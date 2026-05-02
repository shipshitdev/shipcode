import type { DatabaseSync } from 'node:sqlite';
import { toIsoUtc } from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

export interface AgentConversationRecord {
  id: string;
  threadId: string;
  phase: string;
  round: number;
  speaker: string;
  role: 'prompt' | 'response';
  parentId: string | null;
  provider: string | null;
  model: string | null;
  content: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  createdAt: string;
}

export interface InsertAgentConversation {
  threadId: string;
  phase: string;
  round?: number;
  speaker: string;
  role: 'prompt' | 'response';
  parentId?: string | null;
  provider?: string | null;
  model?: string | null;
  content: string;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | null;
}

interface AgentConversationRow {
  id: string;
  thread_id: string;
  phase: string;
  round: number;
  speaker: string;
  role: 'prompt' | 'response';
  parent_id: string | null;
  provider: string | null;
  model: string | null;
  content: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  created_at: string;
}

export class AgentConversationQueries {
  constructor(private db: DatabaseSync) {}

  insert(input: InsertAgentConversation): AgentConversationRecord {
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO agent_conversations
          (id, thread_id, phase, round, speaker, role, parent_id, provider, model, content, tokens_in, tokens_out, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.threadId,
        input.phase,
        input.round ?? 0,
        input.speaker,
        input.role,
        input.parentId ?? null,
        input.provider ?? null,
        input.model ?? null,
        input.content,
        input.tokensIn ?? null,
        input.tokensOut ?? null,
        input.costUsd ?? null,
      );
    return this.getById(id)!;
  }

  getById(id: string): AgentConversationRecord | null {
    const row = this.db.prepare('SELECT * FROM agent_conversations WHERE id = ?').get(id);
    return row ? this.toRecord(asRow<AgentConversationRow>(row)) : null;
  }

  listByThread(
    threadId: string,
    filters?: { phase?: string; role?: 'prompt' | 'response' },
  ): AgentConversationRecord[] {
    let sql = 'SELECT * FROM agent_conversations WHERE thread_id = ?';
    const params: (string | number | null)[] = [threadId];

    if (filters?.phase) {
      sql += ' AND phase = ?';
      params.push(filters.phase);
    }
    if (filters?.role) {
      sql += ' AND role = ?';
      params.push(filters.role);
    }

    sql += ' ORDER BY created_at ASC LIMIT 1000';

    const rows = this.db.prepare(sql).all(...params);
    return asRows<AgentConversationRow>(rows).map((r) => this.toRecord(r));
  }

  countByThread(threadId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM agent_conversations WHERE thread_id = ?')
      .get(threadId) as { count: number };
    return row.count;
  }

  private toRecord(row: AgentConversationRow): AgentConversationRecord {
    return {
      id: row.id,
      threadId: row.thread_id,
      phase: row.phase,
      round: row.round,
      speaker: row.speaker,
      role: row.role,
      parentId: row.parent_id,
      provider: row.provider,
      model: row.model,
      content: row.content,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      costUsd: row.cost_usd,
      createdAt: toIsoUtc(row.created_at) ?? row.created_at,
    };
  }
}
