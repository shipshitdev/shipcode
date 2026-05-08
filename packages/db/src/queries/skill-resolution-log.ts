import type { DatabaseSync } from 'node:sqlite';
import type {
  SkillResolutionLogInsert,
  SkillResolutionLogRecord,
  SkillResolutionSource,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface SkillResolutionLogRow {
  id: string;
  thread_id: string;
  provider_phase: SkillResolutionLogRecord['providerPhase'];
  skill_key: string;
  source: SkillResolutionSource;
  base_version: string | null;
  fallback_used: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export class SkillResolutionLogQueries {
  constructor(private db: DatabaseSync) {}

  create(input: SkillResolutionLogInsert): SkillResolutionLogRecord {
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO skill_resolution_log (
           id,
           thread_id,
           provider_phase,
           skill_key,
           source,
           base_version,
           fallback_used,
           error_code,
           error_message
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.threadId,
        input.providerPhase,
        input.skillKey,
        input.source,
        input.baseVersion ?? null,
        input.fallbackUsed ? 1 : 0,
        input.errorCode ?? null,
        input.errorMessage ?? null,
      );
    return this.getById(id) ?? this.failLoad(id);
  }

  getById(id: string): SkillResolutionLogRecord | null {
    const row = this.db.prepare('SELECT * FROM skill_resolution_log WHERE id = ?').get(id);
    return row ? mapSkillResolution(asRow<SkillResolutionLogRow>(row)) : null;
  }

  listByThread(threadId: string): SkillResolutionLogRecord[] {
    return asRows<SkillResolutionLogRow>(
      this.db
        .prepare(
          `SELECT *
             FROM skill_resolution_log
            WHERE thread_id = ?
            ORDER BY created_at ASC, rowid ASC`,
        )
        .all(threadId),
    ).map(mapSkillResolution);
  }

  private failLoad(id: string): never {
    throw new Error(`Failed to load skill resolution row: ${id}`);
  }
}

function mapSkillResolution(row: SkillResolutionLogRow): SkillResolutionLogRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    providerPhase: row.provider_phase,
    skillKey: row.skill_key,
    source: row.source,
    baseVersion: row.base_version,
    fallbackUsed: row.fallback_used === 1,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}
