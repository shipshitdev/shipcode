import { simpleGit, type SimpleGit } from 'simple-git'
import path from 'node:path'
import { WORKTREE_DIR } from '@crosscode/shared'

export class WorktreeManager {
  private git: SimpleGit

  constructor(private projectPath: string) {
    this.git = simpleGit(projectPath)
  }

  getWorktreePath(threadId: string): string {
    return path.join(this.projectPath, WORKTREE_DIR, threadId)
  }

  getBranchName(threadId: string): string {
    return `crosscode/${threadId}`
  }

  async create(threadId: string, baseBranch?: string): Promise<{ worktreePath: string; branch: string }> {
    const worktreePath = this.getWorktreePath(threadId)
    const branch = this.getBranchName(threadId)

    const base = baseBranch ?? (await this.getDefaultBranch())

    // Create worktree with new branch
    await this.git.raw(['worktree', 'add', '-b', branch, worktreePath, base])

    return { worktreePath, branch }
  }

  async remove(threadId: string): Promise<void> {
    const worktreePath = this.getWorktreePath(threadId)
    const branch = this.getBranchName(threadId)

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

  async list(): Promise<string[]> {
    const result = await this.git.raw(['worktree', 'list', '--porcelain'])
    const worktrees: string[] = []
    for (const line of result.split('\n')) {
      if (line.startsWith('worktree ')) {
        const wtPath = line.replace('worktree ', '').trim()
        if (wtPath.includes(WORKTREE_DIR)) {
          worktrees.push(wtPath)
        }
      }
    }
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
      if (branches.all.includes('main')) return 'main'
      if (branches.all.includes('master')) return 'master'
      return branches.current ?? 'main'
    }
  }
}
