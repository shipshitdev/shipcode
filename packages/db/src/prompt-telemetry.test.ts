import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectQueries } from './queries/projects';
import { PromptTelemetryQueries } from './queries/prompt-telemetry';
import { ThreadQueries } from './queries/threads';
import { migrateV35 } from './schema';
import { createTestDb } from './test-helpers';

describe('prompt telemetry persistence', () => {
  let db: DatabaseSync;
  let threadId: string;

  beforeEach(() => {
    db = createTestDb();
    const projects = new ProjectQueries(db);
    const threads = new ThreadQueries(db);
    const projectId = projects.add('/tmp/prompt-telemetry').id;
    threadId = threads.create(projectId, 'prompt', 'Prompt').id;
  });

  afterEach(() => {
    db.close();
  });

  it('migration is idempotent', () => {
    expect(() => migrateV35(db)).not.toThrow();
    expect(() => migrateV35(db)).not.toThrow();
  });

  it('inserts and reads records by thread and invocation', () => {
    const queries = new PromptTelemetryQueries(db);
    const record = queries.create({
      threadId,
      phase: 'plan',
      invocationId: 'thread-1:plan:1',
      attempt: 1,
      provider: 'claude-cli',
      model: 'claude',
      promptCharacters: 10,
      promptBytes: 10,
      promptLines: 2,
      selectedMaterials: { count: 1, labels: ['repo'], kinds: ['repo_file_context'] },
      promptTokens: 7,
      completionTokens: 3,
      costUsd: 0.01,
    });

    expect(queries.listByThread(threadId)).toEqual([record]);
    expect(queries.listByInvocation(threadId, 'thread-1:plan:1')).toEqual([record]);
  });

  it('maps optional fields, invalid selected materials, missing rows, and failed reloads', () => {
    const queries = new PromptTelemetryQueries(db);
    const minimal = queries.create({
      threadId,
      phase: 'execute',
      invocationId: 'thread-1:execute',
      promptCharacters: 10,
      promptBytes: 11,
      promptLines: 1,
    });

    expect(minimal).toMatchObject({
      attempt: null,
      provider: null,
      model: null,
      selectedMaterials: null,
      promptTokens: null,
      completionTokens: null,
      costUsd: null,
    });
    expect(queries.getById('missing')).toBeNull();

    db.prepare(
      `INSERT INTO prompt_telemetry (
        id, thread_id, phase, invocation_id, prompt_characters, prompt_bytes, prompt_lines, selected_materials
      ) VALUES ('bad-selected-materials', ?, 'plan', 'bad', 1, 1, 1, '{bad')`,
    ).run(threadId);
    expect(queries.getById('bad-selected-materials')?.selectedMaterials).toBeNull();

    const broken = new PromptTelemetryQueries(db);
    broken.getById = () => null;
    expect(() =>
      broken.create({
        threadId,
        phase: 'review',
        invocationId: 'broken',
        promptCharacters: 1,
        promptBytes: 1,
        promptLines: 1,
      }),
    ).toThrow(/Failed to load prompt telemetry after insert/);
  });
});
