import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentProvider, ProcessManager } from '@shipcode/agents';
import {
  createClaudeCliProvider,
  createCodexCliProvider,
  createProviderRegistry,
} from '@shipcode/agents';
import {
  DEFAULT_SETTINGS,
  type GitHubIssueCacheRecord,
  type GitHubPrCheckSummary,
  type GitHubPrReviewCommentSummary,
  MAX_REVIEW_ROUNDS,
  MAX_VERIFICATION_RETRIES,
  PIPELINE_MAX_RETRIES,
  type PlanRecord,
  type Project,
  type Thread,
  type VerificationRecord,
} from '@shipcode/shared';
import type { TaskGraphWithNodes } from '@shipcode/shared/source';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPipeline } from './pipeline';
import type { PipelineContext, PipelineDeps, PipelineEvent } from './types';

vi.mock('@shipcode/git', () => {
  class WorktreeManager {
    create = vi.fn().mockResolvedValue({ worktreePath: '/fake/worktree', branch: 'feat/42-bug' });
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

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => true),
    },
  };
});

const PLAN_JSON = JSON.stringify({
  id: 'p1',
  threadId: 't1',
  version: 1,
  objective: 'Test',
  files: [{ path: 'a.ts', action: 'modify', description: 'd' }],
  steps: [{ order: 1, description: 'd', files: ['a.ts'], rationale: 'r' }],
  acceptanceCriteria: ['works'],
  outOfScope: [],
  estimatedComplexity: 'low',
  dependencies: [],
});

const REVIEW_APPROVE_JSON = JSON.stringify({
  planId: 'p1',
  decision: 'approve',
  confidence: 'high',
  summary: 'Good',
  findings: [],
  suggestedChanges: [],
});

const REVIEW_REQUEST_CHANGES_JSON = JSON.stringify({
  planId: 'p1',
  decision: 'request_changes',
  confidence: 'high',
  summary: 'Needs work',
  findings: [
    {
      id: 'f1',
      severity: 'minor',
      category: 'correctness',
      description: 'fix this',
      suggestion: 'do that',
    },
  ],
  suggestedChanges: ['change X'],
});

const REVIEW_REQUEST_CHANGES_CRITICAL_JSON = JSON.stringify({
  planId: 'p1',
  decision: 'request_changes',
  confidence: 'high',
  summary: 'Critical issues',
  findings: [
    { id: 'f1', severity: 'critical', category: 'security', description: 'security flaw' },
  ],
  suggestedChanges: ['fix security'],
});

const REVIEW_REJECT_JSON = JSON.stringify({
  planId: 'p1',
  decision: 'reject',
  confidence: 'high',
  summary: 'Bad',
  findings: [],
  suggestedChanges: [],
});

const VERIFICATION_PASSED_JSON = JSON.stringify({
  threadId: 't1',
  planId: 'p1',
  result: 'passed',
  summary: 'OK',
  criteriaResults: [{ criterion: 'works', passed: true, evidence: 'yes' }],
  issues: [],
});

const VERIFICATION_FAILED_JSON = JSON.stringify({
  threadId: 't1',
  planId: 'p1',
  result: 'failed',
  summary: 'Not OK',
  criteriaResults: [{ criterion: 'works', passed: false, evidence: 'no' }],
  issues: [{ severity: 'blocker', description: 'broke' }],
});

/** Flush the microtask queue so async handlers (await import) settle */
const flush = () => new Promise((r) => setTimeout(r, 10));
const tempDirs: string[] = [];

function clarificationRequest(id: string, questionId: string, title: string) {
  return {
    id,
    threadId: 't1',
    phase: 'plan' as const,
    summary: `Need ${title}`,
    questions: [
      {
        id: questionId,
        title,
        prompt: `Choose ${title}`,
        description: null,
        choices: [
          { id: 'a', label: `${title} A`, description: `Use ${title} A` },
          { id: 'b', label: `${title} B`, description: `Use ${title} B` },
        ],
        allowFreeform: true,
        freeformPlaceholder: null,
      },
    ],
  };
}

function makeTempProject() {
  const dir = path.join(
    os.tmpdir(),
    `shipcode-pipeline-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(path.join(dir, '.shipcode'), { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function planBlock(json: string = PLAN_JSON) {
  return `\`\`\`shipcode-plan\n${json}\n\`\`\``;
}

function reviewBlock(json: string) {
  return `\`\`\`shipcode-review\n${json}\n\`\`\``;
}

function verificationBlock(json: string) {
  return `\`\`\`shipcode-verification\n${json}\n\`\`\``;
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 't1',
    projectId: 'project-1',
    title: 'test',
    prompt: 'test',
    status: 'awaiting_approval',
    kind: 'pipeline' as const,
    worktreeBranch: null,
    worktreePath: null,
    plannerModel: 'claude',
    reviewerModel: 'codex',
    verifierModel: 'claude',
    executorModel: 'claude',
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
    createdAt: '',
    updatedAt: '',
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

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Issue',
    body: null,
    labels: [],
    assignee: null,
    state: 'open',
    pipelineStatus: 'todo',
    threadId: 't1',
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
    revisionCountOverride: null,
    requireApprovalOverride: null,
    linkedPrNumber: null,
    linkedPrUrl: null,
    linkedPrIsDraft: false,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: '',
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    ...overrides,
  };
}

function makePlanRecord(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 'plan-1',
    threadId: 't1',
    version: 1,
    rawOutput: '',
    structured: JSON.parse(PLAN_JSON),
    status: 'pending_review',
    createdAt: '',
    ...overrides,
  };
}

function makeVerificationRecord(overrides: Partial<VerificationRecord> = {}): VerificationRecord {
  return {
    id: 'verification-1',
    threadId: 't1',
    planId: 'plan-1',
    rawOutput: verificationBlock(VERIFICATION_FAILED_JSON),
    structured: JSON.parse(VERIFICATION_FAILED_JSON),
    result: 'failed',
    retryCount: 0,
    createdAt: '',
    ...overrides,
  };
}

