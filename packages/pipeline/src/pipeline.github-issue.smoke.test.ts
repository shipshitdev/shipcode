/**
 * Smoke test: startFromGitHubIssue
 *
 * Drives the full plan → review cycle via the mock process manager,
 * using the same helpers and mock patterns as pipeline.test.ts.
 * Asserts the thread lands on awaiting_approval (manual-mode default).
 */
import type { AgentProvider, ProcessManager } from '@shipcode/agents';
import {
  createClaudeCliProvider,
  createCodexCliProvider,
  createProviderRegistry,
} from '@shipcode/agents';
import { DEFAULT_SETTINGS, type GitHubIssueCacheRecord } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPipeline } from './pipeline';
import type { PipelineDeps, PipelineEvent } from './types';

vi.mock('@shipcode/git', () => {
  class WorktreeManager {
    create = vi.fn().mockResolvedValue({ worktreePath: '/fake/worktree', branch: 'feat/42-smoke' });
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

// ─── Shared fixture data ────────────────────────────────────────────────────

const PLAN_JSON = JSON.stringify({
  id: 'p1',
  threadId: 't-smoke',
  version: 1,
  objective: 'Fix the bug',
  files: [{ path: 'src/index.ts', action: 'modify', description: 'fix it' }],
  steps: [{ order: 1, description: 'fix it', files: ['src/index.ts'], rationale: 'required' }],
  acceptanceCriteria: ['bug is fixed'],
  outOfScope: [],
  estimatedComplexity: 'low',
  dependencies: [],
});

const REVIEW_APPROVE_JSON = JSON.stringify({
  planId: 'p1',
  decision: 'approve',
  confidence: 'high',
  summary: 'Plan looks good',
  findings: [],
  suggestedChanges: [],
});

function planBlock(json: string = PLAN_JSON) {
  return `\`\`\`shipcode-plan\n${json}\n\`\`\``;
}

function reviewBlock(json: string) {
  return `\`\`\`shipcode-review\n${json}\n\`\`\``;
}

// ─── Mock deps factory ──────────────────────────────────────────────────────

function createSmokeDeps() {
  const emittedEvents: PipelineEvent[] = [];
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  let spawnCount = 0;

  const processManager = {
    spawn: vi.fn(() => ({ id: `proc-${++spawnCount}` })),
    kill: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const eventListeners = listeners[event] ?? [];
      eventListeners.push(handler);
      listeners[event] = eventListeners;
    }),
    removeListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
    }),
  } as unknown as ProcessManager;

  const trigger = async (event: string, ...args: unknown[]) => {
    const handlers = [...(listeners[event] ?? [])];
    for (const h of handlers) h(...args);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  };

  const latestPlan = {
    id: 'plan-1',
    threadId: 't-smoke',
    version: 1,
    rawOutput: '',
    structured: JSON.parse(PLAN_JSON),
    status: 'pending_review',
    createdAt: '',
  };

  const claudeProvider = createClaudeCliProvider(processManager);
  const codexProvider = createCodexCliProvider(processManager);
  const openrouterProvider: AgentProvider = {
    id: 'openrouter',
    supports: new Set(['plan', 'review', 'revision', 'verify']),
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

  const deps = {
    emitter: { emit: vi.fn((event: PipelineEvent) => emittedEvents.push(event)) },
    processManager,
    threads: {
      updateStatus: vi.fn(),
      getById: vi.fn(() => ({
        id: 't-smoke',
        projectId: 'project-1',
        githubIssueNumber: 42,
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
      create: vi.fn((_tid: string, raw: string, structured: unknown, v: number) => ({
        id: 'plan-1',
        threadId: _tid,
        version: v,
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
    diffs: {
      replaceForThread: vi.fn(),
    },
    verifications: {
      create: vi.fn(),
    },
    githubIssues: {
      getByNumber: vi.fn(
        (): GitHubIssueCacheRecord => ({
          id: 'issue-42',
          projectId: 'project-1',
          issueNumber: 42,
          title: 'Fix the bug',
          body: null,
          labels: [],
          assignee: null,
          state: 'open',
          pipelineStatus: 'todo',
          threadId: 't-smoke',
          claimedAt: null,
          claimedBy: null,
          lastPhaseUpdate: null,
          lastStatusLabel: null,
          plannerModelOverride: null,
          reviewerModelOverride: null,
          executorModelOverride: null,
          verifierModelOverride: null,
          plannerModelIdOverride: null,
          reviewerModelIdOverride: null,
          executorModelIdOverride: null,
          verifierModelIdOverride: null,
          plannerReasoningEffortOverride: null,
          reviewerReasoningEffortOverride: null,
          executorReasoningEffortOverride: null,
          verifierReasoningEffortOverride: null,
          linkedPrNumber: null,
          linkedPrUrl: null,
          linkedPrIsDraft: false,
          ciBlocked: false,
          failingChecks: [],
          unresolvedReviewComments: [],
          unresolvedReviewCommentCount: 0,
          prLastSyncAt: null,
          fetchedAt: '',
        }),
      ),
      updatePipelineStatus: vi.fn(),
      updatePullRequestFeedback: vi.fn(),
    },
    checkpoints: {
      getLatest: vi.fn(() => null),
      create: vi.fn(),
    },
    projects: {
      getById: vi.fn(() => ({
        id: 'project-1',
        plannerModelIdOverride: null,
        reviewerModelIdOverride: null,
        executorModelIdOverride: null,
        verifierModelIdOverride: null,
        plannerReasoningEffortOverride: null,
        reviewerReasoningEffortOverride: null,
        executorReasoningEffortOverride: null,
        verifierReasoningEffortOverride: null,
      })),
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
  } as unknown as PipelineDeps;

  return { deps, emittedEvents, trigger, latestPlan };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('startFromGitHubIssue — smoke', () => {
  let smoke: ReturnType<typeof createSmokeDeps>;

  beforeEach(() => {
    smoke = createSmokeDeps();
    mockExecSync.mockReset();
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('symbolic-ref')) return 'origin/main';
      if (cmd.includes('rev-parse')) return 'sha-fork-123';
      if (cmd.includes('git status')) return '';
      return '';
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('plan → review → awaiting_approval (manual mode)', async () => {
    const pipeline = createPipeline(smoke.deps);
    const issue = { number: 42, title: 'Fix the bug', body: 'It crashes on startup', labels: [] };

    await pipeline.startFromGitHubIssue('t-smoke', '/proj', issue, 'claude');

    // Plan phase should have started
    expect(smoke.deps.threads.updateStatus).toHaveBeenCalledWith('t-smoke', 'planning');
    expect(smoke.emittedEvents).toContainEqual(
      expect.objectContaining({ type: 'pipeline:phase', threadId: 't-smoke', phase: 'planning' }),
    );

    // Drive plan output and exit
    await smoke.trigger('output', 'proc-1', planBlock());
    await smoke.trigger('exit', 'proc-1', 0);

    // Plan was created and review started
    expect(smoke.deps.plans.create).toHaveBeenCalled();
    expect(smoke.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'pending_review');
    expect(smoke.deps.threads.updateStatus).toHaveBeenCalledWith('t-smoke', 'reviewing');

    // Drive review output and exit (approve, but manual mode → awaiting_approval)
    await smoke.trigger('output', 'proc-2', reviewBlock(REVIEW_APPROVE_JSON));
    await smoke.trigger('exit', 'proc-2', 0);

    expect(smoke.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'awaiting_approval');
    expect(smoke.deps.threads.updateStatus).toHaveBeenCalledWith('t-smoke', 'awaiting_approval');
  });

  it('syncs GitHub issue pipeline status through planning → reviewing → awaiting_approval', async () => {
    const pipeline = createPipeline(smoke.deps);
    const issue = { number: 42, title: 'Fix the bug', body: 'It crashes', labels: [] };

    await pipeline.startFromGitHubIssue('t-smoke', '/proj', issue, 'claude');

    expect(smoke.deps.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-42',
      'planning',
    );

    await smoke.trigger('output', 'proc-1', planBlock());
    await smoke.trigger('exit', 'proc-1', 0);

    expect(smoke.deps.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-42',
      'reviewing',
    );

    await smoke.trigger('output', 'proc-2', reviewBlock(REVIEW_APPROVE_JSON));
    await smoke.trigger('exit', 'proc-2', 0);

    expect(smoke.deps.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-42',
      'awaiting_approval',
    );
  });

  it('sets autonomous=true and seeds context fields from the issue', async () => {
    const pipeline = createPipeline(smoke.deps);
    const issue = { number: 42, title: 'Fix the bug', body: 'Details here', labels: [] };

    await pipeline.startFromGitHubIssue('t-smoke', '/proj', issue, 'codex');

    expect(smoke.deps.threads.updateAutonomousFields).toHaveBeenCalledWith(
      't-smoke',
      expect.objectContaining({
        autonomous: true,
        reviewRound: 0,
        executorModel: 'codex',
        baseBranch: 'main',
        forkPointSha: 'sha-fork-123',
      }),
    );

    const ctx = pipeline.getContext('t-smoke');
    expect(ctx).toBeDefined();
    expect(ctx?.autonomous).toBe(true);
    expect(ctx?.githubIssueNumber).toBe(42);
    expect(ctx?.githubIssueTitle).toBe('Fix the bug');
  });
});
