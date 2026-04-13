import type { DatabaseSync } from 'node:sqlite';
import { ISO_NOW_SQL, type PhaseSkillKey, toIsoUtc } from '@shipcode/shared';

export type { PhaseSkillKey };

export interface SkillRow {
  projectId: string | null;
  phase: PhaseSkillKey;
  content: string;
  baseVersion: string;
  schemaVersion: number;
  status: 'ok' | 'quarantined';
  statusReason: string | null;
  updatedAt: string;
}

interface SkillDbRow {
  project_id: string | null;
  phase: PhaseSkillKey;
  content: string;
  base_version: string;
  schema_version: number;
  status: 'ok' | 'quarantined';
  status_reason: string | null;
  updated_at: string;
}

function mapRow(row: SkillDbRow): SkillRow {
  return {
    projectId: row.project_id,
    phase: row.phase as PhaseSkillKey,
    content: row.content,
    baseVersion: row.base_version,
    schemaVersion: row.schema_version,
    status: row.status as 'ok' | 'quarantined',
    statusReason: row.status_reason,
    updatedAt: toIsoUtc(row.updated_at) ?? row.updated_at,
  };
}

export class SkillsQueries {
  constructor(private db: DatabaseSync) {}

  /**
   * Fetch a single skill override by composite key. Returns null when no row
   * exists at this scope. Used by `resolveSkill` in @shipcode/agents.
   */
  get(projectId: string | null, phase: PhaseSkillKey): SkillRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM skills
         WHERE COALESCE(project_id, '') = COALESCE(?, '')
           AND phase = ?
         LIMIT 1`,
      )
      .get(projectId, phase) as SkillDbRow | undefined;
    return row ? mapRow(row) : null;
  }

  /**
   * Upsert a skill override. The caller is responsible for validating
   * `content` against the bundled default's required slots BEFORE calling
   * this — `SkillsQueries` does not import the loader to keep the dep graph
   * clean. The IPC handler in apps/desktop runs `validateSkill` first.
   */
  set(
    projectId: string | null,
    phase: PhaseSkillKey,
    content: string,
    baseVersion: string,
    schemaVersion: number,
  ): void {
    const existing = this.get(projectId, phase);
    if (existing) {
      this.db
        .prepare(
          `UPDATE skills
           SET content = ?, base_version = ?, schema_version = ?,
               status = 'ok', status_reason = NULL,
               updated_at = ${ISO_NOW_SQL}
           WHERE COALESCE(project_id, '') = COALESCE(?, '')
             AND phase = ?`,
        )
        .run(content, baseVersion, schemaVersion, projectId, phase);
    } else {
      this.db
        .prepare(
          `INSERT INTO skills (project_id, phase, content, base_version, schema_version, status)
           VALUES (?, ?, ?, ?, ?, 'ok')`,
        )
        .run(projectId, phase, content, baseVersion, schemaVersion);
    }
  }

  /**
   * Delete a skill override row. Used by the /skills page's "Reset to default"
   * action. The next `get()` returns null and the resolver falls through to
   * the next tier.
   */
  delete(projectId: string | null, phase: PhaseSkillKey): void {
    this.db
      .prepare(
        `DELETE FROM skills
         WHERE COALESCE(project_id, '') = COALESCE(?, '')
           AND phase = ?`,
      )
      .run(projectId, phase);
  }

  /**
   * Mark a row as quarantined. Called by the loader when validation fails on
   * load. Preserves the user's content so they can recover it manually via
   * the /skills page rather than silently losing work.
   */
  markQuarantined(projectId: string | null, phase: PhaseSkillKey, reason: string): void {
    this.db
      .prepare(
        `UPDATE skills
         SET status = 'quarantined', status_reason = ?, updated_at = ${ISO_NOW_SQL}
         WHERE COALESCE(project_id, '') = COALESCE(?, '')
           AND phase = ?`,
      )
      .run(reason, projectId, phase);
  }

  /**
   * List every row in the table. Used by the desktop main process to render
   * the /skills page (joined with bundled defaults to show the resolution
   * chain) and to surface the quarantine banner.
   */
  listAll(): SkillRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM skills ORDER BY phase, project_id`)
      .all() as SkillDbRow[];
    return rows.map(mapRow);
  }

  /**
   * List quarantined rows for the startup banner. Empty when no rows are
   * broken.
   */
  listQuarantined(): SkillRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM skills WHERE status = 'quarantined' ORDER BY phase, project_id`)
      .all() as SkillDbRow[];
    return rows.map(mapRow);
  }
}
