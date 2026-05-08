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
  let threadId: string;
  let phaseLogs: PhaseLogQueries;
  let skillLogs: SkillResolutionLogQueries;
  let analytics: PipelineAnalyticsQueries;

  beforeEach(() => {
    db = createTestDb();
    const projectId = new ProjectQueries(db).add('/tmp/pipeline-analytics').id;
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
    phaseLogs.transition(threadId, 'awaiting_approval');
    phaseLogs.transition(threadId, 'executing');

    const rows = phaseLogs.listByThread(threadId);
    const planning = rows.find((row) => row.phase === 'planning');
    const awaitingApproval = rows.find((row) => row.phase === 'awaiting_approval');
    const executing = rows.find((row) => row.phase === 'executing');

    expect(planning?.durationMs ?? 0).toBeGreaterThan(0);
    expect(awaitingApproval).toMatchObject({
      completedAt: awaitingApproval?.startedAt,
      durationMs: null,
      terminalStatus: 'awaiting_approval',
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
});
