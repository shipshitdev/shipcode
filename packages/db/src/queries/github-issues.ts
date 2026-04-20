import type { DatabaseSync } from 'node:sqlite';
import {
  type ExecutorModel,
  type GitHubIssueCacheRecord,
  type GitHubPrCheckSummary,
  type GitHubPrReviewCommentSummary,
  ISO_NOW_SQL,
  type IssuePipelineStatus,
  type ReasoningEffort,
  toIsoUtc,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

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
  planner_reasoning_effort_override: ReasoningEffort | null;
  reviewer_reasoning_effort_override: ReasoningEffort | null;
  executor_reasoning_effort_override: ReasoningEffort | null;
  verifier_reasoning_effort_override: ReasoningEffort | null;
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
      .all(projectId);
    return asRows<GitHubIssueCacheRow>(rows).map((r) => this.toRecord(r));
  }

  getByNumber(projectId: string, issueNumber: number): GitHubIssueCacheRecord | null {
    const row = this.db
      .prepare('SELECT * FROM github_issue_cache WHERE project_id = ? AND issue_number = ?')
      .get(projectId, issueNumber);
    return row ? this.toRecord(asRow<GitHubIssueCacheRow>(row)) : null;
  }

  getByThreadId(threadId: string): GitHubIssueCacheRecord | null {
    const row = this.db
      .prepare('SELECT * FROM github_issue_cache WHERE thread_id = ?')
      .get(threadId);
    return row ? this.toRecord(asRow<GitHubIssueCacheRow>(row)) : null;
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
      | 'plannerReasoningEffortOverride'
      | 'reviewerReasoningEffortOverride'
      | 'executorReasoningEffortOverride'
      | 'verifierReasoningEffortOverride'
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

  resetToTodo(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE github_issue_cache
           SET pipeline_status = 'todo', last_phase_update = NULL
         WHERE id = ?
           AND linked_pr_number IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM threads
             WHERE threads.id = github_issue_cache.thread_id
               AND threads.status = 'completed'
           )`,
      )
      .run(id);
    return Number(result.changes) > 0;
  }

  reconcileCompletedFromEvidence(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE github_issue_cache
           SET pipeline_status = 'completed', last_phase_update = ${ISO_NOW_SQL}
         WHERE id = ?
           AND state = 'open'
           AND pipeline_status IN ('todo','queued','awaiting_approval','failed','done')
           AND (
             linked_pr_number IS NOT NULL
             OR EXISTS (
               SELECT 1
               FROM threads
               WHERE threads.id = github_issue_cache.thread_id
                 AND threads.status = 'completed'
             )
           )`,
      )
      .run(id);
    return Number(result.changes) > 0;
  }

  /**
   * When a GH issue flips to `state = 'closed'` externally (via the web UI,
   * `gh issue close`, or a Projects v2 workflow), move the local
   * `pipeline_status` to `'done'` — but only from terminal or
   * not-yet-started source states. In-flight statuses
   * (planning/reviewing/revising/executing/verifying/shipping) are left alone
   * so the pipeline writer never races with this flip. The SQL guard makes
   * the operation race-safe without locks.
   *
   * Returns `true` iff a row was updated.
   */
  markDoneOnClose(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE github_issue_cache
           SET pipeline_status = 'done', last_phase_update = ${ISO_NOW_SQL}
         WHERE id = ?
           AND pipeline_status IN ('todo','queued','awaiting_approval','failed','completed')`,
      )
      .run(id);
    return Number(result.changes) > 0;
  }

  /**
   * When a GH issue is reopened, restore it to `'completed'` if ShipCode still
   * has completion evidence (linked PR or completed thread); otherwise walk it
   * back to `'todo'` so the user can re-run the pipeline.
   *
   * Returns `true` iff a row was updated.
   */
  markReopenedOnOpen(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE github_issue_cache
           SET pipeline_status = CASE
                 WHEN linked_pr_number IS NOT NULL
                   OR EXISTS (
                     SELECT 1
                     FROM threads
                     WHERE threads.id = github_issue_cache.thread_id
                       AND threads.status = 'completed'
                   )
                 THEN 'completed'
                 ELSE 'todo'
               END,
               last_phase_update = CASE
                 WHEN linked_pr_number IS NOT NULL
                   OR EXISTS (
                     SELECT 1
                     FROM threads
                     WHERE threads.id = github_issue_cache.thread_id
                       AND threads.status = 'completed'
                   )
                 THEN ${ISO_NOW_SQL}
                 ELSE NULL
               END
         WHERE id = ?
           AND pipeline_status IN ('completed','done')`,
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
      .all(thresholdSec);
    return asRows<GitHubIssueCacheRow>(rows).map((r) => this.toRecord(r));
  }

  getRequeued(projectId: string): GitHubIssueCacheRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM github_issue_cache WHERE project_id = ? AND pipeline_status = 'queued' AND claimed_at IS NULL ORDER BY fetched_at ASC",
      )
      .all(projectId);
    return asRows<GitHubIssueCacheRow>(rows).map((r) => this.toRecord(r));
  }

  getNextQueued(): GitHubIssueCacheRecord | null {
    const row = this.db
      .prepare(
        `SELECT gic.* FROM github_issue_cache gic
           JOIN projects p ON p.id = gic.project_id
          WHERE gic.pipeline_status = 'queued'
            AND gic.archived_at IS NULL
            AND p.archived = 0
          ORDER BY gic.last_phase_update ASC
          LIMIT 1`,
      )
      .get();
    return row ? this.toRecord(asRow<GitHubIssueCacheRow>(row)) : null;
  }

  getOrphanedClaims(): GitHubIssueCacheRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM github_issue_cache WHERE claimed_at IS NOT NULL AND thread_id IS NULL AND claimed_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')`,
      )
      .all();
    return asRows<GitHubIssueCacheRow>(rows).map((r) => this.toRecord(r));
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

  updatePhaseReasoningEffortOverride(
    id: string,
    phase: 'planner' | 'reviewer' | 'executor' | 'verifier',
    effort: ReasoningEffort | null,
  ): void {
    const column =
      phase === 'planner'
        ? 'planner_reasoning_effort_override'
        : phase === 'reviewer'
          ? 'reviewer_reasoning_effort_override'
          : phase === 'executor'
            ? 'executor_reasoning_effort_override'
            : 'verifier_reasoning_effort_override';
    this.db.prepare(`UPDATE github_issue_cache SET ${column} = ? WHERE id = ?`).run(effort, id);
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
      .all();
    return asRows<GitHubIssueCacheRow>(rows).map((r) => this.toRecord(r));
  }

  listCompleted(projectId: string): GitHubIssueCacheRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM github_issue_cache WHERE project_id = ? AND pipeline_status IN ('completed','done') AND archived_at IS NULL ORDER BY fetched_at DESC",
      )
      .all(projectId);
    return asRows<GitHubIssueCacheRow>(rows).map((r) => this.toRecord(r));
  }

  private toRecord(row: GitHubIssueCacheRow): GitHubIssueCacheRecord {
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
        row.executor_model_override === 'codex'
          ? 'codex'
          : row.executor_model_override === 'openrouter'
            ? 'openrouter'
            : row.executor_model_override === 'claude'
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
      plannerReasoningEffortOverride: row.planner_reasoning_effort_override ?? null,
      reviewerReasoningEffortOverride: row.reviewer_reasoning_effort_override ?? null,
      executorReasoningEffortOverride: row.executor_reasoning_effort_override ?? null,
      verifierReasoningEffortOverride: row.verifier_reasoning_effort_override ?? null,
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
