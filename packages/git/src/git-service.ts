import fs from 'node:fs';
import path from 'node:path';
import type { GitState } from '@shipcode/shared';
import { normalizeBranches } from '@shipcode/shared';
import { type SimpleGit, type StatusResult, simpleGit } from 'simple-git';

function isUnavailableGitRepositoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not a git repository|Cannot use simple-git on a directory that does not exist/i.test(
    message,
  );
}

export class GitService {
  private git: SimpleGit;

  constructor(projectPath: string) {
    this.git = simpleGit(projectPath);
  }

  async getStatus(worktreePath?: string, compareFallbackRef?: string): Promise<GitState> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git;
    const status: StatusResult = await git.status();
    const log = await git.log({ maxCount: 1 });
    const divergence = await this.getDivergence(git, compareFallbackRef);
    const preCommitHookPath = await this.getPreCommitHookPath(worktreePath);

    return {
      branch: status.current ?? 'HEAD',
      commitHash: log.latest?.hash ?? '',
      isDirty: !status.isClean(),
      untrackedCount: status.not_added.length,
      stagedCount: status.staged.length,
      modifiedCount: status.modified.length,
      aheadCount: divergence.aheadCount,
      behindCount: divergence.behindCount,
      compareRef: divergence.compareRef,
      preCommitHookPath,
    };
  }

  async getDiff(worktreePath?: string): Promise<string> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git;
    return git.diff();
  }

  async getDiffAgainstHead(worktreePath?: string): Promise<string> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git;
    return git.diff(['HEAD']);
  }

  async getDiffStat(worktreePath?: string): Promise<string> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git;
    return git.diff(['--stat']);
  }

  async commit(message: string, worktreePath?: string): Promise<string> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git;
    await git.add('.');
    const result = await git.commit(message);
    return result.commit;
  }

  async push(branch?: string, worktreePath?: string): Promise<void> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git;
    if (branch) {
      await git.push('origin', branch, ['--set-upstream']);
    } else {
      await git.push();
    }
  }

  /**
   * List all branches in this repository as resolvable refs, suitable for
   * display in the base-branch selector. Local branches keep plain names;
   * remote-only branches keep their "<remote>/<name>" prefix. Sorted so the
   * passed `defaultBranch` appears first.
   */
  async fetch(): Promise<void> {
    try {
      await this.git.fetch(['--prune']);
    } catch (error) {
      if (isUnavailableGitRepositoryError(error)) return;
      throw error;
    }
  }

  async listBranches(defaultBranch: string): Promise<string[]> {
    try {
      const result = await this.git.branch(['-a']);
      return normalizeBranches({ raw: result.all, defaultBranch });
    } catch (error) {
      if (isUnavailableGitRepositoryError(error)) return [];
      throw error;
    }
  }

  async getDefaultBranch(): Promise<string> {
    try {
      const result = await this.git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short']);
      return result.trim().replace('origin/', '');
    } catch {
      // Fallback: check if main or master exists
      const branches = await this.git.branchLocal();
      if (branches.all.includes('main')) return 'main';
      if (branches.all.includes('master')) return 'master';
      return branches.current ?? 'main';
    }
  }

  async getRemoteUrl(): Promise<string | null> {
    try {
      const remotes = await this.git.getRemotes(true);
      const origin = remotes.find((r) => r.name === 'origin');
      return origin?.refs.fetch ?? null;
    } catch {
      return null;
    }
  }

  async log(
    count: number = 10,
    worktreePath?: string,
  ): Promise<Array<{ hash: string; message: string; date: string }>> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git;
    const result = await git.log({ maxCount: count });
    return result.all.map((entry) => ({
      hash: entry.hash,
      message: entry.message,
      date: entry.date,
    }));
  }

  /** Stage explicit paths only — no `add('.')`. Used by auto-commit splitter. */
  async addPaths(paths: string[], worktreePath?: string): Promise<void> {
    if (paths.length === 0) return;
    const git = worktreePath ? simpleGit(worktreePath) : this.git;
    await git.add(paths);
  }

  /** Mixed reset to clear the index without touching the working tree. */
  async resetIndex(worktreePath?: string): Promise<void> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git;
    await git.reset(['--mixed']);
  }

  /** Commit whatever is currently staged. Does NOT call add('.') first. */
  async commitStaged(message: string, worktreePath?: string): Promise<string> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git;
    const result = await git.commit(message);
    return result.commit;
  }

  /** Names of files currently in the staging area. */
  async getStagedFiles(worktreePath?: string): Promise<string[]> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git;
    const raw = await git.diff(['--cached', '--name-only']);
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /** Force-delete a local branch. */
  async deleteLocalBranch(branch: string, worktreePath?: string): Promise<void> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git;
    await git.branch(['-D', branch]);
  }

  /** Delete a remote branch via push --delete. */
  async deleteRemoteBranch(branch: string, remote = 'origin'): Promise<void> {
    await this.git.push([remote, '--delete', branch]);
  }

  /**
   * Batch-check dirty state across many worktree paths.
   * Returns Map<path, isDirty>.
   */
  async getDirtyWorktrees(paths: string[]): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    await Promise.all(
      paths.map(async (p) => {
        try {
          const status = await simpleGit(p).status();
          out.set(p, !status.isClean());
        } catch {
          out.set(p, true);
        }
      }),
    );
    return out;
  }

  /** Full status for a worktree — used by auto-commit to enumerate dirty set. */
  async getRawStatus(worktreePath?: string): Promise<StatusResult> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git;
    return git.status();
  }

  async getPreCommitHookPath(worktreePath?: string): Promise<string | null> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git;
    try {
      const root = (await git.revparse(['--show-toplevel'])).trim();
      const configuredPath = (await git.raw(['config', '--get', 'core.hooksPath']).catch(() => ''))
        .trim()
        .replace(/^"(.*)"$/, '$1');
      const gitPath = configuredPath
        ? ''
        : (await git.raw(['rev-parse', '--git-path', 'hooks/pre-commit'])).trim();
      const hookPath = configuredPath
        ? path.resolve(root, configuredPath, 'pre-commit')
        : gitPath
          ? path.resolve(root, gitPath)
          : '';
      if (!hookPath || !fs.existsSync(hookPath)) return null;
      return hookPath;
    } catch {
      return null;
    }
  }

  async getBranchDivergence(
    branch: string,
    compareRef: string,
  ): Promise<{ aheadCount: number; behindCount: number; compareRef: string | null }> {
    if (
      !(await this.refExists(this.git, branch)) ||
      !(await this.refExists(this.git, compareRef))
    ) {
      return { aheadCount: 0, behindCount: 0, compareRef: null };
    }
    try {
      const raw = await this.git.raw([
        'rev-list',
        '--left-right',
        '--count',
        `${compareRef}...${branch}`,
      ]);
      const [behindRaw, aheadRaw] = raw.trim().split(/\s+/);
      return {
        aheadCount: Number.parseInt(aheadRaw ?? '0', 10) || 0,
        behindCount: Number.parseInt(behindRaw ?? '0', 10) || 0,
        compareRef,
      };
    } catch {
      return { aheadCount: 0, behindCount: 0, compareRef };
    }
  }

  private async getDivergence(
    git: SimpleGit,
    compareFallbackRef?: string,
  ): Promise<{ aheadCount: number; behindCount: number; compareRef: string | null }> {
    const compareRef = await this.resolveCompareRef(git, compareFallbackRef);
    if (!compareRef) return { aheadCount: 0, behindCount: 0, compareRef: null };

    try {
      const raw = await git.raw(['rev-list', '--left-right', '--count', `${compareRef}...HEAD`]);
      const [behindRaw, aheadRaw] = raw.trim().split(/\s+/);
      return {
        aheadCount: Number.parseInt(aheadRaw ?? '0', 10) || 0,
        behindCount: Number.parseInt(behindRaw ?? '0', 10) || 0,
        compareRef,
      };
    } catch {
      return { aheadCount: 0, behindCount: 0, compareRef };
    }
  }

  private async resolveCompareRef(
    git: SimpleGit,
    compareFallbackRef?: string,
  ): Promise<string | null> {
    let upstream = '';
    try {
      upstream = (
        await git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
      ).trim();
    } catch {
      upstream = '';
    }
    if (upstream && (await this.refExists(git, upstream))) return upstream;
    if (compareFallbackRef && (await this.refExists(git, compareFallbackRef))) {
      return compareFallbackRef;
    }
    return null;
  }

  private async refExists(git: SimpleGit, ref: string): Promise<boolean> {
    try {
      await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Local branches with metadata used by cleanup-analyzer.
   * Detects remote-tracking via `git for-each-ref` upstream-shortname.
   */
  async listLocalBranchesWithMeta(): Promise<
    Array<{ name: string; hasRemote: boolean; lastCommitDate: string }>
  > {
    const raw = await this.git.raw([
      'for-each-ref',
      '--format=%(refname:short)\t%(upstream:short)\t%(committerdate:iso-strict)',
      'refs/heads',
    ]);
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [name, upstream, date] = line.split('\t');
        return {
          name,
          hasRemote: !!upstream && upstream.length > 0,
          lastCommitDate: date ?? '',
        };
      });
  }
}
