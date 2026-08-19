import path from 'node:path';
import {
  formatIssueBranch as formatIssueBranchShared,
  isShipCodeBranch,
  SHIPCODE_BRANCH_PREFIX,
  slugifyIssueTitle,
} from '@shipcode/shared';
import { resolveWorktreeParent } from '@shipcode/shared/worktree-path';
import { type SimpleGit, simpleGit } from 'simple-git';
import { resolveDefaultBranch } from './default-branch';
import {
  listWorktreeArtifacts,
  pruneWorktreeArtifacts,
  type WorktreeArtifact,
  type WorktreeArtifactCleanupResult,
} from './worktree-artifacts';
import {
  assertCanonicalWorktreePath,
  assertRegisteredWorktree,
  assertSafeWorktreeBranch,
  assertWorktreeCreateTarget,
  listRegisteredWorktrees,
} from './worktree-safety';

export interface WorktreeCreateResult {
  worktreePath: string;
  branch: string;
  /**
   * The ref the worktree was actually forked from. Normally `origin/<base>`
   * (after a fresh fetch); falls back to a local ref when the fetch failed, or
   * to the repo default (`main`/`master`) when the stored base no longer exists.
   */
  baseRef: string;
  /**
   * True when the origin fetch failed and we forked from a possibly-stale local
   * ref. Callers should surface a "base may be stale" warning to the user.
   */
  baseStale: boolean;
}

export interface WorktreeManagerOptions {
  /**
   * User-configured worktree root.
   *   null | undefined → use DEFAULT_WORKTREE_ROOT (~/.shipcode/worktrees)
   *   absolute or ~/…  → custom location
   */
  worktreeRoot?: string | null;
  /**
   * Branch naming format for issue-based worktrees.
   * Tokens: {id} = issue number, {slug} = slugified issue title.
   * Default: 'shipcode/{id}-{slug}'.
   */
  branchFormat?: string;
}

const slugify = slugifyIssueTitle;

/**
 * Prevent `git worktree add -b` from writing branch tracking config while
 * concurrent pipeline starts are also creating worktrees in the same repo.
 * The branch itself is still created; these flags only avoid non-essential
 * `.git/config` mutations that can contend on `config.lock`.
 */
const NO_CONFIG_LOCK_FLAGS = [
  '-c',
  'branch.autoSetupMerge=false',
  '-c',
  'push.autoSetupRemote=false',
];

export class WorktreeManager {
  private git: SimpleGit;

  constructor(
    private projectPath: string,
    private options: WorktreeManagerOptions = {},
  ) {
    this.git = simpleGit(projectPath);
  }

  /** Build branch name for an issue-based worktree. */
  private formatIssueBranch(issueNumber: number, title: string): string {
    return formatIssueBranchShared(issueNumber, title, this.options.branchFormat ?? null);
  }

  /** Build directory name for an issue-based worktree. */
  private formatIssueDir(issueNumber: number, title: string): string {
    const slug = slugify(title);
    const dir = slug ? `${issueNumber}-${slug}` : String(issueNumber);
    return dir;
  }

  /** Branch name for an issue-based worktree. */
  getBranchName(issueNumber: number, title: string): string;
  /** Branch name for non-issue worktrees. Uses the title slug when available. */
  getBranchName(threadId: string, title?: string): string;
  getBranchName(idOrNumber: string | number, title?: string): string {
    if (typeof idOrNumber === 'number') {
      return this.formatIssueBranch(idOrNumber, title ?? '');
    }
    const slug = title ? slugify(title) : '';
    return `${SHIPCODE_BRANCH_PREFIX}${slug || idOrNumber}`;
  }

