import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentProvider, ProcessManager } from '@shipcode/agents';
import {
  createClaudeCliProvider,
  createCodexCliProvider,
  createProviderRegistry,
} from '@shipcode/agents';
import { captureCheckpoint, resolveHeadCommit } from '@shipcode/git';
import type { TaskGraphAssessment, TaskGraphWithNodes } from '@shipcode/shared';
import {
  DEFAULT_SETTINGS,
  type GitHubIssueCacheRecord,
  type GitHubPrCheckSummary,
  type GitHubPrReviewCommentSummary,
  MAX_CLARIFICATION_ROUNDS,
  MAX_NODE_VERIFICATION_RETRIES,
  MAX_REVIEW_ROUNDS,
  MAX_TEST_RETRIES,
  MAX_VERIFICATION_RETRIES,
  PIPELINE_MAX_RETRIES,
  type PlanRecord,
  type Project,
  type Thread,
  type VerificationRecord,
} from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPipeline } from './pipeline';
import type { PipelineContext, PipelineDeps, PipelineEvent } from './types';

const { mockWorktreeCreate } = vi.hoisted(() => ({
  mockWorktreeCreate: vi.fn(),
}));
const { mockPromptArtifacts } = vi.hoisted(() => ({
  mockPromptArtifacts: new Map<string, string>(),
}));

vi.mock('@shipcode/git', () => {
  class WorktreeManager {
    create = mockWorktreeCreate;
    remove = vi.fn().mockResolvedValue({ success: true });
  }
  class GitService {
    listBranches = vi.fn().mockResolvedValue([]);
    getDefaultBranch = vi.fn().mockResolvedValue('main');
  }
  return {
    WorktreeManager,
    GitService,
    captureCheckpoint: vi.fn().mockResolvedValue({
      refName: 'refs/shipcode/checkpoints/t1/turn/0',
      turn: 0,
      commitSha: 'snapshot-sha',
      headSha: 'head-sha',
      branch: 'main',
    }),
    resolveHeadCommit: vi.fn().mockResolvedValue('head-sha'),
    resolveCurrentBranch: vi.fn().mockResolvedValue('main'),
  };
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
  const existsSyncMock = vi.fn((target: Parameters<typeof actual.existsSync>[0]) => {
    const value = String(target);
    if (
      value === '/worktree' ||
      value === '/fake/worktree' ||
      value.includes('/.shipcode/worktrees/')
    ) {
      return true;
    }
    return actual.existsSync(target);
  });
  return {
    ...actual,
    existsSync: existsSyncMock,
    default: {
      ...actual,
      existsSync: existsSyncMock,
    },
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    default: {
      ...actual,
      mkdir: vi.fn(
        async (
          target: Parameters<typeof actual.mkdir>[0],
          options?: Parameters<typeof actual.mkdir>[1],
        ) => {
          const value = String(target);
          if (value.startsWith('/worktree/') || value.startsWith('/fake/worktree/'))
            return undefined;
          return actual.mkdir(target, options);
        },
      ),
      writeFile: vi.fn(
        async (
          target: Parameters<typeof actual.writeFile>[0],
          data: Parameters<typeof actual.writeFile>[1],
          options?: Parameters<typeof actual.writeFile>[2],
        ) => {
          const value = String(target);
          if (
            value.startsWith('/worktree/') ||
            value.startsWith('/fake/worktree/') ||
            value.includes('/.shipcode/runs/')
          ) {
            mockPromptArtifacts.set(value, String(data));
            return undefined;
          }
          return actual.writeFile(target, data, options);
        },
      ),
    },
    mkdir: vi.fn(
      async (
        target: Parameters<typeof actual.mkdir>[0],
        options?: Parameters<typeof actual.mkdir>[1],
      ) => {
        const value = String(target);
        if (value.startsWith('/worktree/') || value.startsWith('/fake/worktree/')) return undefined;
        return actual.mkdir(target, options);
      },
    ),
    writeFile: vi.fn(
      async (
        target: Parameters<typeof actual.writeFile>[0],
        data: Parameters<typeof actual.writeFile>[1],
        options?: Parameters<typeof actual.writeFile>[2],
      ) => {
        const value = String(target);
        if (
          value.startsWith('/worktree/') ||
          value.startsWith('/fake/worktree/') ||
          value.includes('/.shipcode/runs/')
        ) {
          mockPromptArtifacts.set(value, String(data));
          return undefined;
        }
        return actual.writeFile(target, data, options);
      },
    ),
  };
});

const PLAN_JSON = JSON.stringify({
  id: 'p1',
  threadId: 't1',
  version: 1,
  objective: 'Test',
  files: [{ path: 'a.ts', action: 'modify', description: 'd' }],
  steps: [
    { order: 1, description: 'Inspect a.ts', files: ['a.ts'], rationale: 'Baseline' },
    { order: 2, description: 'Modify a.ts', files: ['a.ts'], rationale: 'Feature work' },
    { order: 3, description: 'Verify a.ts', files: ['a.ts'], rationale: 'Regression coverage' },
  ],
  acceptanceCriteria: ['works'],
  outOfScope: ['Unrelated refactors'],
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

// These integration tests drive the programmatic stream-json contract via
// `spawnWithStdin`. The production default for the structured phases is now
// interactive (Track 2); pin them back to programmatic here so the existing
// programmatic-path assertions stay meaningful. The interactive structured
// path is covered by the cli-provider unit tests and the dedicated interactive
// pipeline test below.
const TEST_DEFAULT_SETTINGS = {
  ...DEFAULT_SETTINGS,
  plannerModel: 'claude' as const,
  reviewerModel: 'codex' as const,
  executorModel: 'claude' as const,
  verifierModel: 'claude' as const,
  agentRunModes: {
    claude: {
      ...DEFAULT_SETTINGS.agentRunModes.claude,
      plan: 'programmatic' as const,
      review: 'programmatic' as const,
      revision: 'programmatic' as const,
      verify: 'programmatic' as const,
    },
    codex: {
      ...DEFAULT_SETTINGS.agentRunModes.codex,
      plan: 'programmatic' as const,
      review: 'programmatic' as const,
      revision: 'programmatic' as const,
      verify: 'programmatic' as const,
    },
  },
};

/** Flush the microtask queue so async handlers (await import) settle */
const flush = () => new Promise((r) => setImmediate(r));
const useRetryFakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
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

function materializeMockStdinArgs(args: string[], stdin: string): string[] {
  const promptFlagIndex = args.indexOf('-p');
  if (promptFlagIndex !== -1 && args[promptFlagIndex + 1] === '-') {
    const materialized = args.map((arg, index) => (index === promptFlagIndex + 1 ? stdin : arg));
    return [materialized[0] ?? '-p', stdin, ...materialized.slice(2)];
  }
  if (promptFlagIndex !== -1) {
    const materialized = [
      ...args.slice(0, promptFlagIndex + 1),
      stdin,
      ...args.slice(promptFlagIndex + 1),
    ];
    return [materialized[0] ?? '-p', stdin, ...materialized.slice(2)];
  }
  const execIndex = args.indexOf('exec');
  if (execIndex !== -1 && args[execIndex + 1] === '-') {
    const materialized = args.map((arg, index) => (index === execIndex + 1 ? stdin : arg));
    return [materialized[0] ?? 'exec', stdin, ...materialized.slice(2)];
  }
  return args;
}

function materializeMockArtifactArgs(args: string[]): string[] {
  const artifactArgIndex = args.findIndex(
    (arg) => arg.startsWith('Read ') && arg.includes('/.shipcode/runs/'),
  );
  if (artifactArgIndex === -1) return args;
  const match = /^Read (.+) and execute the ShipCode task\.$/.exec(args[artifactArgIndex]);
  if (!match) return args;
  const prompt = mockPromptArtifacts.get(match[1]);
  if (!prompt) return args;
  const materialized = [
    ...args.slice(0, artifactArgIndex),
    '-p',
    prompt,
    ...args.slice(artifactArgIndex + 1),
  ];
  return [materialized[0] ?? '-p', prompt, ...materialized.slice(2)];
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
    status: 'approval',
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
    pausedPhase: null,
    pausedAt: null,
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
    doneAt: null,
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
    executionRunId: overrides.executionRunId ?? null,
    executionLockedAt: overrides.executionLockedAt ?? null,
    executionLockOwner: overrides.executionLockOwner ?? null,
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
    githubStatusMapping: null,
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

function seedVerifyCommandContext(
  pipeline: ReturnType<typeof createPipeline>,
  command: string,
): PipelineContext {
  const projectDir = makeTempProject();
  const worktreeDir = path.join(projectDir, 'worktree');
  mkdirSync(worktreeDir, { recursive: true });
  const context = pipeline.initializeContext('t1', {
    projectPath: projectDir,
    projectId: 'project-1',
    worktreePath: worktreeDir,
    autonomous: true,
    githubIssueNumber: null,
    baseBranch: 'main',
  });
  context.repoSetupLoaded = true;
  context.repoSetupContract = {
    path: path.join(projectDir, '.shipcode', 'setup.json'),
    contract: {
      version: 1,
      setupCommands: [],
      verifyCommands: [command],
      envFiles: [],
      setupBeforeVerify: false,
      testingContext: null,
    },
  };
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd.startsWith('git diff')) return 'some diff';
    if (cmd.startsWith('git status')) return 'M verified.ts';
    if (cmd.startsWith('git rev-parse HEAD')) return 'headsha123';
    if (cmd.startsWith('git rev-parse')) return 'ship/test';
    return '';
  });
  return context;
}

