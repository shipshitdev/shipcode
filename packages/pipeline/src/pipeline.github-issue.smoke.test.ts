import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentProvider, ProcessManager, ProviderPhase } from '@shipcode/agents';
import {
  createClaudeCliProvider,
  createCodexCliProvider,
  createProviderRegistry,
} from '@shipcode/agents';
import type { PipelineDeps } from './types';
import { createPipeline } from './pipeline';
import { DEFAULT_SETTINGS } from '@shipcode/shared';

vi.mock('@shipcode/git', () => {
  class WorktreeManager {
    create = vi.fn().mockResolvedValue({ worktreePath: '/fake/worktree', branch: 'feat/38-demo' });
    remove = vi.fn().mockResolvedValue({ success: true });
  }
  class GitService {
    listBranches = vi.fn().mockResolvedValue([]);
    getDefaultBranch = vi.fn().mockResolvedValue('main');
  }
  return { WorktreeManager, GitService };
});

const { mockExecSync } = vi.hoisted(() => ({ mockExecSync: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn((command: string, args: string[] = [], options?: object) =>
      mockExecSync([command, ...args].join(' '), options),
    ),
  };
});

const PLAN_JSON = JSON.stringify({
  id: 'p1',
  threadId: 't1',
  version: 1,
  objective: 'Smoke test',
  files: [{ path: 'demo.ts', action: 'modify', description: 'd' }],
  steps: [{ order: 1, description: 'd', files: ['demo.ts'], rationale: 'r' }],
  acceptanceCriteria: ['works'],
  outOfScope: [],
  estimatedComplexity: 'low',
  dependencies: [],
});

const REVIEW_APPROVE_JSON = JSON.stringify({
  planId: 'p1',
  decision: 'approve',
  confidence: 'high',
  summary: 'Looks good',
  findings: [],
  suggestedChanges: [],
});

function planBlock(json: string = PLAN_JSON) {
  return '```shipcode-plan\n' + json + '\n```';
}

function reviewBlock(json: string) {
  return '```shipcode-review\n' + json + '\n```';
}

function createSmokeDeps() {
  const emittedEvents: any[] = [];
  const listeners: Record<string, Function[]> = {};
  let spawnCount = 0;
  const structuredPlan = JSON.parse(PLAN_JSON);

  const processManager = {
    spawn: vi.fn(() => ({ id: `proc-${++spawnCount}` })),
    kill: vi.fn(),
    on: vi.fn((event: string, handler: Function) => {
      (listeners[event] ??= []).push(handler);
    }),
    removeListener: vi.fn((event: string, handler: Function) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
    }),
  } as unknown as ProcessManager;

  const trigger = async (event: string, ...args: any[]) => {
    const handlers = [...(listeners[event] ?? [])];
    handlers.forEach((handler) => handler(...args));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  };

  const latestPlan = {
    id: 'plan-1',
    threadId: 't1',
    version: 1,
    rawOutput: '',
    structured: structuredPlan,
    status: 'pending_review',
    createdAt: '',
  };

  const claudeProvider = createClaudeCliProvider(processManager);
  const codexProvider = createCodexCliProvider(processManager);
  const openrouterProvider: AgentProvider = {
    id: 'openrouter',
    supports: new Set<ProviderPhase>(['plan', 'review', 'revision', 'verify']),
    generate: vi.fn(async () => ({ rawOutput: '', exitCode: 1 })),
    healthCheck: vi.fn(async () => ({ ok: false })),
  };
  const providers = createProviderRegistry({
    claude: claudeProvider,
    codex: codexProvider,
    openrouter: openrouterProvider,
  });

  const settings = {
    get: vi.fn(() => ({ ...DEFAULT_SETTINGS, requireApproval: true })),
    set: vi.fn(),
  };

  return {
    deps: {
      emitter: { emit: vi.fn((event: any) => emittedEvents.push(event)) },
      processManager,
      threads: {
        updateStatus: vi.fn(),
        getById: vi.fn(() => ({
          id: 't1',
          projectId: 'project-1',
          githubIssueNumber: 38,
        })),
        incrementReviewRound: vi.fn(),
        setGithubPr: vi.fn(),
        updateAutonomousFields: vi.fn(),
        setResolvedModel: vi.fn(),
        addTokenUsage: vi.fn(),
        setWorktree: vi.fn(),
      },
      plans: {
        getMaxVersion: vi.fn(() => 0),
        create: vi.fn((_tid: string, raw: string, structured: any, version: number) => ({
          id: 'plan-1',
          threadId: _tid,
          version,
          rawOutput: raw,
          structured,
          status: 'draft',
          createdAt: '',
        })),
        updateStatus: vi.fn(),
        getLatest: vi.fn(() => latestPlan),
        supersedeAll: vi.fn(),
      },
      reviews: {
        create: vi.fn(),
      },
      verifications: {
        create: vi.fn(),
      },
      githubIssues: {
        getByNumber: vi.fn(() => ({ id: 'issue-38' })),
        updatePipelineStatus: vi.fn(),
      },
      settings,
      providers,
      skills: {
        get: vi.fn(() => null),
        set: vi.fn(),
        delete: vi.fn(),
        markQuarantined: vi.fn(),
        listAll: vi.fn(() => []),
        listQuarantined: vi.fn(() => []),
      },
    } as unknown as PipelineDeps,
    emittedEvents,
    trigger,
  };
}

describe('pipeline github issue smoke', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs plan/review from a GitHub issue and stops at awaiting_approval', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('symbolic-ref')) return 'origin/main';
      if (cmd.includes('rev-parse')) return 'sha123';
      return '';
    });

    const mock = createSmokeDeps();
    const pipeline = createPipeline(mock.deps);
    const issue = {
      number: 38,
      title: 'Demo pipeline smoke test',
      body: 'Exercise the GitHub issue path end-to-end.',
      labels: [],
    };

    await pipeline.startFromGitHubIssue('t1', '/proj', issue, 'claude');

    expect(pipeline.getContext('t1')).toMatchObject({
      autonomous: true,
      githubIssueNumber: 38,
      githubIssueTitle: 'Demo pipeline smoke test',
    });

    await mock.trigger('output', 'proc-1', planBlock());
    await mock.trigger('exit', 'proc-1', 0);

    expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'reviewing');
    expect(mock.deps.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-38',
      'reviewing',
    );

    await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_APPROVE_JSON));
    await mock.trigger('exit', 'proc-2', 0);

    expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'awaiting_approval');
    expect(mock.deps.threads.updateStatus).not.toHaveBeenCalledWith('t1', 'executing');
    expect(mock.deps.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-38',
      'awaiting_approval',
    );
    expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(2);
  });
});