function makeTaskGraph(): TaskGraphWithNodes {
  const base = {
    graphId: 'graph-1',
    suggestedExecutorModel: null,
    startedAt: null,
    completedAt: null,
    createdAt: '',
    updatedAt: '',
  };

  return {
    id: 'graph-1',
    threadId: 't1',
    planId: 'plan-1',
    mode: 'internal',
    status: 'active',
    riskScore: 0.52,
    assessment: {
      mode: 'internal',
      shouldDecompose: true,
      riskScore: 0.52,
      reasons: ['2 planned steps'],
      suggestedNodeCount: 2,
      surfaces: ['database', 'backend'],
    },
    createdAt: '',
    updatedAt: '',
    nodes: [
      {
        ...base,
        id: 'node-1',
        stableKey: 'step-1',
        order: 1,
        title: 'Create task graph tables',
        description: 'Add the database schema',
        status: 'ready',
        files: ['packages/db/src/schema.ts'],
        acceptanceCriteria: ['Schema exists'],
        surfaces: ['database'],
        agentRole: 'database',
        suggestedReasoningEffort: 'high',
        githubIssueNumber: null,
      },
      {
        ...base,
        id: 'node-2',
        stableKey: 'step-2',
        order: 2,
        title: 'Wire task graph pipeline',
        description: 'Use the graph during execution',
        status: 'pending',
        files: ['packages/pipeline/src/pipeline.ts'],
        acceptanceCriteria: ['Pipeline uses graph'],
        surfaces: ['backend'],
        agentRole: 'backend',
        suggestedReasoningEffort: 'medium',
        githubIssueNumber: null,
      },
    ],
    edges: [
      {
        id: 'edge-1',
        graphId: 'graph-1',
        sourceNodeId: 'node-1',
        targetNodeId: 'node-2',
        edgeType: 'depends_on',
        createdAt: '',
      },
    ],
  } satisfies TaskGraphWithNodes;
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Project',
    path: '/proj',
    gitRemote: 'https://github.com/acme/repo.git',
    githubRepoId: null,
    githubRepoFullName: null,
    starterIssueNumber: null,
    starterIssueCreatedAt: null,
    githubProjectUrl: null,
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
    revisionCountOverride: null,
    requireApprovalOverride: null,
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makeCheck(overrides: Partial<GitHubPrCheckSummary> = {}): GitHubPrCheckSummary {
  return {
    name: 'check',
    status: 'failed',
    conclusion: 'failure',
    detailsUrl: null,
    workflowName: null,
    ...overrides,
  };
}

function makeReviewComment(
  overrides: Partial<GitHubPrReviewCommentSummary> = {},
): GitHubPrReviewCommentSummary {
  return {
    author: null,
    body: 'Fix it',
    url: 'https://github.com/comment',
    createdAt: '',
    path: null,
    line: null,
    ...overrides,
  };
}

function requireContext(
  pipeline: ReturnType<typeof createPipeline>,
  threadId: string = 't1',
): PipelineContext {
  const context = pipeline.getContext(threadId);
  if (!context) {
    throw new Error(`Expected pipeline context for ${threadId}`);
  }
  return context;
}

function createMockDeps() {
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

  /**
   * Trigger a mock processManager event. Async because the real CLI
   * provider resolves its generate() Promise on the `exit` event via
   * a microtask hop — callers should `await` trigger to ensure the
   * phase completion logic runs before assertions.
   */
  const trigger = async (event: string, ...args: unknown[]) => {
    // Copy the array to avoid mutation during iteration when handlers remove themselves
    const handlers = [...(listeners[event] ?? [])];
    handlers.forEach((h) => {
      h(...args);
    });
    // Let provider.generate() promise + completion IIFE settle
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  };

  const latestPlan = {
    id: 'plan-1',
    threadId: 't1',
    version: 1,
    rawOutput: '',
    structured: JSON.parse(PLAN_JSON),
    status: 'pending_review',
    createdAt: '',
  };

  // Use real CLI providers wrapping the mock processManager so existing
  // trigger-based tests continue to drive phase completion via output/exit
  // events, unchanged. OpenRouter is mocked since Tier 1 tests don't
  // exercise the HTTP path here (that has its own test file).
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
    get: vi.fn(() => ({ ...DEFAULT_SETTINGS })),
    set: vi.fn(),
  };

  return {
    deps: {
      emitter: { emit: vi.fn((event: PipelineEvent) => emittedEvents.push(event)) },
      processManager,
      threads: {
        updateStatus: vi.fn(),
        recordFailure: vi.fn(),
        getById: vi.fn(() => ({
          id: 't1',
          projectId: 'project-1',
          githubIssueNumber: 42,
          status: 'planning',
        })),
        incrementReviewRound: vi.fn(),
        clearClarification: vi.fn(),
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
        getByPlanId: vi.fn(() => null),
      },
      diffs: {
        replaceForThread: vi.fn(),
      },
      verifications: {
        create: vi.fn(),
        getLatest: vi.fn(() => null),
      },
      githubIssues: {
        getByNumber: vi.fn(() => null),
        updatePipelineStatus: vi.fn(),
        updatePullRequestFeedback: vi.fn(),
      },
      checkpoints: {
        getLatest: vi.fn(() => null),
        create: vi.fn(),
      },
      projects: {
        getById: vi.fn(() => makeProject()),
      },
      settings,
      providers,
      skills: {
        // Always return null so the loader falls through to the bundled
        // default. Tests don't exercise per-row overrides — the skill-loader
        // package has its own dedicated test file for that.
        get: vi.fn(() => null),
        set: vi.fn(),
        delete: vi.fn(),
        markQuarantined: vi.fn(),
        listAll: vi.fn(() => []),
        listQuarantined: vi.fn(() => []),
      },
      taskGraphs: {
        replaceForPlan: vi.fn(),
        getByPlanId: vi.fn(() => null),
        getNextReadyNode: vi.fn(() => null),
        updateNodeStatus: vi.fn(),
        markNodeCompletedAndPromote: vi.fn(),
        markNodeFailed: vi.fn(),
        resetForRetry: vi.fn(),
        updateGraphStatus: vi.fn(),
        updateNodeGithubIssueNumber: vi.fn(),
      },
    } as unknown as PipelineDeps,
    emittedEvents,
    trigger,
    latestPlan,
  };
}

