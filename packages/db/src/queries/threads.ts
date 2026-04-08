import type { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import type { Thread, ThreadStatus } from '@shipcode/shared'

export class ThreadQueries {
  constructor(private db: DatabaseSync) {}

  list(projectId: string): Thread[] {
    const rows = this.db.prepare(
      'SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC'
    ).all(projectId) as any[]
    return rows.map(mapThread)
  }

  getById(id: string): Thread | null {
    const row = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as any
    return row ? mapThread(row) : null
  }

  create(projectId: string, prompt: string, title: string): Thread {
    const id = nanoid()
    const now = new Date().toISOString()

    this.db.prepare(
      `INSERT INTO threads (id, project_id, title, prompt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, projectId, title, prompt, now, now)

    return this.getById(id)!
  }

  updateStatus(id: string, status: ThreadStatus): void {
    this.db.prepare(
      `UPDATE threads SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(status, id)
  }

  setWorktree(id: string, branch: string, worktreePath: string): void {
    this.db.prepare(
      `UPDATE threads SET worktree_branch = ?, worktree_path = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(branch, worktreePath, id)
  }

  clearWorktree(id: string): void {
    this.db.prepare(
      `UPDATE threads SET worktree_branch = NULL, worktree_path = NULL, updated_at = datetime('now') WHERE id = ?`
    ).run(id)
  }

  updateAutonomousFields(id: string, fields: {
    autonomous: boolean
    reviewRound: number
    executorModel: string
    baseBranch: string
    forkPointSha: string
  }): void {
    this.db.prepare(
      'UPDATE threads SET autonomous = ?, review_round = ?, executor_model = ?, base_branch = ?, fork_point_sha = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(fields.autonomous ? 1 : 0, fields.reviewRound, fields.executorModel, fields.baseBranch, fields.forkPointSha, id)
  }

  incrementReviewRound(id: string): void {
    this.db.prepare(
      'UPDATE threads SET review_round = review_round + 1, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(id)
  }

  setVerificationStatus(id: string, status: string): void {
    this.db.prepare(
      'UPDATE threads SET verification_status = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(status, id)
  }

  setGithubIssue(id: string, issueNumber: number, repo: string | null): void {
    this.db.prepare(
      'UPDATE threads SET github_issue_number = ?, github_repo = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(issueNumber, repo, id)
  }

  setGithubPr(id: string, prNumber: number): void {
    this.db.prepare(
      'UPDATE threads SET github_pr_number = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(prNumber, id)
  }

  hasActivePipeline(projectId: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM threads WHERE project_id = ? AND status IN (\'planning\', \'reviewing\', \'revising\', \'executing\', \'verifying\', \'shipping\') LIMIT 1'
    ).get(projectId)
    return !!row
  }

  getOrphaned(): any[] {
    return this.db.prepare(
      'SELECT * FROM threads WHERE status IN (\'planning\', \'reviewing\', \'revising\', \'executing\', \'verifying\', \'shipping\')'
    ).all()
  }
}

function mapThread(row: any): Thread {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    prompt: row.prompt,
    status: row.status as ThreadStatus,
    worktreeBranch: row.worktree_branch,
    worktreePath: row.worktree_path,
    plannerModel: row.planner_model,
    reviewerModel: row.reviewer_model,
    executorModel: row.executor_model ?? 'claude',
    reviewRound: row.review_round ?? 0,
    verificationStatus: row.verification_status ?? null,
    verificationRetries: row.verification_retries ?? 0,
    autonomous: !!(row.autonomous),
    baseBranch: row.base_branch ?? null,
    forkPointSha: row.fork_point_sha ?? null,
    githubIssueNumber: row.github_issue_number ?? null,
    githubPrNumber: row.github_pr_number ?? null,
    githubRepo: row.github_repo ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
