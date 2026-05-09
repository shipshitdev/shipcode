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

import { createElectronEmitter } from './pipeline-bridge';

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
        event: {},
        createdAt: new Date().toISOString(),
      })),
    },
    threads: {
      getById: vi.fn(() => makeThread()),
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
});
