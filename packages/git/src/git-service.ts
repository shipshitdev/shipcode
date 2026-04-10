import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git'
import type { GitState } from '@shipcode/shared'
import { normalizeBranches } from '@shipcode/shared'

export class GitService {
  private git: SimpleGit

  constructor(private projectPath: string) {
    this.git = simpleGit(projectPath)
  }

  async getStatus(): Promise<GitState> {
    const status: StatusResult = await this.git.status()
    const log = await this.git.log({ maxCount: 1 })

    return {
      branch: status.current ?? 'HEAD',
      commitHash: log.latest?.hash ?? '',
      isDirty: !status.isClean(),
      untrackedCount: status.not_added.length,
      stagedCount: status.staged.length,
      modifiedCount: status.modified.length,
    }
  }

  async getDiff(worktreePath?: string): Promise<string> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git
    return git.diff()
  }

  async getDiffStat(worktreePath?: string): Promise<string> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git
    return git.diff(['--stat'])
  }

  async getDiffFromSha(sha: string, head?: string): Promise<string> {
    const ref = head ? `${sha}..${head}` : `${sha}..HEAD`
    return this.git.diff([ref])
  }

  async commit(message: string, worktreePath?: string): Promise<string> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git
    await git.add('.')
    const result = await git.commit(message)
    return result.commit
  }

  async push(branch?: string, worktreePath?: string): Promise<void> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git
    if (branch) {
      await git.push('origin', branch, ['--set-upstream'])
    } else {
      await git.push()
    }
  }

  /**
   * List all branches in this repository as resolvable refs, suitable for
   * display in the base-branch selector. Local branches keep plain names;
   * remote-only branches keep their "<remote>/<name>" prefix. Sorted so the
   * passed `defaultBranch` appears first.
   */
  async listBranches(defaultBranch: string): Promise<string[]> {
    const result = await this.git.branch(['-a'])
    return normalizeBranches({ raw: result.all, defaultBranch })
  }

  async getDefaultBranch(): Promise<string> {
    try {
      const result = await this.git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'])
      return result.trim().replace('origin/', '')
    } catch {
      // Fallback: check if main or master exists
      const branches = await this.git.branchLocal()
      if (branches.all.includes('main')) return 'main'
      if (branches.all.includes('master')) return 'master'
      return branches.current ?? 'main'
    }
  }

  async getRemoteUrl(): Promise<string | null> {
    try {
      const remotes = await this.git.getRemotes(true)
      const origin = remotes.find((r) => r.name === 'origin')
      return origin?.refs.fetch ?? null
    } catch {
      return null
    }
  }

  async log(count: number = 10, worktreePath?: string): Promise<Array<{ hash: string; message: string; date: string }>> {
    const git = worktreePath ? simpleGit(worktreePath) : this.git
    const result = await git.log({ maxCount: count })
    return result.all.map((entry) => ({
      hash: entry.hash,
      message: entry.message,
      date: entry.date,
    }))
  }
}
