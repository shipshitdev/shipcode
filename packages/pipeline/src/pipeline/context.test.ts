import { DEFAULT_SETTINGS, PIPELINE_PHASE } from '@shipcode/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PipelineContext } from '../types';
import { createPipelineContextHelpers, resetPhaseState, snapshotPhaseInput } from './context';

describe('resetPhaseState', () => {
  it('clears phase-local context fields', () => {
    const context = {
      stabilizationFeedback: 'fix tests',
      executionResumeContext: 'resume from checkpoint',
      previousPlanRawOutput: 'old plan',
      testOutput: 'test output',
      runtimeQaOutput: 'runtime output',
      runtimeQaCleanup: async () => {},
      cpuQueueStartedAt: 1,
      cpuQueueLastNotifiedAt: 2,
    } as PipelineContext;

    resetPhaseState(context);

    expect(context.stabilizationFeedback).toBeNull();
    expect(context.executionResumeContext).toBeNull();
    expect(context.previousPlanRawOutput).toBeNull();
    expect(context.testOutput).toBeNull();
    expect(context.runtimeQaOutput).toBeNull();
    expect(context.runtimeQaCleanup).toBeNull();
    expect(context.cpuQueueStartedAt).toBeNull();
    expect(context.cpuQueueLastNotifiedAt).toBeNull();
  });

  it('preserves selected phase-local fields for verifier evidence handoff', () => {
    const context = {
      stabilizationFeedback: 'fix tests',
      testOutput: 'typecheck passed',
      runtimeQaOutput: 'playwright passed',
      cpuQueueStartedAt: 1,
      cpuQueueLastNotifiedAt: 2,
    } as PipelineContext;

    resetPhaseState(context, ['testOutput', 'runtimeQaOutput']);

    expect(context.stabilizationFeedback).toBeNull();
    expect(context.testOutput).toBe('typecheck passed');
    expect(context.runtimeQaOutput).toBe('playwright passed');
    expect(context.cpuQueueStartedAt).toBeNull();
    expect(context.cpuQueueLastNotifiedAt).toBeNull();
  });
});

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      get: vi.fn(() => DEFAULT_SETTINGS),
    },
    threads: {
      getById: vi.fn(() => null),
    },
    projects: {
      getById: vi.fn(() => null),
    },
    githubIssues: {
      getByNumber: vi.fn(() => null),
    },
    emitter: {
      emit: vi.fn(),
    },
    skills: {},
    skillResolutionLogs: {
      create: vi.fn(),
    },
    ...overrides,
  };
}

