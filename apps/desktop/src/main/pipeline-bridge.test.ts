import type { PipelineEvent } from '@shipcode/pipeline';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: class {},
}));

// Mock the logger so tests don't write to disk
vi.mock('./logger.service', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logEvent: vi.fn(),
}));

vi.mock('./telemetry', () => ({
  capturePipelineFailure: vi.fn(),
}));

import { logEvent } from './logger.service';
import { breadcrumbForEvent, createElectronEmitter } from './pipeline-bridge';
import { capturePipelineFailure } from './telemetry';

function makeMainWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    },
  };
}

function makeThread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Fix bug',
    prompt: 'Fix it',
    status: 'executing',
    kind: 'pipeline' as const,
    worktreeBranch: null,
    worktreePath: null,
    plannerModel: 'claude',
    reviewerModel: 'codex',
    executorModel: 'claude',
    verifierModel: 'claude',
    reviewRound: 0,
    clarificationRound: 0,
    clarificationRequest: null,
    clarificationAnswers: [],
    answeredClarification: null,
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: false,
    baseBranch: 'main',
    forkPointSha: 'abc123',
    githubIssueNumber: 42,
    githubPrNumber: null,
    githubRepo: null,
    automationId: null,
    lastError: null,
    failurePhase: null,
    failureCount: 0,
    pausedPhase: null,
    pausedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plannerResolvedModel: null,
    reviewerResolvedModel: null,
    revisorResolvedModel: null,
    executorResolvedModel: null,
    verifierResolvedModel: null,
    totalTokensPrompt: 0,
    totalTokensCompletion: 0,
    totalCostUsd: 0,
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    activity: {
      create: vi.fn(),
    },
    terminalEvents: {
      create: vi.fn(() => ({
        id: 'evt-1',
        threadId: 'thread-1',
        runId: null,
        event: {},
        createdAt: new Date().toISOString(),
      })),
    },
    threads: {
      getById: vi.fn((threadId = 'thread-1') => makeThread({ id: threadId })),
    },
    notifications: {
      dismissByThread: vi.fn(),
      markVerificationExhausted: vi.fn(),
      fire: vi.fn(),
    },
    chatNotifications: {
      fire: vi.fn(),
    },
    automations: {
      recordRunFinished: vi.fn(),
    },
    onPipelineTerminal: vi.fn(),
    onExecutionSlotFreed: vi.fn(),
    ...overrides,
  };
}

describe('createElectronEmitter onPipelineTerminal (slot-freed) callback', () => {
  let mainWindow: ReturnType<typeof makeMainWindow>;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    mainWindow = makeMainWindow();
    deps = makeDeps();
  });

  function emitPhase(phase: string) {
    const emitter = createElectronEmitter(mainWindow as never, deps as never);
    emitter.emit({ type: 'pipeline:phase', threadId: 'thread-1', phase } as PipelineEvent);
  }

  it('fires onPipelineTerminal on completed', () => {
    emitPhase('completed');
    expect(deps.onPipelineTerminal).toHaveBeenCalledTimes(1);
  });

  it('fires onPipelineTerminal on failed', () => {
    emitPhase('failed');
    expect(deps.onPipelineTerminal).toHaveBeenCalledTimes(1);
  });

  it('fires onPipelineTerminal on idle', () => {
    emitPhase('idle');
    expect(deps.onPipelineTerminal).toHaveBeenCalledTimes(1);
  });

  it('fires onPipelineTerminal on approval', () => {
    emitPhase('approval');
    expect(deps.onPipelineTerminal).toHaveBeenCalledTimes(1);
  });

  it('fires onPipelineTerminal on clarifying', () => {
    emitPhase('clarifying');
    expect(deps.onPipelineTerminal).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onPipelineTerminal on executing', () => {
    emitPhase('executing');
    expect(deps.onPipelineTerminal).not.toHaveBeenCalled();
  });

  it('does NOT fire onPipelineTerminal on planning', () => {
    emitPhase('planning');
    expect(deps.onPipelineTerminal).not.toHaveBeenCalled();
  });

  it('does NOT fire onPipelineTerminal on verifying', () => {
    emitPhase('verifying');
    expect(deps.onPipelineTerminal).not.toHaveBeenCalled();
  });

  it('works without an onPipelineTerminal callback (optional)', () => {
    const depsNoCallback = makeDeps({ onPipelineTerminal: undefined });
    const emitter = createElectronEmitter(mainWindow as never, depsNoCallback as never);
    expect(() =>
      emitter.emit({
        type: 'pipeline:phase',
        threadId: 'thread-1',
        phase: 'completed',
      } as PipelineEvent),
    ).not.toThrow();
  });
});

