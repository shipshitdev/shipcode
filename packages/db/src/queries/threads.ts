import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import { ISO_NOW_SQL, toIsoUtc, type Thread, type ThreadStatus } from '@shipcode/shared';

export class ThreadQueries {
  constructor(private db: DatabaseSync) {}

  list(projectId: string): Thread[] {
    const rows = this.db
      .prepare('SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId) as any[];
    return rows.map(mapThread);
  }

  getById(id: string): Thread | null {
    const row = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as any;
    return row ? mapThread(row) : null;
  }

  create(projectId: string, prompt: string, title: string): Thread {
    const id = nanoid();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO threads (id, project_id, title, prompt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, projectId, title, prompt, now, now);

    return this.getById(id)!;
  }

  updateStatus(id: string, status: ThreadStatus, lastError?: string): void {
    if (lastError !== undefined) {
      this.db
        .prepare(
          `UPDATE threads SET status = ?, last_error = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
        )
        .run(status, lastError, id);
    } else {
      this.db
        .prepare(
          `UPDATE threads SET status = ?, last_error = NULL, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
        )
        .run(status, id);
    }
  }

  setWorktree(id: string, branch: string, worktreePath: string): void {
    this.db
      .prepare(
        `UPDATE threads SET worktree_branch = ?, worktree_path = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(branch, worktreePath, id);
  }

  clearWorktree(id: string): void {
    this.db
      .prepare(
        `UPDATE threads SET worktree_branch = NULL, worktree_path = NULL, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(id);
  }

  updateAutonomousFields(
    id: string,
    fields: {
      autonomous: boolean;
      reviewRound: number;
      executorModel: string;
      baseBranch: string;
      forkPointSha: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE threads SET autonomous = ?, review_round = ?, executor_model = ?, base_branch = ?, fork_point_sha = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(
        fields.autonomous ? 1 : 0,
        fields.reviewRound,
        fields.executorModel,
        fields.baseBranch,
        fields.forkPointSha,
        id,
      );
  }

  incrementReviewRound(id: string): void {
    this.db
      .prepare(
        `UPDATE threads SET review_round = review_round + 1, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(id);
  }

  setVerificationStatus(id: string, status: string): void {
    this.db
      .prepare(
        `UPDATE threads SET verification_status = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(status, id);
  }

  setGithubIssue(id: string, issueNumber: number, repo: string | null): void {
    this.db
      .prepare(
        `UPDATE threads SET github_issue_number = ?, github_repo = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(issueNumber, repo, id);
  }

  setGithubPr(id: string, prNumber: number): void {
    this.db
      .prepare(`UPDATE threads SET github_pr_number = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
      .run(prNumber, id);
  }

  /**
   * Persist what model actually served a given phase. For
   * openrouter/auto runs this captures whatever the meta-router
   * ultimately picked (e.g. 'anthropic/claude-sonnet-4-6'); for
   * claude/codex it just holds the CLI name.
   */
  setResolvedModel(
    id: string,
    phase: 'plan' | 'review' | 'revision' | 'execute' | 'verify',
    model: string,
  ): void {
    const column = (() => {
      switch (phase) {
        case 'plan':
          return 'planner_resolved_model';
        case 'review':
          return 'reviewer_resolved_model';
        case 'revision':
          return 'revisor_resolved_model';
        case 'execute':
          return 'executor_resolved_model';
        case 'verify':
          return 'verifier_resolved_model';
      }
    })();
    this.db
      .prepare(`UPDATE threads SET ${column} = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
      .run(model, id);
  }

  /**
   * Accumulate token + cost usage for a thread. Called after each
   * provider call that reports usage. Uses SQL-side arithmetic so
   * concurrent writers can't lose counts.
   */
  addTokenUsage(id: string, promptTokens: number, completionTokens: number, costUsd: number): void {
    this.db
      .prepare(
        `UPDATE threads SET
         total_tokens_prompt = total_tokens_prompt + ?,
         total_tokens_completion = total_tokens_completion + ?,
         total_cost_usd = total_cost_usd + ?,
         updated_at = ${ISO_NOW_SQL}
       WHERE id = ?`,
      )
      .run(promptTokens, completionTokens, costUsd, id);
  }

  hasActivePipeline(projectId: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM threads WHERE project_id = ? AND status IN ('planning', 'reviewing', 'revising', 'executing', 'testing', 'verifying', 'shipping') LIMIT 1",
      )
      .get(projectId);
    return !!row;
  }

  getOrphaned(): any[] {
    return this.db
      .prepare(
        "SELECT * FROM threads WHERE status IN ('planning', 'reviewing', 'revising', 'executing', 'testing', 'verifying', 'shipping')",
      )
      .all();
  }

  getStuck(thresholdMs: number): Thread[] {
    const thresholdSec = Math.floor(thresholdMs / 1000);
    const rows = this.db
      .prepare(
        `SELECT * FROM threads
         WHERE status IN ('planning', 'reviewing', 'revising', 'executing', 'testing', 'verifying', 'shipping')
           AND updated_at <= datetime('now', '-' || ? || ' seconds')`,
      )
      .all(thresholdSec) as any[];
    return rows.map(mapThread);
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
    autonomous: !!row.autonomous,
    baseBranch: row.base_branch ?? null,
    forkPointSha: row.fork_point_sha ?? null,
    githubIssueNumber: row.github_issue_number ?? null,
    githubPrNumber: row.github_pr_number ?? null,
    githubRepo: row.github_repo ?? null,
    lastError: row.last_error ?? null,
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
    updatedAt: toIsoUtc(row.updated_at) ?? row.updated_at,
    plannerResolvedModel: row.planner_resolved_model ?? null,
    reviewerResolvedModel: row.reviewer_resolved_model ?? null,
    revisorResolvedModel: row.revisor_resolved_model ?? null,
    executorResolvedModel: row.executor_resolved_model ?? null,
    verifierResolvedModel: row.verifier_resolved_model ?? null,
    totalTokensPrompt: row.total_tokens_prompt ?? 0,
    totalTokensCompletion: row.total_tokens_completion ?? 0,
    totalCostUsd: row.total_cost_usd ?? 0,
  };
}