describe('createPipeline', () => {
  let mock: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    mock = createMockDeps();
    mockExecSync.mockReset();
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'feat/test-branch';
      if (cmd === 'git rev-parse HEAD') return 'abc123';
      if (cmd === 'git status --porcelain') return '';
      return '';
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ─── startPlanGeneration ───────────────────────────────────────────

  describe('startPlanGeneration', () => {
    it('emits planning on start', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'planning');
      expect(mock.emittedEvents).toContainEqual({
        type: 'pipeline:phase',
        threadId: 't1',
        phase: 'planning',
      });
    });

    it('initializeContext seeds state before pipeline start', async () => {
      const pipeline = createPipeline(mock.deps);

      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/proj/.shipcode/worktrees/t1',
        baseBranch: 'main',
      });

      expect(pipeline.getContext('t1')).toMatchObject({
        projectPath: '/proj',
        worktreePath: '/proj/.shipcode/worktrees/t1',
        baseBranch: 'main',
      });
    });

    it('syncs linked GitHub issue status when phases change', async () => {
      vi.mocked(mock.deps.githubIssues.getByNumber).mockReturnValue(makeIssue());

      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      await flush();

      expect(mock.deps.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
        'issue-1',
        'planning',
      );

      await mock.trigger('output', 'proc-1', planBlock());
      await mock.trigger('exit', 'proc-1', 0);

      expect(mock.deps.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
        'issue-1',
        'awaiting_approval',
      );
    });

    it('passes awaiting_approval through to the linked GitHub issue status', async () => {
      vi.mocked(mock.deps.githubIssues.getByNumber).mockReturnValue(makeIssue());

      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await mock.trigger('output', 'proc-1', 'some random output without a plan block');
      await mock.trigger('exit', 'proc-1', 0);
      await flush();

      expect(mock.deps.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-1', 'failed');
    });

    it('exit 0 + valid plan → creates plan, emits plan:parsed, then awaits approval by default', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      await flush();

      await mock.trigger('output', 'proc-1', planBlock());
      await mock.trigger('exit', 'proc-1', 0);

      expect(mock.deps.plans.create).toHaveBeenCalled();
      expect(mock.deps.taskGraphs?.replaceForPlan).toHaveBeenCalledWith(
        't1',
        'plan-1',
        expect.objectContaining({ id: 'p1' }),
      );
      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approved');
      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'awaiting_approval');
      expect(mock.emittedEvents).toContainEqual(
        expect.objectContaining({ type: 'plan:parsed', threadId: 't1' }),
      );
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'awaiting_approval');
    });

    it('exit 0 + valid plan + autonomous → calls startExecution (spawns claude) when revisions are off', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).autonomous = true;
      await flush();

      await mock.trigger('output', 'proc-1', planBlock());
      await mock.trigger('exit', 'proc-1', 0);

      // Default revisionCount is 0, so a parsed plan goes straight to execution.
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(2);
      const secondCall = vi.mocked(mock.deps.processManager.spawn).mock.calls[1];
      expect(secondCall[1]).toBe('claude');
    });

    it('exit 0 + no valid plan → creates plan with null, emits failed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await mock.trigger('output', 'proc-1', 'some random output without a plan block');
      await mock.trigger('exit', 'proc-1', 0);
      await flush();

      expect(mock.deps.plans.create).toHaveBeenCalledWith('t1', expect.any(String), null, 1);
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        'planning',
        'Plan output could not be parsed — No shipcode-plan fenced block found',
      );
    });

    it('exit 0 + no valid plan → never emits an executing phase', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).autonomous = true;
      await flush();

      await mock.trigger('output', 'proc-1', 'some random output without a plan block');
      await mock.trigger('exit', 'proc-1', 0);
      await flush();

      const executingEvents = mock.emittedEvents.filter(
        (e: PipelineEvent) =>
          e.type === 'pipeline:phase' && e.threadId === 't1' && e.phase === 'executing',
      );
      expect(executingEvents).toHaveLength(0);
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(1);
    });

    it('exit 0 + no valid plan does not classify incidental ENOENT as the failure', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await mock.trigger(
        'output',
        'proc-1',
        'source excerpt: throw new Error("ENOENT") without a plan block',
      );
      await mock.trigger('exit', 'proc-1', 0);
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        'planning',
        'Plan output could not be parsed — No shipcode-plan fenced block found',
      );
    });

    it('carries prior clarification answers into the next planning prompt', async () => {
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        clarificationRound: 2,
        clarificationHistory: [
          {
            request: clarificationRequest('clarify-1', 'brand', 'Brand'),
            answers: [{ questionId: 'brand', selectedChoiceId: 'a', freeformText: 'Genfeed' }],
          },
          {
            request: clarificationRequest('clarify-2', 'balance', 'Balance'),
            answers: [
              {
                questionId: 'balance',
                selectedChoiceId: 'b',
                freeformText: 'Connected providers only',
              },
            ],
          },
        ],
      });

      await pipeline.startPlanGeneration('t1', 'add the topbar pill', '/proj', null);

      const args = vi.mocked(mock.deps.processManager.spawn).mock.calls[0][2] as string[];
      const prompt = args[1];
      expect(prompt).toContain('The user has already answered planner clarification');
      expect(prompt).toContain('Clarification round 1');
      expect(prompt).toContain('Extra note: Genfeed');
      expect(prompt).toContain('Clarification round 2');
      expect(prompt).toContain('Extra note: Connected providers only');
      expect(prompt).toContain('Produce a concrete plan now');
    });

    it('exit non-zero → retries (spawns again)', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await mock.trigger('exit', 'proc-1', 1);

      // Should have spawned a second process (retry)
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(2);
    });

    it('exit non-zero 4 times → emits failed (PIPELINE_MAX_RETRIES=3)', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      // First attempt + 3 retries = 4 total failures
      for (let i = 1; i <= PIPELINE_MAX_RETRIES + 1; i++) {
        await mock.trigger('exit', `proc-${i}`, 1);
      }

      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(PIPELINE_MAX_RETRIES + 1);
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
    });

    it('C1 regression: retry counter persists across recursive calls', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      // First failure: retryCount becomes 1
      await mock.trigger('exit', 'proc-1', 1);
      expect(pipeline.getContext('t1')?.retryCount).toBe(1);

      // Second failure: retryCount becomes 2
      await mock.trigger('exit', 'proc-2', 1);
      expect(pipeline.getContext('t1')?.retryCount).toBe(2);

      // Third failure: retryCount becomes 3
      await mock.trigger('exit', 'proc-3', 1);
      expect(pipeline.getContext('t1')?.retryCount).toBe(3);

      // Fourth failure: exhausted → should emit failed
      await mock.trigger('exit', 'proc-4', 1);
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
    });
  });

  // ─── startReview ───────────────────────────────────────────────────

  describe('startReview', () => {
    it('no context → no-op', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));

      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
    });

    it('autonomous spawns codex with -c model_reasoning_effort=<default>', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).autonomous = true;

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));

      // proc-1 from startPlanGeneration, proc-2 from startReview
      const reviewCall = vi.mocked(mock.deps.processManager.spawn).mock.calls[1];
      expect(reviewCall[1]).toBe('codex');
      // codex v0.120.0: -c <key>=<value> before `exec`, not --reasoning-effort after.
      // The default is 'low' (cost-conscious); read from DEFAULT_SETTINGS so this test
      // tracks the default automatically if it changes.
      expect(reviewCall[2]).toContain('-c');
      expect(reviewCall[2]).toContain(
        `model_reasoning_effort=${DEFAULT_SETTINGS.reviewerReasoningEffort}`,
      );
    });

    it('approve + autonomous → calls startExecution (emits executing)', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).autonomous = true;

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));

      // proc-2 is the review process
      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_APPROVE_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approved');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing');
    });

    it('approve + manual → emits awaiting_approval', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));

      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_APPROVE_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'awaiting_approval');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'awaiting_approval');
    });

    it('request_changes + autonomous + round < MAX_REVIEW_ROUNDS → emits revising', async () => {
      vi.mocked(mock.deps.settings.get).mockReturnValue({
        ...DEFAULT_SETTINGS,
        revisionCount: 1,
      });
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.autonomous = true;
      context.reviewRound = 0;

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));
      await flush();

      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_REQUEST_CHANGES_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'rejected');
      expect(mock.deps.threads.incrementReviewRound).toHaveBeenCalledWith('t1');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'revising');
    });

    it('request_changes + autonomous + round >= MAX_REVIEW_ROUNDS + no critical → starts execution', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.autonomous = true;
      context.reviewRound = MAX_REVIEW_ROUNDS;

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));

      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_REQUEST_CHANGES_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing');
    });

    it('request_changes + autonomous + round >= MAX_REVIEW_ROUNDS + has critical → awaiting_approval', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.autonomous = true;
      context.reviewRound = MAX_REVIEW_ROUNDS;

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));

      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_REQUEST_CHANGES_CRITICAL_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'awaiting_approval');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'awaiting_approval');
    });

    it('reject → emits failed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));

      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_REJECT_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'rejected');
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('parse failure → emits failed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));

      await mock.trigger('output', 'proc-2', 'some garbage that is not a review block');
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
    });

    it('approve + non-autonomous + !requireApproval → awaiting_approval (no auto-execute)', async () => {
      // context.autonomous defaults to false; requireApproval defaults to false
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      // do NOT set context.autonomous = true

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));
      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_APPROVE_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'awaiting_approval');
    });

    it('request_changes + requireApproval + rounds exhausted + has critical → awaiting_approval', async () => {
      vi.mocked(mock.deps.settings.get).mockReturnValue({
        ...DEFAULT_SETTINGS,
        requireApproval: true,
      });
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.autonomous = true;
      context.reviewRound = MAX_REVIEW_ROUNDS;

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));
      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_REQUEST_CHANGES_CRITICAL_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'awaiting_approval');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'awaiting_approval');
    });

    it('approve + autonomous + project approval override → awaiting_approval', async () => {
      vi.mocked(mock.deps.projects.getById).mockReturnValue(
        makeProject({ requireApprovalOverride: true }),
      );
      vi.mocked(mock.deps.githubIssues.getByNumber).mockReturnValue(makeIssue());

      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).autonomous = true;

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));
      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_APPROVE_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'awaiting_approval');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'awaiting_approval');
    });

    it('request_changes + non-autonomous + rounds exhausted + has critical → awaiting_approval', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      // autonomous stays false (default)
      requireContext(pipeline).reviewRound = MAX_REVIEW_ROUNDS;

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));
      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_REQUEST_CHANGES_CRITICAL_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'awaiting_approval');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'awaiting_approval');
    });
  });

  // ─── startRevision ─────────────────────────────────────────────────

  describe('startRevision', () => {
    it('no context → no-op', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startRevision('t1', JSON.parse(PLAN_JSON), 'feedback');

      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
    });

    it('parse success → supersedesAll, creates plan version+1, starts review', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startRevision('t1', JSON.parse(PLAN_JSON), 'feedback');

      // proc-2 is the revision process
      await mock.trigger('output', 'proc-2', planBlock());
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.supersedeAll).toHaveBeenCalledWith('t1');
      expect(mock.deps.plans.create).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(Object),
        2,
      );
      // Starts review → spawns proc-3
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(3);
    });

    it('parse failure → emits failed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startRevision('t1', JSON.parse(PLAN_JSON), 'feedback');

      await mock.trigger('output', 'proc-2', 'garbage output');
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });
  });

  // ─── startExecution ────────────────────────────────────────────────

  describe('startExecution', () => {
    it('no context → no-op', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));

      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
    });

    it('exit 0 + autonomous → starts verification (emits verifying)', async () => {
      // Need to set up execSync for verification phase
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return 'some diff output';
        if (cmd.startsWith('git status')) return '';
        return '';
      });

      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.autonomous = true;
      context.forkPointSha = 'abc123';

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));

      // proc-2 is execution
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'verifying');
    });

    it('exit 0 + manual → emits completed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));

      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'completed');
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('exit non-zero → emits failed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));

      await mock.trigger('exit', 'proc-2', 1);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('rehydrateContext restores lost context so startExecution proceeds', async () => {
      const threadId = 't-rehydrate';

      // Override getById to return a full thread matching the rehydrate target
      vi.mocked(mock.deps.threads.getById).mockImplementation((id: string) => {
        if (id === threadId) {
          return makeThread({
            id: threadId,
            projectId: 'p1',
            githubIssueNumber: 16,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        return makeThread({ id });
      });

      const pipeline = createPipeline(mock.deps);

      // No prior startPlanGeneration -- simulates app restart (no activePipelines entry)
      pipeline.rehydrateContext(threadId, '/tmp/test-project', 'Demo issue');

      // startExecution should now proceed (not silently return)
      await pipeline.startExecution(threadId, JSON.parse(PLAN_JSON));

      expect(mock.emittedEvents).toContainEqual(
        expect.objectContaining({ type: 'pipeline:phase', threadId, phase: 'executing' }),
      );
    });

    it('copies declared env files into the worktree before execute starts', async () => {
      const projectDir = makeTempProject();
      const worktreeDir = path.join(projectDir, 'worktree');
      mkdirSync(worktreeDir, { recursive: true });
      writeFileSync(
        path.join(projectDir, '.shipcode', 'setup.json'),
        JSON.stringify({
          envFiles: [{ source: '.env.local' }],
          setupCommands: ['printf setup > .setup-ran'],
        }),
      );
      writeFileSync(path.join(projectDir, '.env.local'), 'TOKEN=abc\n');

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: projectDir,
        worktreePath: worktreeDir,
        baseBranch: 'main',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(readFileSync(path.join(worktreeDir, '.env.local'), 'utf-8')).toBe('TOKEN=abc\n');
      expect(readFileSync(path.join(worktreeDir, '.setup-ran'), 'utf-8')).toBe('setup');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing');
    });

    it('runs setup commands with the hydrated login-shell PATH', async () => {
      const projectDir = makeTempProject();
      const worktreeDir = path.join(projectDir, 'worktree');
      const binDir = path.join(projectDir, 'bin');
      mkdirSync(worktreeDir, { recursive: true });
      mkdirSync(binDir, { recursive: true });
      writeFileSync(
        path.join(binDir, 'shipcode-setup-probe'),
        '#!/bin/sh\nprintf hydrated > .setup-ran\n',
      );
      chmodSync(path.join(binDir, 'shipcode-setup-probe'), 0o755);
      writeFileSync(
        path.join(projectDir, '.shipcode', 'setup.json'),
        JSON.stringify({
          setupCommands: ['shipcode-setup-probe'],
        }),
      );

      const previousPath = process.env.PATH;
      const previousShell = process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      process.env.SHELL = '/bin/zsh';
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === '/bin/zsh -ilc printf "%s" "$PATH"') return `${binDir}:/usr/bin:/bin`;
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'feat/test-branch';
        if (cmd === 'git rev-parse HEAD') return 'abc123';
        if (cmd === 'git status --porcelain') return '';
        return '';
      });

      try {
        const pipeline = createPipeline(mock.deps);
        pipeline.initializeContext('t1', {
          projectPath: projectDir,
          worktreePath: worktreeDir,
          baseBranch: 'main',
        });

        await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
        await flush();
      } finally {
        process.env.PATH = previousPath;
        process.env.SHELL = previousShell;
      }

      expect(readFileSync(path.join(worktreeDir, '.setup-ran'), 'utf-8')).toBe('hydrated');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing');
    });

    it('fails fast when a required env file declared by the repo contract is missing', async () => {
      const projectDir = makeTempProject();
      const worktreeDir = path.join(projectDir, 'worktree');
      mkdirSync(worktreeDir, { recursive: true });
      writeFileSync(
        path.join(projectDir, '.shipcode', 'setup.json'),
        JSON.stringify({
          envFiles: [{ source: '.env.local', required: true }],
        }),
      );

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: projectDir,
        worktreePath: worktreeDir,
        baseBranch: 'main',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('Setup failed: required env file missing: .env.local'),
      );
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
    });

    it('uses executor model override as modelHint and keeps the provider selection on the executor provider', async () => {
      const openrouterGenerate = vi.fn(async () => ({
        rawOutput: 'done',
        exitCode: 0,
        resolvedModel: 'anthropic/claude-sonnet-4-6',
      }));
      const openrouterProvider: AgentProvider = {
        id: 'openrouter',
        supports: new Set(['plan', 'review', 'revision', 'verify', 'execute']),
        generate: openrouterGenerate,
        healthCheck: vi.fn(async () => ({ ok: true })),
      };
      const registry = createProviderRegistry({
        claude: mock.deps.providers.for('claude', 'plan'),
        codex: mock.deps.providers.for('codex', 'review'),
        openrouter: openrouterProvider,
      });
      const deps = { ...mock.deps, providers: registry };
      const pipeline = createPipeline(deps);

      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        executorModel: 'openrouter',
        executorModelOverride: 'openrouter/auto',
        executorReasoningEffort: 'low',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(openrouterGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'execute',
          cwd: '/worktree',
          modelHint: 'openrouter/auto',
          phaseHints: expect.objectContaining({ reasoningEffort: 'low' }),
        }),
      );
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'completed');
    });

    it('feeds structured verification failures back into the next execution prompt', async () => {
      const projectDir = makeTempProject();
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: projectDir,
        worktreePath: projectDir,
        baseBranch: 'main',
      });
      vi.mocked(mock.deps.verifications.getLatest).mockReturnValue(makeVerificationRecord());

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));

      const executeCall = vi.mocked(mock.deps.processManager.spawn).mock.calls[0];
      expect(executeCall[2][1]).toContain('<previous_verification_failure>');
      expect(executeCall[2][1]).toContain('Summary: Not OK');
      expect(executeCall[2][1]).toContain('[blocker] broke');
    });

    it('keeps successful test output in the verification prompt after autonomous execution', async () => {
      const projectDir = makeTempProject();
      vi.mocked(mock.deps.settings.get).mockReturnValue({
        ...DEFAULT_SETTINGS,
        testCommand: `printf 'typecheck ok\\ntests ok\\n'`,
      });
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        if (cmd.startsWith('git rev-parse')) return 'headsha123';
        return '';
      });

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: projectDir,
        worktreePath: projectDir,
        autonomous: true,
        baseBranch: 'main',
        forkPointSha: 'abc123',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await mock.trigger('exit', 'proc-1', 0);
      const spawnMock = vi.mocked(mock.deps.processManager.spawn);
      for (let i = 0; i < 100 && spawnMock.mock.calls.length < 2; i++) {
        await flush();
      }

      expect(spawnMock).toHaveBeenCalledTimes(2);
      const verifyCall = spawnMock.mock.calls[1];
      expect(verifyCall[2][1]).toContain('<test_results>');
      expect(verifyCall[2][1]).toContain('typecheck ok');
      expect(verifyCall[2][1]).toContain('tests ok');
    });
  });

  // ─── startVerification ─────────────────────────────────────────────

  describe('startVerification', () => {
    it('no context → no-op', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startVerification('t1');

      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
    });

    it('no structured plan → emits failed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      vi.mocked(mock.deps.plans.getLatest).mockReturnValue(makePlanRecord({ structured: null }));

      await pipeline.startVerification('t1');

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('no diff → creates verification, emits failed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).forkPointSha = 'abc123';

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return '';
        return '';
      });

      await pipeline.startVerification('t1');

      expect(mock.deps.verifications.create).toHaveBeenCalledWith(
        't1',
        'plan-1',
        'No changes detected',
        null,
      );
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
      expect(mock.deps.diffs.replaceForThread).toHaveBeenCalledWith('t1', []);
    });

    it('persists parsed per-file diffs before running verification', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).forkPointSha = 'abc123';

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) {
          return [
            'diff --git a/src/foo.ts b/src/foo.ts',
            'index 1111111..2222222 100644',
            '--- a/src/foo.ts',
            '+++ b/src/foo.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
            'diff --git a/src/new.ts b/src/new.ts',
            'new file mode 100644',
            'index 0000000..3333333',
            '--- /dev/null',
            '+++ b/src/new.ts',
            '@@ -0,0 +1 @@',
            '+hello',
          ].join('\n');
        }
        if (cmd.startsWith('git status')) return '';
        if (cmd.startsWith('git rev-parse')) return 'headsha123';
        return '';
      });

      await pipeline.startVerification('t1');

      expect(mock.deps.diffs.replaceForThread).toHaveBeenCalledWith('t1', [
        {
          filePath: 'src/foo.ts',
          action: 'modify',
          diffContent: expect.stringContaining('diff --git a/src/foo.ts b/src/foo.ts'),
          beforeHash: '1111111',
          afterHash: '2222222',
        },
        {
          filePath: 'src/new.ts',
          action: 'create',
          diffContent: expect.stringContaining('diff --git a/src/new.ts b/src/new.ts'),
          beforeHash: '0000000',
          afterHash: '3333333',
        },
      ]);
    });

    it('dirty worktree is auto-committed before verification, then retries on verifier failure', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.verificationRetries = 0;

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return 'M dirty.ts';
        if (cmd.startsWith('git rev-parse')) return 'headsha123';
        return '';
      });

      await pipeline.startVerification('t1');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('git add -A'),
        expect.any(Object),
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('git commit --no-verify'),
        expect.any(Object),
      );

      await mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_FAILED_JSON));
      await mock.trigger('exit', 'proc-2', 0);
      await flush();

      expect(mock.deps.verifications.create).toHaveBeenCalled();
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing');
      expect(pipeline.getContext('t1')?.verificationRetries).toBe(1);
    });

    it('dirty worktree is auto-committed before verification, then fails when retries are exhausted', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.verificationRetries = MAX_VERIFICATION_RETRIES;

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return 'M dirty.ts';
        if (cmd.startsWith('git rev-parse')) return 'headsha123';
        return '';
      });

      await pipeline.startVerification('t1');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('git add -A'),
        expect.any(Object),
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('git commit --no-verify'),
        expect.any(Object),
      );

      await mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_FAILED_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.verifications.create).toHaveBeenCalled();
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('verification passed → calls startCommitAndPush', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).forkPointSha = 'abc123';

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        if (cmd.startsWith('git log')) return 'abc123 commit';
        if (cmd.startsWith('git rev-parse')) return 'feat/branch';
        if (cmd.startsWith('git push')) return '';
        return '';
      });

      await pipeline.startVerification('t1');

      // proc-2 is verification process
      await mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_PASSED_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      // startCommitAndPush is async — wait for it to settle
      await flush();

      expect(mock.emittedEvents).toContainEqual(
        expect.objectContaining({ type: 'verification:parsed', threadId: 't1' }),
      );
      // startCommitAndPush was called — it uses execSync for git push
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('git push'),
        expect.any(Object),
      );
    });

    it('verification failed + retries left → starts execution', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.verificationRetries = 0;

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        return '';
      });

      await pipeline.startVerification('t1');

      await mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_FAILED_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      // startExecution is async — wait for it to settle
      await flush();

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing');
      expect(pipeline.getContext('t1')?.verificationRetries).toBe(1);
    });

    it('verification failed + no retries → emits failed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.verificationRetries = MAX_VERIFICATION_RETRIES;

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        return '';
      });

      await pipeline.startVerification('t1');

      await mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_FAILED_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();

      // When retries are exhausted, the pipeline MUST emit
      // 'pipeline:verification-exhausted' so the desktop bridge can
      // distinguish this failure from a generic 'failed' and fire
      // the dedicated notification kind. Regression test for a
      // coverage gap CodeRabbit flagged on the original Tier 1 PR.
      expect(mock.emittedEvents).toContainEqual(
        expect.objectContaining({
          type: 'pipeline:verification-exhausted',
          threadId: 't1',
        }),
      );
    });
  });

  // ─── startCommitAndPush ────────────────────────────────────────────

  describe('startCommitAndPush', () => {
    it('no context → no-op', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startCommitAndPush('t1');

      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('dirty worktree → emits failed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git status')) return 'M dirty.ts';
        return '';
      });

      await pipeline.startCommitAndPush('t1');

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('no commits ahead → emits failed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).forkPointSha = 'abc123';

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git status')) return '';
        if (cmd.startsWith('git log')) return '';
        return '';
      });

      await pipeline.startCommitAndPush('t1');

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('push succeeds → calls startShipping', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).forkPointSha = 'abc123';

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git status')) return '';
        if (cmd.startsWith('git log')) return 'abc123 some commit';
        if (cmd.startsWith('git rev-parse')) return 'feat/branch';
        if (cmd.startsWith('git push')) return '';
        return '';
      });

      await pipeline.startCommitAndPush('t1');

      // startShipping emits 'shipping' then 'completed' (no github issue)
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'shipping');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'completed');
    });

    it('push fails twice → emits failed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).forkPointSha = 'abc123';

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git status')) return '';
        if (cmd.startsWith('git log')) return 'abc123 some commit';
        if (cmd.startsWith('git rev-parse')) return 'feat/branch';
        if (cmd.startsWith('git push')) {
          throw new Error('push failed');
        }
        return '';
      });

      await pipeline.startCommitAndPush('t1');

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });
  });

  // ─── startShipping ─────────────────────────────────────────────────

  describe('startShipping', () => {
    it('no context → no-op', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startShipping('t1');

      expect(mock.deps.threads.updateStatus).not.toHaveBeenCalledWith('t1', 'shipping');
    });

    it('no GitHub issue → emits completed directly', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startShipping('t1');

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'shipping');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'completed');
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('creates a draft PR when none exists and stores the relation', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.githubIssueNumber = 42;
      context.projectId = 'project-1';
      // baseBranch is a hard prerequisite for PR creation (invariant
      // added alongside the per-project base-branch selector).
      context.baseBranch = 'main';
      vi.mocked(mock.deps.githubIssues.getByNumber).mockReturnValue(makeIssue());

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse')) return 'feat/branch';
        if (cmd.startsWith('gh pr list')) return '[]';
        if (cmd.startsWith('gh pr create')) return 'https://github.com/org/repo/pull/99\n';
        if (cmd.startsWith('gh issue comment')) return '';
        return '';
      });

      await pipeline.startShipping('t1');

      expect(mock.deps.threads.setGithubPr).toHaveBeenCalledWith('t1', 99);
      expect(mock.deps.githubIssues.updatePullRequestFeedback).toHaveBeenCalledWith('issue-1', {
        linkedPrNumber: 99,
        linkedPrUrl: 'https://github.com/org/repo/pull/99',
        linkedPrIsDraft: true,
        ciBlocked: false,
        failingChecks: [],
        unresolvedReviewComments: [],
      });
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'completed');
    });

    it('updates an existing PR instead of creating a duplicate', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.githubIssueNumber = 42;
      context.projectId = 'project-1';
      context.baseBranch = 'main';
      vi.mocked(mock.deps.githubIssues.getByNumber).mockReturnValue(
        makeIssue({
          ciBlocked: true,
          failingChecks: [makeCheck()],
          unresolvedReviewComments: [makeReviewComment()],
        }),
      );

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse')) return 'feat/branch';
        if (cmd.startsWith('gh pr list'))
          return JSON.stringify([
            { number: 88, url: 'https://github.com/org/repo/pull/88', isDraft: false },
          ]);
        if (cmd.startsWith('gh pr edit')) return '';
        return '';
      });

      await pipeline.startShipping('t1');

      expect(mock.deps.threads.setGithubPr).toHaveBeenCalledWith('t1', 88);
      expect(mock.deps.githubIssues.updatePullRequestFeedback).toHaveBeenCalledWith('issue-1', {
        linkedPrNumber: 88,
        linkedPrUrl: 'https://github.com/org/repo/pull/88',
        linkedPrIsDraft: false,
        ciBlocked: true,
        failingChecks: [makeCheck()],
        unresolvedReviewComments: [makeReviewComment()],
      });
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'completed');
    });

    it('PR creation fails → emits failed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).githubIssueNumber = 42;

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse')) throw new Error('git failed');
        return '';
      });

      await pipeline.startShipping('t1');

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
    });
  });

  // ─── startFromGitHubIssue ──────────────────────────────────────────

  describe('startFromGitHubIssue', () => {
    it('calls updateAutonomousFields', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('symbolic-ref')) return 'origin/main';
        if (cmd.includes('rev-parse')) return 'sha123';
        return '';
      });

      const pipeline = createPipeline(mock.deps);
      const issue = { number: 7, title: 'Bug', body: 'Fix it', labels: [] };

      await pipeline.startFromGitHubIssue('t1', '/proj', issue, 'claude');

      expect(mock.deps.threads.updateAutonomousFields).toHaveBeenCalledWith('t1', {
        autonomous: true,
        reviewRound: 0,
        executorModel: 'claude',
        baseBranch: 'main',
        forkPointSha: 'sha123',
      });
    });

    it('C2 regression: startFromGitHubIssue seeds autonomous=true and issue metadata', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('symbolic-ref')) return 'origin/develop';
        if (cmd.includes('rev-parse')) return 'forksha';
        return '';
      });

      const pipeline = createPipeline(mock.deps);
      const issue = { number: 7, title: 'Bug', body: 'Fix it', labels: [] };

      await pipeline.startFromGitHubIssue('t1', '/proj', issue, 'codex');

      const ctx = pipeline.getContext('t1');
      expect(ctx).toBeDefined();
      expect(ctx?.autonomous).toBe(true);
      expect(ctx?.githubIssueNumber).toBe(7);
      expect(ctx?.githubIssueTitle).toBe('Bug');
      expect(ctx?.baseBranch).toBe('develop');
      expect(ctx?.forkPointSha).toBe('forksha');
      expect(ctx?.executorModel).toBe('codex');
    });

    it('defaults baseBranch to main on failure', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('symbolic-ref')) throw new Error('no remote HEAD');
        if (cmd.includes('rev-parse')) return 'sha456';
        return '';
      });

      const pipeline = createPipeline(mock.deps);
      const issue = { number: 1, title: 'Test', body: null, labels: [] };

      await pipeline.startFromGitHubIssue('t1', '/proj', issue, 'claude');

      expect(mock.deps.threads.updateAutonomousFields).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({
          baseBranch: 'main',
        }),
      );
    });

    it('stores phase-specific provider, model-id, and reasoning selections in context', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('symbolic-ref')) return 'origin/main';
        if (cmd.includes('rev-parse')) return 'sha789';
        return '';
      });

      const pipeline = createPipeline(mock.deps);
      const issue = { number: 11, title: 'Phase routing', body: 'Check phase config', labels: [] };

      await pipeline.startFromGitHubIssue('t1', '/proj', issue, 'openrouter', {
        baseBranch: 'develop',
        plannerModel: 'claude',
        reviewerModel: 'codex',
        verifierModel: 'openrouter',
        plannerModelIdOverride: 'claude-opus-4-6',
        reviewerModelIdOverride: 'gpt-5.4-mini',
        executorModelIdOverride: 'openrouter/auto',
        verifierModelIdOverride: 'anthropic/claude-sonnet-4-6',
        plannerReasoningEffort: 'high',
        reviewerReasoningEffort: 'medium',
        executorReasoningEffort: 'low',
        verifierReasoningEffort: 'high',
      });

      const ctx = requireContext(pipeline);
      expect(ctx.plannerModel).toBe('claude');
      expect(ctx.reviewerModel).toBe('codex');
      expect(ctx.executorModel).toBe('openrouter');
      expect(ctx.verifierModel).toBe('openrouter');
      expect(ctx.plannerModelIdOverride).toBe('claude-opus-4-6');
      expect(ctx.reviewerModelIdOverride).toBe('gpt-5.4-mini');
      expect(ctx.executorModelIdOverride).toBe('openrouter/auto');
      expect(ctx.verifierModelIdOverride).toBe('anthropic/claude-sonnet-4-6');
      expect(ctx.plannerReasoningEffort).toBe('high');
      expect(ctx.reviewerReasoningEffort).toBe('medium');
      expect(ctx.executorReasoningEffort).toBe('low');
      expect(ctx.verifierReasoningEffort).toBe('high');
      expect(ctx.baseBranch).toBe('develop');
    });

    it('uses issue approval override ahead of the project default in start-context events', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('symbolic-ref')) return 'origin/main';
        if (cmd.includes('rev-parse')) return 'sha789';
        return '';
      });
      vi.mocked(mock.deps.projects.getById).mockReturnValue(
        makeProject({ requireApprovalOverride: true }),
      );
      vi.mocked(mock.deps.githubIssues.getByNumber).mockReturnValue(
        makeIssue({ requireApprovalOverride: false }),
      );

      const pipeline = createPipeline(mock.deps);
      const issue = {
        number: 11,
        title: 'Approval precedence',
        body: 'Check overrides',
        labels: [],
      };

      await pipeline.startFromGitHubIssue('t1', '/proj', issue, 'claude');

      expect(mock.emittedEvents).toContainEqual({
        type: 'pipeline:start-context',
        threadId: 't1',
        source: 'github:start-issue',
        projectPath: '/proj',
        githubIssueNumber: 11,
        autonomous: true,
        requireApproval: false,
        reviewRound: 0,
      });
    });

    it('uses the reused worktree as planner cwd when restarting the same issue', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('symbolic-ref')) return 'origin/main';
        if (cmd.includes('rev-parse')) return 'sha789';
        return '';
      });

      const openrouterGenerate = vi.fn(async () => ({
        rawOutput: planBlock(),
        exitCode: 0,
        resolvedModel: 'openrouter/auto',
      }));
      const openrouterProvider: AgentProvider = {
        id: 'openrouter',
        supports: new Set(['plan', 'review', 'revision', 'verify', 'execute']),
        generate: openrouterGenerate,
        healthCheck: vi.fn(async () => ({ ok: true })),
      };
      const registry = createProviderRegistry({
        claude: mock.deps.providers.for('claude', 'plan'),
        codex: mock.deps.providers.for('codex', 'review'),
        openrouter: openrouterProvider,
      });
      const deps = { ...mock.deps, providers: registry };
      const pipeline = createPipeline(deps);
      const issue = { number: 11, title: 'Resume issue', body: 'Continue', labels: [] };

      await pipeline.startFromGitHubIssue('t1', '/proj', issue, 'claude', {
        plannerModel: 'openrouter',
        worktreePath: '/worktree',
      });
      await flush();

      expect(openrouterGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'plan',
          cwd: '/worktree',
        }),
      );
      expect(pipeline.getContext('t1')?.worktreePath).toBe('/worktree');
    });
  });

  // ─── startFromAutomation ───────────────────────────────────────────

  describe('startFromQuickTask', () => {
    it('synthesizes an approved plan and emits quick-task:start start-context', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('symbolic-ref')) return 'origin/main';
        if (cmd.includes('rev-parse')) return 'sha789';
        return '';
      });
      const pipeline = createPipeline(mock.deps);

      await pipeline.startFromQuickTask(
        't1',
        '/proj',
        {
          issueNumber: -1,
          title: 'Tighten quick flow',
          text: 'Make quick task telemetry explicit.',
        },
        'claude',
      );

      expect(mock.deps.emitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pipeline:start-context',
          threadId: 't1',
          source: 'quick-task:start',
          projectPath: '/proj',
          githubIssueNumber: null,
          autonomous: true,
        }),
      );

      expect(mock.deps.plans.create).toHaveBeenCalledWith(
        't1',
        '<quick-task-synthesized>',
        expect.objectContaining({
          objective: 'Quick: Tighten quick flow',
          steps: [
            expect.objectContaining({
              order: 1,
              description: 'Quick task: Tighten quick flow\n\nMake quick task telemetry explicit.',
            }),
          ],
        }),
        1,
      );
      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approved');
    });
  });

  describe('startFromAutomation', () => {
    it('synthesizes an approved plan and emits automation:tick start-context', async () => {
      const pipeline = createPipeline(mock.deps);

      await pipeline.startFromAutomation('t1', 'List 3 files', '/proj', 'Smoke');

      expect(mock.deps.emitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pipeline:start-context',
          threadId: 't1',
          source: 'automation:tick',
          projectPath: '/proj',
          autonomous: true,
          requireApproval: false,
        }),
      );

      expect(mock.deps.plans.create).toHaveBeenCalledWith(
        't1',
        '<automation-synthesized>',
        expect.objectContaining({
          objective: 'Automation: Smoke',
          steps: [
            expect.objectContaining({
              order: 1,
              description: 'List 3 files',
            }),
          ],
          acceptanceCriteria: expect.arrayContaining([expect.any(String)]),
        }),
        1,
      );

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approved');
    });

    it('passes the synthesized plan to executor (skipping plan/review)', async () => {
      const pipeline = createPipeline(mock.deps);

      await pipeline.startFromAutomation('t1', 'Run smoke', '/proj', 'Daily');

      // The executor was invoked with a structured plan payload that matches
      // the synthesized plan (objective starts with "Automation:").
      const planArg = (mock.deps.plans.create as ReturnType<typeof vi.fn>).mock.calls[0][2] as {
        objective: string;
      };
      expect(planArg.objective).toBe('Automation: Daily');
    });
  });

  // ─── cancel ────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('emits idle, getContext returns undefined after', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      expect(pipeline.getContext('t1')).toBeDefined();

      pipeline.cancel('t1');

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'idle');
      expect(pipeline.getContext('t1')).toBeUndefined();
    });
  });

  // ─── getContext ────────────────────────────────────────────────────

  describe('getContext', () => {
    it('returns context for active pipeline', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', '/worktree');

      const ctx = pipeline.getContext('t1');
      expect(ctx).toBeDefined();
      expect(ctx?.threadId).toBe('t1');
      expect(ctx?.projectPath).toBe('/proj');
      expect(ctx?.worktreePath).toBe('/worktree');
    });

    it('returns undefined for missing pipeline', () => {
      const pipeline = createPipeline(mock.deps);
      expect(pipeline.getContext('nonexistent')).toBeUndefined();
    });
  });

  // ─── listActive ────────────────────────────────────────────────────

  describe('listActive', () => {
    it('returns an empty array when no pipelines are running', () => {
      const pipeline = createPipeline(mock.deps);
      expect(pipeline.listActive()).toEqual([]);
    });

    it('includes a running pipeline with its phase from the thread', async () => {
      mock.deps.threads.getById = vi.fn(() => ({
        id: 't1',
        projectId: 'project-1',
        githubIssueNumber: 42,
        status: 'planning',
      })) as never;

      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      const active = pipeline.listActive();
      expect(active).toHaveLength(1);
      expect(active[0].threadId).toBe('t1');
      expect(active[0].phase).toBe('planning');
    });

    it('reflects awaiting_approval phase from the thread for scheduler slot accounting', async () => {
      mock.deps.threads.getById = vi.fn(() => ({
        id: 't1',
        projectId: 'project-1',
        githubIssueNumber: 42,
        status: 'awaiting_approval',
      })) as never;

      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      const active = pipeline.listActive();
      expect(active).toHaveLength(1);
      expect(active[0].phase).toBe('awaiting_approval');
    });

    it('removes a pipeline from the active list after cancel', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      expect(pipeline.listActive()).toHaveLength(1);

      pipeline.cancel('t1');
      expect(pipeline.listActive()).toHaveLength(0);
    });
  });

  // ─── listActiveInPhases ─────────────────────────────────────────────

  describe('listActiveInPhases', () => {
    it('returns only pipelines whose thread status matches the given phases', async () => {
      // Seed two threads: one in planning, one in executing
      let callCount = 0;
      mock.deps.threads.getById = vi.fn(() => {
        callCount++;
        return {
          id: callCount <= 1 ? 't1' : 't2',
          status: callCount <= 1 ? 'planning' : 'executing',
        };
      }) as never;

      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      await pipeline.startPlanGeneration('t2', 'do more', '/proj', null);

      // Reset the mock to return consistent per-id statuses
      mock.deps.threads.getById = vi.fn((id: string) => ({
        id,
        status: id === 't1' ? 'planning' : 'executing',
      })) as never;

      const executing = pipeline.listActiveInPhases([
        'executing',
        'testing',
        'verifying',
        'shipping',
      ]);
      expect(executing).toHaveLength(1);
      expect(executing[0].threadId).toBe('t2');

      const planning = pipeline.listActiveInPhases(['planning', 'reviewing', 'revising']);
      expect(planning).toHaveLength(1);
      expect(planning[0].threadId).toBe('t1');
    });

    it('returns empty array when no pipelines match the given phases', async () => {
      mock.deps.threads.getById = vi.fn(() => ({
        id: 't1',
        status: 'planning',
      })) as never;

      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      expect(pipeline.listActiveInPhases(['executing'])).toHaveLength(0);
    });
  });

  // ─── execution concurrency gate ───────────────────────────────────

  describe('execution concurrency gate', () => {
    it('blocks execution when the project maxConcurrentExecutions is reached', async () => {
      mock.deps.threads.getById = vi.fn((id: string) => ({
        id,
        projectId: 'project-1',
        status: id === 't-new' ? 'awaiting_approval' : 'executing',
      })) as never;

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t-existing-1', { projectPath: '/proj' });
      pipeline.initializeContext('t-existing-2', { projectPath: '/proj' });
      pipeline.initializeContext('t-existing-3', { projectPath: '/proj' });
      pipeline.initializeContext('t-new', { projectPath: '/proj' });

      const plan = { steps: [] } as never;
      await pipeline.startExecution('t-new', plan);

      // Should have emitted awaiting_approval, not executing
      const phaseEvents = mock.emittedEvents.filter(
        (e: PipelineEvent) => e.type === 'pipeline:phase' && e.threadId === 't-new',
      );
      expect(phaseEvents[phaseEvents.length - 1]).toMatchObject({
        type: 'pipeline:phase',
        phase: 'awaiting_approval',
      });
    });

    it('allows execution when under the project maxConcurrentExecutions limit', async () => {
      mock.deps.threads.getById = vi.fn((id: string) => ({
        id,
        projectId: 'project-1',
        status: id === 't-existing' ? 'executing' : 'awaiting_approval',
      })) as never;

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t-existing', { projectPath: '/proj' });
      pipeline.initializeContext('t-new', { projectPath: '/proj' });

      const plan = { steps: [] } as never;
      await pipeline.startExecution('t-new', plan);

      // Should have emitted executing (gate passed), not awaiting_approval
      const phaseEvents = mock.emittedEvents.filter(
        (e: PipelineEvent) => e.type === 'pipeline:phase' && e.threadId === 't-new',
      );
      expect(phaseEvents[phaseEvents.length - 1]).toMatchObject({
        type: 'pipeline:phase',
        phase: 'executing',
      });
    });

    it('does not let executions from another project consume this project slot', async () => {
      mock.deps.threads.getById = vi.fn((id: string) => ({
        id,
        projectId: id.startsWith('other-') ? 'project-2' : 'project-1',
        status: id === 't-new' ? 'awaiting_approval' : 'executing',
      })) as never;

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('other-1', { projectPath: '/other' });
      pipeline.initializeContext('other-2', { projectPath: '/other' });
      pipeline.initializeContext('other-3', { projectPath: '/other' });
      pipeline.initializeContext('t-new', { projectPath: '/proj' });

      const plan = { steps: [] } as never;
      await pipeline.startExecution('t-new', plan);

      const phaseEvents = mock.emittedEvents.filter(
        (e: PipelineEvent) => e.type === 'pipeline:phase' && e.threadId === 't-new',
      );
      expect(phaseEvents[phaseEvents.length - 1]).toMatchObject({
        type: 'pipeline:phase',
        phase: 'executing',
      });
    });

    it('allows multiple concurrent executions when limit permits', async () => {
      mock.deps.settings.get = vi.fn(() => ({
        ...DEFAULT_SETTINGS,
        maxConcurrentExecutions: 3,
      })) as never;

      mock.deps.threads.getById = vi.fn((id: string) => ({
        id,
        projectId: 'project-1',
        status: id === 't3' ? 'awaiting_approval' : 'executing',
      })) as never;

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', { projectPath: '/proj' });
      pipeline.initializeContext('t2', { projectPath: '/proj' });
      pipeline.initializeContext('t3', { projectPath: '/proj' });

      const plan = { steps: [] } as never;
      await pipeline.startExecution('t3', plan);

      // 2 executing + t3 = 3 total, which is at limit but t3 should pass (2 < 3 at check time)
      const phaseEvents = mock.emittedEvents.filter(
        (e: PipelineEvent) => e.type === 'pipeline:phase' && e.threadId === 't3',
      );
      expect(phaseEvents[phaseEvents.length - 1]).toMatchObject({
        type: 'pipeline:phase',
        phase: 'executing',
      });
    });

    it('refuses to execute when latest plan record has null structured', async () => {
      mock.deps.plans.getLatest = vi.fn(() => ({
        id: 'plan-null',
        threadId: 't-null',
        version: 1,
        rawOutput: '',
        structured: null,
        status: 'draft' as const,
        createdAt: '',
      })) as never;

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t-null', { projectPath: '/proj' });

      const plan = { steps: [] } as never;
      await pipeline.startExecution('t-null', plan);

      const phaseEvents = mock.emittedEvents.filter(
        (e: PipelineEvent) => e.type === 'pipeline:phase' && e.threadId === 't-null',
      );
      const last = phaseEvents[phaseEvents.length - 1];
      expect(last).toMatchObject({ type: 'pipeline:phase', phase: 'failed' });
      expect(phaseEvents.some((e) => e.type === 'pipeline:phase' && e.phase === 'executing')).toBe(
        false,
      );
    });

    it('refuses to execute when latest plan record is superseded', async () => {
      mock.deps.plans.getLatest = vi.fn(() => ({
        id: 'plan-old',
        threadId: 't-stale',
        version: 1,
        rawOutput: '',
        structured: JSON.parse(PLAN_JSON),
        status: 'superseded' as const,
        createdAt: '',
      })) as never;

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t-stale', { projectPath: '/proj' });

      const plan = { steps: [] } as never;
      await pipeline.startExecution('t-stale', plan);

      const phaseEvents = mock.emittedEvents.filter(
        (e: PipelineEvent) => e.type === 'pipeline:phase' && e.threadId === 't-stale',
      );
      const last = phaseEvents[phaseEvents.length - 1];
      expect(last).toMatchObject({ type: 'pipeline:phase', phase: 'failed' });
      expect(phaseEvents.some((e) => e.type === 'pipeline:phase' && e.phase === 'executing')).toBe(
        false,
      );
      // Executor must not spawn when guard halts the pipeline.
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
    });
  });

  // ─── Tier 3: pipeline:model-resolved telemetry ─────────────────────

  describe('Tier 3 telemetry', () => {
    it('emits pipeline:model-resolved + persists when provider reports resolvedModel', async () => {
      // Swap the openrouter provider with a scripted one that returns
      // a fake resolvedModel + usage, and point plannerModel at it.
      const openrouterProvider: AgentProvider = {
        id: 'openrouter',
        supports: new Set(['plan', 'review', 'revision', 'verify', 'execute']),
        generate: vi.fn(async () => ({
          rawOutput: planBlock(),
          exitCode: 0,
          resolvedModel: 'anthropic/claude-sonnet-4-6',
          tokensUsed: { prompt: 1200, completion: 450 },
          costUsd: 0.0031,
        })),
        healthCheck: vi.fn(async () => ({ ok: true })),
      };
      const registry = createProviderRegistry({
        claude: mock.deps.providers.for('claude', 'plan'),
        codex: mock.deps.providers.for('codex', 'review'),
        openrouter: openrouterProvider,
      });
      const deps = { ...mock.deps, providers: registry };
      vi.mocked(deps.settings.get).mockReturnValue({
        ...DEFAULT_SETTINGS,
        plannerModel: 'openrouter',
      });

      const pipeline = createPipeline(deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // The emitted events should include pipeline:model-resolved with the full payload
      const resolvedEvent = mock.emittedEvents.find(
        (event): event is Extract<PipelineEvent, { type: 'pipeline:model-resolved' }> =>
          event.type === 'pipeline:model-resolved',
      );
      expect(resolvedEvent).toBeDefined();
      expect(resolvedEvent).toMatchObject({
        type: 'pipeline:model-resolved',
        threadId: 't1',
        phase: 'plan',
        resolvedModel: 'anthropic/claude-sonnet-4-6',
        tokensUsed: { prompt: 1200, completion: 450 },
        costUsd: 0.0031,
      });

      // And the thread row should have been updated via the queries
      expect(mock.deps.threads.setResolvedModel).toHaveBeenCalledWith(
        't1',
        'plan',
        'anthropic/claude-sonnet-4-6',
      );
      expect(mock.deps.threads.addTokenUsage).toHaveBeenCalledWith('t1', 1200, 450, 0.0031);
    });

    it('does NOT emit model-resolved when the provider omits resolvedModel', async () => {
      // Baseline claude-cli provider returns `resolvedModel: 'claude'`
      // so we get an event — verify the opposite by stubbing a
      // provider that returns no resolvedModel at all.
      const silentProvider: AgentProvider = {
        id: 'openrouter',
        supports: new Set(['plan', 'review', 'revision', 'verify', 'execute']),
        generate: vi.fn(async () => ({ rawOutput: planBlock(), exitCode: 0 })),
        healthCheck: vi.fn(async () => ({ ok: true })),
      };
      const registry = createProviderRegistry({
        claude: mock.deps.providers.for('claude', 'plan'),
        codex: mock.deps.providers.for('codex', 'review'),
        openrouter: silentProvider,
      });
      const deps = { ...mock.deps, providers: registry };
      vi.mocked(deps.settings.get).mockReturnValue({
        ...DEFAULT_SETTINGS,
        plannerModel: 'openrouter',
      });

      const pipeline = createPipeline(deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      const resolvedEvent = mock.emittedEvents.find(
        (event): event is Extract<PipelineEvent, { type: 'pipeline:model-resolved' }> =>
          event.type === 'pipeline:model-resolved',
      );
      expect(resolvedEvent).toBeUndefined();
      expect(mock.deps.threads.setResolvedModel).not.toHaveBeenCalled();
      expect(mock.deps.threads.addTokenUsage).not.toHaveBeenCalled();
    });

    it('emits model-resolved for claude-cli too (resolvedModel defaults to "claude")', async () => {
      // The CLI provider sets resolvedModel: 'claude' unconditionally,
      // so plan phase under the default settings should emit the event.
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      // Drive the CLI provider's spawn → exit cycle
      await mock.trigger('output', 'proc-1', planBlock());
      await mock.trigger('exit', 'proc-1', 0);

      const resolvedEvents = mock.emittedEvents.filter(
        (event): event is Extract<PipelineEvent, { type: 'pipeline:model-resolved' }> =>
          event.type === 'pipeline:model-resolved',
      );
      expect(resolvedEvents.length).toBeGreaterThan(0);
      expect(resolvedEvents[0]).toMatchObject({
        phase: 'plan',
        resolvedModel: 'claude',
      });
      // No tokensUsed/costUsd because the CLI provider doesn't report them
      expect(resolvedEvents[0].tokensUsed).toBeUndefined();
    });

    it('skips addTokenUsage when provider reports resolvedModel but no tokensUsed', async () => {
      const partialProvider: AgentProvider = {
        id: 'openrouter',
        supports: new Set(['plan', 'review', 'revision', 'verify', 'execute']),
        generate: vi.fn(async () => ({
          rawOutput: planBlock(),
          exitCode: 0,
          resolvedModel: 'openrouter/auto',
          // no tokensUsed
        })),
        healthCheck: vi.fn(async () => ({ ok: true })),
      };
      const registry = createProviderRegistry({
        claude: mock.deps.providers.for('claude', 'plan'),
        codex: mock.deps.providers.for('codex', 'review'),
        openrouter: partialProvider,
      });
      const deps = { ...mock.deps, providers: registry };
      vi.mocked(deps.settings.get).mockReturnValue({
        ...DEFAULT_SETTINGS,
        plannerModel: 'openrouter',
      });

      const pipeline = createPipeline(deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      // Still emits the event (with resolvedModel only)
      const resolvedEvent = mock.emittedEvents.find(
        (event): event is Extract<PipelineEvent, { type: 'pipeline:model-resolved' }> =>
          event.type === 'pipeline:model-resolved',
      );
      expect(resolvedEvent).toBeDefined();
      expect(resolvedEvent?.tokensUsed).toBeUndefined();

      // Still persists resolvedModel
      expect(mock.deps.threads.setResolvedModel).toHaveBeenCalledWith(
        't1',
        'plan',
        'openrouter/auto',
      );
      // But does NOT call addTokenUsage
      expect(mock.deps.threads.addTokenUsage).not.toHaveBeenCalled();
    });
  });
});