function createMockDeps() {
  const emittedEvents: PipelineEvent[] = [];
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  let spawnCount = 0;

  const emitMockProcessEvent = (event: string, ...args: unknown[]) => {
    const handlers = [...(listeners[event] ?? [])];
    handlers.forEach((handler) => {
      handler(...args);
    });
  };

  const simulateShellCommand = (processId: string, cwd: string, args: string[]) => {
    const command = args.at(-1) ?? '';
    setImmediate(() => {
      if (command === 'printf setup > .setup-ran') {
        writeFileSync(path.join(cwd, '.setup-ran'), 'setup');
        emitMockProcessEvent('exit', processId, 0);
        return;
      }

      if (command === 'shipcode-setup-probe') {
        writeFileSync(path.join(cwd, '.setup-ran'), 'hydrated');
        emitMockProcessEvent('exit', processId, 0);
        return;
      }

      if (command === `printf 'typecheck ok\\ntests ok\\n'`) {
        emitMockProcessEvent('output', processId, 'typecheck ok\ntests ok\n');
        emitMockProcessEvent('exit', processId, 0);
        return;
      }

      if (command.includes('FAIL packages/foo.test.ts')) {
        emitMockProcessEvent(
          'output',
          processId,
          'FAIL packages/foo.test.ts\nAssertionError: expected true to be false\n',
        );
        emitMockProcessEvent('exit', processId, 1);
        return;
      }

      if (command.includes('process.exit(0)')) {
        emitMockProcessEvent('exit', processId, 0);
      }
    });
  };

  const processManager = {
    spawn: vi.fn(
      (_type: 'claude' | 'codex' | 'gemini' | 'gh', _command: string, args: string[] = []) => {
        const materializedArgs = materializeMockArtifactArgs(args);
        args.splice(0, args.length, ...materializedArgs);
        return { id: `proc-${++spawnCount}` };
      },
    ),
    spawnWithStdin: vi.fn(
      (
        type: 'claude' | 'codex' | 'shell',
        command: string,
        args: string[],
        cwd: string,
        input: string,
        threadId?: string,
        options?: Parameters<ProcessManager['spawn']>[5],
      ) => {
        if (type === 'shell') {
          const process = { id: `proc-${++spawnCount}` };
          simulateShellCommand(process.id, cwd, args);
          return process;
        }
        return processManager.spawn(
          type,
          command,
          materializeMockStdinArgs(args, input),
          cwd,
          threadId,
          options,
        );
      },
    ),
    get: vi.fn(() => ({ state: 'exited' })),
    kill: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const eventListeners = listeners[event] ?? [];
      eventListeners.push(handler);
      listeners[event] = eventListeners;
    }),
    removeListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
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
    emitMockProcessEvent(event, ...args);
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
    get: vi.fn(() => ({ ...TEST_DEFAULT_SETTINGS })),
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
        setClarificationRequest: vi.fn(),
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
      projectFailures: {
        claimOrCreate: vi.fn((input: { threadId: string; fingerprint: string }) => ({
          id: 'failure-1',
          projectId: 'project-1',
          baseBranch: 'main',
          fingerprint: input.fingerprint,
          status: 'in_progress',
          ownerThreadId: input.threadId,
          firstSeenThreadId: input.threadId,
          seenThreadIds: [input.threadId],
          command: 'bun test',
          summary: 'Tests failed',
          outputExcerpt: '',
          implicatedFiles: [],
          resolvedByThreadId: null,
          resolvedCommitSha: null,
          resolvedAt: null,
          createdAt: '',
          updatedAt: '',
        })),
        resolveOwnedByThread: vi.fn(() => 0),
      },
      featureQaResults: {
        insert: vi.fn(),
        listByThread: vi.fn(() => []),
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
    mockWorktreeCreate.mockReset();
    mockWorktreeCreate.mockResolvedValue({
      worktreePath: '/fake/worktree',
      branch: 'feat/42-bug',
    });
    mockExecSync.mockReset();
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'feat/test-branch';
      if (cmd === 'git rev-parse HEAD') return 'abc123';
      if (cmd === 'git status --porcelain') return '';
      return '';
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

    it('fails fast when the project PRD quality gate is enabled', async () => {
      vi.mocked(mock.deps.projects.getById).mockReturnValue(
        makeProject({ prdQualityGate: true } as Partial<Project>),
      );
      const pipeline = createPipeline(mock.deps);

      await pipeline.startPlanGeneration('t1', '## Executive Summary\nToo thin', '/proj', null);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('PRD quality gate:'),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('reports a missing planner provider when generation exits 127', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await mock.trigger('exit', 'proc-1', 127);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('claude CLI not found (exit 127)'),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
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
        'approval',
      );
    });

    it('passes approval through to the linked GitHub issue status', async () => {
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
        { speedProfile: 'smart_fast' },
      );
      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approved');
      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approval');
      expect(mock.emittedEvents).toContainEqual(
        expect.objectContaining({ type: 'plan:parsed', threadId: 't1' }),
      );
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'approval');
    });

    it('exit non-zero + valid plan still accepts the structured plan', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await mock.trigger('output', 'proc-1', planBlock());
      await mock.trigger('exit', 'proc-1', 1);

      expect(mock.deps.plans.create).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(Object),
        1,
      );
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'approval');
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

    it('persists and comments task graphs when a structured plan is accepted', async () => {
      const graph = makeTaskGraph();
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.replaceForPlan).mockReturnValue(graph);
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await mock.trigger('output', 'proc-1', planBlock());
      await mock.trigger('exit', 'proc-1', 0);

      expect(mock.deps.taskGraphs?.replaceForPlan).toHaveBeenCalledWith(
        't1',
        'plan-1',
        expect.any(Object),
        expect.any(Object),
      );
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(1);
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'approval');
    });

    it('continues when task graph persistence fails for an accepted plan', async () => {
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.replaceForPlan).mockImplementation(() => {
        throw new Error('task graph db offline');
      });
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await mock.trigger('output', 'proc-1', planBlock());
      await mock.trigger('exit', 'proc-1', 0);

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approval');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'approval');
    });

    it('replaces an existing planning retry timer and skips retry when cancelled', async () => {
      useRetryFakeTimers();
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.retryTimer = setTimeout(() => {}, 10_000);

      await mock.trigger('output', 'proc-1', 'transient failure without plan');
      await mock.trigger('exit', 'proc-1', 1);

      expect(clearSpy).toHaveBeenCalled();
      expect(context.retryTimer).not.toBeNull();
      context.cancelled = true;
      await vi.runOnlyPendingTimersAsync();

      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(1);
      expect(context.retryTimer).toBeNull();
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

    it('enters clarifying when the planner emits a clarification request', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const request = clarificationRequest('clarify-1', 'scope', 'Scope');

      await mock.trigger(
        'output',
        'proc-1',
        `\`\`\`shipcode-clarification\n${JSON.stringify(request)}\n\`\`\``,
      );
      await mock.trigger('exit', 'proc-1', 0);
      await flush();

      expect(mock.deps.threads.setClarificationRequest).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({
          id: 'clarify-1',
          threadId: 't1',
          phase: 'plan',
        }),
        1,
      );
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'clarifying');
      expect(mock.emittedEvents).toContainEqual(
        expect.objectContaining({
          type: 'terminal:event',
          threadId: 't1',
          event: expect.objectContaining({
            kind: 'clarification_requested',
            questionCount: 1,
          }),
        }),
      );
    });

    it('exit non-zero + clarification request still enters clarifying', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const request = clarificationRequest('clarify-1', 'scope', 'Scope');

      await mock.trigger(
        'output',
        'proc-1',
        `\`\`\`shipcode-clarification\n${JSON.stringify(request)}\n\`\`\``,
      );
      await mock.trigger('exit', 'proc-1', 1);

      expect(mock.deps.threads.setClarificationRequest).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ id: 'clarify-1' }),
        1,
      );
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'clarifying');
    });

    it('fails when planner clarification exceeds the round limit', async () => {
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        clarificationRound: MAX_CLARIFICATION_ROUNDS,
      });
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const request = clarificationRequest('clarify-1', 'scope', 'Scope');

      await mock.trigger(
        'output',
        'proc-1',
        `\`\`\`shipcode-clarification\n${JSON.stringify(request)}\n\`\`\``,
      );
      await mock.trigger('exit', 'proc-1', 0);
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        'planning',
        expect.stringContaining('Planning clarification limit reached'),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('fails planning when the repo setup contract is invalid', async () => {
      const projectDir = makeTempProject();
      writeFileSync(path.join(projectDir, '.shipcode', 'setup.json'), '{');
      const pipeline = createPipeline(mock.deps);

      await pipeline.startPlanGeneration('t1', 'do stuff', projectDir, null);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('Invalid repo setup contract'),
      );
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('ignores planner completion after the context is cancelled', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).cancelled = true;

      await mock.trigger('output', 'proc-1', planBlock());
      await mock.trigger('exit', 'proc-1', 0);

      expect(mock.deps.plans.create).not.toHaveBeenCalled();
      expect(mock.deps.threads.recordFailure).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeDefined();
    });

    it('uses repo WORKFLOW.md body as the planner prompt template when present', async () => {
      const projectDir = makeTempProject();
      writeFileSync(
        path.join(projectDir, '.shipcode', 'WORKFLOW.md'),
        'Custom {{ phase }} prompt for attempt {{ attempt.number }}.',
      );

      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', projectDir, null);

      const args = vi.mocked(mock.deps.processManager.spawn).mock.calls[0][2] as string[];
      expect(args[1]).toContain('Custom plan prompt for attempt 1.');
    });

    it('emits a structured workflow warning and falls back when WORKFLOW.md is invalid', async () => {
      const projectDir = makeTempProject();
      writeFileSync(
        path.join(projectDir, '.shipcode', 'WORKFLOW.md'),
        `---
- not-a-map
---
Custom prompt`,
      );

      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', projectDir, null);

      expect(mock.emittedEvents).toContainEqual(
        expect.objectContaining({
          type: 'workflow:warning',
          threadId: 't1',
          warning: expect.objectContaining({ code: 'workflow_front_matter_not_a_map' }),
        }),
      );
      const args = vi.mocked(mock.deps.processManager.spawn).mock.calls[0][2] as string[];
      expect(args[1]).toContain('Produce a detailed, step-by-step implementation plan');
    });

    it('fails when the repo WORKFLOW.md template cannot render', async () => {
      const projectDir = makeTempProject();
      writeFileSync(path.join(projectDir, '.shipcode', 'WORKFLOW.md'), '{{ issue.titel }}');

      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', projectDir, null);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        'planning',
        expect.stringContaining('WORKFLOW.md template render error:'),
      );
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('exit non-zero → schedules failure retry with exponential backoff', async () => {
      useRetryFakeTimers();
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      const firstExit = mock.trigger('exit', 'proc-1', 1);
      await vi.advanceTimersByTimeAsync(0);
      await firstExit;

      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(9999);
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(2);
    });

    it('exit non-zero 4 times → emits failed (PIPELINE_MAX_RETRIES=3)', async () => {
      useRetryFakeTimers();
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      // First attempt + 3 retries = 4 total failures
      for (let i = 1; i <= PIPELINE_MAX_RETRIES + 1; i++) {
        const exit = mock.trigger('exit', `proc-${i}`, 1);
        await vi.advanceTimersByTimeAsync(0);
        await exit;
        if (i <= PIPELINE_MAX_RETRIES) {
          await vi.advanceTimersByTimeAsync(10_000 * 2 ** (i - 1));
        }
      }

      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(PIPELINE_MAX_RETRIES + 1);
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
    });

    it('uses a final CLI result line as the exhausted planning failure reason', async () => {
      useRetryFakeTimers();
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      for (let i = 1; i <= PIPELINE_MAX_RETRIES + 1; i++) {
        await mock.trigger(
          'output',
          `proc-${i}`,
          JSON.stringify({ type: 'result', result: `Planner failed attempt ${i}` }),
        );
        const exit = mock.trigger('exit', `proc-${i}`, 1);
        await vi.advanceTimersByTimeAsync(0);
        await exit;
        if (i <= PIPELINE_MAX_RETRIES) {
          await vi.advanceTimersByTimeAsync(10_000 * 2 ** (i - 1));
        }
      }

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        'planning',
        'Planner failed attempt 4',
      );
    });

    it('uses a final CLI errors line as the exhausted planning failure reason', async () => {
      useRetryFakeTimers();
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      for (let i = 1; i <= PIPELINE_MAX_RETRIES + 1; i++) {
        await mock.trigger(
          'output',
          `proc-${i}`,
          JSON.stringify({ type: 'result', errors: [`Planner error attempt ${i}`] }),
        );
        const exit = mock.trigger('exit', `proc-${i}`, 1);
        await vi.advanceTimersByTimeAsync(0);
        await exit;
        if (i <= PIPELINE_MAX_RETRIES) {
          await vi.advanceTimersByTimeAsync(10_000 * 2 ** (i - 1));
        }
      }

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        'planning',
        'Planner error attempt 4',
      );
    });

    it('uses the generic exhausted planning failure when the final snippet is raw JSON', async () => {
      useRetryFakeTimers();
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      for (let i = 1; i <= PIPELINE_MAX_RETRIES + 1; i++) {
        await mock.trigger('output', `proc-${i}`, '{"unexpected":"shape"}');
        const exit = mock.trigger('exit', `proc-${i}`, 1);
        await vi.advanceTimersByTimeAsync(0);
        await exit;
        if (i <= PIPELINE_MAX_RETRIES) {
          await vi.advanceTimersByTimeAsync(10_000 * 2 ** (i - 1));
        }
      }

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        'planning',
        'Plan generation failed — no structured plan was produced.',
      );
    });

    it('C1 regression: retry counter persists across recursive calls', async () => {
      useRetryFakeTimers();
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      // First failure: retryCount becomes 1
      const firstExit = mock.trigger('exit', 'proc-1', 1);
      await vi.advanceTimersByTimeAsync(0);
      await firstExit;
      expect(pipeline.getContext('t1')?.retryCount).toBe(1);
      await vi.advanceTimersByTimeAsync(10_000);

      // Second failure: retryCount becomes 2
      const secondExit = mock.trigger('exit', 'proc-2', 1);
      await vi.advanceTimersByTimeAsync(0);
      await secondExit;
      expect(pipeline.getContext('t1')?.retryCount).toBe(2);
      await vi.advanceTimersByTimeAsync(20_000);

      // Third failure: retryCount becomes 3
      const thirdExit = mock.trigger('exit', 'proc-3', 1);
      await vi.advanceTimersByTimeAsync(0);
      await thirdExit;
      expect(pipeline.getContext('t1')?.retryCount).toBe(3);
      await vi.advanceTimersByTimeAsync(40_000);

      // Fourth failure: exhausted → should emit failed
      const fourthExit = mock.trigger('exit', 'proc-4', 1);
      await vi.advanceTimersByTimeAsync(0);
      await fourthExit;
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
    });

    it('cancel clears pending planning retry timer', async () => {
      useRetryFakeTimers();
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      const firstExit = mock.trigger('exit', 'proc-1', 1);
      await vi.advanceTimersByTimeAsync(0);
      await firstExit;
      expect(pipeline.getContext('t1')?.retryTimer).not.toBeNull();

      pipeline.cancel('t1');
      await vi.advanceTimersByTimeAsync(10_000);

      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(1);
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

    it('loads repo prompt materials when review starts from a rehydrated context', async () => {
      const projectDir = makeTempProject();
      mkdirSync(path.join(projectDir, '.agents', 'memory'), { recursive: true });
      writeFileSync(path.join(projectDir, '.agents', 'memory', 'MEMORY.md'), 'Repo memory.');
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', { projectPath: projectDir, worktreePath: projectDir });

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));

      const context = requireContext(pipeline);
      expect(context.repoPromptMaterials).not.toBeNull();
      expect(context.repoContext).toContain('Repo memory.');
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(1);
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

    it('approve + manual → emits approval', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));

      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_APPROVE_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approval');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'approval');
    });

    it('reports a missing reviewer provider when review exits 127', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));
      await mock.trigger('exit', 'proc-2', 127);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('codex CLI not found (exit 127)'),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('fails review when WORKFLOW.md template cannot render', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.workflowPolicy = {
        ...context.workflowPolicy,
        promptTemplate: '{{ issue.titel }}',
      };

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('WORKFLOW.md template render error:'),
      );
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(1);
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('request_changes + autonomous + round < MAX_REVIEW_ROUNDS → emits revising', async () => {
      vi.mocked(mock.deps.settings.get).mockReturnValue({
        ...TEST_DEFAULT_SETTINGS,
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

    it('request_changes + autonomous + round >= MAX_REVIEW_ROUNDS + has critical → approval', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.autonomous = true;
      context.reviewRound = MAX_REVIEW_ROUNDS;

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));

      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_REQUEST_CHANGES_CRITICAL_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approval');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'approval');
    });

    it('reject → halts at approval gate', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));

      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_REJECT_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'rejected');
      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approval');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'approval');
      expect(mock.deps.threads.recordFailure).not.toHaveBeenCalled();
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

    it('parse failure without a latest plan still emits failed', async () => {
      vi.mocked(mock.deps.plans.getLatest).mockReturnValue(null);
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));
      await mock.trigger('output', 'proc-2', 'garbage output');
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.reviews.create).not.toHaveBeenCalled();
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Review output could not be parsed — reviewer did not emit a shipcode-review block.',
      );
    });

    it('ignores review completion after the context is cancelled', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));
      requireContext(pipeline).cancelled = true;

      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_APPROVE_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.reviews.create).not.toHaveBeenCalled();
      expect(mock.deps.plans.updateStatus).not.toHaveBeenCalledWith('plan-1', 'approved');
    });

    it('fails review when the latest plan record has no structured plan', async () => {
      mock.latestPlan.structured = null;
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));
      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_APPROVE_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Review aborted: latest plan record has no structured plan.',
      );
    });

    it('reports review persistence errors', async () => {
      vi.mocked(mock.deps.reviews.create).mockImplementation(() => {
        throw new Error('review db offline');
      });
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));
      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_APPROVE_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Review error: review db offline',
      );
    });

    it('approve + non-autonomous + !requireApproval → approval (no auto-execute)', async () => {
      // context.autonomous defaults to false; requireApproval defaults to false
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      // do NOT set context.autonomous = true

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));
      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_APPROVE_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'approval');
    });

    it('request_changes + requireApproval + rounds exhausted + has critical → approval', async () => {
      vi.mocked(mock.deps.settings.get).mockReturnValue({
        ...TEST_DEFAULT_SETTINGS,
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

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approval');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'approval');
    });

    it('approve + autonomous + project approval override → approval', async () => {
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

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approval');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'approval');
    });

    it('request_changes + non-autonomous + rounds exhausted + has critical → approval', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      // autonomous stays false (default)
      requireContext(pipeline).reviewRound = MAX_REVIEW_ROUNDS;

      await pipeline.startReview('t1', JSON.parse(PLAN_JSON));
      await mock.trigger('output', 'proc-2', reviewBlock(REVIEW_REQUEST_CHANGES_CRITICAL_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'approval');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'approval');
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

    it('fails revision when WORKFLOW.md template cannot render', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.workflowPolicy = {
        ...context.workflowPolicy,
        promptTemplate: '{{ issue.titel }}',
      };

      await pipeline.startRevision('t1', JSON.parse(PLAN_JSON), 'feedback');

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('WORKFLOW.md template render error:'),
      );
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(1);
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('reports revision persistence errors', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      vi.mocked(mock.deps.plans.create).mockImplementation(() => {
        throw new Error('plan db offline');
      });

      await pipeline.startRevision('t1', JSON.parse(PLAN_JSON), 'feedback');
      await mock.trigger('output', 'proc-2', planBlock());
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.supersedeAll).toHaveBeenCalledWith('t1');
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Revision error: plan db offline',
      );
    });

    it('ignores revision completion after the context is cancelled', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      await pipeline.startRevision('t1', JSON.parse(PLAN_JSON), 'feedback');
      requireContext(pipeline).cancelled = true;

      await mock.trigger('output', 'proc-2', planBlock());
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.plans.supersedeAll).not.toHaveBeenCalled();
      expect(mock.deps.plans.create).not.toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(Object),
        2,
      );
    });
  });

  // ─── startExecution ────────────────────────────────────────────────

  describe('startExecution', () => {
    it('no context → no-op', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
    });

    it('refuses execution when no latest plan record exists', async () => {
      vi.mocked(mock.deps.plans.getLatest).mockReturnValue(null);
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', { projectPath: '/proj', worktreePath: '/worktree' });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Refusing to execute: no plan record found for this thread.',
      );
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('refuses execution when latest plan is rejected', async () => {
      vi.mocked(mock.deps.plans.getLatest).mockReturnValue(makePlanRecord({ status: 'rejected' }));
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', { projectPath: '/proj', worktreePath: '/worktree' });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Refusing to execute: latest plan is rejected.',
      );
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('refuses execution when latest plan has no structured output', async () => {
      vi.mocked(mock.deps.plans.getLatest).mockReturnValue(makePlanRecord({ structured: null }));
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', { projectPath: '/proj', worktreePath: '/worktree' });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Refusing to execute: latest plan has no parsed structured output.',
      );
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('refuses execution when latest plan is superseded', async () => {
      vi.mocked(mock.deps.plans.getLatest).mockReturnValue(
        makePlanRecord({ status: 'superseded' }),
      );
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', { projectPath: '/proj', worktreePath: '/worktree' });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Refusing to execute: latest plan is superseded.',
      );
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('fails execution when worktree creation fails', async () => {
      mockWorktreeCreate.mockRejectedValueOnce(new Error('worktree failed'));
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', { projectPath: '/proj', worktreePath: null });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Worktree creation failed: Error: worktree failed',
      );
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('continues execution when checkpoint capture fails entirely', async () => {
      // Failure policy: checkpoint capture is best-effort and must never fail
      // the execute phase. Ref capture throws AND HEAD is unresolvable → the
      // row is skipped, but the executor still runs.
      vi.mocked(captureCheckpoint).mockRejectedValueOnce(new Error('capture offline'));
      vi.mocked(resolveHeadCommit)
        .mockResolvedValueOnce(null) // dedupe probe
        .mockResolvedValueOnce(null); // commitSha fallback after capture failure
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', { projectPath: '/proj', worktreePath: '/worktree' });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(mock.deps.checkpoints.create).not.toHaveBeenCalled();
      expect(mock.deps.threads.recordFailure).not.toHaveBeenCalled();
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(1);
    });

    it('skips duplicate checkpoint creation for the same execute attempt', async () => {
      vi.mocked(mock.deps.checkpoints.getLatest).mockReturnValue({
        id: 'checkpoint-1',
        threadId: 't1',
        projectId: 'project-1',
        phase: 'executing',
        reason: 'before_execute',
        label: 'Before execute attempt 1',
        branch: 'feat/test-branch',
        // Dedupe compares the latest row's commitSha against the worktree's
        // resolved HEAD ('head-sha' from the module mock above).
        commitSha: 'head-sha',
        refName: null,
        createdAt: '',
      });
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', { projectPath: '/proj', worktreePath: '/worktree' });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await flush();
      await flush();

      expect(mock.deps.checkpoints.create).not.toHaveBeenCalled();
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(1);
    });

    it('keeps execution in approval when project execution slots are full', async () => {
      vi.mocked(mock.deps.settings.get).mockReturnValue({
        ...TEST_DEFAULT_SETTINGS,
        maxConcurrentExecutions: 1,
      });
      vi.mocked(mock.deps.threads.getById).mockImplementation((id: string) =>
        id === 'other-thread'
          ? ({ id, projectId: null, githubIssueNumber: null, status: 'executing' } as never)
          : ({ id, projectId: null, githubIssueNumber: null, status: 'approval' } as never),
      );
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('other-thread', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        projectId: null,
      });
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        projectId: null,
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'approval');
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
    });

    it('keeps execution in approval when the issue execution lock is held by another run', async () => {
      const pipelineRuns = {
        getCurrentForThread: vi.fn(() => null),
        claimIssueExecution: vi.fn(() => false),
        start: vi.fn(),
        setPhase: vi.fn(),
      };
      mock.deps.pipelineRuns = pipelineRuns as never;
      vi.mocked(mock.deps.githubIssues.getByNumber).mockReturnValue(
        makeIssue({ executionRunId: 'run-other', executionLockOwner: 'claude' }),
      );

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        runId: 'run-current',
        projectId: 'project-1',
        githubIssueNumber: 42,
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));

      expect(pipelineRuns.claimIssueExecution).not.toHaveBeenCalled();
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'approval');
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeDefined();
    });

    it('fails execution when WORKFLOW.md execute template cannot render', async () => {
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', { projectPath: '/proj', worktreePath: '/worktree' });
      const context = requireContext(pipeline);
      context.workflowPolicy = {
        ...context.workflowPolicy,
        promptTemplate: '{{ issue.titel }}',
      };

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('WORKFLOW.md template render error:'),
      );
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('fails execution when repo setup contract loading throws', async () => {
      const projectDir = makeTempProject();
      writeFileSync(path.join(projectDir, '.shipcode', 'setup.json'), '{');
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: projectDir,
        worktreePath: projectDir,
        baseBranch: 'main',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('Invalid repo setup contract'),
      );
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('appends interrupted execution resume context from the start carry', async () => {
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON), {
        executionResumeContext:
          '\n\n<interrupted_run_context>\nContinue from the existing WIP.\n</interrupted_run_context>',
      });
      await flush();

      const executeCall = vi.mocked(mock.deps.processManager.spawn).mock.calls[0];
      expect(executeCall[2][1]).toContain('<interrupted_run_context>');
      expect(executeCall[2][1]).toContain('Continue from the existing WIP.');
    });

    it('exit 0 + autonomous → starts verification (emits verifying)', async () => {
      // Need to set up execSync for verification phase
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse --verify')) return 'abc123';
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
      await flush();

      // proc-2 is execution
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'verifying');
    });

    it('exit 0 + manual → emits completed', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git status --porcelain') return ' M a.ts';
        return '';
      });
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'completed');
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('direct task graph runs one execute pass and skips node verification', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse --verify')) return 'abc123';
        if (cmd.startsWith('git diff')) return 'some diff output';
        if (cmd.startsWith('git status')) return '';
        return '';
      });
      const graph = {
        ...makeTaskGraph(),
        mode: 'direct',
        assessment: {
          mode: 'direct',
          shouldDecompose: false,
          riskScore: 0.1,
          reasons: ['Contained plan with one low-risk execution surface'],
          suggestedNodeCount: 1,
          surfaces: ['frontend'],
        } satisfies TaskGraphAssessment,
        nodes: [makeTaskGraph().nodes[0]],
        edges: [],
      } satisfies TaskGraphWithNodes;
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.getByPlanId).mockImplementation(() => graph);
      vi.mocked(taskGraphs.updateGraphStatus).mockImplementation((_graphId, status) => ({
        ...graph,
        status,
      }));

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
        autonomous: true,
        forkPointSha: 'abc123',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger('output', 'proc-1', 'execution done');
      await mock.trigger('exit', 'proc-1', 0);
      await flush();

      expect(taskGraphs.getNextReadyNode).not.toHaveBeenCalled();
      expect(taskGraphs.updateNodeStatus).not.toHaveBeenCalled();
      expect(taskGraphs.markNodeCompletedAndPromote).not.toHaveBeenCalled();
      expect(taskGraphs.updateGraphStatus).toHaveBeenCalledWith('graph-1', 'completed');
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(2);
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'verifying');
    });

    it('continues autonomous direct execution when graph completion status update fails', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse --verify')) return 'abc123';
        if (cmd.startsWith('git diff')) return 'some diff output';
        if (cmd.startsWith('git status')) return '';
        return '';
      });
      const graph = {
        ...makeTaskGraph(),
        mode: 'direct',
        assessment: {
          mode: 'direct',
          shouldDecompose: false,
          riskScore: 0.1,
          reasons: ['Contained plan with one low-risk execution surface'],
          suggestedNodeCount: 1,
          surfaces: ['frontend'],
        } satisfies TaskGraphAssessment,
        nodes: [makeTaskGraph().nodes[0]],
        edges: [],
      } satisfies TaskGraphWithNodes;
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      const statusError = new Error('status offline');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(taskGraphs.getByPlanId).mockImplementation(() => graph);
      vi.mocked(taskGraphs.updateGraphStatus).mockImplementation(() => {
        throw statusError;
      });

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
        autonomous: true,
        forkPointSha: 'abc123',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger('exit', 'proc-1', 0);
      await flush();

      expect(taskGraphs.updateGraphStatus).toHaveBeenCalledWith('graph-1', 'completed');
      expect(consoleError).toHaveBeenCalledWith(
        '[pipeline] direct task graph completion failed for t1:',
        statusError,
      );
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'verifying');
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(2);
    });

    it('fails a completed manual task graph when no code changes were produced', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git status --porcelain') return '';
        if (cmd.startsWith('git diff')) return '';
        if (cmd.startsWith('git rev-parse')) return 'abc123';
        return '';
      });
      const graph: TaskGraphWithNodes = {
        ...makeTaskGraph(),
        status: 'active',
        nodes: makeTaskGraph().nodes.map((node) => ({ ...node, status: 'completed' as const })),
      };
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.getByPlanId).mockReturnValue(graph);
      vi.mocked(taskGraphs.getNextReadyNode).mockReturnValue(null);
      vi.mocked(taskGraphs.updateGraphStatus).mockReturnValue({ ...graph, status: 'completed' });

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
        autonomous: false,
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(taskGraphs.updateGraphStatus).toHaveBeenCalledWith('graph-1', 'completed');
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'All task graph nodes completed but no code changes were produced',
      );
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('fails a task graph with incomplete nodes but no ready node', async () => {
      const graph = {
        ...makeTaskGraph(),
        nodes: makeTaskGraph().nodes.map((node, index) => ({
          ...node,
          status: index === 0 ? ('blocked' as const) : ('pending' as const),
        })),
      };
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.getByPlanId).mockReturnValue(graph);
      vi.mocked(taskGraphs.getNextReadyNode).mockReturnValue(null);

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Task graph has no ready node (step-1:blocked, step-2:pending).',
      );
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('resets terminal task graph nodes before retry execution', async () => {
      const terminalGraph: TaskGraphWithNodes = {
        ...makeTaskGraph(),
        status: 'failed',
        nodes: makeTaskGraph().nodes.map((node) => ({
          ...node,
          status: 'failed' as const,
        })),
      };
      const resetGraph: TaskGraphWithNodes = {
        ...makeTaskGraph(),
        nodes: makeTaskGraph().nodes.map((node, index) => ({
          ...node,
          status: index === 0 ? ('ready' as const) : ('pending' as const),
        })),
      };
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.getByPlanId).mockReturnValue(resetGraph);
      vi.mocked(taskGraphs.resetForRetry).mockReturnValue(resetGraph);
      vi.mocked(taskGraphs.getNextReadyNode).mockReturnValue(resetGraph.nodes[0]);

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
        testRetries: 1,
        nodeVerificationRetries: 2,
        nodeAnchorSha: 'old-anchor',
      });
      vi.mocked(taskGraphs.getByPlanId)
        .mockReturnValueOnce(terminalGraph)
        .mockReturnValue(resetGraph);

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(taskGraphs.resetForRetry).toHaveBeenCalledWith('graph-1');
      expect(requireContext(pipeline).nodeVerificationRetries).toBe(0);
      expect(requireContext(pipeline).nodeAnchorSha).toBe('abc123');
      expect(taskGraphs.updateNodeStatus).toHaveBeenCalledWith('node-1', 'running');
    });

    it('executes task graph nodes one by one with specialist node prompts', async () => {
      // Mock git commands for per-node verification (captureNodeAnchorSha, computeNodeDiff)
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-parse HEAD') return 'anchor-sha-123';
        if (cmd === 'git status --porcelain') return ' M a.ts';
        if (cmd === 'git add -A') return '';
        if (cmd.startsWith('git commit --no-verify')) return '';
        if (cmd.startsWith('git diff anchor-sha-123..HEAD')) return 'diff --git a/file.ts\n+code';
        return '';
      });

      // Build a valid verification "passed" block the parser will accept
      const verificationPassedBlock = (threadId: string, planId: string) =>
        `\`\`\`shipcode-verification\n${JSON.stringify({
          threadId,
          planId,
          result: 'passed',
          summary: 'Node criteria met',
          criteriaResults: [{ criterion: 'test', passed: true, evidence: 'done' }],
          issues: [],
        })}\n\`\`\``;

      const graph = makeTaskGraph();
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.getByPlanId).mockImplementation(() => graph);
      vi.mocked(taskGraphs.getNextReadyNode).mockImplementation(
        () => graph.nodes.find((node) => node.status === 'ready') ?? null,
      );
      vi.mocked(taskGraphs.updateNodeStatus).mockImplementation((nodeId: string, status) => {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) throw new Error(`missing node ${nodeId}`);
        node.status = status;
        return node;
      });
      vi.mocked(taskGraphs.markNodeCompletedAndPromote).mockImplementation((nodeId: string) => {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) throw new Error(`missing node ${nodeId}`);
        node.status = 'completed';
        const next = graph.nodes.find((candidate) => candidate.status === 'pending');
        if (next) next.status = 'ready';
        if (graph.nodes.every((candidate) => candidate.status === 'completed')) {
          graph.status = 'completed';
        }
        return graph;
      });
      vi.mocked(taskGraphs.updateGraphStatus).mockImplementation((_graphId, status) => {
        graph.status = status;
        return graph;
      });

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      // proc-1: execute node-1
      await mock.trigger('exit', 'proc-1', 0);
      const spawnMock = vi.mocked(mock.deps.processManager.spawn);

      // proc-2: verify node-1 (per-node verification)
      for (let i = 0; i < 100 && spawnMock.mock.calls.length < 2; i++) {
        await flush();
      }
      await mock.trigger('output', 'proc-2', verificationPassedBlock('t1', 'plan-1'));
      await mock.trigger('exit', 'proc-2', 0);

      // proc-3: execute node-2
      for (let i = 0; i < 100 && spawnMock.mock.calls.length < 3; i++) {
        await flush();
      }
      await mock.trigger('exit', 'proc-3', 0);

      // proc-4: verify node-2 (per-node verification)
      for (let i = 0; i < 100 && spawnMock.mock.calls.length < 4; i++) {
        await flush();
      }
      await mock.trigger('output', 'proc-4', verificationPassedBlock('t1', 'plan-1'));
      await mock.trigger('exit', 'proc-4', 0);

      expect(taskGraphs.updateNodeStatus).toHaveBeenNthCalledWith(1, 'node-1', 'running');
      expect(taskGraphs.markNodeCompletedAndPromote).toHaveBeenNthCalledWith(1, 'node-1');
      expect(taskGraphs.updateNodeStatus).toHaveBeenNthCalledWith(2, 'node-2', 'running');
      expect(taskGraphs.markNodeCompletedAndPromote).toHaveBeenNthCalledWith(2, 'node-2');
      // 4 spawns: execute node-1, verify node-1, execute node-2, verify node-2
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(4);
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'completed');
      expect(pipeline.getContext('t1')).toBeUndefined();

      // Execute spawns are at indices 0 and 2 (verify spawns at 1 and 3)
      const firstPrompt = spawnMock.mock.calls[0][2][1];
      const secondPrompt = spawnMock.mock.calls[2][2][1];
      expect(firstPrompt).toContain('Create task graph tables');
      expect(firstPrompt).toContain('You are running as the database specialist executor');
      expect(firstPrompt).toContain('Hard rule: execute ONLY the active node');
      expect(secondPrompt).toContain('Wire task graph pipeline');
      expect(secondPrompt).toContain('You are running as the backend specialist executor');
    });

    it('marks an active task graph node failed when execution exits non-zero', async () => {
      const graph = makeTaskGraph();
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.getByPlanId).mockReturnValue(graph);
      vi.mocked(taskGraphs.getNextReadyNode).mockReturnValue(graph.nodes[0]);
      vi.mocked(taskGraphs.updateNodeStatus).mockImplementation((nodeId: string, status) => {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) throw new Error(`missing node ${nodeId}`);
        node.status = status;
        return node;
      });
      vi.mocked(taskGraphs.markNodeFailed).mockReturnValue({
        ...graph,
        nodes: [{ ...graph.nodes[0], status: 'failed' }, graph.nodes[1]],
      });

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger('output', 'proc-1', 'executor failed');
      await mock.trigger('exit', 'proc-1', 1);

      expect(taskGraphs.markNodeFailed).toHaveBeenCalledWith('node-1');
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Execution failed (exit 1): executor failed',
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('schedules a node retry when node verification fails with retry budget left', async () => {
      useRetryFakeTimers();
      const graph = makeTaskGraph();
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.getByPlanId).mockReturnValue(graph);
      vi.mocked(taskGraphs.getNextReadyNode).mockReturnValue(graph.nodes[0]);
      vi.mocked(taskGraphs.updateNodeStatus).mockImplementation((nodeId: string, status) => {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) throw new Error(`missing node ${nodeId}`);
        node.status = status;
        return node;
      });

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-parse HEAD') return 'anchor-sha-123';
        if (cmd === 'git status --porcelain') return ' M a.ts';
        if (cmd === 'git add -A') return '';
        if (cmd.startsWith('git commit --no-verify')) return '';
        if (cmd.startsWith('git diff anchor-sha-123..HEAD')) return 'diff --git a/file.ts\n+code';
        return '';
      });

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger('exit', 'proc-1', 0);
      await mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_FAILED_JSON));
      const verifyExit = mock.trigger('exit', 'proc-2', 0);
      await vi.advanceTimersByTimeAsync(0);
      await verifyExit;

      const context = requireContext(pipeline);
      expect(context.nodeVerificationRetries).toBe(1);
      expect(context.retryTimer).not.toBeNull();
      // Node-verification feedback now rides the carried execute outcome (asserted
      // at the unit level in execution-phases.test.ts), not context.stabilizationFeedback.
      expect(taskGraphs.updateNodeStatus).toHaveBeenLastCalledWith('node-1', 'ready');

      await vi.advanceTimersByTimeAsync(1000);
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing');
    });

    it('does not verify a completed node when execution is cancelled before provider exit settles', async () => {
      const graph = makeTaskGraph();
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.getByPlanId).mockReturnValue(graph);
      vi.mocked(taskGraphs.getNextReadyNode).mockReturnValue(graph.nodes[0]);
      vi.mocked(taskGraphs.updateNodeStatus).mockImplementation((nodeId: string, status) => {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) throw new Error(`missing node ${nodeId}`);
        node.status = status;
        return node;
      });
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-parse HEAD') return 'anchor-sha-123';
        return '';
      });

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      requireContext(pipeline).cancelled = true;
      await mock.trigger('exit', 'proc-1', 0);
      await flush();

      expect(taskGraphs.markNodeCompletedAndPromote).not.toHaveBeenCalled();
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(1);
    });

    it('replaces an existing node retry timer and skips retry execution after cancellation', async () => {
      useRetryFakeTimers();
      const graph = makeTaskGraph();
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.getByPlanId).mockReturnValue(graph);
      vi.mocked(taskGraphs.getNextReadyNode).mockReturnValue(graph.nodes[0]);
      vi.mocked(taskGraphs.updateNodeStatus).mockImplementation((nodeId: string, status) => {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) throw new Error(`missing node ${nodeId}`);
        node.status = status;
        return node;
      });

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-parse HEAD') return 'anchor-sha-123';
        if (cmd === 'git status --porcelain') return ' M a.ts';
        if (cmd === 'git add -A') return '';
        if (cmd.startsWith('git commit --no-verify')) return '';
        if (cmd.startsWith('git diff anchor-sha-123..HEAD')) return 'diff --git a/file.ts\n+code';
        return '';
      });

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
      });
      const context = requireContext(pipeline);
      context.retryTimer = setTimeout(() => {
        throw new Error('stale retry timer fired');
      }, 1_000);

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger('exit', 'proc-1', 0);
      await mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_FAILED_JSON));
      const verifyExit = mock.trigger('exit', 'proc-2', 0);
      await vi.advanceTimersByTimeAsync(0);
      await verifyExit;

      context.cancelled = true;
      await vi.advanceTimersByTimeAsync(1_000);

      expect(context.nodeVerificationRetries).toBe(1);
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(2);
    });

    it('continues when direct task graph completion status persistence fails', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return 'some diff output';
        if (cmd.startsWith('git status')) return '';
        return '';
      });
      const graph = {
        ...makeTaskGraph(),
        mode: 'direct',
        status: 'active',
        assessment: {
          mode: 'direct',
          shouldDecompose: false,
          riskScore: 0.1,
          reasons: ['direct'],
          suggestedNodeCount: 1,
          surfaces: ['frontend'],
        } satisfies TaskGraphAssessment,
        nodes: [makeTaskGraph().nodes[0]],
        edges: [],
      } satisfies TaskGraphWithNodes;
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.getByPlanId).mockReturnValue(graph);
      vi.mocked(taskGraphs.updateGraphStatus).mockImplementation(() => {
        throw new Error('graph db offline');
      });

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
        autonomous: true,
        forkPointSha: 'abc123',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger('exit', 'proc-1', 0);
      await flush();

      expect(taskGraphs.updateGraphStatus).toHaveBeenCalledWith('graph-1', 'completed');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'verifying');
    });

    it('continues failure handling when direct task graph failure status persistence fails', async () => {
      const graph = {
        ...makeTaskGraph(),
        mode: 'direct',
        status: 'active',
        assessment: {
          mode: 'direct',
          shouldDecompose: false,
          riskScore: 0.1,
          reasons: ['direct'],
          suggestedNodeCount: 1,
          surfaces: ['frontend'],
        } satisfies TaskGraphAssessment,
        nodes: [makeTaskGraph().nodes[0]],
        edges: [],
      } satisfies TaskGraphWithNodes;
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.getByPlanId).mockReturnValue(graph);
      vi.mocked(taskGraphs.updateGraphStatus).mockImplementation(() => {
        throw new Error('graph db offline');
      });

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger('output', 'proc-1', 'executor failed');
      await mock.trigger('exit', 'proc-1', 1);

      expect(taskGraphs.updateGraphStatus).toHaveBeenCalledWith('graph-1', 'failed');
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Execution failed (exit 1): executor failed',
      );
    });

    it('empty node diff exhausts retry budget and marks node failed (no infinite loop)', async () => {
      // Regression: verifyNodeCompletion returned 'retry' on the empty-diff path
      // without checking MAX_NODE_VERIFICATION_RETRIES, causing an unbounded loop.
      const graph = makeTaskGraph();
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.getByPlanId).mockImplementation(() => graph);
      vi.mocked(taskGraphs.getNextReadyNode).mockImplementation(
        () => graph.nodes.find((n) => n.status === 'ready') ?? null,
      );
      vi.mocked(taskGraphs.updateNodeStatus).mockImplementation((nodeId: string, status) => {
        const node = graph.nodes.find((n) => n.id === nodeId);
        if (!node) throw new Error(`missing node ${nodeId}`);
        node.status = status;
        return node;
      });
      vi.mocked(taskGraphs.markNodeFailed).mockImplementation(() => graph);

      // Git diff always returns empty string — triggers the no-diff retry path
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-parse HEAD') return 'anchor-sha-123';
        if (cmd === 'git status --porcelain') return ' M a.ts';
        if (cmd === 'git add -A') return '';
        if (cmd.startsWith('git commit --no-verify')) return '';
        if (cmd.startsWith('git diff')) return ''; // empty → 'retry' in verifyNodeCompletion
        return '';
      });

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
      });

      // Pre-exhaust the budget so the very first retry triggers the ceiling
      requireContext(pipeline).nodeVerificationRetries = MAX_NODE_VERIFICATION_RETRIES;

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger('exit', 'proc-1', 0);
      await flush();

      // Budget was at ceiling → no retry scheduled, node marked failed immediately
      expect(taskGraphs.markNodeFailed).toHaveBeenCalledWith('node-1');
      expect(pipeline.getContext('t1')).toBeUndefined();
      // Only 1 spawn: the execute. Verify is never spawned (diff empty, budget hit first).
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(1);
    });

    it('verifier provider exception exhausts retry budget and marks node failed', async () => {
      // Regression: catch path in verifyNodeCompletion returned 'retry' without checking
      // MAX_NODE_VERIFICATION_RETRIES, same unbounded loop risk as the empty-diff path.
      const graph = makeTaskGraph();
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.getByPlanId).mockImplementation(() => graph);
      vi.mocked(taskGraphs.getNextReadyNode).mockImplementation(
        () => graph.nodes.find((n) => n.status === 'ready') ?? null,
      );
      vi.mocked(taskGraphs.updateNodeStatus).mockImplementation((nodeId: string, status) => {
        const node = graph.nodes.find((n) => n.id === nodeId);
        if (!node) throw new Error(`missing node ${nodeId}`);
        node.status = status;
        return node;
      });
      vi.mocked(taskGraphs.markNodeFailed).mockImplementation(() => graph);

      // Non-empty diff so we reach runProviderPhase; 2nd spawn (verify) throws
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-parse HEAD') return 'anchor-sha-123';
        if (cmd === 'git status --porcelain') return ' M a.ts';
        if (cmd === 'git add -A') return '';
        if (cmd.startsWith('git commit --no-verify')) return '';
        if (cmd.startsWith('git diff anchor-sha-123..HEAD')) return 'diff --git a/file.ts\n+code';
        return '';
      });

      const spawnMock = vi.mocked(mock.deps.processManager.spawn);
      spawnMock
        // execute — normal (id must match mock.trigger('exit', 'proc-1', 0) below)
        .mockImplementationOnce(() => ({ id: 'proc-1' }) as never)
        .mockImplementationOnce(() => {
          throw new Error('provider unavailable'); // verify — throws → caught → 'retry'
        });

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
      });

      // Pre-exhaust the budget
      requireContext(pipeline).nodeVerificationRetries = MAX_NODE_VERIFICATION_RETRIES;

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger('exit', 'proc-1', 0);
      await flush();

      // Provider threw → catch returns 'retry' → budget ceiling → mark failed
      expect(taskGraphs.markNodeFailed).toHaveBeenCalledWith('node-1');
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('marks a task graph node completed when node verification passes', async () => {
      const graph = makeTaskGraph();
      const taskGraphs = mock.deps.taskGraphs;
      if (!taskGraphs) throw new Error('Expected task graph deps');
      vi.mocked(taskGraphs.getByPlanId).mockImplementation(() => graph);
      vi.mocked(taskGraphs.getNextReadyNode).mockImplementation(
        () => graph.nodes.find((n) => n.status === 'ready') ?? null,
      );
      vi.mocked(taskGraphs.updateNodeStatus).mockImplementation((nodeId: string, status) => {
        const node = graph.nodes.find((n) => n.id === nodeId);
        if (!node) throw new Error(`missing node ${nodeId}`);
        node.status = status;
        return node;
      });
      vi.mocked(taskGraphs.markNodeCompletedAndPromote).mockImplementation((nodeId: string) => {
        const node = graph.nodes.find((n) => n.id === nodeId);
        if (!node) throw new Error(`missing node ${nodeId}`);
        node.status = 'completed';
        graph.nodes[1].status = 'ready';
        return graph;
      });

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-parse HEAD') return 'anchor-sha-123';
        if (cmd === 'git status --porcelain') return ' M a.ts';
        if (cmd === 'git add -A') return '';
        if (cmd.startsWith('git commit --no-verify')) return '';
        if (cmd.startsWith('git diff anchor-sha-123..HEAD')) return 'diff --git a/file.ts\n+code';
        return '';
      });

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger('exit', 'proc-1', 0);
      await flush();
      await mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_PASSED_JSON));
      await mock.trigger('exit', 'proc-2', 0);
      await flush();

      expect(taskGraphs.markNodeCompletedAndPromote).toHaveBeenCalledWith('node-1');
      expect(taskGraphs.updateNodeStatus).toHaveBeenCalledWith('node-1', 'running');
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(3);
    });

    it('exit non-zero → emits failed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      await mock.trigger('exit', 'proc-2', 1);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.any(String),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('manual execution fails when the executor exits successfully without changes', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git status --porcelain') return '';
        if (cmd.startsWith('git diff')) return '';
        if (cmd.startsWith('git rev-parse')) return 'abc123';
        return '';
      });
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        autonomous: false,
        baseBranch: 'main',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger(
        'output',
        'proc-1',
        '{"type":"result","is_error":true,"result":"No edits needed"}',
      );
      await mock.trigger('exit', 'proc-1', 0);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Executor exited successfully but produced no code changes: No edits needed',
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('reports execution provider errors from the async execution body', async () => {
      const provider: AgentProvider = {
        id: 'claude-cli',
        supports: new Set(['execute']),
        generate: vi.fn(async () => {
          throw new Error('provider failed');
        }),
        healthCheck: vi.fn(async () => ({ ok: true })),
      };
      const deps = {
        ...mock.deps,
        providers: {
          for: vi.fn(() => provider),
        },
      } as unknown as PipelineDeps;
      const pipeline = createPipeline(deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Execution error: Error: provider failed',
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
      await flush();

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
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('Setup failed: required env file missing: .env.local'),
      );
      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
    });

    it('uses executor model override as modelHint and keeps the provider selection on the executor provider', async () => {
      const projectDir = makeTempProject();
      const worktreeDir = path.join(projectDir, 'worktree');
      mkdirSync(worktreeDir, { recursive: true });
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
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'git status --porcelain') return ' M a.ts';
        return '';
      });
      const pipeline = createPipeline(deps);

      pipeline.initializeContext('t1', {
        projectPath: projectDir,
        worktreePath: worktreeDir,
        executorModel: 'openrouter',
        executorModelOverride: 'openrouter/auto',
        executorReasoningEffort: 'low',
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      expect(openrouterGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'execute',
          cwd: worktreeDir,
          modelHint: 'openrouter/auto',
          phaseHints: expect.objectContaining({ reasoningEffort: 'low' }),
        }),
      );
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'completed');
    });

    it('feeds structured verification failures back into the next execution prompt', async () => {
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        baseBranch: 'main',
      });
      vi.mocked(mock.deps.verifications.getLatest).mockReturnValue(makeVerificationRecord());

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();

      const executeCall = vi.mocked(mock.deps.processManager.spawn).mock.calls[0];
      expect(executeCall[2][1]).toContain('<previous_verification_failure>');
      expect(executeCall[2][1]).toContain('Summary: Not OK');
      expect(executeCall[2][1]).toContain('[blocker] broke');
    });

    it.skip('keeps successful test output in the verification prompt after autonomous execution', async () => {
      const projectDir = makeTempProject();
      vi.mocked(mock.deps.settings.get).mockReturnValue({
        ...TEST_DEFAULT_SETTINGS,
        testCommand: `printf 'typecheck ok\\ntests ok\\n'`,
      });
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return 'M tested.ts';
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
      await flush();
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

    it('fails when the pre-verification commit step throws', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).forkPointSha = 'abc123';

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git status')) return 'M dirty.ts';
        if (cmd.startsWith('git add')) throw new Error('git add failed');
        return '';
      });

      await pipeline.startVerification('t1');

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Pre-verification commit failed: git add failed',
      );
      expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(1);
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('treats diff command failures as an empty diff', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).forkPointSha = 'abc123';

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git status')) return '';
        if (cmd.startsWith('git rev-parse')) return 'headsha123';
        if (cmd.startsWith('git diff')) throw new Error('diff failed');
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
        expect.stringContaining('Verification skipped'),
      );
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
      useRetryFakeTimers();
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
      const exitP = mock.trigger('exit', 'proc-2', 0);
      await vi.advanceTimersByTimeAsync(0);
      await exitP;

      // Retry is scheduled via continuation delay (1s), not immediate
      expect(mock.deps.verifications.create).toHaveBeenCalled();
      expect(pipeline.getContext('t1')?.retryTimer).not.toBeNull();
      expect(pipeline.getContext('t1')?.verificationRetries).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing');
    });

    it('replaces an existing verification retry timer before scheduling execution retry', async () => {
      useRetryFakeTimers();
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.verificationRetries = 0;
      context.retryTimer = setTimeout(() => {}, 10_000);

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        if (cmd.startsWith('git rev-parse')) return 'headsha123';
        return '';
      });

      await pipeline.startVerification('t1');
      await mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_FAILED_JSON));
      const exitP = mock.trigger('exit', 'proc-2', 0);
      await vi.advanceTimersByTimeAsync(0);
      await exitP;

      expect(clearSpy).toHaveBeenCalled();
      expect(context.retryTimer).not.toBeNull();
    });

    it('persists feature QA flow results emitted by the verifier', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.featureQaState = {
        featureId: 'issue-42',
        routes: [],
        criticalFlows: [],
        expectedStates: [],
        testDataAssumptions: [],
        selectorReadiness: 'ready',
      };

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        if (cmd.startsWith('git rev-parse')) return 'headsha123';
        if (cmd.startsWith('git log')) return 'commit ahead';
        return '';
      });

      await pipeline.startVerification('t1');
      await mock.trigger(
        'output',
        'proc-2',
        `${verificationBlock(VERIFICATION_PASSED_JSON)}\n<qa_results>${JSON.stringify([
          { flowName: 'checkout-flow', passed: true, evidencePaths: ['qa/pass.png'] },
        ])}</qa_results>`,
      );
      await mock.trigger('exit', 'proc-2', 0);
      await flush();

      expect(mock.deps.featureQaResults?.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 't1',
          featureId: 'issue-42',
          status: 'passed',
          summary: 'OK',
          evidencePaths: ['qa/pass.png'],
        }),
      );
    });

    it('continues when verifier feature QA persistence fails', async () => {
      const featureQaResults = mock.deps.featureQaResults;
      if (!featureQaResults) throw new Error('Expected feature QA deps');
      vi.mocked(featureQaResults.insert).mockImplementation(() => {
        throw new Error('qa db offline');
      });
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.featureQaState = {
        featureId: 'issue-42',
        routes: [],
        criticalFlows: [],
        expectedStates: [],
        testDataAssumptions: [],
        selectorReadiness: 'ready',
      };

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        if (cmd.startsWith('git rev-parse')) return 'headsha123';
        if (cmd.startsWith('git log')) return 'commit ahead';
        return '';
      });

      await pipeline.startVerification('t1');
      await mock.trigger(
        'output',
        'proc-2',
        `${verificationBlock(VERIFICATION_PASSED_JSON)}\n<qa_results>${JSON.stringify([
          { flowName: 'checkout-flow', passed: true },
        ])}</qa_results>`,
      );
      await mock.trigger('exit', 'proc-2', 0);
      await flush();

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'shipping');
    });

    it('reports verifier provider errors', async () => {
      const provider: AgentProvider = {
        id: 'claude-cli',
        supports: new Set(['verify']),
        generate: vi.fn(async () => {
          throw new Error('verifier failed');
        }),
        healthCheck: vi.fn(async () => ({ ok: true })),
      };
      const deps = {
        ...mock.deps,
        providers: {
          for: vi.fn(() => provider),
        },
      } as unknown as PipelineDeps;
      const pipeline = createPipeline(deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        forkPointSha: 'abc123',
      });

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse --verify')) return 'abc123';
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        return '';
      });

      await pipeline.startVerification('t1');
      await flush();

      expect(deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Verification error: verifier failed',
      );
    });

    it('fails verification when WORKFLOW.md verify template cannot render', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.workflowPolicy = {
        ...context.workflowPolicy,
        promptTemplate: '{{ issue.titel }}',
      };

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse --verify')) return 'abc123';
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        return '';
      });

      await pipeline.startVerification('t1');

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('WORKFLOW.md template render error:'),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('dirty worktree is auto-committed before verification, then fails when retries are exhausted', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.verificationRetries = MAX_VERIFICATION_RETRIES;
      context.workflowPolicy.agent.maxTurns = 1;

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

    it('verification failed + retries left → schedules continuation retry then starts execution', async () => {
      useRetryFakeTimers();
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.verificationRetries = 0;

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse --verify')) return 'abc123';
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        return '';
      });

      await pipeline.startVerification('t1');

      await mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_FAILED_JSON));
      const exitP = mock.trigger('exit', 'proc-2', 0);
      await vi.advanceTimersByTimeAsync(0);
      await exitP;

      // Retry scheduled but not yet fired
      expect(pipeline.getContext('t1')?.retryTimer).not.toBeNull();
      expect(pipeline.getContext('t1')?.verificationRetries).toBe(1);

      // Advance past continuation delay (1s)
      await vi.advanceTimersByTimeAsync(1000);

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing');
    });

    it('does not persist verifier output after a run is marked cancelled', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse --verify')) return 'abc123';
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        return '';
      });

      await pipeline.startVerification('t1');
      context.cancelled = true;
      await mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_PASSED_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.verifications.create).not.toHaveBeenCalled();
      expect(mock.deps.threads.updateStatus).not.toHaveBeenCalledWith('t1', 'shipping');
    });

    it('verification failed + no retries → emits failed', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.verificationRetries = MAX_VERIFICATION_RETRIES;
      context.workflowPolicy.agent.maxTurns = 1;

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse --verify')) return 'abc123';
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

    it('cancel clears pending verification retry timer', async () => {
      useRetryFakeTimers();
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.verificationRetries = 0;

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse --verify')) return 'abc123';
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        return '';
      });

      await pipeline.startVerification('t1');

      await mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_FAILED_JSON));
      const exitP = mock.trigger('exit', 'proc-2', 0);
      await vi.advanceTimersByTimeAsync(0);
      await exitP;

      expect(pipeline.getContext('t1')?.retryTimer).not.toBeNull();

      pipeline.cancel('t1');
      await vi.advanceTimersByTimeAsync(1000);

      // Should NOT have re-entered execution after cancel
      expect(mock.deps.threads.updateStatus).not.toHaveBeenCalledWith('t1', 'executing');
    });
  });

  describe('shared test failure ledger', () => {
    const failingCommand =
      "node -e \"console.error('FAIL packages/foo.test.ts'); console.error('AssertionError: expected true to be false'); process.exit(1)\"";

    it.skip('claims a new test failure and schedules one focused test-fix pass', async () => {
      useRetryFakeTimers();
      const pipeline = createPipeline(mock.deps);
      seedVerifyCommandContext(pipeline, failingCommand);

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger('output', 'proc-1', 'execution done');
      await mock.trigger('exit', 'proc-1', 0);
      await mock.trigger('output', 'proc-2', 'FAIL packages/foo.test.ts\n');
      const exitP = mock.trigger('exit', 'proc-2', 1);
      await vi.advanceTimersByTimeAsync(0);
      await exitP;

      expect(mock.deps.projectFailures?.claimOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-1',
          baseBranch: 'main',
          threadId: 't1',
          command: failingCommand,
          summary: expect.stringContaining('FAIL packages/foo.test.ts'),
          implicatedFiles: ['packages/foo.test.ts'],
        }),
      );
      expect(pipeline.getContext('t1')?.retryTimer).not.toBeNull();

      await vi.advanceTimersByTimeAsync(1000);
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing');
    });

    it.skip('blocks duplicate fixes when another thread owns the same test failure', async () => {
      const projectFailures = mock.deps.projectFailures;
      if (!projectFailures) throw new Error('Expected project failure deps');
      vi.mocked(projectFailures.claimOrCreate).mockReturnValueOnce({
        id: 'failure-1',
        projectId: 'project-1',
        baseBranch: 'main',
        fingerprint: 'fp-1',
        status: 'in_progress',
        ownerThreadId: 'owner-thread',
        firstSeenThreadId: 'owner-thread',
        seenThreadIds: ['owner-thread', 't1'],
        command: failingCommand,
        summary: 'FAIL packages/foo.test.ts',
        outputExcerpt: '',
        implicatedFiles: ['packages/foo.test.ts'],
        resolvedByThreadId: null,
        resolvedCommitSha: null,
        resolvedAt: null,
        createdAt: '',
        updatedAt: '',
      });
      const pipeline = createPipeline(mock.deps);
      seedVerifyCommandContext(pipeline, failingCommand);

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger('output', 'proc-1', 'execution done');
      await mock.trigger('exit', 'proc-1', 0);
      await mock.trigger('output', 'proc-2', 'FAIL packages/foo.test.ts\n');
      await mock.trigger('exit', 'proc-2', 1);
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('already being fixed by owner-thread'),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it.skip('blocks when the same shared test failure was already resolved elsewhere', async () => {
      const projectFailures = mock.deps.projectFailures;
      if (!projectFailures) throw new Error('Expected project failure deps');
      vi.mocked(projectFailures.claimOrCreate).mockReturnValueOnce({
        id: 'failure-1',
        projectId: 'project-1',
        baseBranch: 'main',
        fingerprint: 'fp-1',
        status: 'resolved',
        ownerThreadId: 'owner-thread',
        firstSeenThreadId: 'owner-thread',
        seenThreadIds: ['owner-thread', 't1'],
        command: failingCommand,
        summary: 'FAIL packages/foo.test.ts',
        outputExcerpt: '',
        implicatedFiles: ['packages/foo.test.ts'],
        resolvedByThreadId: 'owner-thread',
        resolvedCommitSha: 'resolvedsha1234567890',
        resolvedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const pipeline = createPipeline(mock.deps);
      seedVerifyCommandContext(pipeline, failingCommand);

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger('output', 'proc-1', 'execution done');
      await mock.trigger('exit', 'proc-1', 0);
      await mock.trigger('output', 'proc-2', 'FAIL packages/foo.test.ts\n');
      await mock.trigger('exit', 'proc-2', 1);
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('already resolved by owner-thread at resolvedsha1'),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it.skip('marks owned shared failures resolved after tests pass and verification commits', async () => {
      const passingCommand = 'node -e "process.exit(0)"';
      const pipeline = createPipeline(mock.deps);
      const context = seedVerifyCommandContext(pipeline, passingCommand);
      context.forkPointSha = 'abc123';
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return 'M fixed.ts';
        if (cmd.startsWith('git rev-parse HEAD')) return 'resolvedsha123';
        if (cmd.startsWith('git rev-parse')) return 'ship/test';
        return '';
      });

      await pipeline.startExecution('t1', JSON.parse(PLAN_JSON));
      await flush();
      await mock.trigger('output', 'proc-1', 'execution done');
      await mock.trigger('exit', 'proc-1', 0);
      await mock.trigger('exit', 'proc-2', 0);
      await flush();

      expect(mock.deps.projectFailures?.resolveOwnedByThread).toHaveBeenCalledWith(
        't1',
        'resolvedsha123',
      );
    });

    it('parse failure creates an unstructured verification and fails', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).forkPointSha = 'abc123';

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        if (cmd.startsWith('git rev-parse')) return 'headsha123';
        return '';
      });

      await pipeline.startVerification('t1');
      await mock.trigger('output', 'proc-2', 'verifier did not emit a block');
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.deps.verifications.create).toHaveBeenCalledWith(
        't1',
        'plan-1',
        'verifier did not emit a block',
        null,
      );
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Verification output could not be parsed — verifier did not emit a shipcode-verify block.',
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });
  });

  describe('runtime QA', () => {
    it('startTesting no-ops without active context', async () => {
      const pipeline = createPipeline(mock.deps);

      await pipeline.startTesting('t1');

      expect(mock.deps.processManager.spawnWithStdin).not.toHaveBeenCalled();
      expect(mock.deps.threads.updateStatus).not.toHaveBeenCalledWith('t1', 'testing');
    });

    it('defers local verification while CPU task slots are busy', async () => {
      useRetryFakeTimers();
      vi.mocked(mock.deps.settings.get).mockReturnValue({
        ...TEST_DEFAULT_SETTINGS,
        maxConcurrentCpuTasks: 1,
      });
      let cpuReady = false;
      mock.deps.cpuTaskGate = {
        canStartCpuTask: vi.fn(() =>
          cpuReady ? { allowed: true } : { allowed: false, reason: 'CPU load high' },
        ),
        retryDelayMs: 5000,
      } as never;
      const pipeline = createPipeline(mock.deps);
      seedVerifyCommandContext(pipeline, 'node -e "process.exit(0)"');

      await pipeline.startTesting('t1');

      const context = requireContext(pipeline);
      expect(context.cpuQueueStartedAt).not.toBeNull();
      expect(context.cpuQueueLastNotifiedAt).not.toBeNull();
      expect(context.retryTimer).not.toBeNull();
      expect(mock.deps.processManager.spawnWithStdin).not.toHaveBeenCalledWith(
        'shell',
        expect.any(String),
        expect.arrayContaining(['node -e "process.exit(0)"']),
        expect.any(String),
        '',
        't1',
        expect.any(Object),
      );

      cpuReady = true;
      await vi.advanceTimersByTimeAsync(5000);
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'testing');
    });

    it('defers local verification when another thread occupies the only CPU slot', async () => {
      useRetryFakeTimers();
      vi.mocked(mock.deps.settings.get).mockReturnValue({
        ...TEST_DEFAULT_SETTINGS,
        maxConcurrentCpuTasks: 1,
      });
      let otherThreadStatus = 'testing';
      vi.mocked(mock.deps.threads.getById).mockImplementation((id: string) =>
        id === 'other-thread'
          ? ({ id, projectId: 'project-1', status: otherThreadStatus } as never)
          : ({ id, projectId: 'project-1', status: 'approval' } as never),
      );
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('other-thread', {
        projectPath: '/proj',
        worktreePath: '/other-worktree',
        projectId: 'project-1',
      });
      const context = seedVerifyCommandContext(pipeline, 'node -e "process.exit(0)"');
      context.retryTimer = setTimeout(() => undefined, 1);

      await pipeline.startTesting('t1');

      expect(context.retryTimer).not.toBeNull();
      expect(mock.deps.threads.updateStatus).not.toHaveBeenCalledWith('t1', 'testing');

      otherThreadStatus = 'completed';
      await vi.advanceTimersByTimeAsync(5000);

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'testing');
    });

    it('fails verification preflight when setup-before-verify commands fail', async () => {
      const pipeline = createPipeline(mock.deps);
      const context = seedVerifyCommandContext(pipeline, 'node -e "process.exit(0)"');
      const repoSetupContract = context.repoSetupContract;
      if (!repoSetupContract) throw new Error('Expected repo setup contract');
      context.repoSetupContract = {
        ...repoSetupContract,
        contract: {
          ...repoSetupContract.contract,
          setupCommands: ['setup-fails'],
          setupBeforeVerify: true,
        },
      };

      const testing = pipeline.startTesting('t1');
      await flush();
      await mock.trigger('output', 'proc-1', 'setup failed\n');
      await mock.trigger('exit', 'proc-1', 1);
      await testing;

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Verification preflight failed: command failed (1): setup-fails — setup failed',
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('fails testing when repo setup contract loading throws', async () => {
      const projectDir = makeTempProject();
      writeFileSync(path.join(projectDir, '.shipcode', 'setup.json'), '{');
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: projectDir,
        worktreePath: projectDir,
        autonomous: true,
      });

      await pipeline.startTesting('t1');

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('Invalid repo setup contract'),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('routes a scheduled test fix failure when the structured plan is missing', async () => {
      useRetryFakeTimers();
      vi.mocked(mock.deps.plans.getLatest).mockReturnValue(makePlanRecord({ structured: null }));
      const pipeline = createPipeline(mock.deps);
      seedVerifyCommandContext(pipeline, 'FAIL packages/foo.test.ts');

      await pipeline.startTesting('t1');
      await mock.trigger('output', 'proc-1', 'FAIL packages/foo.test.ts\n');
      const exitP = mock.trigger('exit', 'proc-1', 1);
      await vi.advanceTimersByTimeAsync(0);
      await exitP;

      await vi.advanceTimersByTimeAsync(1000);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Test fix cannot start: structured plan missing for this thread.',
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('schedules a local test-fix retry without the shared failure ledger and cancels before retry', async () => {
      useRetryFakeTimers();
      const pipeline = createPipeline(mock.deps);
      const context = seedVerifyCommandContext(pipeline, 'FAIL packages/foo.test.ts');
      delete (context as unknown as { projectId?: string }).projectId;
      context.retryTimer = setTimeout(() => undefined, 1);

      await pipeline.startTesting('t1');
      await mock.trigger('output', 'proc-1', 'FAIL packages/foo.test.ts\n');
      const exitP = mock.trigger('exit', 'proc-1', 1);
      await vi.advanceTimersByTimeAsync(0);
      await exitP;

      expect(mock.deps.projectFailures?.claimOrCreate).not.toHaveBeenCalled();
      expect(context.retryTimer).not.toBeNull();

      context.cancelled = true;
      await vi.advanceTimersByTimeAsync(1000);

      expect(mock.deps.threads.updateStatus).not.toHaveBeenCalledWith('t1', 'executing');
    });

    it('blocks a duplicate test fix when the shared failure is already resolved', async () => {
      const projectFailures = mock.deps.projectFailures;
      if (!projectFailures) throw new Error('Expected project failure deps');
      vi.mocked(projectFailures.claimOrCreate).mockReturnValueOnce({
        id: 'failure-1',
        projectId: 'project-1',
        baseBranch: 'main',
        fingerprint: 'fingerprint-1',
        status: 'resolved',
        ownerThreadId: 'owner-thread',
        firstSeenThreadId: 'owner-thread',
        seenThreadIds: ['owner-thread', 't1'],
        command: 'bun test',
        summary: 'Tests failed',
        outputExcerpt: '',
        implicatedFiles: [],
        resolvedByThreadId: 'owner-thread',
        resolvedCommitSha: 'abcdef1234567890',
        resolvedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const pipeline = createPipeline(mock.deps);
      seedVerifyCommandContext(pipeline, 'FAIL packages/foo.test.ts');

      await pipeline.startTesting('t1');
      await mock.trigger('output', 'proc-1', 'FAIL packages/foo.test.ts\n');
      await mock.trigger('exit', 'proc-1', 1);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Shared test failure already resolved by owner-thread at abcdef123456. Rebase or cherry-pick that fix before retrying this worktree.',
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('blocks a duplicate test fix when another thread owns the shared failure', async () => {
      const projectFailures = mock.deps.projectFailures;
      if (!projectFailures) throw new Error('Expected project failure deps');
      vi.mocked(projectFailures.claimOrCreate).mockReturnValueOnce({
        id: 'failure-1',
        projectId: 'project-1',
        baseBranch: 'main',
        fingerprint: 'fingerprint-1',
        status: 'in_progress',
        ownerThreadId: 'owner-thread',
        firstSeenThreadId: 'owner-thread',
        seenThreadIds: ['owner-thread', 't1'],
        command: 'bun test',
        summary: 'Tests failed',
        outputExcerpt: '',
        implicatedFiles: [],
        resolvedByThreadId: null,
        resolvedCommitSha: null,
        resolvedAt: null,
        createdAt: '',
        updatedAt: '',
      });
      const pipeline = createPipeline(mock.deps);
      seedVerifyCommandContext(pipeline, 'FAIL packages/foo.test.ts');

      await pipeline.startTesting('t1');
      await mock.trigger('output', 'proc-1', 'FAIL packages/foo.test.ts\n');
      await mock.trigger('exit', 'proc-1', 1);

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Shared test failure is already being fixed by owner-thread. This worktree is blocked to avoid a duplicate fix and merge conflict.',
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('emits an exhausted static verification failure at the test retry ceiling', async () => {
      const pipeline = createPipeline(mock.deps);
      const context = seedVerifyCommandContext(pipeline, 'FAIL packages/foo.test.ts');
      context.testRetries = MAX_TEST_RETRIES;

      await pipeline.startTesting('t1');
      await mock.trigger('output', 'proc-1', 'FAIL packages/foo.test.ts\n');
      await mock.trigger('exit', 'proc-1', 1);

      expect(mock.emittedEvents).toContainEqual(
        expect.objectContaining({
          type: 'pipeline:verification-exhausted',
          threadId: 't1',
          retries: MAX_TEST_RETRIES,
          testSummary: 'FAIL packages/foo.test.ts',
        }),
      );
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        `Test fix exhausted after ${MAX_TEST_RETRIES + 1} attempt(s): FAIL packages/foo.test.ts`,
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('fails static verification command spawn errors', async () => {
      const pipeline = createPipeline(mock.deps);
      seedVerifyCommandContext(pipeline, 'node -e "throw new Error()"');
      vi.mocked(mock.deps.processManager.spawnWithStdin).mockImplementationOnce(() => {
        throw new Error('shell spawn failed');
      });

      await pipeline.startTesting('t1');
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Verification command error: shell spawn failed',
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('runs runtime QA commands and continues to verification on success', async () => {
      const pipeline = createPipeline(mock.deps);
      const context = pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        autonomous: true,
      });
      context.repoSetupLoaded = true;
      context.repoSetupContract = {
        path: '/proj/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
          runtimeQa: {
            testCommands: ['node -e "process.exit(0)"'],
            discoverAgentTests: false,
          },
        },
      };

      await pipeline.startTesting('t1');
      await mock.trigger('exit', 'proc-1', 0);
      await flush();

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'testing');
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'verifying');
      expect(context.runtimeQaCleanup).toBeNull();
    });

    it('fails runtime QA command errors as fatal verification failures', async () => {
      const pipeline = createPipeline(mock.deps);
      const context = pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        autonomous: true,
      });
      context.repoSetupLoaded = true;
      context.repoSetupContract = {
        path: '/proj/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
          runtimeQa: {
            testCommands: ['node -e "throw new Error()"'],
            discoverAgentTests: false,
          },
        },
      };
      vi.mocked(mock.deps.processManager.spawnWithStdin).mockImplementationOnce(() => {
        throw new Error('spawn failed');
      });

      await pipeline.startTesting('t1');
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('Runtime QA command error: spawn failed'),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('fails visual QA when selector readiness is not ready and retry budget is exhausted', async () => {
      const pipeline = createPipeline(mock.deps);
      const context = pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        autonomous: true,
        projectId: null,
      });
      context.testRetries = MAX_TEST_RETRIES;
      context.repoSetupLoaded = true;
      context.repoSetupContract = {
        path: '/proj/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
        },
      };
      context.featureQaState = {
        featureId: 'issue-42',
        routes: ['/dashboard'],
        criticalFlows: [],
        expectedStates: [],
        testDataAssumptions: [],
        selectorReadiness: 'missing',
        visualAssertions: [
          {
            name: 'button visible',
            route: '/dashboard',
            targetSelector: '[data-testid="create-button"]',
            assertion: 'visible',
          },
        ],
      };

      await pipeline.startTesting('t1');

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('Visual QA requires stable selectors'),
      );
      expect(mock.deps.processManager.spawnWithStdin).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('schedules a test-fix retry when visual QA selectors are not ready and retry budget remains', async () => {
      useRetryFakeTimers();
      const pipeline = createPipeline(mock.deps);
      const context = pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        autonomous: true,
      });
      context.repoSetupLoaded = true;
      context.repoSetupContract = {
        path: '/proj/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
        },
      };
      context.featureQaState = {
        featureId: 'issue-42',
        routes: ['/dashboard'],
        criticalFlows: [],
        expectedStates: [],
        testDataAssumptions: [],
        selectorReadiness: 'missing',
        visualAssertions: [
          {
            name: 'button visible',
            route: '/dashboard',
            targetSelector: '[data-testid="create-button"]',
            assertion: 'visible',
          },
        ],
      };

      await pipeline.startTesting('t1');
      await flush();

      expect(context.retryTimer).not.toBeNull();
      expect(mock.deps.threads.recordFailure).not.toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('Visual QA requires stable selectors'),
      );
      expect(pipeline.getContext('t1')).toBe(context);
    });

    it('fails visual QA when relative routes have no runtime server', async () => {
      const pipeline = createPipeline(mock.deps);
      const context = pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        autonomous: true,
      });
      context.repoSetupLoaded = true;
      context.repoSetupContract = {
        path: '/proj/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
          runtimeQa: { testCommands: [], discoverAgentTests: false },
        },
      };
      context.featureQaState = {
        featureId: 'issue-42',
        routes: ['/dashboard'],
        criticalFlows: [],
        expectedStates: [],
        testDataAssumptions: [],
        selectorReadiness: 'ready',
        visualAssertions: [
          {
            name: 'button visible',
            route: '/dashboard',
            targetSelector: '[data-testid="create-button"]',
            assertion: 'visible',
          },
        ],
      };

      await pipeline.startTesting('t1');

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('Visual QA uses relative routes'),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('generates visual QA runtime tests and runs the discovered runner', async () => {
      const projectDir = makeTempProject();
      const localPlaywright = path.join(projectDir, 'node_modules', '.bin', 'playwright');
      mkdirSync(path.dirname(localPlaywright), { recursive: true });
      writeFileSync(localPlaywright, '#!/usr/bin/env bash\nexit 0\n');
      chmodSync(localPlaywright, 0o755);

      const pipeline = createPipeline(mock.deps);
      const context = pipeline.initializeContext('t1', {
        projectPath: projectDir,
        worktreePath: projectDir,
        autonomous: true,
      });
      context.repoSetupLoaded = true;
      context.repoSetupContract = {
        path: path.join(projectDir, '.shipcode', 'setup.json'),
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
          runtimeQa: { testCommands: [], discoverAgentTests: true },
        },
      };
      context.featureQaState = {
        featureId: 'issue-42',
        routes: ['http://localhost:3000/dashboard'],
        criticalFlows: [],
        expectedStates: [],
        testDataAssumptions: [],
        selectorReadiness: 'ready',
        visualAssertions: [
          {
            name: 'button visible',
            route: 'http://localhost:3000/dashboard',
            targetSelector: 'data-testid=create-button',
            assertion: 'visible',
          },
        ],
      };

      const testing = pipeline.startTesting('t1');
      await flush();
      const runnerPath = path.join(
        projectDir,
        '.shipcode',
        'runtime-tests',
        'visual-qa.generated.test.sh',
      );
      expect(readFileSync(runnerPath, 'utf-8')).toContain('playwright test');
      await mock.trigger('exit', 'proc-1', 0);
      await testing;

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'verifying');
      expect(mock.deps.processManager.spawnWithStdin).toHaveBeenCalledWith(
        'shell',
        expect.any(String),
        expect.arrayContaining([expect.stringContaining('visual-qa.generated.test.sh')]),
        projectDir,
        '',
        't1',
        expect.any(Object),
      );
    });

    it('fails runtime QA server startup until server commands have a trust gate', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false })),
      );
      const pipeline = createPipeline(mock.deps);
      const context = pipeline.initializeContext('t1', {
        projectPath: '/proj',
        projectId: null,
        worktreePath: '/worktree',
        autonomous: true,
      });
      context.testRetries = MAX_TEST_RETRIES;
      context.repoSetupLoaded = true;
      context.repoSetupContract = {
        path: '/proj/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
          runtimeQa: {
            server: {
              command: 'npm run dev',
              readinessUrl: 'http://localhost:3000/health',
              portEnvVar: 'PORT',
              startupTimeoutMs: 1,
            },
            testCommands: ['runtime-qa-pass'],
            discoverAgentTests: false,
          },
        },
      };

      await pipeline.startTesting('t1');
      await flush();

      expect(mock.deps.processManager.spawnWithStdin).not.toHaveBeenCalledWith(
        'shell',
        expect.any(String),
        expect.any(Array),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Object),
      );
      expect(mock.deps.processManager.kill).not.toHaveBeenCalled();
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Runtime QA server startup is disabled until server commands have an explicit trust gate',
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('fails runtime QA server crash coverage at the trust gate before spawning', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          await mock.trigger('exit', 'proc-1', 1);
          return { ok: true };
        }),
      );
      const pipeline = createPipeline(mock.deps);
      const context = pipeline.initializeContext('t1', {
        projectPath: '/proj',
        projectId: null,
        worktreePath: '/worktree',
        autonomous: true,
      });
      context.testRetries = MAX_TEST_RETRIES;
      context.repoSetupLoaded = true;
      context.repoSetupContract = {
        path: '/proj/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
          runtimeQa: {
            server: {
              command: 'npm run dev',
              readinessUrl: 'http://localhost:3000/health',
              portEnvVar: 'PORT',
              startupTimeoutMs: 100,
            },
            testCommands: ['runtime-qa-pass'],
            discoverAgentTests: false,
          },
        },
      };

      await pipeline.startTesting('t1');
      await flush();

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Runtime QA server startup is disabled until server commands have an explicit trust gate',
      );
      expect(mock.deps.processManager.kill).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('persists passing runtime QA flow results before verification', async () => {
      const pipeline = createPipeline(mock.deps);
      const context = pipeline.initializeContext('t1', {
        projectPath: '/proj',
        projectId: null,
        worktreePath: '/worktree',
        autonomous: true,
      });
      context.repoSetupLoaded = true;
      context.repoSetupContract = {
        path: '/proj/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
          runtimeQa: {
            testCommands: ['runtime-qa-pass'],
            discoverAgentTests: false,
          },
        },
      };
      context.featureQaState = {
        featureId: 'issue-42',
        routes: [],
        criticalFlows: [],
        expectedStates: [],
        testDataAssumptions: [],
        selectorReadiness: 'ready',
      };

      const testing = pipeline.startTesting('t1');
      await flush();
      await mock.trigger(
        'output',
        'proc-1',
        `<qa_results>${JSON.stringify([
          { flowName: 'checkout-flow', passed: true, evidencePaths: ['qa/pass.png'] },
        ])}</qa_results>`,
      );
      await mock.trigger('exit', 'proc-1', 0);
      await testing;

      expect(mock.deps.featureQaResults?.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 't1',
          featureId: 'issue-42',
          status: 'passed',
          evidencePaths: ['qa/pass.png'],
        }),
      );
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'verifying');
    });

    it('persists failed runtime QA flow results and emits exhausted failure at retry ceiling', async () => {
      const pipeline = createPipeline(mock.deps);
      const context = pipeline.initializeContext('t1', {
        projectPath: '/proj',
        projectId: null,
        worktreePath: '/worktree',
        autonomous: true,
      });
      context.testRetries = MAX_TEST_RETRIES;
      context.repoSetupLoaded = true;
      context.repoSetupContract = {
        path: '/proj/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
          runtimeQa: {
            testCommands: ['runtime-qa-fail'],
            discoverAgentTests: false,
          },
        },
      };
      context.featureQaState = {
        featureId: 'issue-42',
        routes: [],
        criticalFlows: [],
        expectedStates: [],
        testDataAssumptions: [],
        selectorReadiness: 'ready',
      };

      const testing = pipeline.startTesting('t1');
      await flush();
      await mock.trigger(
        'output',
        'proc-1',
        `<qa_results>${JSON.stringify([
          { flowName: 'checkout-flow', passed: false, failureReason: 'Missing total' },
        ])}</qa_results>`,
      );
      await mock.trigger('exit', 'proc-1', 1);
      await testing;

      expect(mock.deps.featureQaResults?.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 't1',
          featureId: 'issue-42',
          status: 'failed',
          summary: expect.stringContaining('Missing total'),
        }),
      );
      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Runtime QA exhausted retries on: runtime-qa-fail',
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('schedules a test-fix retry when runtime QA fails and retry budget remains', async () => {
      useRetryFakeTimers();
      const pipeline = createPipeline(mock.deps);
      const context = pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        autonomous: true,
      });
      context.repoSetupLoaded = true;
      context.repoSetupContract = {
        path: '/proj/.shipcode/setup.json',
        contract: {
          version: 1,
          setupCommands: [],
          verifyCommands: [],
          envFiles: [],
          setupBeforeVerify: false,
          testingContext: null,
          runtimeQa: {
            testCommands: ['runtime-qa-fail'],
            discoverAgentTests: false,
          },
        },
      };

      const testing = pipeline.startTesting('t1');
      await Promise.resolve();
      await mock.trigger('output', 'proc-1', 'runtime failure\n');
      await mock.trigger('exit', 'proc-1', 1);
      await testing;

      expect(context.retryTimer).not.toBeNull();
      expect(mock.deps.threads.recordFailure).not.toHaveBeenCalledWith(
        't1',
        expect.any(String),
        expect.stringContaining('Runtime QA exhausted retries'),
      );
      expect(pipeline.getContext('t1')).toBe(context);
    });
  });

  // ─── turn loop ──────────────────────────────────────────────────────

  describe('turn loop', () => {
    it('triggers new turn on verify-exhausted when maxTurns allows', async () => {
      useRetryFakeTimers();
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.verificationRetries = MAX_VERIFICATION_RETRIES;
      context.turnCount = 0;
      context.workflowPolicy.agent.maxTurns = 3;

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse --verify')) return 'abc123';
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        return '';
      });

      await pipeline.startVerification('t1');

      await mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_FAILED_JSON));
      const exitP = mock.trigger('exit', 'proc-2', 0);
      await vi.advanceTimersByTimeAsync(0);
      await exitP;

      // Turn loop should have incremented turnCount and reset retries
      expect(context.turnCount).toBe(1);
      expect(context.verificationRetries).toBe(0);

      // turn events emitted
      expect(mock.emittedEvents).toContainEqual(
        expect.objectContaining({
          type: 'pipeline:turn-completed',
          turnNumber: 1,
          result: 'failed',
        }),
      );
      expect(mock.emittedEvents).toContainEqual(
        expect.objectContaining({ type: 'pipeline:turn-started', turnNumber: 2 }),
      );

      // After continuation delay, should re-enter planning (not execution)
      await vi.advanceTimersByTimeAsync(1000);
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'planning');
    });

    it('emits max_turns_reached when turn cap is hit', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.verificationRetries = MAX_VERIFICATION_RETRIES;
      context.turnCount = 2;
      context.workflowPolicy.agent.maxTurns = 3;

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse --verify')) return 'abc123';
        if (cmd.startsWith('git diff')) return 'some diff';
        if (cmd.startsWith('git status')) return '';
        return '';
      });

      await pipeline.startVerification('t1');

      await mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_FAILED_JSON));
      await mock.trigger('exit', 'proc-2', 0);

      expect(mock.emittedEvents).toContainEqual(
        expect.objectContaining({
          type: 'pipeline:turn-completed',
          turnNumber: 3,
          result: 'max_turns_reached',
        }),
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('turnCount defaults to 0 in fresh context', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      expect(context.turnCount).toBe(0);
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

    it('aborts commit when HEAD moved after verification', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.forkPointSha = 'abc123';
      context.verifiedSha = 'verified-sha';

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse HEAD')) return 'different-sha';
        return '';
      });

      await pipeline.startCommitAndPush('t1');

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Commit aborted: HEAD moved after verification (verifiedSha mismatch).',
      );
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('retries commit push once after an initial failure', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      requireContext(pipeline).forkPointSha = 'abc123';
      let pushAttempts = 0;

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse --verify')) return 'abc123';
        if (cmd.startsWith('git rev-parse HEAD')) return 'headsha';
        if (cmd.startsWith('git log')) return 'abc123 some commit';
        if (cmd.startsWith('git rev-parse --abbrev-ref')) return 'feat/branch';
        if (cmd.startsWith('git push')) {
          pushAttempts++;
          if (pushAttempts === 1) throw new Error('transient push failed');
          return '';
        }
        return '';
      });

      await pipeline.startCommitAndPush('t1');

      expect(pushAttempts).toBe(2);
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'shipping');
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

    it('fails shipping when baseBranch is missing for a GitHub issue', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.githubIssueNumber = 42;
      context.projectId = 'project-1';
      context.baseBranch = null as never;

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse')) return 'feat/branch';
        return '';
      });

      await pipeline.startShipping('t1');

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Shipping failed: Thread t1: missing baseBranch at PR creation',
      );
      expect(mock.deps.threads.setGithubPr).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('fails shipping when gh pr create output has no pull request number', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);
      const context = requireContext(pipeline);
      context.githubIssueNumber = 42;
      context.projectId = 'project-1';
      context.baseBranch = 'main';

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse')) return 'feat/branch';
        if (cmd.startsWith('gh pr list')) return '[]';
        if (cmd.startsWith('gh pr create')) return 'created but no url';
        return '';
      });

      await pipeline.startShipping('t1');

      expect(mock.deps.threads.recordFailure).toHaveBeenCalledWith(
        't1',
        expect.any(String),
        'Shipping failed: Failed to parse pull request number from: created but no url',
      );
      expect(mock.deps.threads.setGithubPr).not.toHaveBeenCalled();
      expect(pipeline.getContext('t1')).toBeUndefined();
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

    it('creates a PR with fallback body when the latest plan is missing', async () => {
      vi.mocked(mock.deps.plans.getLatest).mockReturnValue(null);
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        githubIssueNumber: 42,
        projectId: null,
        baseBranch: 'main',
      });
      let createArgs: string[] = [];

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-parse')) return 'feat/branch';
        if (cmd.startsWith('gh pr list')) return '[]';
        if (cmd.startsWith('gh pr create')) {
          createArgs = cmd.split(' ');
          return 'https://github.com/org/repo/pull/99\n';
        }
        return '';
      });

      await pipeline.startShipping('t1');

      expect(mock.deps.threads.setGithubPr).toHaveBeenCalledWith('t1', 99);
      expect(createArgs.join(' ')).toContain('ShipCode: Issue #42');
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

    it('wraps normal GitHub issues in the ShipCode run contract before planning', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('symbolic-ref')) return 'origin/develop';
        if (cmd === 'git rev-parse develop') return 'forksha';
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'shipcode/7-bug';
        return '';
      });

      const pipeline = createPipeline(mock.deps);
      const issue = {
        number: 7,
        title: 'Bug',
        body: '---\nstatus: planned\n---\n# PRD: bug\n\n## Goals\n- Fix it',
        labels: [],
      };

      await pipeline.startFromGitHubIssue('t1', '/proj', issue, 'claude', {
        worktreePath: '/worktree/issue-7',
      });
      await flush();

      const args = vi.mocked(mock.deps.processManager.spawn).mock.calls[0][2] as string[];
      const prompt = args[1];
      expect(prompt).toContain('You are working inside ShipCode');
      expect(prompt).toContain('- Repo: /proj');
      expect(prompt).toContain('- Worktree: /worktree/issue-7');
      expect(prompt).toContain('- Target branch: develop');
      expect(prompt).toContain('- Current branch: shipcode/7-bug');
      expect(prompt).toContain('- Do not rename the current branch.');
      expect(prompt).toContain('Treat the GitHub issue/PRD below as the source of truth.');
      expect(prompt).toContain('# PRD: bug');
      expect(prompt).not.toContain('status: planned');
    });

    it('does not resolve the project checkout branch before a worktree exists', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('symbolic-ref')) return 'origin/develop';
        if (cmd === 'git rev-parse develop') return 'forksha';
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'develop';
        return '';
      });

      const pipeline = createPipeline(mock.deps);
      const issue = {
        number: 7,
        title: 'Bug',
        body: 'Fix it',
        labels: [],
      };

      await pipeline.startFromGitHubIssue('t1', '/proj', issue, 'claude');
      await flush();

      const args = vi.mocked(mock.deps.processManager.spawn).mock.calls[0][2] as string[];
      const prompt = args[1];
      expect(prompt).toContain('- Target branch: develop');
      expect(prompt).toContain('- Current branch: (current worktree branch)');
      expect(prompt).not.toContain('- Current branch: develop');
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

    it('uses the project approval setting when no cached issue override exists', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('symbolic-ref')) return 'origin/main';
        if (cmd.includes('rev-parse')) return 'sha789';
        return '';
      });
      vi.mocked(mock.deps.projects.getById).mockReturnValue(
        makeProject({ requireApprovalOverride: false }),
      );
      vi.mocked(mock.deps.githubIssues.getByNumber).mockReturnValue(null);

      const pipeline = createPipeline(mock.deps);

      await pipeline.startFromGitHubIssue(
        't1',
        '/proj',
        { number: 12, title: 'Project setting', body: null, labels: [] },
        'claude',
      );

      expect(mock.emittedEvents).toContainEqual(
        expect.objectContaining({
          type: 'pipeline:start-context',
          threadId: 't1',
          requireApproval: false,
        }),
      );
    });

    it('falls back to global approval when no thread/project can be resolved', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('symbolic-ref')) return 'origin/main';
        if (cmd.includes('rev-parse')) return 'sha789';
        return '';
      });
      vi.mocked(mock.deps.settings.get).mockReturnValue({
        ...TEST_DEFAULT_SETTINGS,
        requireApproval: false,
      });
      vi.mocked(mock.deps.threads.getById).mockReturnValue(null);

      const pipeline = createPipeline(mock.deps);

      await pipeline.startFromGitHubIssue(
        'missing-thread',
        '/proj',
        { number: 13, title: 'Global setting', body: null, labels: [] },
        'claude',
      );

      expect(mock.emittedEvents).toContainEqual(
        expect.objectContaining({
          type: 'pipeline:start-context',
          threadId: 'missing-thread',
          requireApproval: false,
        }),
      );
      expect(mock.deps.githubIssues.getByNumber).not.toHaveBeenCalled();
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
      const projectDir = makeTempProject();
      const worktreeDir = path.join(projectDir, 'worktree');
      mkdirSync(worktreeDir, { recursive: true });
      const issue = { number: 11, title: 'Resume issue', body: 'Continue', labels: [] };

      await pipeline.startFromGitHubIssue('t1', projectDir, issue, 'claude', {
        plannerModel: 'openrouter',
        worktreePath: worktreeDir,
      });
      await flush();

      expect(openrouterGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'plan',
          cwd: worktreeDir,
        }),
      );
      expect(pipeline.getContext('t1')?.worktreePath).toBe(worktreeDir);
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

    it('falls back to main with no fork point, global approval, and short acceptance criteria', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('symbolic-ref')) throw new Error('no remote HEAD');
        if (cmd.includes('rev-parse')) throw new Error('no ref');
        return '';
      });
      vi.mocked(mock.deps.settings.get).mockReturnValue({
        ...TEST_DEFAULT_SETTINGS,
        requireApproval: false,
      });
      vi.mocked(mock.deps.threads.getById).mockReturnValue(null);
      const pipeline = createPipeline(mock.deps);

      await pipeline.startFromQuickTask(
        'missing-thread',
        '/proj',
        {
          issueNumber: -1,
          title: 'Tiny',
          text: 'Ship',
        },
        'claude',
      );

      expect(mock.deps.threads.updateAutonomousFields).toHaveBeenCalledWith(
        'missing-thread',
        expect.objectContaining({
          baseBranch: 'main',
          forkPointSha: '',
        }),
      );
      expect(mock.deps.emitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pipeline:start-context',
          threadId: 'missing-thread',
          requireApproval: false,
        }),
      );
      expect(mock.deps.plans.create).toHaveBeenCalledWith(
        'missing-thread',
        '<quick-task-synthesized>',
        expect.objectContaining({
          acceptanceCriteria: ['Implements: Tiny'],
        }),
        1,
      );
    });

    it('uses an explicit quick-task base branch without probing origin HEAD', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('symbolic-ref')) throw new Error('should not probe remote HEAD');
        if (cmd.includes('rev-parse develop')) return 'develop-sha';
        return '';
      });
      const pipeline = createPipeline(mock.deps);

      await pipeline.startFromQuickTask(
        't1',
        '/proj',
        {
          issueNumber: -1,
          title: 'Explicit base',
          text: 'Use the supplied base branch.',
        },
        'claude',
        { baseBranch: 'develop' },
      );

      expect(mock.deps.threads.updateAutonomousFields).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({
          baseBranch: 'develop',
          forkPointSha: 'develop-sha',
        }),
      );
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

    it('uses project speed settings and includes long prompt acceptance criteria', async () => {
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        projectId: 'project-1',
      });
      const prompt = 'Run the full smoke automation and collect detailed evidence.';

      await pipeline.startFromAutomation('t1', prompt, '/proj', 'Nightly');

      expect(mock.deps.projects.getById).toHaveBeenCalledWith('project-1');
      expect(mock.deps.plans.create).toHaveBeenCalledWith(
        't1',
        '<automation-synthesized>',
        expect.objectContaining({
          acceptanceCriteria: ['Implements automation: Nightly', `Satisfies prompt: ${prompt}`],
        }),
        1,
      );
    });
  });

  describe('startStabilization', () => {
    it('startStabilization no-ops without active context', async () => {
      const pipeline = createPipeline(mock.deps);

      await pipeline.startStabilization('missing-thread', {
        prNumber: 7,
        prUrl: null,
        failingChecks: [],
        unresolvedReviewComments: [],
      });

      expect(mock.deps.processManager.spawn).not.toHaveBeenCalled();
    });

    it('resets cancellation state, injects stabilization feedback, and resumes execution', async () => {
      const pipeline = createPipeline(mock.deps);
      const context = pipeline.initializeContext('t1', {
        projectPath: '/proj',
        worktreePath: '/worktree',
        cancelled: true,
        verifiedSha: 'old-sha',
        autonomous: true,
      });

      await pipeline.startStabilization('t1', {
        prNumber: 7,
        prUrl: 'https://github.com/acme/repo/pull/7',
        failingChecks: [makeCheck({ workflowName: 'CI', name: 'test' })],
        unresolvedReviewComments: [makeReviewComment({ path: 'src/a.ts', line: 12 })],
      });
      await flush();

      expect(context.cancelled).toBe(false);
      expect(context.verifiedSha).toBeNull();
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing');
      expect(mock.deps.processManager.spawn).toHaveBeenCalled();
    });

    it('throws when stabilization has no structured plan to resume', async () => {
      vi.mocked(mock.deps.plans.getLatest).mockReturnValue(makePlanRecord({ structured: null }));
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', { projectPath: '/proj', worktreePath: '/worktree' });

      await expect(
        pipeline.startStabilization('t1', {
          prNumber: 7,
          prUrl: null,
          failingChecks: [],
          unresolvedReviewComments: [],
        }),
      ).rejects.toThrow('missing approved plan');
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

    it('clears retry state, aborts, kills active process, and runs cleanup', () => {
      vi.useFakeTimers();
      const pipeline = createPipeline(mock.deps);
      const cleanup = vi.fn(async () => {});
      const abort = new AbortController();
      const abortSpy = vi.spyOn(abort, 'abort');
      const retryTimer = setTimeout(() => {}, 1000);

      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        activeProcessId: 'proc-1',
        retryTimer,
        abort,
      });
      const context = pipeline.getContext('t1');
      if (!context) throw new Error('Expected context');
      context.runtimeQaCleanup = cleanup;

      pipeline.cancel('t1');

      expect(context.cancelled).toBe(true);
      expect(context.retryTimer).toBeNull();
      expect(abortSpy).toHaveBeenCalled();
      expect(mock.deps.processManager.kill).toHaveBeenCalledWith('proc-1');
      expect(cleanup).toHaveBeenCalled();
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'idle');
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('still emits idle when no active context exists', () => {
      const pipeline = createPipeline(mock.deps);

      pipeline.cancel('missing');

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('missing', 'idle');
    });
  });

  describe('pause', () => {
    it('clears timers, aborts, kills active process, runs cleanup, and emits paused', () => {
      vi.useFakeTimers();
      const pipeline = createPipeline(mock.deps);
      const cleanup = vi.fn(async () => {});
      const abort = new AbortController();
      const abortSpy = vi.spyOn(abort, 'abort');
      const retryTimer = setTimeout(() => {}, 1000);

      pipeline.initializeContext('t1', {
        projectPath: '/proj',
        activeProcessId: 'proc-1',
        retryTimer,
        abort,
      });
      const context = pipeline.getContext('t1');
      if (!context) throw new Error('Expected context');
      context.runtimeQaCleanup = cleanup;

      pipeline.pause('t1');

      expect(context.cancelled).toBe(true);
      expect(context.retryTimer).toBeNull();
      expect(abortSpy).toHaveBeenCalled();
      expect(mock.deps.processManager.kill).toHaveBeenCalledWith('proc-1');
      expect(cleanup).toHaveBeenCalled();
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'paused');
      expect(pipeline.getContext('t1')).toBeUndefined();
    });

    it('still emits paused when no active context exists', () => {
      const pipeline = createPipeline(mock.deps);

      pipeline.pause('missing');

      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('missing', 'paused');
    });

    it('pauses a context without optional timer, process, or cleanup state', () => {
      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', { projectPath: '/proj' });

      pipeline.pause('t1');

      expect(mock.deps.processManager.kill).not.toHaveBeenCalled();
      expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'paused');
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

    it('reflects approval phase from the thread for scheduler slot accounting', async () => {
      mock.deps.threads.getById = vi.fn(() => ({
        id: 't1',
        projectId: 'project-1',
        githubIssueNumber: 42,
        status: 'approval',
      })) as never;

      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      const active = pipeline.listActive();
      expect(active).toHaveLength(1);
      expect(active[0].phase).toBe('approval');
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
        status: id === 't-new' ? 'approval' : 'executing',
      })) as never;

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t-existing-1', { projectPath: '/proj' });
      pipeline.initializeContext('t-existing-2', { projectPath: '/proj' });
      pipeline.initializeContext('t-existing-3', { projectPath: '/proj' });
      pipeline.initializeContext('t-new', { projectPath: '/proj' });

      const plan = { steps: [] } as never;
      await pipeline.startExecution('t-new', plan);
      await flush();

      // Should have emitted approval, not executing
      const phaseEvents = mock.emittedEvents.filter(
        (e: PipelineEvent) => e.type === 'pipeline:phase' && e.threadId === 't-new',
      );
      expect(phaseEvents[phaseEvents.length - 1]).toMatchObject({
        type: 'pipeline:phase',
        phase: 'approval',
      });
    });

    it('allows execution when under the project maxConcurrentExecutions limit', async () => {
      mock.deps.threads.getById = vi.fn((id: string) => ({
        id,
        projectId: 'project-1',
        status: id === 't-existing' ? 'executing' : 'approval',
      })) as never;

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t-existing', { projectPath: '/proj' });
      pipeline.initializeContext('t-new', { projectPath: '/proj' });

      const plan = { steps: [] } as never;
      await pipeline.startExecution('t-new', plan);
      await flush();

      // Should have emitted executing (gate passed), not approval
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
        status: id === 't-new' ? 'approval' : 'executing',
      })) as never;

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('other-1', { projectPath: '/other' });
      pipeline.initializeContext('other-2', { projectPath: '/other' });
      pipeline.initializeContext('other-3', { projectPath: '/other' });
      pipeline.initializeContext('t-new', { projectPath: '/proj' });

      const plan = { steps: [] } as never;
      await pipeline.startExecution('t-new', plan);
      await flush();

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
        ...TEST_DEFAULT_SETTINGS,
        maxConcurrentExecutions: 3,
      })) as never;

      mock.deps.threads.getById = vi.fn((id: string) => ({
        id,
        projectId: 'project-1',
        status: id === 't3' ? 'approval' : 'executing',
      })) as never;

      const pipeline = createPipeline(mock.deps);
      pipeline.initializeContext('t1', { projectPath: '/proj' });
      pipeline.initializeContext('t2', { projectPath: '/proj' });
      pipeline.initializeContext('t3', { projectPath: '/proj' });

      const plan = { steps: [] } as never;
      await pipeline.startExecution('t3', plan);
      await flush();

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
      await flush();

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
      await flush();

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
        ...TEST_DEFAULT_SETTINGS,
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
        ...TEST_DEFAULT_SETTINGS,
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

    it('does not fabricate model-resolved for claude-cli without concrete evidence', async () => {
      const pipeline = createPipeline(mock.deps);
      await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null);

      // Drive the CLI provider's spawn → exit cycle
      await mock.trigger('output', 'proc-1', planBlock());
      await mock.trigger('exit', 'proc-1', 0);

      const resolvedEvents = mock.emittedEvents.filter(
        (event): event is Extract<PipelineEvent, { type: 'pipeline:model-resolved' }> =>
          event.type === 'pipeline:model-resolved',
      );
      expect(resolvedEvents).toHaveLength(0);
      expect(mock.deps.threads.setResolvedModel).not.toHaveBeenCalled();
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
        ...TEST_DEFAULT_SETTINGS,
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
