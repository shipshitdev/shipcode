import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { PipelineAnalyticsQueries } from './pipeline-analytics';
import { PhaseLogQueries } from './pipeline-phase-log';
import { PipelineStepQueries } from './pipeline-steps';
import { ProjectQueries } from './projects';
import { PromptTelemetryQueries } from './prompt-telemetry';
import { SkillResolutionLogQueries } from './skill-resolution-log';
import { ThreadQueries } from './threads';

describe('pipeline analytics persistence', () => {
  let db: DatabaseSync;
  let projectId: string;
  let threadId: string;
  let phaseLogs: PhaseLogQueries;
  let skillLogs: SkillResolutionLogQueries;
  let analytics: PipelineAnalyticsQueries;

  beforeEach(() => {
    db = createTestDb();
    projectId = new ProjectQueries(db).add('/tmp/pipeline-analytics').id;
    threadId = new ThreadQueries(db).create(projectId, 'prompt', 'Issue').id;
    phaseLogs = new PhaseLogQueries(db);
    skillLogs = new SkillResolutionLogQueries(db);
    analytics = new PipelineAnalyticsQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('closes phase duration rows across transitions', () => {
    phaseLogs.transition(threadId, 'planning');
    phaseLogs.transition(threadId, 'executing');
    phaseLogs.transition(threadId, 'completed');

    const rows = phaseLogs.listByThread(threadId);

    expect(rows.map((row) => row.phase)).toEqual(['planning', 'executing', 'completed']);
    expect(rows.every((row) => row.completedAt !== null)).toBe(true);
    expect(rows.find((row) => row.phase === 'planning')?.durationMs).not.toBeNull();
    expect(rows.find((row) => row.phase === 'executing')?.durationMs).not.toBeNull();
    expect(rows.find((row) => row.phase === 'completed')?.durationMs).toBeNull();
  });

  it('does not accrue human-blocked approval wait time', () => {
    phaseLogs.create({
      threadId,
      phase: 'planning',
      startedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    phaseLogs.transition(threadId, 'approval');
    phaseLogs.transition(threadId, 'executing');

    const rows = phaseLogs.listByThread(threadId);
    const planning = rows.find((row) => row.phase === 'planning');
    const approval = rows.find((row) => row.phase === 'approval');
    const executing = rows.find((row) => row.phase === 'executing');

    expect(planning?.durationMs ?? 0).toBeGreaterThan(0);
    expect(approval).toMatchObject({
      completedAt: approval?.startedAt,
      durationMs: null,
      terminalStatus: 'approval',
    });
    expect(executing?.completedAt).toBeNull();
    expect(rows.filter((row) => row.completedAt === null)).toHaveLength(1);
  });

  it('records skill resolution rows', () => {
    const row = skillLogs.create({
      threadId,
      providerPhase: 'execute',
      skillKey: 'plan-execution',
      source: 'bundled',
      baseVersion: 'abc123',
      fallbackUsed: false,
    });

    expect(row.skillKey).toBe('plan-execution');
    expect(row.source).toBe('bundled');
    expect(skillLogs.listByThread(threadId)).toHaveLength(1);
  });

  it('aggregates thread timeline, prompt, token, and skill data', () => {
    phaseLogs.transition(threadId, 'planning');
    phaseLogs.transition(threadId, 'executing');
    const steps = new PipelineStepQueries(db);
    const attempt = steps.start({
      threadId,
      phase: 'execute',
      attempt: 1,
      provider: 'claude',
      requestedModel: 'claude-sonnet-4-6',
    });
    steps.complete(attempt.id, {
      status: 'completed',
      promptTokens: 100,
      completionTokens: 25,
      costUsd: 0.01,
    });
    new PromptTelemetryQueries(db).create({
      threadId,
      phase: 'execute',
      invocationId: 'inv-1',
      attempt: 1,
      promptCharacters: 1000,
      promptBytes: 1100,
      promptLines: 20,
      selectedMaterials: {
        count: 2,
        labels: ['issue', 'repo'],
        kinds: ['issue_prompt', 'repo_context'],
      },
    });
    skillLogs.create({
      threadId,
      providerPhase: 'execute',
      skillKey: 'plan-execution',
      source: 'bundled',
    });

    const result = analytics.getThread(threadId);

    expect(result.phaseTimeline.length).toBeGreaterThanOrEqual(1);
    expect(result.providerAttempts).toHaveLength(1);
    expect(result.tokensByPhase[0]).toMatchObject({
      phase: 'execute',
      promptTokens: 100,
      completionTokens: 25,
    });
    expect(result.promptByPhase[0]).toMatchObject({
      phase: 'execute',
      materialCount: 2,
    });
    expect(result.skillFallback.totalResolutions).toBe(1);
  });

  it('returns empty thread analytics defaults when no rows exist', () => {
    const result = analytics.getThread('missing-thread');

    expect(result).toMatchObject({
      threadId: 'missing-thread',
      phaseTimeline: [],
      providerAttempts: [],
      promptTelemetry: [],
      skillResolutions: [],
      tokensByPhase: [],
      promptByPhase: [],
      bottleneckPhase: null,
      bottleneckDurationMs: null,
      totalDurationMs: null,
    });
    expect(result.skillFallback.score).toBe(100);
  });

  it('treats missing token and cost fields as zero in thread analytics', () => {
    new PipelineStepQueries(db).start({
      threadId,
      phase: 'plan',
      attempt: 1,
    });
    skillLogs.create({
      threadId,
      providerPhase: 'plan',
      skillKey: 'plan-generation',
      source: 'bundled',
      fallbackUsed: true,
    });

    const result = analytics.getThread(threadId);

    expect(result.tokensByPhase).toEqual([
      {
        phase: 'plan',
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        attemptCount: 1,
      },
    ]);
    expect(result.skillFallback.fallbackCount).toBe(1);
  });

  it('returns empty overview defaults when no analytics rows exist', () => {
    const overview = analytics.getOverview();

    expect(overview.timeToPr).toEqual({
      sampleSize: 0,
      medianMs: null,
      p75Ms: null,
      p95Ms: null,
    });
    expect(overview.averagePhaseDurations).toEqual([]);
    expect(overview.slowestRecentRuns).toEqual([]);
    expect(overview.tokensByPhase).toEqual([]);
    expect(overview.promptByPhase).toEqual([]);
    expect(overview.skillFallback).toMatchObject({
      totalResolutions: 0,
      fallbackCount: 0,
      fallbackRate: 0,
      parseFailureRate: 0,
      retryRate: 0,
      downstreamSuccessRate: 1,
      score: 100,
    });
  });

  it('returns null bottlenecks for slow runs when phase duration lookup is empty', () => {
    const fakeDb = {
      prepare: () => ({
        get: () => null,
      }),
    } as unknown as DatabaseSync;
    const fakeAnalytics = new PipelineAnalyticsQueries(fakeDb) as unknown as {
      getSlowestRecentRuns: (
        runs: Array<Record<string, unknown>>,
      ) => Array<Record<string, unknown>>;
    };

    expect(
      fakeAnalytics.getSlowestRecentRuns([
        {
          thread_id: 'thread-empty-bottleneck',
          title: 'No bottleneck',
          project_name: null,
          github_pr_number: null,
          duration_ms: 10,
          completed_at: null,
        },
      ]),
    ).toEqual([
      {
        threadId: 'thread-empty-bottleneck',
        title: 'No bottleneck',
        projectName: null,
        githubPrNumber: null,
        durationMs: 10,
        completedAt: null,
        bottleneckPhase: null,
        bottleneckDurationMs: null,
      },
    ]);
  });

  it('ignores bottleneck rows without a duration', () => {
    const fakeDb = {
      prepare: () => ({
        get: () => ({ phase: 'planning', duration_ms: null }),
      }),
    } as unknown as DatabaseSync;
    const fakeAnalytics = new PipelineAnalyticsQueries(fakeDb) as unknown as {
      getBottleneckForThread: (threadId: string) => unknown;
    };

    expect(fakeAnalytics.getBottleneckForThread('thread-null-duration')).toBeNull();
  });

  it('aggregates overview analytics from completed runs, prompts, steps, and skill outcomes', () => {
    const threads = new ThreadQueries(db);
    const steps = new PipelineStepQueries(db);
    const prompts = new PromptTelemetryQueries(db);

    const slowThread = threads.create(projectId, 'prompt', 'Slow run');
    const failedThread = threads.create(projectId, 'prompt', 'Failed run');
    threads.updateStatus(threadId, 'completed');
    threads.updateStatus(slowThread.id, 'completed');
    threads.updateStatus(failedThread.id, 'failed');
    threads.setGithubPr(threadId, 42);
    threads.setGithubPr(slowThread.id, 77);

    db.prepare(
      `INSERT INTO pipeline_phase_log (
        id, thread_id, phase, started_at, completed_at, duration_ms, terminal_status
      ) VALUES
        ('phase-1', ?, 'planning', '2026-05-09T00:00:00.000Z', '2026-05-09T00:01:00.000Z', 60000, 'executing'),
        ('phase-2', ?, 'executing', '2026-05-09T00:01:00.000Z', '2026-05-09T00:03:00.000Z', 120000, 'completed'),
        ('phase-3', ?, 'planning', '2026-05-09T00:00:00.000Z', '2026-05-09T00:04:00.000Z', 240000, 'executing'),
        ('phase-4', ?, 'executing', '2026-05-09T00:04:00.000Z', '2026-05-09T00:09:00.000Z', 300000, 'completed')`,
    ).run(threadId, threadId, slowThread.id, slowThread.id);

    const firstAttempt = steps.start({
      threadId,
      phase: 'execute',
      attempt: 1,
      provider: 'claude',
      requestedModel: 'claude-sonnet-4-6',
    });
    steps.complete(firstAttempt.id, {
      status: 'failed',
      errorKind: 'schema_parse',
      errorMessage: 'Invalid JSON',
      promptTokens: 100,
      completionTokens: 20,
      costUsd: 0.01,
    });
    const retryAttempt = steps.start({
      threadId,
      phase: 'execute',
      attempt: 2,
      provider: 'claude',
      requestedModel: 'claude-sonnet-4-6',
    });
    steps.complete(retryAttempt.id, {
      status: 'completed',
      promptTokens: 200,
      completionTokens: 50,
      costUsd: 0.03,
    });
    const reviewAttempt = steps.start({
      threadId: slowThread.id,
      phase: 'review',
      attempt: 1,
      provider: 'codex',
      requestedModel: 'gpt-5.4',
    });
    steps.complete(reviewAttempt.id, {
      status: 'completed',
      promptTokens: 300,
      completionTokens: 60,
      costUsd: 0.05,
    });

    prompts.create({
      threadId,
      phase: 'execute',
      invocationId: 'inv-1',
      attempt: 1,
      promptCharacters: 1000,
      promptBytes: 1200,
      promptLines: 20,
      selectedMaterials: {
        count: 2,
        labels: ['issue', 'tests'],
        kinds: ['issue_prompt', 'testing_context'],
      },
    });
    prompts.create({
      threadId: slowThread.id,
      phase: 'review',
      invocationId: 'inv-2',
      attempt: 1,
      promptCharacters: 600,
      promptBytes: 800,
      promptLines: 10,
      selectedMaterials: null,
    });
    db.prepare(
      `INSERT INTO prompt_telemetry (
        id, thread_id, phase, invocation_id, prompt_characters, prompt_bytes, prompt_lines, selected_materials
      ) VALUES ('bad-materials', ?, 'plan', 'inv-3', 300, 500, 5, '{not json')`,
    ).run(threadId);

    skillLogs.create({
      threadId,
      providerPhase: 'execute',
      skillKey: 'plan-execution',
      source: 'bundled',
      fallbackUsed: true,
    });
    skillLogs.create({
      threadId: failedThread.id,
      providerPhase: 'execute',
      skillKey: 'plan-execution',
      source: 'bundled',
      fallbackUsed: false,
    });

    const overview = analytics.getOverview();

    expect(overview.timeToPr).toEqual({
      sampleSize: 2,
      medianMs: 180000,
      p75Ms: 540000,
      p95Ms: 540000,
    });
    expect(overview.averagePhaseDurations.map((row) => row.phase)).toEqual([
      'executing',
      'planning',
    ]);
    expect(overview.averagePhaseDurations[0]).toMatchObject({
      runCount: 2,
      averageMs: 210000,
      medianMs: 120000,
      p75Ms: 300000,
    });
    expect(overview.slowestRecentRuns[0]).toMatchObject({
      threadId: slowThread.id,
      title: 'Slow run',
      githubPrNumber: 77,
      durationMs: 540000,
      bottleneckPhase: 'executing',
      bottleneckDurationMs: 300000,
    });
    expect(overview.tokensByPhase).toEqual([
      {
        phase: 'review',
        promptTokens: 300,
        completionTokens: 60,
        costUsd: 0.05,
        attemptCount: 1,
      },
      {
        phase: 'execute',
        promptTokens: 300,
        completionTokens: 70,
        costUsd: 0.04,
        attemptCount: 2,
      },
    ]);
    expect(overview.promptByPhase).toEqual([
      {
        phase: 'execute',
        promptCount: 1,
        averageCharacters: 1000,
        averageBytes: 1200,
        averageLines: 20,
        materialCount: 2,
        materialKinds: ['issue_prompt', 'testing_context'],
      },
      {
        phase: 'review',
        promptCount: 1,
        averageCharacters: 600,
        averageBytes: 800,
        averageLines: 10,
        materialCount: 0,
        materialKinds: [],
      },
      {
        phase: 'plan',
        promptCount: 1,
        averageCharacters: 300,
        averageBytes: 500,
        averageLines: 5,
        materialCount: 0,
        materialKinds: [],
      },
    ]);
    expect(overview.skillFallback).toMatchObject({
      totalResolutions: 2,
      fallbackCount: 1,
      fallbackRate: 0.5,
      parseFailureRate: 1 / 3,
      retryRate: 1 / 3,
      downstreamSuccessRate: 0.5,
    });
    expect(overview.skillFallback.score).toBe(57);
  });
});