describe('breadcrumbForEvent', () => {
  it('maps a phase transition to an info breadcrumb', () => {
    const crumb = breadcrumbForEvent({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'executing',
      runId: 'run-9',
    } as PipelineEvent);
    expect(crumb).toEqual({
      category: 'pipeline.phase',
      level: 'info',
      message: 'phase: executing',
      data: { threadId: 'thread-1', phase: 'executing', runId: 'run-9' },
    });
  });

  it('marks the failed phase as an error-level breadcrumb', () => {
    const crumb = breadcrumbForEvent({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'failed',
    } as PipelineEvent);
    expect(crumb?.level).toBe('error');
    expect(crumb?.data).toMatchObject({ phase: 'failed', runId: null });
  });

  it('records run start, approval-gate, and verification-exhausted lifecycle steps', () => {
    expect(
      breadcrumbForEvent({
        type: 'pipeline:start-context',
        threadId: 't',
        source: 'github:start-issue',
        projectPath: '/p',
        githubIssueNumber: 42,
        autonomous: true,
        requireApproval: false,
        reviewRound: 0,
      } as PipelineEvent),
    ).toMatchObject({
      category: 'pipeline.lifecycle',
      message: 'run started via github:start-issue',
    });

    expect(
      breadcrumbForEvent({
        type: 'pipeline:approval-gate',
        threadId: 't',
        outcome: 'auto_execute',
        reviewDecision: 'approve',
        planVersion: 1,
        requireApproval: false,
        autonomous: true,
        reviewRound: 1,
        revisionCount: 0,
        hasCriticalOrMajor: false,
        reasons: ['reviewApproved'],
      } as PipelineEvent),
    ).toMatchObject({
      category: 'pipeline.approval',
      message: 'approval-gate: auto_execute (review: approve)',
    });

    expect(
      breadcrumbForEvent({
        type: 'pipeline:verification-exhausted',
        threadId: 't',
        retries: 3,
      } as PipelineEvent),
    ).toMatchObject({
      category: 'pipeline.verification',
      level: 'warning',
      message: 'verification exhausted after 3 retries',
    });
  });

  it('returns null for noisy / low-signal events', () => {
    expect(
      breadcrumbForEvent({ type: 'pipeline:output', threadId: 't', chunk: 'x' } as PipelineEvent),
    ).toBeNull();
    expect(
      breadcrumbForEvent({
        type: 'pipeline:turn-started',
        threadId: 't',
        turnNumber: 1,
      } as PipelineEvent),
    ).toBeNull();
  });
});

