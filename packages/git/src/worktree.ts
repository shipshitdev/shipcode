import { simpleGit, type SimpleGit } from 'simple-git'
import path from 'node:path'
import { resolveWorktreeParent } from '@shipcode/shared'

export interface WorktreeManagerOptions {
  /**
   * User-configured worktree root.
   *   null | undefined → use DEFAULT_WORKTREE_ROOT (~/.shipcode/worktrees)
   *   ''               → legacy project-local (<project>/.shipcode/worktrees)
   *   absolute or ~/…  → custom location
   */
  worktreeRoot?: string | null
}

export class WorktreeManager {
  private git: SimpleGit

  constructor(private projectPath: string, private options: WorktreeManagerOptions = {}) {
    this.git = simpleGit(projectPath)
  }

  getBranchName(threadId: string): string {
    return `shipcode/${threadId}`
  }

  getWorktreePath(threadId: string): string {
    return path.join(
      resolveWorktreeParent(this.projectPath, this.options.worktreeRoot ?? null),
      threadId,
    )
  }

  async create(threadId: string, baseBranch?: string): Promise<{ worktreePath: string; branch: string }> {
    const worktreePath = this.getWorktreePath(threadId)
    const branch = this.getBranchName(threadId)

    const base = baseBranch ?? (await this.getDefaultBranch())

    // Create worktree with new branch
    await this.git.raw(['worktree', 'add', '-b', branch, worktreePath, base])

    return { worktreePath, branch }
  }

  /**
   * Remove a worktree using its persisted path and branch rather than
   * recomputing from threadId. This insulates cleanup from settings changes
   * that happened after the worktree was created.
   */
  async remove(worktreePath: string, branch: string): Promise<void> {
    try {
      await this.git.raw(['worktree', 'remove', worktreePath, '--force'])
    } catch {
      // Worktree may already be removed
    }

    try {
      await this.git.deleteLocalBranch(branch, true)
    } catch {
      // Branch may already be deleted
    }
  }

  /**
   * List all ShipCode worktrees in this project by branch-name prefix.
   * Returns { path, branch } pairs so callers can act on either identifier.
   */
  async list(): Promise<Array<{ path: string; branch: string }>> {
    const result = await this.git.raw(['worktree', 'list', '--porcelain'])
    const worktrees: Array<{ path: string; branch: string }> = []
    let current: { path?: string; branch?: string } = {}
    const push = () => {
      if (current.path && current.branch && current.branch.startsWith('shipcode/')) {
        worktrees.push({ path: current.path, branch: current.branch })
      }
    }
    for (const line of result.split('\n')) {
      if (line.startsWith('worktree ')) {
        push()
        current = { path: line.slice('worktree '.length).trim() }
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
      } else if (line === '') {
        push()
        current = {}
      }
    }
    push()
    return worktrees
  }

  async merge(threadId: string, targetBranch?: string, strategy: 'merge' | 'squash' = 'merge'): Promise<void> {
    const branch = this.getBranchName(threadId)
    const target = targetBranch ?? (await this.getDefaultBranch())

    // Switch to target branch in main worktree
    await this.git.checkout(target)

    if (strategy === 'squash') {
      await this.git.raw(['merge', '--squash', branch])
      await this.git.commit(`feat: merge ${branch} (squashed)`)
    } else {
      await this.git.merge([branch, '--no-ff'])
    }
  }

  private async getDefaultBranch(): Promise<string> {
    try {
      const result = await this.git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'])
      return result.trim().replace('origin/', '')
    } catch {
      const branches = await this.git.branchLocal()
      // Check current branch first, then common defaults
      if (branches.current) return branches.current
      if (branches.all.includes('main')) return 'main'
      if (branches.all.includes('master')) return 'master'
      return 'main'
    }
  }
}
