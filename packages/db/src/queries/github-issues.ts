import type { DatabaseSync } from 'node:sqlite';
import {
  type ExecutorModel,
  type GitHubIssueCacheRecord,
  type GitHubPrCheckSummary,
  type GitHubPrReviewCommentSummary,
  ISO_NOW_SQL,
  type IssuePipelineStatus,
  toIsoUtc,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';

interface GitHubIssueCacheRow {
  id: string;
  project_id: string;
  issue_number: number;
  title: string;
  body: string;
  labels: string;
  assignee: string | null;
  state: string;
  pipeline_status: IssuePipelineStatus;
  thread_id: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  last_phase_update: string | null;
  last_status_label: string | null;
  planner_model_override: ExecutorModel | null;
  reviewer_model_override: ExecutorModel | null;
  executor_model_override: ExecutorModel | null;
  verifier_model_override: ExecutorModel | null;
  planner_model_id_override: string | null;
  reviewer_model_id_override: string | null;
  executor_model_id_override: string | null;
  verifier_model_id_override: string | null;
  linked_pr_number: number | null;
  linked_pr_url: string | null;
  linked_pr_is_draft: number | null;
  ci_blocked: number | null;
  failing_checks: string | null;
  unresolved_review_comments: string | null;
  unresolved_review_comment_count: number | null;
  pr_last_sync_at: string | null;
  fetched_at: string;
  archived_at: string | null;
}

export class GitHubIssueQueries {
  constructor(private db: DatabaseSync) {}

  list(projectId: string): GitHubIssueCacheRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM github_issue_cache WHERE project_id = ? AND archived_at IS NULL ORDER BY fetched_at DESC',
      )
      .all(projectId) as GitHubIssueCacheRow[];
    return rows.map((r) => this.toRecord(r));
  }

  getByNumber(projectId: string, issueNumber: number): GitHubIssueCacheRecord | null {
    const row = this.db
      .prepare('SELECT * FROM github_issue_cache WHERE project_id = ? AND issue_number = ?')
      .get(projectId, issueNumber) as GitHubIssueCacheRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  getByThreadId(threadId: string): GitHubIssueCacheRecord | null {
    const row = this.db
      .prepare('SELECT * FROM github_issue_cache WHERE thread_id = ?')
      .get(threadId) as GitHubIssueCacheRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  upsert(
    record: Omit<
      GitHubIssueCacheRecord,
      | 'id'
      | 'pipelineStatus'
      | 'threadId'
      | 'claimedAt'
      | 'claimedBy'
      | 'lastPhaseUpdate'
      | 'lastStatusLabel'
      | 'plannerModelOverride'
      | 'reviewerModelOverride'
      | 'executorModelOverride'
      | 'verifierModelOverride'
      | 'plannerModelIdOverride'
      | 'reviewerModelIdOverride'
      | 'executorModelIdOverride'
      | 'verifierModelIdOverride'
      | 'linkedPrNumber'
      | 'linkedPrUrl'
      | 'linkedPrIsDraft'
      | 'ciBlocked'
      | 'failingChecks'
      | 'unresolvedReviewComments'
      | 'unresolvedReviewCommentCount'
      | 'prLastSyncAt'
      | 'fetchedAt'
    >,
  ): GitHubIssueCacheRecord {
    const existing = this.getByNumber(record.projectId, record.issueNumber);
    if (existing) {
      this.db
        .prepare(
          `UPDATE github_issue_cache SET title = ?, body = ?, labels = ?, assignee = ?, state = ?, fetched_at = ${ISO_NOW_SQL} WHERE id = ?`,
        )
        .run(
          record.title,
          record.body,
          JSON.stringify(record.labels),
          record.assignee,
          record.state,
          existing.id,
        );
      const updated = this.getByNumber(record.projectId, record.issueNumber);
      if (!updated) {
        throw new Error(
          `Failed to load GitHub issue after update: ${record.projectId}#${record.issueNumber}`,
        );
      }
      return updated;
    }
    const id = nanoid();
    this.db
      .prepare(
        'INSERT INTO github_issue_cache (id, project_id, issue_number, title, body, labels, assignee, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        record.projectId,
        record.issueNumber,
        record.title,
        record.body,
        JSON.stringify(record.labels),
        record.assignee,
        record.state,
      );
    const created = this.getByNumber(record.projectId, record.issueNumber);
    if (!created) {
      throw new Error(
        `Failed to load GitHub issue after insert: ${record.projectId}#${record.issueNumber}`,
      );
    }
    return created;
  }

  updatePipelineStatus(id: string, status: IssuePipelineStatus): void {
    this.db
      .prepare(
        `UPDATE github_issue_cache SET pipeline_status = ?, last_phase_update = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(status, id);
  }

  /**
   * When a GH issue flips to `state = 'closed'` externally (via the web UI,
   * `gh issue close`, or a Projects v2 workflow), move the local
   * `pipeline_status` to `'completed'` — but only from terminal or
   * not-yet-started source states. In-flight statuses
   * (planning/reviewing/revising/executing/verifying/shipping) are left alone
   * so the pipeline writer never races with this flip. The SQL guard makes
   * the operation race-safe without locks.
   *
   * Returns `true` iff a row was updated.
   */
  markCompletedOnClose(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE github_issue_cache
           SET pipeline_status = 'completed', last_phase_update = ${ISO_NOW_SQL}
         WHERE id = ?
           AND pipeline_status IN ('todo','queued','awaiting_approval','failed')`,
      )
      .run(id);
    return Number(result.changes) > 0;
  }

  /**
   * Symmetric partner to `markCompletedOnClose`: when a GH issue is reopened,
   * walk the local `pipeline_status` back from `'completed'` to `'todo'` so
   * the user can re-run the pipeline. Leaves any non-completed status
   * untouched (the pipeline might have advanced independently).
   *
   * Returns `true` iff a row was updated.
   */
  markReopenedOnOpen(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE github_issue_cache
           SET pipeline_status = 'todo', last_phase_update = NULL
         WHERE id = ?
           AND pipeline_status = 'completed'`,
      )
      .run(id);
    return Number(result.changes) > 0;
  }

  linkThread(id: string, threadId: string): void {
    this.db.prepare('UPDATE github_issue_cache SET thread_id = ? WHERE id = ?').run(threadId, id);
  }

  tryClaim(id: string, instanceId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE github_issue_cache SET claimed_at = ${ISO_NOW_SQL}, claimed_by = ?, last_phase_update = ${ISO_NOW_SQL} WHERE id = ? AND claimed_at IS NULL`,
      )
      .run(instanceId, id);
    return Number(result.changes) > 0;
  }

  releaseClaim(id: string): void {
    this.db
      .prepare(
        "UPDATE github_issue_cache SET claimed_at = NULL, claimed_by = NULL, pipeline_status = 'queued', last_phase_update = NULL WHERE id = ?",
      )
      .run(id);
  }

  getStale(olderThanMs: number): GitHubIssueCacheRecord[] {
    const thresholdSec = Math.floor(olderThanMs / 1000);
    const rows = this.db
      .prepare(
        `SELECT * FROM github_issue_cache WHERE claimed_at IS NOT NULL AND last_phase_update IS NOT NULL AND last_phase_update < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || ? || ' seconds')`,
      )
      .all(thresholdSec) as GitHubIssueCacheRow[];
    return rows.map((r) => this.toRecord(r));
  }

  getRequeued(projectId: string): GitHubIssueCacheRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM github_issue_cache WHERE project_id = ? AND pipeline_status = 'queued' AND claimed_at IS NULL ORDER BY fetched_at ASC",
      )
      .all(projectId) as GitHubIssueCacheRow[];
    return rows.map((r) => this.toRecord(r));
  }

  getNextQueued(): GitHubIssueCacheRecord | null {
    const row = this.db
      .prepare(
        "SELECT * FROM github_issue_cache WHERE pipeline_status = 'queued' AND archived_at IS NULL ORDER BY last_phase_update ASC LIMIT 1",
      )
      .get() as GitHubIssueCacheRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  getOrphanedClaims(): GitHubIssueCacheRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM github_issue_cache WHERE claimed_at IS NOT NULL AND thread_id IS NULL AND claimed_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')`,
      )
      .all() as GitHubIssueCacheRow[];
    return rows.map((r) => this.toRecord(r));
  }

  refreshHeartbeat(id: string): void {
    this.db
      .prepare(`UPDATE github_issue_cache SET last_phase_update = ${ISO_NOW_SQL} WHERE id = ?`)
      .run(id);
  }

  updateLastStatusLabel(id: string, label: string | null): void {
    this.db
      .prepare('UPDATE github_issue_cache SET last_status_label = ? WHERE id = ?')
      .run(label, id);
  }

  updatePhaseModelOverride(
    id: string,
    phase: 'planner' | 'reviewer' | 'executor' | 'verifier',
    model: ExecutorModel | null,
  ): void {
    const column =
      phase === 'planner'
        ? 'planner_model_override'
        : phase === 'reviewer'
          ? 'reviewer_model_override'
          : phase === 'executor'
            ? 'executor_model_override'
            : 'verifier_model_override';
    this.db.prepare(`UPDATE github_issue_cache SET ${column} = ? WHERE id = ?`).run(model, id);
  }

  updatePhaseModelIdOverride(
    id: string,
    phase: 'planner' | 'reviewer' | 'executor' | 'verifier',
    modelId: string | null,
  ): void {
    const column =
      phase === 'planner'
        ? 'planner_model_id_override'
        : phase === 'reviewer'
          ? 'reviewer_model_id_override'
          : phase === 'executor'
            ? 'executor_model_id_override'
            : 'verifier_model_id_override';
    this.db.prepare(`UPDATE github_issue_cache SET ${column} = ? WHERE id = ?`).run(modelId, id);
  }

  updatePullRequestFeedback(
    id: string,
    input: {
      linkedPrNumber: number | null;
      linkedPrUrl: string | null;
      linkedPrIsDraft: boolean;
      ciBlocked: boolean;
      failingChecks: GitHubPrCheckSummary[];
      unresolvedReviewComments: GitHubPrReviewCommentSummary[];
    },
  ): void {
    this.db
      .prepare(
        `UPDATE github_issue_cache
           SET linked_pr_number = ?,
               linked_pr_url = ?,
               linked_pr_is_draft = ?,
               ci_blocked = ?,
               failing_checks = ?,
               unresolved_review_comments = ?,
               unresolved_review_comment_count = ?,
               pr_last_sync_at = ${ISO_NOW_SQL}
         WHERE id = ?`,
      )
      .run(
        input.linkedPrNumber,
        input.linkedPrUrl,
        input.linkedPrIsDraft ? 1 : 0,
        input.ciBlocked ? 1 : 0,
        JSON.stringify(input.failingChecks),
        JSON.stringify(input.unresolvedReviewComments),
        input.unresolvedReviewComments.length,
        id,
      );
  }

  setCachedLabelPresence(id: string, label: string, present: boolean): void {
    const row = this.db.prepare('SELECT labels FROM github_issue_cache WHERE id = ?').get(id) as
      | { labels: string }
      | undefined;
    if (!row) return;

    const current = new Set<string>(JSON.parse(row.labels || '[]'));
    if (present) current.add(label);
    else current.delete(label);

    this.db
      .prepare('UPDATE github_issue_cache SET labels = ? WHERE id = ?')
      .run(JSON.stringify(Array.from(current)), id);
  }

  archiveIssues(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    this.db
      .prepare(
        `UPDATE github_issue_cache SET archived_at = ${ISO_NOW_SQL} WHERE id IN (${placeholders})`,
      )
      .run(...ids);
  }

  clearArchivedAt(id: string): void {
    this.db.prepare('UPDATE github_issue_cache SET archived_at = NULL WHERE id = ?').run(id);
  }

  listArchived(): GitHubIssueCacheRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM github_issue_cache WHERE archived_at IS NOT NULL ORDER BY archived_at DESC',
      )
      .all() as GitHubIssueCacheRow[];
    return rows.map((r) => this.toRecord(r));
  }

  listCompleted(projectId: string): GitHubIssueCacheRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM github_issue_cache WHERE project_id = ? AND pipeline_status = 'completed' AND archived_at IS NULL ORDER BY fetched_at DESC",
      )
      .all(projectId) as GitHubIssueCacheRow[];
    return rows.map((r) => this.toRecord(r));
  }

  private toRecord(row: GitHubIssueCacheRow): GitHubIssueCacheRecord {
    const overrideRaw =
      row.executor_model_override === undefined ? row.executor_model : row.executor_model_override;
    return {
      id: row.id,
      projectId: row.project_id,
      issueNumber: row.issue_number,
      title: row.title,
      body: row.body,
      labels: JSON.parse(row.labels || '[]'),
      assignee: row.assignee,
      state: row.state,
      pipelineStatus: row.pipeline_status,
      threadId: row.thread_id,
      claimedAt: toIsoUtc(row.claimed_at),
      claimedBy: row.claimed_by,
      lastPhaseUpdate: toIsoUtc(row.last_phase_update),
      lastStatusLabel: row.last_status_label ?? null,
      plannerModelOverride:
        row.planner_model_override === 'codex'
          ? 'codex'
          : row.planner_model_override === 'openrouter'
            ? 'openrouter'
            : row.planner_model_override === 'claude'
              ? 'claude'
              : null,
      reviewerModelOverride:
        row.reviewer_model_override === 'codex'
          ? 'codex'
          : row.reviewer_model_override === 'openrouter'
            ? 'openrouter'
            : row.reviewer_model_override === 'claude'
              ? 'claude'
              : null,
      executorModelOverride:
        overrideRaw === 'codex'
          ? 'codex'
          : overrideRaw === 'openrouter'
            ? 'openrouter'
            : overrideRaw === 'claude'
              ? 'claude'
              : null,
      verifierModelOverride:
        row.verifier_model_override === 'codex'
          ? 'codex'
          : row.verifier_model_override === 'openrouter'
            ? 'openrouter'
            : row.verifier_model_override === 'claude'
              ? 'claude'
              : null,
      plannerModelIdOverride: row.planner_model_id_override ?? null,
      reviewerModelIdOverride: row.reviewer_model_id_override ?? null,
      executorModelIdOverride: row.executor_model_id_override ?? null,
      verifierModelIdOverride: row.verifier_model_id_override ?? null,
      linkedPrNumber: row.linked_pr_number ?? null,
      linkedPrUrl: row.linked_pr_url ?? null,
      linkedPrIsDraft: !!row.linked_pr_is_draft,
      ciBlocked: !!row.ci_blocked,
      failingChecks: JSON.parse(row.failing_checks || '[]'),
      unresolvedReviewComments: JSON.parse(row.unresolved_review_comments || '[]'),
      unresolvedReviewCommentCount: row.unresolved_review_comment_count ?? 0,
      prLastSyncAt: toIsoUtc(row.pr_last_sync_at),
      fetchedAt: toIsoUtc(row.fetched_at) ?? row.fetched_at,
    };
  }
}
