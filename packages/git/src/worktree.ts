import path from 'node:path';
import { formatIssueBranch as formatIssueBranchShared, slugifyIssueTitle } from '@shipcode/shared';
import { resolveWorktreeParent } from '@shipcode/shared/worktree-path';
import { type SimpleGit, simpleGit } from 'simple-git';

export interface WorktreeManagerOptions {
  /**
   * User-configured worktree root.
   *   null | undefined → use DEFAULT_WORKTREE_ROOT (~/.shipcode/worktrees)
   *   ''               → legacy project-local (<project>/.shipcode/worktrees)
   *   absolute or ~/…  → custom location
   */
  worktreeRoot?: string | null;
  /**
   * Branch naming format for issue-based worktrees.
   * Tokens: {id} = issue number, {slug} = slugified issue title.
   * Default: 'ship/{id}-{slug}'.
   */
  branchFormat?: string;
}

const slugify = slugifyIssueTitle;

/** ShipCode-managed branch prefixes for list() filtering. */
const SHIPCODE_BRANCH_RE = /^(shipcode\/|ship\/\d+)/;

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
  /** Legacy branch name for non-issue (manual thread) worktrees. */
  getBranchName(threadId: string): string;
  getBranchName(idOrNumber: string | number, title?: string): string {
    if (typeof idOrNumber === 'number') {
      return this.formatIssueBranch(idOrNumber, title ?? '');
    }
    return `shipcode/${idOrNumber}`;
  }

  /** Worktree path for an issue-based worktree. */
  getWorktreePath(issueNumber: number, title: string): string;
  /** Legacy worktree path for non-issue (manual thread) worktrees. */
  getWorktreePath(threadId: string): string;
  getWorktreePath(idOrNumber: string | number, title?: string): string {
    const parent = resolveWorktreeParent(this.projectPath, this.options.worktreeRoot ?? null);
    if (typeof idOrNumber === 'number') {
      return path.join(parent, this.formatIssueDir(idOrNumber, title ?? ''));
    }
    return path.join(parent, idOrNumber);
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
  ): Promise<{ worktreePath: string; branch: string }>;
  /**
   * Create a worktree for a manual thread (legacy threadId-based name).
   */
  async create(
    threadId: string,
    baseBranch?: string,
  ): Promise<{ worktreePath: string; branch: string }>;
  async create(
    idOrNumber: string | number,
    titleOrBase?: string,
    baseBranch?: string,
  ): Promise<{ worktreePath: string; branch: string }> {
    const parent = resolveWorktreeParent(this.projectPath, this.options.worktreeRoot ?? null);
    const base =
      typeof idOrNumber === 'number'
        ? (baseBranch ?? (await this.getDefaultBranch()))
        : (titleOrBase ?? (await this.getDefaultBranch()));

    await this.prune();

    let branch: string;
    let dirName: string;

    if (typeof idOrNumber === 'number') {
      const title = titleOrBase ?? '';
      const rawBranch = this.formatIssueBranch(idOrNumber, title);
      branch = await this.resolveUniqueBranch(rawBranch);
      dirName = this.formatIssueDir(idOrNumber, title);
      // If branch was suffixed for collision, match the dir name
      if (branch !== rawBranch) {
        const suffix = branch.slice(rawBranch.length);
        dirName = dirName + suffix;
      }
    } else {
      branch = this.getBranchName(idOrNumber);
      dirName = idOrNumber;
    }

    // Retry loop: if a concurrent start grabs the branch between our check
    // and the actual `worktree add`, bump the suffix and try again.
    const MAX_RETRIES = 3;
    for (let attempt = 0; ; attempt++) {
      const worktreePath = path.join(parent, dirName);
      try {
        await this.git.raw([
          ...NO_CONFIG_LOCK_FLAGS,
          'worktree',
          'add',
          '-b',
          branch,
          worktreePath,
          base,
        ]);
        return { worktreePath, branch };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isCollision = /already exists|is already checked out/i.test(msg);
        if (!isCollision || attempt >= MAX_RETRIES) throw err;
        // Bump suffix and retry
        const nextN = branch.match(/-(\d+)$/) ? Number(branch.match(/-(\d+)$/)?.[1]) + 1 : 2;
        const rawBranch =
          typeof idOrNumber === 'number'
            ? this.formatIssueBranch(idOrNumber, titleOrBase ?? '')
            : this.getBranchName(idOrNumber);
        branch = `${rawBranch}-${nextN}`;
        const rawDir =
          typeof idOrNumber === 'number'
            ? this.formatIssueDir(idOrNumber, titleOrBase ?? '')
            : String(idOrNumber);
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

  async repair(worktreePaths: string[]): Promise<void> {
    if (worktreePaths.length === 0) return;
    await this.git.raw(['worktree', 'repair', ...worktreePaths]);
  }

  async prune(): Promise<void> {
    await this.git.raw(['worktree', 'prune']);
  }

  async move(fromPath: string, toPath: string): Promise<void> {
    await this.git.raw(['worktree', 'move', fromPath, toPath]);
  }

  /**
   * List all ShipCode worktrees in this project by branch-name prefix.
   * Returns { path, branch } pairs so callers can act on either identifier.
   * Matches both legacy `shipcode/` and `ship/{N}-` branch patterns.
   */
  async list(): Promise<Array<{ path: string; branch: string }>> {
    const result = await this.git.raw(['worktree', 'list', '--porcelain']);
    const worktrees: Array<{ path: string; branch: string }> = [];
    let current: { path?: string; branch?: string } = {};
    const push = () => {
      if (current.path && current.branch && SHIPCODE_BRANCH_RE.test(current.branch)) {
        worktrees.push({ path: current.path, branch: current.branch });
      }
    };
    for (const line of result.split('\n')) {
      if (line.startsWith('worktree ')) {
        push();
        current = { path: line.slice('worktree '.length).trim() };
      } else if (line.startsWith('branch ')) {
        current.branch = line
          .slice('branch '.length)
          .trim()
          .replace(/^refs\/heads\//, '');
      } else if (line === '') {
        push();
        current = {};
      }
    }
    push();
    return worktrees;
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

    // Switch to target branch in main worktree
    await this.git.checkout(target);

    if (strategy === 'squash') {
      await this.git.raw(['merge', '--squash', branch]);
      await this.git.commit(`feat: merge ${branch} (squashed)`);
    } else {
      await this.git.merge([branch, '--no-ff']);
    }
  }

  private async getDefaultBranch(): Promise<string> {
    try {
      const result = await this.git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short']);
      return result.trim().replace('origin/', '');
    } catch {
      const branches = await this.git.branchLocal();
      // Check current branch first, then common defaults
      if (branches.current) return branches.current;
      if (branches.all.includes('main')) return 'main';
      if (branches.all.includes('master')) return 'master';
      return 'main';
    }
  }
}
