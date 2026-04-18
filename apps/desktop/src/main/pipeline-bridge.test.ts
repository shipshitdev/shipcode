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
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: false,
    baseBranch: 'main',
    forkPointSha: 'abc123',
    githubIssueNumber: 42,
    githubPrNumber: null,
    githubRepo: null,
    lastError: null,
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
    onPipelineTerminal: vi.fn(),
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

  it('fires onPipelineTerminal on awaiting_approval', () => {
    emitPhase('awaiting_approval');
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