describe('snapshotPhaseInput', () => {
  it('returns an immutable provider-safe view of context fields', () => {
    const snapshot = snapshotPhaseInput({
      threadId: 'thread-1',
      projectPath: '/repo',
      projectId: 'project-1',
      worktreePath: '/worktree',
      baseBranch: 'main',
      forkPointSha: 'abc123',
      githubIssueNumber: 42,
      githubIssueTitle: 'Issue title',
      githubRepo: 'shipshitdev/shipcode',
      autonomous: true,
      stabilizationFeedback: 'must not leak',
    } as PipelineContext);

    expect(snapshot).toEqual({
      threadId: 'thread-1',
      projectPath: '/repo',
      projectId: 'project-1',
      worktreePath: '/worktree',
      baseBranch: 'main',
      forkPointSha: 'abc123',
      githubIssueNumber: 42,
      githubIssueTitle: 'Issue title',
      githubRepo: 'shipshitdev/shipcode',
      autonomous: true,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});

describe('createPipelineContextHelpers', () => {
  it('emits workflow warnings once when creating and reusing context', () => {
    const deps = makeDeps();
    const active = new Map<string, PipelineContext>();
    const helpers = createPipelineContextHelpers(deps as never, active);
    const warning = {
      code: 'workflow_parse_error',
      message: 'bad workflow',
      path: '/repo/WORKFLOW.md',
    } as const;

    const context = helpers.ensureContext('thread-1', {
      projectPath: '/repo',
      workflowPolicy: {
        path: '/repo/WORKFLOW.md',
        config: {},
        promptTemplate: null,
        continuationPromptTemplate: null,
        agent: {
          maxConcurrentAgents: 1,
          maxRetryBackoffMs: 1000,
          maxConcurrentAgentsByState: {},
          maxTurns: 5,
        },
        warning,
      },
    });
    const same = helpers.ensureContext('thread-1', { projectPath: '/repo' });

    expect(same).toBe(context);
    expect(deps.emitter.emit).toHaveBeenCalledTimes(1);
    expect(deps.emitter.emit).toHaveBeenCalledWith({
      type: 'workflow:warning',
      threadId: 'thread-1',
      warning,
    });
  });

  it('reuses sparse existing contexts with settings fallbacks', () => {
    const deps = makeDeps();
    const existing = {
      threadId: 'thread-1',
      projectPath: '/repo',
      phaseReasoningOverrides: {},
      phasePromptScopes: undefined,
      clarificationHistory: undefined,
      repoPromptMaterials: undefined,
      workflowPolicy: {
        path: null,
        config: {},
        promptTemplate: null,
        continuationPromptTemplate: null,
        agent: {
          maxConcurrentAgents: 1,
          maxRetryBackoffMs: 1000,
          maxConcurrentAgentsByState: {},
          maxTurns: 5,
        },
        warning: null,
      },
      workflowWarningEmitted: undefined,
      executionResumeContext: undefined,
    } as unknown as PipelineContext;
    const helpers = createPipelineContextHelpers(
      deps as never,
      new Map<string, PipelineContext>([['thread-1', existing]]),
    );

    const context = helpers.ensureContext('thread-1', {
      projectPath: '/repo',
      executorReasoningEffort: 'high',
      verifierReasoningEffort: 'low',
    });

    expect(context).toBe(existing);
    expect(context.plannerModel).toBe(DEFAULT_SETTINGS.plannerModel);
    expect(context.reviewerModel).toBe(DEFAULT_SETTINGS.reviewerModel);
    expect(context.verifierModel).toBe(DEFAULT_SETTINGS.verifierModel);
    expect(context.executorModel).toBe('claude');
    expect(context.phaseReasoningOverrides.execute).toBe('high');
    expect(context.phaseReasoningOverrides.verify).toBe('low');
    expect(context.clarificationHistory).toEqual([]);
    expect(context.repoPromptMaterials).toBeNull();
    expect(context.executionResumeContext).toBeNull();
  });

  it('falls back to settings reasoning efforts when reusing sparse contexts', () => {
    const deps = makeDeps();
    const existing = {
      threadId: 'thread-1',
      projectPath: '/repo',
      plannerModel: 'claude',
      reviewerModel: 'codex',
      verifierModel: 'claude',
      executorModel: 'claude',
      plannerModelIdOverride: null,
      reviewerModelIdOverride: null,
      executorModelIdOverride: null,
      verifierModelIdOverride: null,
      phaseReasoningOverrides: {},
      phasePromptScopes: undefined,
      clarificationHistory: [],
      repoPromptMaterials: null,
      workflowPolicy: {
        path: null,
        config: {},
        promptTemplate: null,
        continuationPromptTemplate: null,
        agent: {
          maxConcurrentAgents: 1,
          maxRetryBackoffMs: 1000,
          maxConcurrentAgentsByState: {},
          maxTurns: 5,
        },
        warning: null,
      },
      workflowWarningEmitted: false,
      executionResumeContext: null,
    } as unknown as PipelineContext;
    const helpers = createPipelineContextHelpers(
      deps as never,
      new Map<string, PipelineContext>([['thread-1', existing]]),
    );

    const context = helpers.ensureContext('thread-1', { projectPath: '/repo' });

    expect(context.phaseReasoningOverrides.execute).toBe(DEFAULT_SETTINGS.executorReasoningEffort);
    expect(context.phaseReasoningOverrides.verify).toBe(DEFAULT_SETTINGS.verifierReasoningEffort);
  });

  it('rehydrateContext no-ops for active or missing threads', () => {
    const deps = makeDeps();
    const active = new Map<string, PipelineContext>();
    const helpers = createPipelineContextHelpers(deps as never, active);

    helpers.ensureContext('active-thread', { projectPath: '/repo' });
    helpers.rehydrateContext('active-thread', '/repo');
    helpers.rehydrateContext('missing-thread', '/repo');

    expect(active.has('active-thread')).toBe(true);
    expect(active.has('missing-thread')).toBe(false);
  });

  it('rehydrates a persisted thread with issue-specific project model overrides', () => {
    const deps = makeDeps({
      threads: {
        getById: vi.fn(() => ({
          id: 'thread-1',
          projectId: 'project-1',
          worktreePath: '/worktree',
          autonomous: true,
          reviewRound: 2,
          clarificationRound: 1,
          clarificationRequest: null,
          clarificationAnswers: [],
          answeredClarification: null,
          verificationRetries: 3,
          githubIssueNumber: 42,
          githubRepo: 'shipshitdev/shipcode',
          baseBranch: 'main',
          forkPointSha: 'abc123',
          plannerModel: 'claude',
          reviewerModel: 'codex',
          verifierModel: 'claude',
          executorModel: 'openrouter',
        })),
      },
      projects: {
        getById: vi.fn(() => ({
          id: 'project-1',
          plannerModelOverride: 'codex',
          reviewerModelOverride: 'claude',
          executorModelOverride: 'openrouter',
          verifierModelOverride: 'codex',
          plannerModelIdOverride: 'gpt-5.4-mini',
          reviewerModelIdOverride: 'claude-sonnet-4-6',
          executorModelIdOverride: 'openrouter/auto',
          verifierModelIdOverride: 'gpt-5.4',
          plannerReasoningEffortOverride: 'low',
          reviewerReasoningEffortOverride: 'medium',
          executorReasoningEffortOverride: 'high',
          verifierReasoningEffortOverride: 'xhigh',
        })),
      },
      githubIssues: {
        getByNumber: vi.fn(() => ({
          issueNumber: 42,
          plannerModelOverride: null,
          reviewerModelOverride: null,
          executorModelOverride: null,
          verifierModelOverride: null,
        })),
      },
    });
    const active = new Map<string, PipelineContext>();
    const helpers = createPipelineContextHelpers(deps as never, active);

    helpers.rehydrateContext('thread-1', '/repo', 'Issue title');

    const context = active.get('thread-1');
    expect(context).toMatchObject({
      threadId: 'thread-1',
      projectId: 'project-1',
      worktreePath: '/worktree',
      autonomous: true,
      reviewRound: 2,
      verificationRetries: 3,
      githubIssueNumber: 42,
      githubIssueTitle: 'Issue title',
      baseBranch: 'main',
      forkPointSha: 'abc123',
    });
  });

  it('rehydrates a thread without issue/project metadata using thread defaults', () => {
    const deps = makeDeps({
      threads: {
        getById: vi.fn(() => ({
          id: 'thread-1',
          projectId: 'project-1',
          worktreePath: null,
          autonomous: false,
          reviewRound: 0,
          clarificationRound: 0,
          clarificationRequest: null,
          clarificationAnswers: [],
          answeredClarification: null,
          verificationRetries: 0,
          githubIssueNumber: null,
          githubRepo: null,
          baseBranch: null,
          forkPointSha: null,
          plannerModel: null,
          reviewerModel: null,
          verifierModel: null,
          executorModel: null,
        })),
      },
      projects: {
        getById: vi.fn(() => null),
      },
    });
    const active = new Map<string, PipelineContext>();
    const helpers = createPipelineContextHelpers(deps as never, active);

    helpers.rehydrateContext('thread-1', '/repo');

    expect(active.get('thread-1')).toMatchObject({
      plannerModel: 'claude',
      reviewerModel: 'codex',
      verifierModel: 'claude',
      executorModel: 'claude',
      githubIssueNumber: null,
      githubIssueTitle: null,
      githubRepo: null,
      baseBranch: '',
      forkPointSha: '',
    });
    expect(deps.githubIssues.getByNumber).not.toHaveBeenCalled();
  });

  it('rehydrates answered clarification history from persisted threads', () => {
    const answeredClarification = {
      request: {
        id: 'clarify-1',
        threadId: 'thread-1',
        phase: 'plan',
        summary: 'Need input',
        questions: [],
      },
      answers: [],
      answeredAt: '2026-01-01T00:00:00.000Z',
    };
    const deps = makeDeps({
      threads: {
        getById: vi.fn(() => ({
          id: 'thread-1',
          projectId: 'project-1',
          worktreePath: null,
          autonomous: false,
          reviewRound: 0,
          clarificationRound: 1,
          clarificationRequest: null,
          clarificationAnswers: [],
          answeredClarification,
          verificationRetries: 0,
          githubIssueNumber: null,
          githubRepo: null,
          baseBranch: 'main',
          forkPointSha: 'abc123',
          plannerModel: 'claude',
          reviewerModel: 'codex',
          verifierModel: 'claude',
          executorModel: 'claude',
        })),
      },
    });
    const active = new Map<string, PipelineContext>();
    const helpers = createPipelineContextHelpers(deps as never, active);

    helpers.rehydrateContext('thread-1', '/repo');

    expect(active.get('thread-1')?.clarificationHistory).toEqual([answeredClarification]);
  });

  it('lists active contexts with thread status and filters by phase', () => {
    const deps = makeDeps({
      threads: {
        getById: vi.fn((threadId: string) =>
          threadId === 'thread-1'
            ? { id: threadId, projectId: 'project-1', status: PIPELINE_PHASE.executing }
            : null,
        ),
      },
    });
    const helpers = createPipelineContextHelpers(deps as never, new Map());
    helpers.ensureContext('thread-1', {
      projectPath: '/repo',
      projectId: 'project-1',
      worktreePath: '/worktree',
      activeProcessId: 'proc-1',
      startedAt: 123,
    });

    expect(helpers.listActive()).toEqual([
      {
        threadId: 'thread-1',
        projectId: 'project-1',
        projectPath: '/repo',
        worktreePath: '/worktree',
        phase: PIPELINE_PHASE.executing,
        startedAt: 123,
        activeProcessId: 'proc-1',
      },
    ]);
    expect(helpers.listActiveInPhases([PIPELINE_PHASE.executing])).toHaveLength(1);
    expect(helpers.listActiveInPhases([PIPELINE_PHASE.planning])).toHaveLength(0);
  });

  it('lists active contexts with thread and idle fallbacks', () => {
    const deps = makeDeps({
      threads: {
        getById: vi.fn((threadId: string) =>
          threadId === 'thread-1' ? { id: threadId, projectId: 'project-from-thread' } : null,
        ),
      },
    });
    const helpers = createPipelineContextHelpers(deps as never, new Map());
    helpers.ensureContext('thread-1', {
      projectPath: '/repo',
      startedAt: 123,
    });
    helpers.ensureContext('thread-2', {
      projectPath: '/repo',
      startedAt: 456,
    });

    expect(helpers.listActive()).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        projectId: 'project-from-thread',
        worktreePath: null,
        phase: 'idle',
      }),
      expect.objectContaining({
        threadId: 'thread-2',
        projectId: null,
        worktreePath: null,
        phase: 'idle',
      }),
    ]);
  });

  it('emits skill fallback events and records resolved skill sources', () => {
    const deps = makeDeps();
    const helpers = createPipelineContextHelpers(deps as never, new Map());
    const context = helpers.ensureContext('thread-1', {
      projectPath: '/repo',
      projectId: 'project-1',
    });

    const callSite = helpers.skillCallSite(context);
    callSite.deps.onFallback('plan-generation', { message: 'invalid override' } as never);
    callSite.deps.onResolved('plan-generation', {
      skill: {
        source: 'default',
        baseVersion: 'bundled',
      },
      fallbackUsed: true,
      error: {
        code: 'invalid',
        message: 'bad skill',
      },
    } as never);
    callSite.deps.onResolved('plan-execution', {
      skill: {
        source: 'project',
        baseVersion: 'custom',
      },
      fallbackUsed: false,
      error: null,
    } as never);
    callSite.deps.onResolved(
      'github-label-sync' as never,
      {
        skill: { source: 'global', baseVersion: 'global' },
        fallbackUsed: false,
        error: null,
      } as never,
    );

    expect(deps.emitter.emit).toHaveBeenCalledWith({
      type: 'skill:fallback',
      threadId: 'thread-1',
      phase: 'plan-generation',
      reason: 'invalid override',
    });
    expect(deps.skillResolutionLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPhase: 'plan',
        skillKey: 'plan-generation',
        source: 'bundled',
        fallbackUsed: true,
      }),
    );
    expect(deps.skillResolutionLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPhase: 'execute',
        skillKey: 'plan-execution',
        source: 'project',
        fallbackUsed: false,
      }),
    );
    expect(deps.skillResolutionLogs.create).toHaveBeenCalledTimes(2);
  });

  it('uses the default skill fallback reason and null telemetry error fields', () => {
    const deps = makeDeps();
    const helpers = createPipelineContextHelpers(deps as never, new Map());
    const context = helpers.ensureContext('thread-1', { projectPath: '/repo' });
    const callSite = helpers.skillCallSite(context);

    callSite.deps.onFallback('plan-generation', undefined);
    callSite.deps.onResolved('plan-generation', {
      skill: {
        source: 'default',
        baseVersion: 'bundled',
      },
      fallbackUsed: false,
      error: undefined,
    } as never);

    expect(deps.emitter.emit).toHaveBeenCalledWith({
      type: 'skill:fallback',
      threadId: 'thread-1',
      phase: 'plan-generation',
      reason: 'override quarantined',
    });
    expect(deps.skillResolutionLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: null,
        errorMessage: null,
      }),
    );
  });

  it('logs non-fatal skill resolution persistence failures', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({
      skillResolutionLogs: {
        create: vi.fn(() => {
          throw new Error('db locked');
        }),
      },
    });
    const helpers = createPipelineContextHelpers(deps as never, new Map());
    const context = helpers.ensureContext('thread-1', { projectPath: '/repo' });

    helpers.skillCallSite(context).deps.onResolved('plan-generation', {
      skill: { source: 'default', baseVersion: 'bundled' },
      fallbackUsed: false,
      error: null,
    } as never);

    expect(errorSpy).toHaveBeenCalledWith(
      '[pipeline] skill resolution log failed for thread thread-1:',
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
