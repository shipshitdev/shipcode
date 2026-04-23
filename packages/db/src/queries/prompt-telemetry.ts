import type { DatabaseSync } from 'node:sqlite';
import type {
  PromptTelemetryInsert,
  PromptTelemetryMaterialSummary,
  PromptTelemetryRecord,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface PromptTelemetryRow {
  id: string;
  thread_id: string;
  phase: PromptTelemetryRecord['phase'];
  invocation_id: string;
  attempt: number | null;
  provider: string | null;
  model: string | null;
  prompt_characters: number;
  prompt_bytes: number;
  prompt_lines: number;
  selected_materials: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  created_at: string;
}

export class PromptTelemetryQueries {
  constructor(private db: DatabaseSync) {}

  create(input: PromptTelemetryInsert): PromptTelemetryRecord {
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO prompt_telemetry (
          id, thread_id, phase, invocation_id, attempt, provider, model,
          prompt_characters, prompt_bytes, prompt_lines, selected_materials,
          prompt_tokens, completion_tokens, cost_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.threadId,
        input.phase,
        input.invocationId,
        input.attempt ?? null,
        input.provider ?? null,
        input.model ?? null,
        input.promptCharacters,
        input.promptBytes,
        input.promptLines,
        input.selectedMaterials ? JSON.stringify(input.selectedMaterials) : null,
        input.promptTokens ?? null,
        input.completionTokens ?? null,
        input.costUsd ?? null,
      );
    return this.getById(id) ?? this.failLoad(id);
  }

  getById(id: string): PromptTelemetryRecord | null {
    const row = this.db.prepare('SELECT * FROM prompt_telemetry WHERE id = ?').get(id);
    return row ? mapPromptTelemetry(asRow<PromptTelemetryRow>(row)) : null;
  }

  listByThread(threadId: string): PromptTelemetryRecord[] {
    return asRows<PromptTelemetryRow>(
      this.db
        .prepare(
          'SELECT * FROM prompt_telemetry WHERE thread_id = ? ORDER BY created_at ASC, id ASC',
        )
        .all(threadId),
    ).map(mapPromptTelemetry);
  }

  listByInvocation(threadId: string, invocationId: string): PromptTelemetryRecord[] {
    return asRows<PromptTelemetryRow>(
      this.db
        .prepare(
          `SELECT * FROM prompt_telemetry
           WHERE thread_id = ? AND invocation_id = ?
           ORDER BY created_at ASC, id ASC`,
        )
        .all(threadId, invocationId),
    ).map(mapPromptTelemetry);
  }

  private failLoad(id: string): never {
    throw new Error(`Failed to load prompt telemetry after insert: ${id}`);
  }
}

function mapPromptTelemetry(row: PromptTelemetryRow): PromptTelemetryRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    phase: row.phase,
    invocationId: row.invocation_id,
    attempt: row.attempt,
    provider: row.provider,
    model: row.model,
    promptCharacters: row.prompt_characters,
    promptBytes: row.prompt_bytes,
    promptLines: row.prompt_lines,
    selectedMaterials: parseSelectedMaterials(row.selected_materials),
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
  };
}

function parseSelectedMaterials(value: string | null): PromptTelemetryMaterialSummary | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as PromptTelemetryMaterialSummary;
  } catch {
    return null;
  }
}
