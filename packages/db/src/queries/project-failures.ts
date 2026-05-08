import type { DatabaseSync } from 'node:sqlite';
import { type ProjectFailureRecord, toIsoUtc } from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface ProjectFailureRow {
  id: string;
  project_id: string;
  base_branch: string | null;
  fingerprint: string;
  status: ProjectFailureRecord['status'];
  owner_thread_id: string | null;
  first_seen_thread_id: string | null;
  seen_thread_ids: string;
  command: string;
  summary: string;
  output_excerpt: string;
  implicated_files: string;
  resolved_by_thread_id: string | null;
  resolved_commit_sha: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectFailureClaimInput {
  projectId: string;
  baseBranch: string | null;
  fingerprint: string;
  threadId: string;
  command: string;
  summary: string;
  outputExcerpt: string;
  implicatedFiles: string[];
}

export class ProjectFailureQueries {
  constructor(private db: DatabaseSync) {}

  claimOrCreate(input: ProjectFailureClaimInput): ProjectFailureRecord {
    const existing = this.getByFingerprint(input.projectId, input.baseBranch, input.fingerprint);
    if (existing) {
      const seenThreadIds = mergeThreadId(existing.seenThreadIds, input.threadId);
      this.db
        .prepare(
          `UPDATE project_failures
              SET seen_thread_ids = ?,
                  command = ?,
                  summary = ?,
                  output_excerpt = ?,
                  implicated_files = ?,
                  owner_thread_id = CASE
                    WHEN status = 'in_progress' AND owner_thread_id IS NULL THEN ?
                    ELSE owner_thread_id
                  END,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?`,
        )
        .run(
          JSON.stringify(seenThreadIds),
          input.command,
          input.summary,
          input.outputExcerpt,
          JSON.stringify(input.implicatedFiles),
          input.threadId,
          existing.id,
        );
      return this.getById(existing.id) ?? this.failLoad(existing.id);
    }

    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO project_failures (
           id,
           project_id,
           base_branch,
           fingerprint,
           status,
           owner_thread_id,
           first_seen_thread_id,
           seen_thread_ids,
           command,
           summary,
           output_excerpt,
           implicated_files
         ) VALUES (?, ?, ?, ?, 'in_progress', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.baseBranch,
        input.fingerprint,
        input.threadId,
        input.threadId,
        JSON.stringify([input.threadId]),
        input.command,
        input.summary,
        input.outputExcerpt,
        JSON.stringify(input.implicatedFiles),
      );
    return this.getById(id) ?? this.failLoad(id);
  }

  getById(id: string): ProjectFailureRecord | null {
    const row = this.db.prepare('SELECT * FROM project_failures WHERE id = ?').get(id);
    return row ? mapRow(asRow<ProjectFailureRow>(row)) : null;
  }

  getByFingerprint(
    projectId: string,
    baseBranch: string | null,
    fingerprint: string,
  ): ProjectFailureRecord | null {
    const row = this.db
      .prepare(
        `SELECT *
           FROM project_failures
          WHERE project_id = ?
            AND COALESCE(base_branch, '') = COALESCE(?, '')
            AND fingerprint = ?
          LIMIT 1`,
      )
      .get(projectId, baseBranch, fingerprint);
    return row ? mapRow(asRow<ProjectFailureRow>(row)) : null;
  }

  listOpenForProject(projectId: string): ProjectFailureRecord[] {
    const rows = this.db
      .prepare(
        `SELECT *
           FROM project_failures
          WHERE project_id = ?
            AND status = 'in_progress'
          ORDER BY updated_at DESC, rowid DESC`,
      )
      .all(projectId);
    return asRows<ProjectFailureRow>(rows).map(mapRow);
  }

  resolveOwnedByThread(threadId: string, commitSha: string): number {
    const result = this.db
      .prepare(
        `UPDATE project_failures
            SET status = 'resolved',
                resolved_by_thread_id = ?,
                resolved_commit_sha = ?,
                resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE owner_thread_id = ?
            AND status = 'in_progress'`,
      )
      .run(threadId, commitSha, threadId);
    return Number(result.changes ?? 0);
  }

  private failLoad(id: string): never {
    throw new Error(`Failed to load project failure row: ${id}`);
  }
}

function mergeThreadId(threadIds: string[], threadId: string): string[] {
  return threadIds.includes(threadId) ? threadIds : [...threadIds, threadId];
}

function mapRow(row: ProjectFailureRow): ProjectFailureRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    baseBranch: row.base_branch,
    fingerprint: row.fingerprint,
    status: row.status,
    ownerThreadId: row.owner_thread_id,
    firstSeenThreadId: row.first_seen_thread_id,
    seenThreadIds: parseStringArray(row.seen_thread_ids),
    command: row.command,
    summary: row.summary,
    outputExcerpt: row.output_excerpt,
    implicatedFiles: parseStringArray(row.implicated_files),
    resolvedByThreadId: row.resolved_by_thread_id,
    resolvedCommitSha: row.resolved_commit_sha,
    resolvedAt: row.resolved_at ? (toIsoUtc(row.resolved_at) ?? row.resolved_at) : null,
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
    updatedAt: toIsoUtc(row.updated_at) ?? row.updated_at,
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}
