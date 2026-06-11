import type { DatabaseSync } from 'node:sqlite';
import { toIsoUtc } from '@shipcode/shared';
import { asRow } from '../utils';

export type IssueChatSessionProvider = 'claude' | 'codex';

export interface IssueChatSessionRecord {
  threadId: string;
  provider: IssueChatSessionProvider;
  sessionId: string | null;
  cwd: string;
  model: string | null;
  reasoningEffort: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertIssueChatSession {
  threadId: string;
  provider: IssueChatSessionProvider;
  sessionId?: string | null;
  cwd: string;
  model?: string | null;
  reasoningEffort?: string | null;
}

interface IssueChatSessionRow {
  thread_id: string;
  provider: IssueChatSessionProvider;
  session_id: string | null;
  cwd: string;
  model: string | null;
  reasoning_effort: string | null;
  created_at: string;
  updated_at: string;
}

export class IssueChatSessionQueries {
  constructor(private db: DatabaseSync) {}

  getByThread(threadId: string): IssueChatSessionRecord | null {
    const row = this.db
      .prepare('SELECT * FROM issue_chat_sessions WHERE thread_id = ?')
      .get(threadId);
    return row ? this.toRecord(asRow<IssueChatSessionRow>(row)) : null;
  }

  upsert(input: UpsertIssueChatSession): IssueChatSessionRecord {
    this.db
      .prepare(
        `INSERT INTO issue_chat_sessions
          (thread_id, provider, session_id, cwd, model, reasoning_effort)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
          provider = excluded.provider,
          session_id = excluded.session_id,
          cwd = excluded.cwd,
          model = excluded.model,
          reasoning_effort = excluded.reasoning_effort,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run(
        input.threadId,
        input.provider,
        input.sessionId ?? null,
        input.cwd,
        input.model ?? null,
        input.reasoningEffort ?? null,
      );
    const record = this.getByThread(input.threadId);
    if (!record) {
      throw new Error(`Failed to load issue chat session after upsert: ${input.threadId}`);
    }
    return record;
  }

  updateSessionId(threadId: string, sessionId: string): IssueChatSessionRecord {
    this.db
      .prepare(
        `UPDATE issue_chat_sessions
            SET session_id = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE thread_id = ?`,
      )
      .run(sessionId, threadId);
    const record = this.getByThread(threadId);
    if (!record) {
      throw new Error(`Failed to load issue chat session after session update: ${threadId}`);
    }
    return record;
  }

  delete(threadId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM issue_chat_sessions WHERE thread_id = ?')
      .run(threadId);
    return result.changes > 0;
  }

  private toRecord(row: IssueChatSessionRow): IssueChatSessionRecord {
    return {
      threadId: row.thread_id,
      provider: row.provider,
      sessionId: row.session_id,
      cwd: row.cwd,
      model: row.model,
      reasoningEffort: row.reasoning_effort,
      createdAt: toIsoUtc(row.created_at) ?? row.created_at,
      updatedAt: toIsoUtc(row.updated_at) ?? row.updated_at,
    };
  }
}