describe('createElectronEmitter thread-scoped breadcrumb trail', () => {
  let mainWindow: ReturnType<typeof makeMainWindow>;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    mainWindow = makeMainWindow();
    deps = makeDeps();
  });

  it('attaches only the failed thread breadcrumb trail to pipeline failure capture', () => {
    deps.threads.getById.mockImplementation((threadId = 'thread-1') =>
      makeThread({
        id: threadId,
        projectId: `project-${threadId}`,
        githubIssueNumber: threadId === 'thread-1' ? 1 : 2,
        lastError: `${threadId} failed`,
      }),
    );
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    emitter.emit({
      type: 'pipeline:start-context',
      threadId: 'thread-1',
      source: 'github:start-issue',
      projectPath: '/repo',
      githubIssueNumber: 1,
      autonomous: true,
      requireApproval: false,
      reviewRound: 0,
    } as never);
    emitter.emit({
      type: 'pipeline:phase',
      threadId: 'thread-2',
      phase: 'executing',
    } as PipelineEvent);
    emitter.emit({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'failed',
    } as PipelineEvent);

    expect(capturePipelineFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        breadcrumbs: [
          expect.objectContaining({
            category: 'pipeline.lifecycle',
            data: expect.objectContaining({ threadId: 'thread-1' }),
          }),
          expect.objectContaining({
            category: 'pipeline.phase',
            data: expect.objectContaining({ threadId: 'thread-1', phase: 'failed' }),
          }),
        ],
      }),
    );
    expect(capturePipelineFailure).not.toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        breadcrumbs: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({ threadId: 'thread-2' }),
          }),
        ]),
      }),
    );
  });

  it('does not attach raw output events to the failure breadcrumb trail', () => {
    const emitter = createElectronEmitter(mainWindow as never, deps as never);
    emitter.emit({
      type: 'pipeline:output',
      threadId: 'thread-1',
      chunk: 'noise',
    } as PipelineEvent);
    emitter.emit({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'failed',
    } as PipelineEvent);

    expect(capturePipelineFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        breadcrumbs: [
          expect.objectContaining({
            category: 'pipeline.phase',
            data: expect.objectContaining({ phase: 'failed' }),
          }),
        ],
      }),
    );
  });
});

