import { simpleGit, type SimpleGit } from 'simple-git';
import path from 'node:path';
import { resolveWorktreeParent } from '@shipcode/shared';

export interface WorktreeManagerOptions {
  /**
   * User-configured worktree root.
   *   null | undefined → use DEFAULT_WORKTREE_ROOT (~/.shipcode/worktrees)
   *   ''               → legacy project-local (<project>/.shipcode/worktrees)
   *   absolute or ~/…  → custom location
   */
  worktreeRoot?: string | null;
}

export class WorktreeManager {
  private git: SimpleGit;

  constructor(
    private projectPath: string,
    private options: WorktreeManagerOptions = {},
  ) {
    this.git = simpleGit(projectPath);
  }

  getBranchName(threadId: string): string {
    return `shipcode/${threadId}`;
  }

  getWorktreePath(threadId: string): string {
    return path.join(
      resolveWorktreeParent(this.projectPath, this.options.worktreeRoot ?? null),
      threadId,
    );
  }

  async create(
    threadId: string,
    baseBranch?: string,
  ): Promise<{ worktreePath: string; branch: string }> {
    const worktreePath = this.getWorktreePath(threadId);
    const branch = this.getBranchName(threadId);

    const base = baseBranch ?? (await this.getDefaultBranch());

    // Create worktree with new branch
    await this.git.raw(['worktree', 'add', '-b', branch, worktreePath, base]);

    return { worktreePath, branch };
  }

  /**
   * Remove a worktree using its persisted path and branch rather than
   * recomputing from threadId. This insulates cleanup from settings changes
   * that happened after the worktree was created.
   *
   * Returns structured per-step results so callers can distinguish "already
   * gone" (safe, treated as success) from real failures (surfaced via
   * `error`). The `project:remove` handler uses this signal to fail closed
   * before deleting the registry row — previously the method swallowed all
   * errors, which allowed orphaned worktrees on disk with no project row to
   * recover them.
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

  /**
   * List all ShipCode worktrees in this project by branch-name prefix.
   * Returns { path, branch } pairs so callers can act on either identifier.
   */
  async list(): Promise<Array<{ path: string; branch: string }>> {
    const result = await this.git.raw(['worktree', 'list', '--porcelain']);
    const worktrees: Array<{ path: string; branch: string }> = [];
    let current: { path?: string; branch?: string } = {};
    const push = () => {
      if (current.path && current.branch && current.branch.startsWith('shipcode/')) {
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

  async merge(
    threadId: string,
    targetBranch?: string,
    strategy: 'merge' | 'squash' = 'merge',
  ): Promise<void> {
    const branch = this.getBranchName(threadId);
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
