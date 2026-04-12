import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import {
  ISO_NOW_SQL,
  toIsoUtc,
  type ExecutorModel,
  type GitHubIssueCacheRecord,
  type IssuePipelineStatus,
} from '@shipcode/shared';

export class GitHubIssueQueries {
  constructor(private db: DatabaseSync) {}

  list(projectId: string): GitHubIssueCacheRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM github_issue_cache WHERE project_id = ? AND archived_at IS NULL ORDER BY fetched_at DESC')
      .all(projectId) as any[];
    return rows.map((r) => this.toRecord(r));
  }

  getByNumber(projectId: string, issueNumber: number): GitHubIssueCacheRecord | null {
    const row = this.db
      .prepare('SELECT * FROM github_issue_cache WHERE project_id = ? AND issue_number = ?')
      .get(projectId, issueNumber) as any | undefined;
    return row ? this.toRecord(row) : null;
  }

  getByThreadId(threadId: string): GitHubIssueCacheRecord | null {
    const row = this.db
      .prepare('SELECT * FROM github_issue_cache WHERE thread_id = ?')
      .get(threadId) as any | undefined;
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
      | 'executorModel'
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
      return this.getByNumber(record.projectId, record.issueNumber)!;
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
    return this.getByNumber(record.projectId, record.issueNumber)!;
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
      .all(thresholdSec) as any[];
    return rows.map((r) => this.toRecord(r));
  }

  getRequeued(projectId: string): GitHubIssueCacheRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM github_issue_cache WHERE project_id = ? AND pipeline_status = 'queued' AND claimed_at IS NULL ORDER BY fetched_at ASC",
      )
      .all(projectId) as any[];
    return rows.map((r) => this.toRecord(r));
  }

  getOrphanedClaims(): GitHubIssueCacheRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM github_issue_cache WHERE claimed_at IS NOT NULL AND thread_id IS NULL AND claimed_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')`,
      )
      .all() as any[];
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

  updateExecutorModel(id: string, model: ExecutorModel): void {
    this.db.prepare('UPDATE github_issue_cache SET executor_model = ? WHERE id = ?').run(model, id);
  }

  archiveIssues(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    this.db
      .prepare(`UPDATE github_issue_cache SET archived_at = ${ISO_NOW_SQL} WHERE id IN (${placeholders})`)
      .run(...ids);
  }

  clearArchivedAt(id: string): void {
    this.db
      .prepare('UPDATE github_issue_cache SET archived_at = NULL WHERE id = ?')
      .run(id);
  }

  listCompleted(projectId: string): GitHubIssueCacheRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM github_issue_cache WHERE project_id = ? AND pipeline_status = 'completed' AND archived_at IS NULL ORDER BY fetched_at DESC",
      )
      .all(projectId) as any[];
    return rows.map((r) => this.toRecord(r));
  }

  private toRecord(row: any): GitHubIssueCacheRecord {
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
      executorModel:
        row.executor_model === 'codex'
          ? 'codex'
          : row.executor_model === 'openrouter'
            ? 'openrouter'
            : 'claude',
      fetchedAt: toIsoUtc(row.fetched_at) ?? row.fetched_at,
    };
  }
}