describe('createElectronEmitter event forwarding and terminal bookkeeping', () => {
  let mainWindow: ReturnType<typeof makeMainWindow>;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    mainWindow = makeMainWindow();
    deps = makeDeps();
  });

  it('persists canonical terminal events and forwards the saved record to the renderer', () => {
    const emitter = createElectronEmitter(mainWindow as never, deps as never);
    const terminalEvent = { kind: 'text' as const, content: 'hello' };

    emitter.emit({
      type: 'terminal:event',
      threadId: 'thread-1',
      event: terminalEvent,
    } as PipelineEvent);

    expect(deps.terminalEvents.create).toHaveBeenCalledWith('thread-1', terminalEvent);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'terminal:event',
      expect.objectContaining({ id: 'evt-1', threadId: 'thread-1' }),
    );
    expect(deps.threads.getById).not.toHaveBeenCalled();
  });

  it('persists pipeline terminal events with their run id', () => {
    const emitter = createElectronEmitter(mainWindow as never, deps as never);
    const terminalEvent = { kind: 'text' as const, content: 'hello' };

    emitter.emit({
      type: 'terminal:event',
      threadId: 'thread-1',
      runId: 'run-1',
      event: terminalEvent,
    } as PipelineEvent);

    expect(deps.terminalEvents.create).toHaveBeenCalledWith('thread-1', terminalEvent, 'run-1');
  });

  it('forwards raw pipeline output as agent output without writing activity or terminal records', () => {
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    emitter.emit({
      type: 'pipeline:output',
      threadId: 'thread-1',
      chunk: 'installing deps\n',
    } as PipelineEvent);

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('agent:output', {
      processId: 'test-thread-1',
      chunk: 'installing deps\n',
      threadId: 'thread-1',
    });
    expect(deps.terminalEvents.create).not.toHaveBeenCalled();
    expect(deps.activity.create).not.toHaveBeenCalled();
  });

  it('records automation completion and frees execution slots only for terminal phases', () => {
    deps.threads.getById = vi.fn(() => makeThread({ automationId: 'auto-1' }));
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    emitter.emit({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'completed',
    } as PipelineEvent);

    expect(deps.onExecutionSlotFreed).toHaveBeenCalledTimes(1);
    expect(deps.automations.recordRunFinished).toHaveBeenCalledWith('auto-1', 'completed');
    expect(deps.notifications.fire).toHaveBeenCalledWith(
      'completed',
      expect.objectContaining({ id: 'thread-1' }),
    );
    expect(deps.chatNotifications.fire).toHaveBeenCalledWith(
      'completed',
      expect.objectContaining({ id: 'thread-1' }),
    );
  });

  it('records activity for remaining visible phase transitions', () => {
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    for (const phase of ['reviewing', 'revising', 'testing', 'shipping', 'paused']) {
      emitter.emit({ type: 'pipeline:phase', threadId: 'thread-1', phase } as PipelineEvent);
    }

    expect(deps.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'codex',
        title: 'Fix bug — in review',
      }),
    );
    expect(deps.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'human',
        title: 'Fix bug — paused',
      }),
    );
    expect(deps.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Fix bug — revising' }),
    );
    expect(deps.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Fix bug — running tests' }),
    );
    expect(deps.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Fix bug — shipping' }),
    );
  });

  it('does not free execution slots while waiting for approval', () => {
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    emitter.emit({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'approval',
    } as PipelineEvent);

    expect(deps.onPipelineTerminal).toHaveBeenCalledTimes(1);
    expect(deps.onExecutionSlotFreed).not.toHaveBeenCalled();
    expect(deps.automations.recordRunFinished).not.toHaveBeenCalled();
  });

  it('records activity for parsed pipeline artifacts and verification exhaustion', () => {
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    emitter.emit({
      type: 'plan:parsed',
      threadId: 'thread-1',
      plan: {
        objective: 'Fix the failing test',
        steps: [{ id: 's1' }],
        files: ['src/app.ts'],
      },
    } as never);
    emitter.emit({
      type: 'review:parsed',
      threadId: 'thread-1',
      review: {
        decision: 'request_changes',
        confidence: 0.8,
        findings: [{ severity: 'medium' }],
      },
    } as never);
    emitter.emit({
      type: 'verification:parsed',
      threadId: 'thread-1',
      verification: {
        result: 'fail',
        summary: 'Tests failed',
      },
    } as never);
    emitter.emit({
      type: 'pipeline:verification-exhausted',
      threadId: 'thread-1',
      retries: 2,
      testSummary: 'still red',
    } as never);

    expect(deps.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'plan_parsed', subtitle: 'Fix the failing test' }),
    );
    expect(deps.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'review_parsed',
        actor: 'codex',
        subtitle: 'Revision requested by reviewer',
      }),
    );
    expect(deps.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'verification_parsed', subtitle: 'Tests failed' }),
    );
    expect(deps.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'pipeline_verification_exhausted',
        subtitle: '2 retries',
      }),
    );
    expect(deps.notifications.markVerificationExhausted).toHaveBeenCalledWith('thread-1');
    expect(deps.notifications.fire).toHaveBeenCalledWith(
      'verification_exhausted',
      expect.objectContaining({ id: 'thread-1' }),
      'still red',
    );
    expect(deps.chatNotifications.fire).toHaveBeenCalledWith(
      'verification_exhausted',
      expect.objectContaining({ id: 'thread-1' }),
      'still red',
    );
  });

  it('records null objective plan activity and logging metadata', () => {
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    emitter.emit({
      type: 'plan:parsed',
      threadId: 'thread-1',
      plan: {
        objective: null,
        steps: [],
        files: [],
      },
    } as never);

    expect(deps.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'plan_parsed', subtitle: null }),
    );
    expect(logEvent).toHaveBeenCalledWith(
      'plan:parsed',
      expect.objectContaining({ objective: null }),
    );
  });

  it('skips activity and failure capture when no thread is found', () => {
    deps.threads.getById.mockReturnValue(null as never);
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    emitter.emit({
      type: 'pipeline:verification-exhausted',
      threadId: 'thread-1',
      retries: 1,
      testSummary: 'red',
    } as never);

    expect(deps.activity.create).not.toHaveBeenCalled();
    expect(deps.notifications.markVerificationExhausted).not.toHaveBeenCalled();
  });

  it('swallows verification-exhausted notification errors', () => {
    deps.notifications.markVerificationExhausted.mockImplementation(() => {
      throw new Error('mark failed');
    });
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    expect(() =>
      emitter.emit({
        type: 'pipeline:verification-exhausted',
        threadId: 'thread-1',
        retries: 1,
        testSummary: 'red',
      } as never),
    ).not.toThrow();
  });

  it('writes model-resolution lifecycle events with explicit and estimated costs', () => {
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    emitter.emit({
      type: 'pipeline:model-resolved',
      threadId: 'thread-1',
      requestedModel: 'openrouter',
      resolvedModel: 'openai/gpt-4.1',
      tokensUsed: { prompt: 100, completion: 20 },
      costUsd: 0.0123,
    } as never);
    emitter.emit({
      type: 'pipeline:model-resolved',
      threadId: 'thread-1',
      requestedModel: 'codex',
      resolvedModel: 'gpt-5.3-codex',
      tokensUsed: { prompt: 100, completion: 20 },
      costUsd: 0,
    } as never);
    emitter.emit({
      type: 'pipeline:model-resolved',
      threadId: 'thread-1',
      requestedModel: 'claude',
      resolvedModel: 'claude-sonnet-4',
      tokensUsed: null,
      costUsd: 0.01,
    } as never);
    emitter.emit({
      type: 'pipeline:model-resolved',
      threadId: 'thread-1',
      requestedModel: null,
      resolvedModel: null,
      tokensUsed: null,
      costUsd: null,
    } as never);

    expect(deps.terminalEvents.create).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({
        kind: 'lifecycle',
        message: expect.stringContaining('model:'),
      }),
    );
    expect(deps.terminalEvents.create).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({
        message: expect.stringContaining('~$'),
      }),
    );
  });

  it('ignores unknown phase activity metadata while still forwarding the event', () => {
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    emitter.emit({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'unknown-phase',
    } as never);

    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'pipeline:phase',
      expect.objectContaining({ phase: 'unknown-phase' }),
    );
    expect(deps.activity.create).not.toHaveBeenCalled();
  });

  it('logs and forwards non-activity pipeline event variants', () => {
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    emitter.emit({ type: 'pipeline:start-context', threadId: 'thread-1', source: 'test' } as never);
    emitter.emit({ type: 'pipeline:approval-gate', threadId: 'thread-1' } as never);
    emitter.emit({ type: 'skill:fallback', threadId: 'thread-1', skill: 'missing' } as never);
    emitter.emit({ type: 'workflow:warning', threadId: 'thread-1', message: 'warn' } as never);

    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'pipeline:start-context',
      expect.objectContaining({ type: 'pipeline:start-context' }),
    );
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'pipeline:approval-gate',
      expect.objectContaining({ type: 'pipeline:approval-gate' }),
    );
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'skill:fallback',
      expect.objectContaining({ type: 'skill:fallback' }),
    );
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'workflow:warning',
      expect.objectContaining({ type: 'workflow:warning' }),
    );
  });

  it('throttles dashboard invalidation for non-terminal events and flushes terminal phases', () => {
    vi.useFakeTimers();
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    emitter.emit({
      type: 'review:parsed',
      threadId: 'thread-1',
      review: {
        decision: 'approve',
        confidence: 1,
        findings: [],
      },
    } as never);
    emitter.emit({
      type: 'verification:parsed',
      threadId: 'thread-1',
      verification: {
        result: 'pass',
        summary: null,
      },
    } as never);

    expect(mainWindow.webContents.send).not.toHaveBeenCalledWith(
      'dashboard:invalidate',
      expect.anything(),
    );

    vi.advanceTimersByTime(2000);

    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'dashboard:invalidate',
      expect.objectContaining({ kinds: ['stats', 'activity', 'running', 'recent'] }),
    );

    emitter.emit({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'completed',
    } as PipelineEvent);

    expect(mainWindow.webContents.send).toHaveBeenLastCalledWith(
      'dashboard:invalidate',
      expect.objectContaining({ kinds: ['stats', 'activity', 'running', 'recent'] }),
    );
    vi.useRealTimers();
  });

  it('clears pending dashboard throttles when a terminal phase flushes immediately', () => {
    vi.useFakeTimers();
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    emitter.emit({
      type: 'review:parsed',
      threadId: 'thread-1',
      review: {
        decision: 'reject',
        confidence: 0.1,
        findings: [],
      },
    } as never);
    emitter.emit({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'failed',
    } as PipelineEvent);
    vi.advanceTimersByTime(2000);

    expect(
      mainWindow.webContents.send.mock.calls.filter(
        ([channel]) => channel === 'dashboard:invalidate',
      ),
    ).toHaveLength(1);
    vi.useRealTimers();
  });

  it('does not forward renderer events when the window is destroyed', () => {
    mainWindow.isDestroyed.mockReturnValue(true);
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    emitter.emit({
      type: 'pipeline:output',
      threadId: 'thread-1',
      chunk: 'hidden',
    } as PipelineEvent);
    emitter.emit({
      type: 'review:parsed',
      threadId: 'thread-1',
      review: {
        decision: 'approve',
        confidence: 1,
        findings: [],
      },
    } as never);

    expect(mainWindow.webContents.send).not.toHaveBeenCalledWith('agent:output', expect.anything());
    expect(mainWindow.webContents.send).not.toHaveBeenCalledWith(
      'review:parsed',
      expect.anything(),
    );
  });

  it('skips immediate dashboard invalidation when the window is destroyed', () => {
    mainWindow.isDestroyed.mockReturnValue(true);
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    emitter.emit({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'completed',
    } as PipelineEvent);

    expect(mainWindow.webContents.send).not.toHaveBeenCalledWith(
      'dashboard:invalidate',
      expect.anything(),
    );
  });

  it('swallows event logging and telemetry capture errors', () => {
    vi.mocked(logEvent).mockImplementationOnce(() => {
      throw new Error('terminal log failed');
    });
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    expect(() =>
      emitter.emit({
        type: 'terminal:event',
        threadId: 'thread-1',
        event: { kind: 'text', content: 'hello' },
      } as never),
    ).not.toThrow();

    vi.mocked(logEvent).mockImplementationOnce(() => {
      throw new Error('event log failed');
    });
    expect(() =>
      emitter.emit({
        type: 'review:parsed',
        threadId: 'thread-1',
        review: {
          decision: 'approve',
          confidence: 1,
          findings: [],
        },
      } as never),
    ).not.toThrow();

    vi.mocked(capturePipelineFailure).mockImplementationOnce(() => {
      throw new Error('capture failed');
    });
    expect(() =>
      emitter.emit({
        type: 'pipeline:phase',
        threadId: 'thread-1',
        phase: 'failed',
      } as PipelineEvent),
    ).not.toThrow();
  });

  it('swallows activity, notification, queue, execution queue, and automation errors', () => {
    deps.activity.create.mockImplementation(() => {
      throw new Error('activity failed');
    });
    deps.notifications.fire.mockImplementation(() => {
      throw new Error('notification failed');
    });
    deps.onPipelineTerminal = vi.fn(() => {
      throw new Error('queue failed');
    });
    deps.onExecutionSlotFreed = vi.fn(() => {
      throw new Error('execution queue failed');
    });
    deps.automations.recordRunFinished.mockImplementation(() => {
      throw new Error('automation failed');
    });
    deps.threads.getById = vi.fn(() => makeThread({ automationId: 'auto-1' }));
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    expect(() =>
      emitter.emit({
        type: 'pipeline:phase',
        threadId: 'thread-1',
        phase: 'completed',
      } as PipelineEvent),
    ).not.toThrow();

    expect(deps.onPipelineTerminal).toHaveBeenCalled();
    expect(deps.onExecutionSlotFreed).toHaveBeenCalled();
    expect(deps.automations.recordRunFinished).toHaveBeenCalledWith('auto-1', 'completed');
  });

  it('swallows terminal persistence and model terminal write errors', () => {
    deps.terminalEvents.create.mockImplementation(() => {
      throw new Error('terminal db failed');
    });
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    expect(() =>
      emitter.emit({
        type: 'terminal:event',
        threadId: 'thread-1',
        event: { kind: 'text', content: 'hello' },
      } as never),
    ).not.toThrow();
    expect(() =>
      emitter.emit({
        type: 'pipeline:model-resolved',
        threadId: 'thread-1',
        requestedModel: 'openrouter',
        resolvedModel: 'openai/gpt-4.1',
        tokensUsed: null,
        costUsd: null,
      } as never),
    ).not.toThrow();
  });

  it('swallows phase terminal write errors', () => {
    deps.terminalEvents.create.mockImplementation(() => {
      throw new Error('terminal db failed');
    });
    const emitter = createElectronEmitter(mainWindow as never, deps as never);

    expect(() =>
      emitter.emit({
        type: 'pipeline:phase',
        threadId: 'thread-1',
        phase: 'planning',
      } as PipelineEvent),
    ).not.toThrow();
  });
});
