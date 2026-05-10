import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { HeatmapQueries } from './heatmap';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';

interface InsertStepArgs {
  threadId: string;
  startedAt: string;
  phase?: string;
  attempt?: number;
  status?: string;
  cost?: number;
  promptTokens?: number;
  completionTokens?: number;
  completedAt?: string | null;
}

function ymd(daysAgo: number): string {
  const today = new Date();
  const utc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return new Date(utc - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

function isoAt(daysAgo: number, hour = 12): string {
  return `${ymd(daysAgo)}T${String(hour).padStart(2, '0')}:00:00.000Z`;
}

function insertStep(db: DatabaseSync, args: InsertStepArgs): string {
  const id = `step-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    `INSERT INTO pipeline_step_log (
       id, thread_id, phase, attempt, provider, requested_model,
       status, prompt_tokens, completion_tokens, cost_usd,
       started_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    args.threadId,
    args.phase ?? 'execute',
    args.attempt ?? 1,
    'claude-cli',
    'claude-sonnet-4-6',
    args.status ?? 'completed',
    args.promptTokens ?? null,
    args.completionTokens ?? null,
    args.cost ?? null,
    args.startedAt,
    args.completedAt ?? null,
  );
  return id;
}

describe('HeatmapQueries.byScope', () => {
  let db: DatabaseSync;
  let queries: HeatmapQueries;
  let projectId: string;
  let threadA: string;
  let threadB: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = new ProjectQueries(db).add('/tmp/heatmap-test').id;
    const threads = new ThreadQueries(db);
    threadA = threads.create(projectId, 'a', 'Thread A').id;
    threadB = threads.create(projectId, 'b', 'Thread B').id;
    queries = new HeatmapQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('zero-fills every day in the range', () => {
    const rows = queries.byScope({ scope: 'global', rangeDays: 30 });
    expect(rows).toHaveLength(30);
    expect(
      rows.every((r) => r.costUsd === 0 && r.tokens === 0 && r.runs === 0 && r.prsOpened === 0),
    ).toBe(true);
    // Chronological: oldest first
    expect(rows[0].date).toBe(ymd(29));
    expect(rows[29].date).toBe(ymd(0));
  });

  it('aggregates cost, tokens, and runs per day', () => {
    insertStep(db, {
      threadId: threadA,
      startedAt: isoAt(2),
      cost: 0.5,
      promptTokens: 100,
      completionTokens: 50,
    });
    insertStep(db, {
      threadId: threadA,
      startedAt: isoAt(2, 14),
      attempt: 2,
      cost: 0.25,
      promptTokens: 40,
      completionTokens: 20,
    });
    insertStep(db, {
      threadId: threadB,
      startedAt: isoAt(2, 16),
      cost: 1.0,
      promptTokens: 200,
      completionTokens: 80,
    });

    const rows = queries.byScope({ scope: 'global', rangeDays: 30 });
    const target = rows.find((r) => r.date === ymd(2));
    expect(target).toBeDefined();
    expect(target?.costUsd).toBeCloseTo(1.75, 6);
    expect(target?.tokens).toBe(490);
    // runs = DISTINCT (thread_id, attempt) → A/1, A/2, B/1 = 3
    expect(target?.runs).toBe(3);
  });

  it('scopes by project', () => {
    const otherProject = new ProjectQueries(db).add('/tmp/other').id;
    const otherThread = new ThreadQueries(db).create(otherProject, 'o', 'Other').id;
    insertStep(db, { threadId: threadA, startedAt: isoAt(1), cost: 0.1 });
    insertStep(db, { threadId: otherThread, startedAt: isoAt(1), cost: 5.0 });

    const projectRows = queries.byScope({ scope: 'project', projectId, rangeDays: 30 });
    const day = projectRows.find((r) => r.date === ymd(1));
    expect(day?.costUsd).toBeCloseTo(0.1, 6);
  });

  it('scopes by thread', () => {
    insertStep(db, {
      threadId: threadA,
      startedAt: isoAt(1),
      cost: 0.1,
      promptTokens: 10,
      completionTokens: 5,
    });
    insertStep(db, {
      threadId: threadB,
      startedAt: isoAt(1),
      cost: 9.0,
      promptTokens: 99,
      completionTokens: 99,
    });

    const rows = queries.byScope({ scope: 'thread', threadId: threadA, rangeDays: 30 });
    const day = rows.find((r) => r.date === ymd(1));
    expect(day?.costUsd).toBeCloseTo(0.1, 6);
    expect(day?.tokens).toBe(15);
    expect(day?.runs).toBe(1);
  });

  it('throws when project scope is missing projectId', () => {
    expect(() => queries.byScope({ scope: 'project', rangeDays: 30 })).toThrow(
      /projectId required/,
    );
  });

  it('throws when thread scope is missing threadId', () => {
    expect(() => queries.byScope({ scope: 'thread', rangeDays: 30 })).toThrow(/threadId required/);
  });

  it('excludes rows outside the range window', () => {
    // 30-day window covers ymd(0)..ymd(29). Anything older must be excluded.
    insertStep(db, { threadId: threadA, startedAt: isoAt(45), cost: 99 });
    insertStep(db, { threadId: threadA, startedAt: isoAt(5), cost: 1 });

    const rows = queries.byScope({ scope: 'global', rangeDays: 30 });
    expect(rows).toHaveLength(30);
    const total = rows.reduce((sum, r) => sum + r.costUsd, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('counts a PR once per thread even with multiple shipping completions', () => {
    new ThreadQueries(db).setGithubPr(threadA, 42);

    // First shipping completion (the one that opened the PR)
    insertStep(db, {
      threadId: threadA,
      phase: 'shipping',
      startedAt: isoAt(5),
      completedAt: isoAt(5, 13),
      status: 'completed',
    });
    // Re-run shipping a few days later — must NOT double-count
    insertStep(db, {
      threadId: threadA,
      phase: 'shipping',
      attempt: 2,
      startedAt: isoAt(2),
      completedAt: isoAt(2, 13),
      status: 'completed',
    });

    const rows = queries.byScope({ scope: 'global', rangeDays: 30 });
    const totalPrs = rows.reduce((sum, r) => sum + r.prsOpened, 0);
    expect(totalPrs).toBe(1);
    // MIN(date) wins → counted on the earlier day (5 days ago)
    expect(rows.find((r) => r.date === ymd(5))?.prsOpened).toBe(1);
    expect(rows.find((r) => r.date === ymd(2))?.prsOpened).toBe(0);
  });

  it('ignores shipping completions for threads without a PR number', () => {
    // threadB has no github_pr_number set
    insertStep(db, {
      threadId: threadB,
      phase: 'shipping',
      startedAt: isoAt(3),
      completedAt: isoAt(3, 14),
      status: 'completed',
    });

    const rows = queries.byScope({ scope: 'global', rangeDays: 30 });
    const totalPrs = rows.reduce((sum, r) => sum + r.prsOpened, 0);
    expect(totalPrs).toBe(0);
  });

  it('returns rangeDays cells for each preset range', () => {
    expect(queries.byScope({ scope: 'global', rangeDays: 30 })).toHaveLength(30);
    expect(queries.byScope({ scope: 'global', rangeDays: 90 })).toHaveLength(90);
    expect(queries.byScope({ scope: 'global', rangeDays: 365 })).toHaveLength(365);
  });

  it('ignores aggregate rows outside the enumerated range and rejects unknown scopes', () => {
    const fakeDb = {
      prepare: (() => {
        let call = 0;
        return () => ({
          all: () => {
            call++;
            if (call === 1) {
              return [
                { day: ymd(0), cost: null, tokens: null, runs: null },
                { day: '1900-01-01', cost: 1, tokens: 2, runs: 3 },
              ];
            }
            return [{ pr_date: null }, { pr_date: '1900-01-01' }];
          },
        });
      })(),
    } as unknown as DatabaseSync;

    const rows = new HeatmapQueries(fakeDb).byScope({ scope: 'global', rangeDays: 30 });
    expect(rows.every((row) => row.costUsd === 0 && row.prsOpened === 0)).toBe(true);
    expect(() => queries.byScope({ scope: 'workspace' as never, rangeDays: 30 })).toThrow(
      'unknown scope',
    );
  });
});
