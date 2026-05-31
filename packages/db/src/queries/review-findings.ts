import type { DatabaseSync } from 'node:sqlite';
import type {
  ReviewFindingCreateInput,
  ReviewFindingRecord,
  ReviewFindingSource,
  ReviewFindingStatus,
} from '@shipcode/shared';
import { toIsoUtc } from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface ReviewFindingRow {
  id: string;
  project_id: string;
  thread_id: string;
  plan_id: string | null;
  review_id: string | null;
  verification_id: string | null;
  run_id: string | null;
  phase: string;
  source: ReviewFindingSource;
  severity: ReviewFindingRecord['severity'];
  status: ReviewFindingStatus;
  title: string;
  description: string;
  suggestion: string | null;
  file_path: string | null;
  fingerprint: string;
  source_model: string | null;
  commit_sha: string | null;
  pr_number: number | null;
  worktree_path: string | null;
  branch: string | null;
  metadata_json: string | null;
  resolved_by_run_id: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export class ReviewFindingQueries {
  constructor(private db: DatabaseSync) {}

  getById(id: string): ReviewFindingRecord | null {
    const row = this.db.prepare('SELECT * FROM review_findings WHERE id = ?').get(id);
    return row ? mapRow(asRow<ReviewFindingRow>(row)) : null;
  }

  listByThread(threadId: string, options?: { includeClosed?: boolean }): ReviewFindingRecord[] {
    const includeClosed = options?.includeClosed === true;
    const rows = this.db
      .prepare(
        `SELECT *
           FROM review_findings
          WHERE thread_id = ?
            AND (? = 1 OR status = 'open')
          ORDER BY
            CASE severity
              WHEN 'critical' THEN 0
              WHEN 'blocker' THEN 1
              WHEN 'major' THEN 2
              WHEN 'warning' THEN 3
              WHEN 'minor' THEN 4
              ELSE 5
            END,
            updated_at DESC,
            rowid DESC`,
      )
      .all(threadId, includeClosed ? 1 : 0);
    return asRows<ReviewFindingRow>(rows).map(mapRow);
  }

  listOpenByThread(threadId: string): ReviewFindingRecord[] {
    return this.listByThread(threadId, { includeClosed: false });
  }

  replaceOpenForReview(input: {
    threadId: string;
    planId: string;
    reviewId: string;
    findings: ReviewFindingCreateInput[];
  }): ReviewFindingRecord[] {
    this.supersedeOpen({
      threadId: input.threadId,
      planId: input.planId,
      source: 'review',
    });
    return input.findings.map((finding) =>
      this.createOrUpdateOpen({ ...finding, planId: input.planId, reviewId: input.reviewId }),
    );
  }

  replaceOpenForVerification(input: {
    threadId: string;
    planId: string;
    verificationId: string;
    findings: ReviewFindingCreateInput[];
  }): ReviewFindingRecord[] {
    this.supersedeOpen({
      threadId: input.threadId,
      planId: input.planId,
      source: 'verification',
    });
    return input.findings.map((finding) =>
      this.createOrUpdateOpen({
        ...finding,
        planId: input.planId,
        verificationId: input.verificationId,
      }),
    );
  }

  syncOpenForPullRequestFeedback(input: {
    threadId: string;
    findings: ReviewFindingCreateInput[];
  }): ReviewFindingRecord[] {
    const incoming = new Set(
      input.findings.map((finding) =>
        [finding.source, finding.phase, finding.fingerprint].join('\0'),
      ),
    );
    const current = this.listOpenByThread(input.threadId).filter(
      (finding) => finding.source === 'ci' || finding.source === 'pr_review',
    );

    for (const finding of current) {
      const key = [finding.source, finding.phase, finding.fingerprint].join('\0');
      if (!incoming.has(key)) {
        this.updateStatus(finding.id, 'superseded');
      }
    }

    return input.findings.map((finding) => this.createOrUpdateOpen(finding));
  }

  createOrUpdateOpen(input: ReviewFindingCreateInput): ReviewFindingRecord {
    const existing = this.db
      .prepare(
        `SELECT *
           FROM review_findings
          WHERE thread_id = ?
            AND source = ?
            AND phase = ?
            AND fingerprint = ?
            AND status = 'open'
          ORDER BY updated_at DESC, rowid DESC
          LIMIT 1`,
      )
      .get(input.threadId, input.source, input.phase, input.fingerprint);

    if (existing) {
      const row = asRow<ReviewFindingRow>(existing);
      this.db
        .prepare(
          `UPDATE review_findings
              SET project_id = ?,
                  plan_id = ?,
                  review_id = ?,
                  verification_id = ?,
                  run_id = ?,
                  severity = ?,
                  title = ?,
                  description = ?,
                  suggestion = ?,
                  file_path = ?,
                  source_model = ?,
                  commit_sha = ?,
                  pr_number = ?,
                  worktree_path = ?,
                  branch = ?,
                  metadata_json = ?,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?`,
        )
        .run(
          input.projectId,
          input.planId ?? null,
          input.reviewId ?? null,
          input.verificationId ?? null,
          input.runId ?? null,
          input.severity,
          input.title,
          input.description,
          input.suggestion ?? null,
          input.filePath ?? null,
          input.sourceModel ?? null,
          input.commitSha ?? null,
          input.prNumber ?? null,
          input.worktreePath ?? null,
          input.branch ?? null,
          input.metadata ? JSON.stringify(input.metadata) : null,
          row.id,
        );
      return this.getById(row.id) ?? this.failLoad(row.id);
    }

    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO review_findings (
           id,
           project_id,
           thread_id,
           plan_id,
           review_id,
           verification_id,
           run_id,
           phase,
           source,
           severity,
           status,
           title,
           description,
           suggestion,
           file_path,
           fingerprint,
           source_model,
           commit_sha,
           pr_number,
           worktree_path,
           branch,
           metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.threadId,
        input.planId ?? null,
        input.reviewId ?? null,
        input.verificationId ?? null,
        input.runId ?? null,
        input.phase,
        input.source,
        input.severity,
        input.title,
        input.description,
        input.suggestion ?? null,
        input.filePath ?? null,
        input.fingerprint,
        input.sourceModel ?? null,
        input.commitSha ?? null,
        input.prNumber ?? null,
        input.worktreePath ?? null,
        input.branch ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      );
    return this.getById(id) ?? this.failLoad(id);
  }

  updateStatus(
    id: string,
    status: Exclude<ReviewFindingStatus, 'open'>,
  ): ReviewFindingRecord | null {
    this.db
      .prepare(
        `UPDATE review_findings
            SET status = ?,
                resolved_at = CASE WHEN ? IN ('fixed', 'ignored', 'closed') THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE resolved_at END,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?`,
      )
      .run(status, status, id);
    return this.getById(id);
  }

  markOpenFixed(input: {
    threadId: string;
    planId?: string | null;
    runId?: string | null;
    commitSha?: string | null;
  }): number {
    const result = this.db
      .prepare(
        `UPDATE review_findings
            SET status = 'fixed',
                resolved_by_run_id = ?,
                commit_sha = COALESCE(?, commit_sha),
                resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE thread_id = ?
            AND status = 'open'
            AND (? IS NULL OR plan_id = ?)`,
      )
      .run(
        input.runId ?? null,
        input.commitSha ?? null,
        input.threadId,
        input.planId ?? null,
        input.planId ?? null,
      );
    return Number(result.changes);
  }

  supersedeOpen(input: {
    threadId: string;
    source?: ReviewFindingSource;
    planId?: string | null;
    runId?: string | null;
  }): number {
    const result = this.db
      .prepare(
        `UPDATE review_findings
            SET status = 'superseded',
                resolved_by_run_id = ?,
                resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE thread_id = ?
            AND status = 'open'
            AND (? IS NULL OR source = ?)
            AND (? IS NULL OR plan_id = ?)`,
      )
      .run(
        input.runId ?? null,
        input.threadId,
        input.source ?? null,
        input.source ?? null,
        input.planId ?? null,
        input.planId ?? null,
      );
    return Number(result.changes);
  }

  private failLoad(id: string): never {
    throw new Error(`Failed to load review finding row: ${id}`);
  }
}

function mapRow(row: ReviewFindingRow): ReviewFindingRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    threadId: row.thread_id,
    planId: row.plan_id,
    reviewId: row.review_id,
    verificationId: row.verification_id,
    runId: row.run_id,
    phase: row.phase,
    source: row.source,
    severity: row.severity,
    status: row.status,
    title: row.title,
    description: row.description,
    suggestion: row.suggestion,
    filePath: row.file_path,
    fingerprint: row.fingerprint,
    sourceModel: row.source_model,
    commitSha: row.commit_sha,
    prNumber: row.pr_number,
    worktreePath: row.worktree_path,
    branch: row.branch,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    resolvedByRunId: row.resolved_by_run_id,
    resolvedAt: toIsoUtc(row.resolved_at),
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
    updatedAt: toIsoUtc(row.updated_at) ?? row.updated_at,
  };
}