  /** Worktree path for an issue-based worktree. */
  getWorktreePath(issueNumber: number, title: string): string;
  /** Worktree path for non-issue worktrees. Uses the title slug when available. */
  getWorktreePath(threadId: string, title?: string): string;
  getWorktreePath(idOrNumber: string | number, title?: string): string {
    const parent = resolveWorktreeParent(this.projectPath, this.options.worktreeRoot ?? null);
    if (typeof idOrNumber === 'number') {
      const worktreePath = path.join(parent, this.formatIssueDir(idOrNumber, title ?? ''));
      assertCanonicalWorktreePath(worktreePath, 'worktree path');
      return worktreePath;
    }
    const slug = title ? slugify(title) : '';
    const worktreePath = path.join(parent, slug || idOrNumber);
    assertCanonicalWorktreePath(worktreePath, 'worktree path');
    if (path.dirname(worktreePath) !== path.resolve(parent)) {
      throw new Error(
        `worktree path must be a direct child of its configured parent: ${worktreePath}`,
      );
    }
    return worktreePath;
  }

  /**
   * Check if a branch already exists. Used for collision detection on re-runs.
   */
  private async branchExists(branch: string): Promise<boolean> {
    try {
      await this.git.raw(['rev-parse', '--verify', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  /** True when `ref` names a commit — local branch, remote-tracking, or SHA. */
  private async commitExists(ref: string): Promise<boolean> {
    try {
      await this.git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find a non-colliding branch name by appending -2, -3, etc.
   */
  private async resolveUniqueBranch(baseBranch: string): Promise<string> {
    if (!(await this.branchExists(baseBranch))) return baseBranch;
    let n = 2;
    while (await this.branchExists(`${baseBranch}-${n}`)) {
      n++;
    }
    return `${baseBranch}-${n}`;
  }

  /**
   * Create a worktree for a GitHub issue (human-readable branch name).
   */
  async create(
    issueNumber: number,
    title: string,
    baseBranch?: string,
  ): Promise<WorktreeCreateResult>;
  /**
   * Create a worktree for a non-issue thread. Pass a title for slug-based names.
   */
  async create(threadId: string, baseBranch?: string): Promise<WorktreeCreateResult>;
  async create(threadId: string, title: string, baseBranch?: string): Promise<WorktreeCreateResult>;
  async create(
    idOrNumber: string | number,
    ...rest: [titleOrBase?: string, baseBranch?: string]
  ): Promise<WorktreeCreateResult> {
    const [titleOrBase, baseBranch] = rest;
    const parent = resolveWorktreeParent(this.projectPath, this.options.worktreeRoot ?? null);
    const hasExplicitThreadTitle = typeof idOrNumber === 'string' && rest.length >= 2;
    const threadTitle = hasExplicitThreadTitle ? titleOrBase : undefined;
    const base =
      typeof idOrNumber === 'number'
        ? (baseBranch ?? (await this.getDefaultBranch()))
        : ((hasExplicitThreadTitle ? baseBranch : titleOrBase) ?? (await this.getDefaultBranch()));

    let branch: string;
    let dirName: string;
    let rawIssueBranch: string | null = null;

    if (typeof idOrNumber === 'number') {
      const title = titleOrBase ?? '';
      rawIssueBranch = this.formatIssueBranch(idOrNumber, title);
      branch = rawIssueBranch;
      dirName = this.formatIssueDir(idOrNumber, title);
    } else {
      branch = this.getBranchName(idOrNumber, threadTitle);
      dirName = threadTitle ? slugify(threadTitle) || idOrNumber : idOrNumber;
    }

    assertSafeWorktreeBranch(branch);
    await this.prune();

    if (rawIssueBranch) {
      branch = await this.resolveUniqueBranch(rawIssueBranch);
      if (branch !== rawIssueBranch) {
        dirName += branch.slice(rawIssueBranch.length);
      }
    }

    // Fork from the freshest remote tip, not a possibly-stale local ref.
    // Resolve once, before the retry loop, so a concurrent-collision retry
    // never re-fetches.
    const { ref: forkRef, stale: baseStale } = await this.resolveForkBase(base);

    // Retry loop: if a concurrent start grabs the branch between our check
    // and the actual `worktree add`, bump the suffix and try again.
    const MAX_RETRIES = 3;
    for (let attempt = 0; ; attempt++) {
      const worktreePath = path.join(parent, dirName);
      assertSafeWorktreeBranch(branch);
      try {
        // Validate the target inside the retry so a pre-existing directory is
        // treated as a collision (bump suffix + retry) rather than a hard
        // failure. Security violations (path escape, symlink, traversal) throw
        // messages that don't match the collision regex below, so they still
        // fail fast on the first attempt.
        assertWorktreeCreateTarget(parent, worktreePath);
        await this.git.raw([
          ...NO_CONFIG_LOCK_FLAGS,
          'worktree',
          'add',
          '-b',
          branch,
          worktreePath,
          forkRef,
        ]);
        return { worktreePath, branch, baseRef: forkRef, baseStale };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isCollision = /already exists|is already checked out/i.test(msg);
        if (!isCollision || attempt >= MAX_RETRIES) throw err;
        // Bump suffix and retry
        const nextN = branch.match(/-(\d+)$/) ? Number(branch.match(/-(\d+)$/)?.[1]) + 1 : 2;
        const rawBranch =
          typeof idOrNumber === 'number'
            ? this.formatIssueBranch(idOrNumber, titleOrBase ?? '')
            : this.getBranchName(idOrNumber, threadTitle);
        branch = `${rawBranch}-${nextN}`;
        const rawDir =
          typeof idOrNumber === 'number'
            ? this.formatIssueDir(idOrNumber, titleOrBase ?? '')
            : threadTitle
              ? slugify(threadTitle) || idOrNumber
              : idOrNumber;
        dirName = `${rawDir}-${nextN}`;
      }
    }
  }

  /**
   * Remove a worktree using its persisted path and branch rather than
   * recomputing from threadId. This insulates cleanup from settings changes
   * that happened after the worktree was created.
   */
  async remove(
    worktreePath: string,
    branch: string,
  ): Promise<{ worktreeRemoved: boolean; branchDeleted: boolean; error?: string }> {
    let worktreeRemoved = false;
    let branchDeleted = false;

    await assertRegisteredWorktree({
      git: this.git,
      projectPath: this.projectPath,
      worktreePath,
      branch,
    });

    try {
      await this.git.raw(['worktree', 'remove', worktreePath, '--force']);
      worktreeRemoved = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "not a working tree" / "is not a working tree" / "no such file" → already gone
      if (/not a working tree|is not a working tree|no such file|does not exist/i.test(msg)) {
        worktreeRemoved = true;
      } else {
        return { worktreeRemoved, branchDeleted, error: `worktree remove: ${msg}` };
      }
    }

    try {
      await this.git.deleteLocalBranch(branch, true);
      branchDeleted = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "not found" → already gone
      if (/not found|does not exist/i.test(msg)) {
        branchDeleted = true;
      } else {
        return { worktreeRemoved, branchDeleted, error: `branch delete: ${msg}` };
      }
    }

    return { worktreeRemoved, branchDeleted };
  }

  async repair(worktrees: Array<{ path: string; branch: string }>): Promise<void> {
    if (worktrees.length === 0) return;
    for (const worktree of worktrees) {
      await assertRegisteredWorktree({
        git: this.git,
        projectPath: this.projectPath,
        worktreePath: worktree.path,
        branch: worktree.branch,
        allowBrokenIdentity: true,
      });
    }
    await this.git.raw(['worktree', 'repair', ...worktrees.map((worktree) => worktree.path)]);
  }

  async prune(): Promise<void> {
    await this.git.raw(['worktree', 'prune']);
  }

  /** Validate an existing persisted path/branch pair without mutating Git state. */
  async assertRegistered(worktreePath: string, branch: string): Promise<void> {
    await assertRegisteredWorktree({
      git: this.git,
      projectPath: this.projectPath,
      worktreePath,
      branch,
      requireExisting: true,
    });
  }

  async listArtifacts(worktreePath: string, branch: string): Promise<WorktreeArtifact[]> {
    await assertRegisteredWorktree({
      git: this.git,
      projectPath: this.projectPath,
      worktreePath,
      branch,
      requireExisting: true,
    });
    return listWorktreeArtifacts(worktreePath);
  }

  async pruneArtifacts(
    worktreePath: string,
    branch: string,
  ): Promise<WorktreeArtifactCleanupResult> {
    await assertRegisteredWorktree({
      git: this.git,
      projectPath: this.projectPath,
      worktreePath,
      branch,
      requireExisting: true,
    });
    return pruneWorktreeArtifacts(worktreePath);
  }

  async move(fromPath: string, toPath: string, branch: string): Promise<void> {
    await assertRegisteredWorktree({
      git: this.git,
      projectPath: this.projectPath,
      worktreePath: fromPath,
      branch,
    });
    const expectedParent = resolveWorktreeParent(
      this.projectPath,
      this.options.worktreeRoot ?? null,
    );
    assertWorktreeCreateTarget(expectedParent, toPath);
    await this.git.raw(['worktree', 'move', fromPath, toPath]);
  }

  /**
   * List all ShipCode worktrees in this project by branch-name prefix.
   * Returns { path, branch } pairs so callers can act on either identifier.
   * Matches the `shipcode/` prefix and legacy `ship/{N}-` issue branches.
   */
  async list(): Promise<Array<{ path: string; branch: string }>> {
    return (await listRegisteredWorktrees(this.git)).flatMap((worktree) =>
      worktree.branch && isShipCodeBranch(worktree.branch)
        ? [{ path: worktree.path, branch: worktree.branch }]
        : [],
    );
  }

  /**
   * Merge a worktree branch into a target. Uses the DB-stored branch name
   * directly — does not reconstruct from threadId.
   */
  async merge(
    branch: string,
    targetBranch?: string,
    strategy: 'merge' | 'squash' = 'merge',
  ): Promise<void> {
    const target = targetBranch ?? (await this.getDefaultBranch());

    // Switch to target branch in main worktree. A clone that has only ever been
    // driven through ShipCode worktrees can be missing the local trunk even
    // though `origin/<target>` is present, so materialize it from the remote
    // ref instead of failing the merge outright.
    if (await this.branchExists(target)) {
      await this.git.checkout(target);
    } else {
      await this.git.checkout(['-b', target, `origin/${target}`]);
    }

    if (strategy === 'squash') {
      await this.git.raw(['merge', '--squash', branch]);
      await this.git.commit(`feat: merge ${branch} (squashed)`);
    } else {
      await this.git.merge([branch, '--no-ff']);
    }
  }

  private async getDefaultBranch(): Promise<string> {
    return resolveDefaultBranch(this.git);
  }

  /**
   * Fetch the base branch from origin so a new worktree forks from the freshest
   * remote tip rather than a possibly-stale local ref.
   *
   * The #395 incident: local `master` was 669 commits behind origin, so
   * `git worktree add -b <branch> <path> master` forked from six-week-old code.
   * Plans referenced code that did not exist on the base and every run failed
   * verification.
   *
   * On any fetch failure — offline, no `origin` remote, or a base branch that
   * does not exist on the remote — fall back to the local ref and flag it stale
   * so callers can warn the user instead of silently forking from old code.
   *
   * If the stored base itself is gone (project still says `develop` after the
   * repo moved to `master`), try the real default, then `main`/`master`, rather
   * than handing `git worktree add` an unresolvable name.
   */
  private async resolveForkBase(base: string): Promise<{ ref: string; stale: boolean }> {
    // Already a remote-tracking ref: nothing to freshen locally, use as-is.
    if (base.startsWith('origin/')) return { ref: base, stale: false };

    const fromRemote = await this.fetchOriginBranch(base);
    if (fromRemote) return { ref: fromRemote, stale: false };
    if (await this.commitExists(base)) return { ref: base, stale: true };

    const fallbacks: string[] = [];
    const push = (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === base || trimmed.startsWith('origin/')) return;
      if (fallbacks.includes(trimmed)) return;
      fallbacks.push(trimmed);
    };
    push(await this.getDefaultBranch());
    push('main');
    push('master');

    for (const candidate of fallbacks) {
      const remote = await this.fetchOriginBranch(candidate);
      if (remote) return { ref: remote, stale: false };
      if (await this.commitExists(candidate)) return { ref: candidate, stale: true };
    }

    throw new Error(
      `Cannot create worktree: base branch '${base}' does not exist locally or on origin`,
    );
  }

  private async fetchOriginBranch(branch: string): Promise<string | null> {
    try {
      await this.git.fetch('origin', branch);
      return `origin/${branch}`;
    } catch {
      return null;
    }
  }
}
