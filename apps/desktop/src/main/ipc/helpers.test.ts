import fs from 'node:fs';
import type { PipelineEmitter } from '@shipcode/pipeline';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertCliPhaseModelsSupported,
  assertPrdRewriteModelSupported,
  attachIssueToConfiguredProjectBoard,
  buildSkillRow,
  enrichProjectPath,
  enrichProjectPaths,
  resolveIssuePhaseModels,
  resolveLinkedPullRequestPipelineStatus,
  resolveProjectPhaseModels,
  sendGithubIssuesUpdated,
  syncLinkedPullRequestFeedback,
  transitionThreadPhase,
  tryParsePlan,
} from './helpers';
import type { Queries } from './types';

const {
  checkCliModelCapabilitiesMock,
  ghCliGetPullRequestFeedbackMock,
  ghCliSetIssueLabelPresenceMock,
  ghCliInstances,
  inspectProjectSetupMock,
  streamParserExtractPlanMock,
  streamParserFeedMock,
} = vi.hoisted(() => ({
  checkCliModelCapabilitiesMock: vi.fn(),
  ghCliGetPullRequestFeedbackMock: vi.fn(),
  ghCliSetIssueLabelPresenceMock: vi.fn(async () => undefined),
  ghCliInstances: [] as Array<{
    getPullRequestFeedback: ReturnType<typeof vi.fn>;
    setIssueLabelPresence: ReturnType<typeof vi.fn>;
  }>,
  inspectProjectSetupMock: vi.fn(() => ({
    status: 'configured',
    path: '/repo/WORKFLOW.md',
    error: null,
  })),
  streamParserExtractPlanMock: vi.fn(),
  streamParserFeedMock: vi.fn(),
}));

vi.mock('../logger.service', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@shipcode/agents', () => {
  const defaultSkill = {
    content: 'bundled skill',
    version: 1,
    schemaVersion: 1,
    requiredSlots: [],
  };
  return {
    checkCliModelCapabilities: checkCliModelCapabilitiesMock,
    DEFAULT_SKILLS: {
      'plan-generation': defaultSkill,
      'adversarial-review': defaultSkill,
      'plan-revision': defaultSkill,
      'plan-execution': defaultSkill,
      'plan-verification': defaultSkill,
      'pr-generation': defaultSkill,
    },
    inspectProjectSetup: inspectProjectSetupMock,
    GhCli: class {
      getPullRequestFeedback = ghCliGetPullRequestFeedbackMock;
      setIssueLabelPresence = ghCliSetIssueLabelPresenceMock;

      constructor() {
        ghCliInstances.push(this);
      }
    },
    StreamParser: class {
      feed = streamParserFeedMock;
      extractPlan = streamParserExtractPlanMock;
    },
  };
});

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'project-1',
    name: 'Repo',
    path: '/tmp/repo',
    gitRemote: 'https://github.com/acme/repo.git',
    githubProjectUrl: null,
    githubStatusMapping: null,
    defaultBranch: 'main',
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
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Fix bug',
    body: 'Fix the bug',
    labels: [],
    assignee: null,
    state: 'open',
    pipelineStatus: 'todo',
    threadId: 'thread-1',
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
    linkedPrNumber: null,
    linkedPrUrl: null,
    linkedPrIsDraft: false,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: new Date().toISOString(),
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    ...overrides,
  };
}

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    plannerModel: 'claude',
    reviewerModel: 'codex',
    executorModel: 'claude',
    verifierModel: 'openrouter',
    plannerReasoningEffort: 'medium',
    reviewerReasoningEffort: 'high',
    executorReasoningEffort: 'low',
    verifierReasoningEffort: 'minimal',
    openrouterPlannerModel: 'anthropic/claude-sonnet-4',
    openrouterReviewerModel: 'openai/gpt-5.2',
    openrouterExecutorModel: 'anthropic/claude-opus-4.5',
    openrouterVerifierModel: 'openai/gpt-5.2-mini',
    ...overrides,
  };
}

function makeCapabilities() {
  return {
    claude: {
      provider: 'claude',
      source: 'catalog',
      checkedAt: new Date().toISOString(),
      error: null,
      models: [
        {
          value: 'claude-sonnet-4-5',
          label: 'Claude Sonnet 4.5',
          description: null,
          defaultReasoningEffort: 'medium',
          supportedReasoningEfforts: ['low', 'medium', 'high'],
        },
      ],
    },
    codex: {
      provider: 'codex',
      source: 'catalog',
      checkedAt: new Date().toISOString(),
      error: null,
      models: [
        {
          value: 'gpt-5.2',
          label: 'GPT-5.2',
          description: null,
          defaultReasoningEffort: 'high',
          supportedReasoningEfforts: ['low', 'medium', 'high'],
        },
      ],
    },
    gemini: {
      provider: 'gemini',
      source: 'catalog',
      checkedAt: new Date().toISOString(),
      error: null,
      models: [],
    },
  };
}

describe('project helper enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for a missing project and enriches project setup metadata', () => {
    expect(enrichProjectPath(null)).toBeNull();

    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const enriched = enrichProjectPath(makeProject({ path: '/repo' }) as never);

    expect(inspectProjectSetupMock).toHaveBeenCalledWith('/repo');
    expect(existsSpy).toHaveBeenCalledWith('/repo');
    expect(enriched).toEqual(
      expect.objectContaining({
        path: '/repo',
        pathExists: true,
        setupStatus: 'configured',
        setupPath: '/repo/WORKFLOW.md',
        setupError: null,
      }),
    );

    existsSpy.mockRestore();
  });

  it('enriches every project in a list', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((path) => path === '/repo-a');

    const enriched = enrichProjectPaths([
      makeProject({ id: 'a', path: '/repo-a' }),
      makeProject({ id: 'b', path: '/repo-b' }),
    ] as never);

    expect(enriched.map((project) => project.pathExists)).toEqual([true, false]);
    expect(inspectProjectSetupMock).toHaveBeenCalledTimes(2);

    existsSpy.mockRestore();
  });
});

describe('phase model helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkCliModelCapabilitiesMock.mockResolvedValue(makeCapabilities());
  });

  it('resolves project and issue phase model providers, model ids, and reasoning effort', () => {
    const project = makeProject({
      reviewerModelOverride: 'openrouter',
      openrouterReviewerModelOverride: 'anthropic/project-reviewer',
      executorReasoningEffortOverride: 'medium',
    });
    const issue = makeIssue({
      plannerModelOverride: 'openrouter',
      plannerModelIdOverride: 'anthropic/issue-planner',
      executorReasoningEffortOverride: 'high',
    });
    const settings = makeSettings({
      openrouterReviewerModel: 'openai/settings-reviewer',
      executorReasoningEffort: 'low',
    });

    expect(resolveProjectPhaseModels(settings as never, project as never)).toEqual(
      expect.objectContaining({
        plannerModel: 'claude',
        reviewerModel: 'openrouter',
        reviewerModelId: 'openai/settings-reviewer',
        executorReasoningEffort: 'medium',
      }),
    );
    expect(resolveIssuePhaseModels(settings as never, project as never, issue as never)).toEqual(
      expect.objectContaining({
        plannerModel: 'openrouter',
        plannerModelId: 'anthropic/issue-planner',
        executorReasoningEffort: 'high',
      }),
    );
  });

  it('accepts supported CLI phase models and ignores OpenRouter selections', async () => {
    await expect(
      assertCliPhaseModelsSupported({
        plannerModel: 'claude',
        reviewerModel: 'codex',
        executorModel: 'openrouter',
        verifierModel: 'openrouter',
        plannerModelId: 'claude-sonnet-4-5',
        reviewerModelId: 'gpt-5.2',
        executorModelId: 'openrouter/executor',
        verifierModelId: 'openrouter/verifier',
        plannerReasoningEffort: 'medium',
        reviewerReasoningEffort: 'high',
        executorReasoningEffort: 'high',
        verifierReasoningEffort: 'high',
      }),
    ).resolves.toBeUndefined();
  });

  it('throws with the phase label when a CLI model is unavailable', async () => {
    await expect(
      assertCliPhaseModelsSupported({
        plannerModel: 'claude',
        reviewerModel: 'codex',
        executorModel: 'claude',
        verifierModel: 'codex',
        plannerModelId: 'missing-claude-model',
        reviewerModelId: 'gpt-5.2',
        executorModelId: 'claude-sonnet-4-5',
        verifierModelId: 'gpt-5.2',
        plannerReasoningEffort: 'medium',
        reviewerReasoningEffort: 'high',
        executorReasoningEffort: 'high',
        verifierReasoningEffort: 'high',
      }),
    ).rejects.toThrow('Planner: missing-claude-model is not reported');
  });

  it('validates PRD rewrite CLI model selections', async () => {
    await expect(
      assertPrdRewriteModelSupported('claude', 'claude-sonnet-4-5', 'medium'),
    ).resolves.toBeUndefined();

    await expect(assertPrdRewriteModelSupported('codex', 'gpt-5.2', 'minimal')).rejects.toThrow(
      'Codex CLI does not report minimal effort',
    );
  });
});

describe('tryParsePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for empty or unparseable output and the plan for valid output', () => {
    expect(tryParsePlan('')).toBeNull();

    streamParserExtractPlanMock.mockReturnValueOnce({ success: false });
    expect(tryParsePlan('not json')).toBeNull();
    expect(streamParserFeedMock).toHaveBeenCalledWith('not json');

    const plan = { summary: 'Ship it', tasks: [] };
    streamParserExtractPlanMock.mockReturnValueOnce({ success: true, data: plan });

    expect(tryParsePlan('plan json')).toBe(plan);
  });
});

describe('syncLinkedPullRequestFeedback', () => {
  const notificationService = { fire: vi.fn() };
  const chatNotificationService = { fire: vi.fn() };

  function makeFeedbackQueries(
    thread: Record<string, unknown> | null,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      threads: {
        getById: vi.fn(() => thread),
      },
      plans: {
        getLatest: vi.fn(() => null),
      },
      githubIssues: {
        updatePullRequestFeedback: vi.fn(),
        updatePipelineStatus: vi.fn(),
        setCachedLabelPresence: vi.fn(),
        reconcileCompletedFromEvidence: vi.fn(),
      },
      ...overrides,
    } as unknown as Queries;
  }

  function makeFeedback(overrides: Record<string, unknown> = {}) {
    return {
      number: 17,
      url: 'https://github.com/acme/repo/pull/17',
      isDraft: false,
      state: 'OPEN',
      reviewDecision: null,
      reviewRequestCount: 0,
      ciBlocked: false,
      failingChecks: [],
      unresolvedReviewComments: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    ghCliInstances.length = 0;
    ghCliGetPullRequestFeedbackMock.mockReset();
    ghCliSetIssueLabelPresenceMock.mockReset();
    ghCliSetIssueLabelPresenceMock.mockResolvedValue(undefined);
  });

  it('clears stale pull request feedback and CI labels when no linked PR exists', async () => {
    const queries = makeFeedbackQueries({
      id: 'thread-1',
      githubPrNumber: null,
    });
    const issue = makeIssue({
      linkedPrNumber: 12,
      ciBlocked: true,
      unresolvedReviewCommentCount: 2,
    });

    await syncLinkedPullRequestFeedback(
      makeProject() as never,
      issue as never,
      queries,
      notificationService as never,
      chatNotificationService as never,
    );

    expect(queries.githubIssues.updatePullRequestFeedback).toHaveBeenCalledWith(
      'issue-1',
      expect.objectContaining({
        linkedPrNumber: null,
        ciBlocked: false,
        unresolvedReviewComments: [],
      }),
    );
    expect(queries.githubIssues.setCachedLabelPresence).toHaveBeenCalledWith(
      'issue-1',
      'shipcode:blocked:ci',
      false,
    );
    expect(ghCliInstances[0]?.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:blocked:ci',
      false,
    );
    expect(queries.githubIssues.reconcileCompletedFromEvidence).toHaveBeenCalledWith('issue-1');
  });

  it('clears stale PR review status labels when the linked PR disappears', async () => {
    const queries = makeFeedbackQueries({
      id: 'thread-1',
      githubPrNumber: null,
    });
    const issue = makeIssue({
      pipelineStatus: 'needs_review',
      labels: ['shipcode:pipeline:needs_review'],
      linkedPrNumber: 12,
    });

    await syncLinkedPullRequestFeedback(
      makeProject() as never,
      issue as never,
      queries,
      notificationService as never,
      chatNotificationService as never,
    );

    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-1', 'completed');
    expect(queries.githubIssues.setCachedLabelPresence).toHaveBeenCalledWith(
      'issue-1',
      'shipcode:pipeline:needs_review',
      false,
    );
    expect(ghCliInstances[0]?.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:pipeline:needs_review',
      false,
    );
  });

  it('syncs linked PR feedback and fires notifications when CI becomes blocked', async () => {
    const queries = makeFeedbackQueries({
      id: 'thread-1',
      githubPrNumber: 17,
    });
    ghCliGetPullRequestFeedbackMock.mockResolvedValueOnce({
      ...makeFeedback(),
      ciBlocked: true,
      failingChecks: ['test'],
      unresolvedReviewComments: [{ id: 'comment-1' }],
    });

    await syncLinkedPullRequestFeedback(
      makeProject() as never,
      makeIssue({ ciBlocked: false }) as never,
      queries,
      notificationService as never,
      chatNotificationService as never,
    );

    expect(queries.githubIssues.updatePullRequestFeedback).toHaveBeenCalledWith(
      'issue-1',
      expect.objectContaining({
        linkedPrNumber: 17,
        ciBlocked: true,
        failingChecks: ['test'],
      }),
    );
    expect(ghCliInstances[0]?.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:blocked:ci',
      true,
    );
    expect(notificationService.fire).toHaveBeenCalledWith(
      'ci_blocked',
      expect.objectContaining({ id: 'thread-1' }),
    );
    expect(chatNotificationService.fire).toHaveBeenCalledWith(
      'ci_blocked',
      expect.objectContaining({ id: 'thread-1' }),
    );
  });

  it('persists linked PR CI and review blockers as open findings', async () => {
    const reviewFindings = { syncOpenForPullRequestFeedback: vi.fn() };
    const queries = makeFeedbackQueries(
      {
        id: 'thread-1',
        githubPrNumber: 17,
        currentRunId: 'run-1',
        worktreeBranch: 'shipcode/17-review',
        worktreePath: '/tmp/worktree',
      },
      {
        plans: { getLatest: vi.fn(() => ({ id: 'plan-1' })) },
        reviewFindings,
      },
    );
    ghCliGetPullRequestFeedbackMock.mockResolvedValueOnce({
      ...makeFeedback(),
      ciBlocked: true,
      failingChecks: [
        {
          name: 'test',
          workflowName: 'CI',
          status: 'failed',
          conclusion: 'failure',
          detailsUrl: 'https://github.com/check',
        },
      ],
      unresolvedReviewComments: [
        {
          author: 'reviewer',
          body: 'Please add a regression test',
          url: 'https://github.com/comment',
          createdAt: '2026-05-31T00:00:00Z',
          path: 'src/app.ts',
          line: 42,
        },
      ],
    });

    await syncLinkedPullRequestFeedback(
      makeProject() as never,
      makeIssue({ ciBlocked: false }) as never,
      queries,
      notificationService as never,
      chatNotificationService as never,
    );

    expect(reviewFindings.syncOpenForPullRequestFeedback).toHaveBeenCalledWith({
      threadId: 'thread-1',
      findings: [
        expect.objectContaining({
          source: 'ci',
          phase: 'ci',
          prNumber: 17,
          runId: 'run-1',
          branch: 'shipcode/17-review',
        }),
        expect.objectContaining({
          source: 'pr_review',
          phase: 'pr_review',
          filePath: 'src/app.ts',
          prNumber: 17,
          runId: 'run-1',
          branch: 'shipcode/17-review',
        }),
      ],
    });
  });

  it('keeps the cached CI label when CI remains blocked', async () => {
    const queries = makeFeedbackQueries({
      id: 'thread-1',
      githubPrNumber: 17,
    });
    ghCliGetPullRequestFeedbackMock.mockResolvedValueOnce({
      ...makeFeedback(),
      ciBlocked: true,
      failingChecks: [],
      unresolvedReviewComments: [],
    });

    await syncLinkedPullRequestFeedback(
      makeProject() as never,
      makeIssue({ ciBlocked: true }) as never,
      queries,
      notificationService as never,
      chatNotificationService as never,
    );

    expect(queries.githubIssues.setCachedLabelPresence).toHaveBeenCalledWith(
      'issue-1',
      'shipcode:blocked:ci',
      true,
    );
    expect(ghCliInstances[0]?.setIssueLabelPresence).not.toHaveBeenCalled();
  });

  it('moves linked issues to needs_review when a PR requires review', async () => {
    const queries = makeFeedbackQueries({
      id: 'thread-1',
      githubPrNumber: 17,
    });
    ghCliGetPullRequestFeedbackMock.mockResolvedValueOnce(
      makeFeedback({
        reviewDecision: 'REVIEW_REQUIRED',
        reviewRequestCount: 1,
      }),
    );

    await syncLinkedPullRequestFeedback(
      makeProject() as never,
      makeIssue({ pipelineStatus: 'completed' }) as never,
      queries,
      notificationService as never,
      chatNotificationService as never,
    );

    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-1',
      'needs_review',
    );
    expect(queries.githubIssues.setCachedLabelPresence).toHaveBeenCalledWith(
      'issue-1',
      'shipcode:pipeline:needs_review',
      true,
    );
    expect(ghCliInstances[0]?.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:pipeline:needs_review',
      true,
    );
  });

  it('moves approved linked PRs to ready_to_merge and removes stale review labels', async () => {
    const queries = makeFeedbackQueries({
      id: 'thread-1',
      githubPrNumber: 17,
    });
    ghCliGetPullRequestFeedbackMock.mockResolvedValueOnce(
      makeFeedback({
        reviewDecision: 'APPROVED',
      }),
    );

    await syncLinkedPullRequestFeedback(
      makeProject() as never,
      makeIssue({
        pipelineStatus: 'needs_review',
        labels: ['shipcode:pipeline:needs_review'],
      }) as never,
      queries,
      notificationService as never,
      chatNotificationService as never,
    );

    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-1',
      'ready_to_merge',
    );
    expect(queries.githubIssues.setCachedLabelPresence).toHaveBeenCalledWith(
      'issue-1',
      'shipcode:pipeline:needs_review',
      false,
    );
    expect(queries.githubIssues.setCachedLabelPresence).toHaveBeenCalledWith(
      'issue-1',
      'shipcode:pipeline:ready_to_merge',
      true,
    );
    expect(ghCliInstances[0]?.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:pipeline:needs_review',
      false,
    );
    expect(ghCliInstances[0]?.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:pipeline:ready_to_merge',
      true,
    );
  });
});

describe('resolveLinkedPullRequestPipelineStatus', () => {
  it('maps pull request review states to ShipCode issue statuses', () => {
    expect(
      resolveLinkedPullRequestPipelineStatus({
        state: 'OPEN',
        isDraft: true,
        reviewDecision: null,
        reviewRequestCount: 0,
      }),
    ).toBe('executing');
    expect(
      resolveLinkedPullRequestPipelineStatus({
        state: 'OPEN',
        isDraft: false,
        reviewDecision: 'REVIEW_REQUIRED',
        reviewRequestCount: 0,
      }),
    ).toBe('needs_review');
    expect(
      resolveLinkedPullRequestPipelineStatus({
        state: 'OPEN',
        isDraft: false,
        reviewDecision: 'APPROVED',
        reviewRequestCount: 0,
      }),
    ).toBe('ready_to_merge');
    expect(
      resolveLinkedPullRequestPipelineStatus({
        state: 'MERGED',
        isDraft: false,
        reviewDecision: 'APPROVED',
        reviewRequestCount: 0,
      }),
    ).toBe('completed');
    expect(
      resolveLinkedPullRequestPipelineStatus({
        state: 'CLOSED',
        isDraft: false,
        reviewDecision: null,
        reviewRequestCount: 0,
      }),
    ).toBe('executing');
  });
});

describe('buildSkillRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds default, global, and project skill rows', () => {
    const queries = {
      skills: {
        get: vi.fn(() => null),
      },
    } as unknown as Queries;

    expect(buildSkillRow(queries, 'plan-generation', null)).toEqual(
      expect.objectContaining({
        phase: 'plan-generation',
        projectId: null,
        source: 'default',
        status: 'ok',
      }),
    );

    queries.skills.get = vi.fn((_projectId, phase) => ({
      phase,
      projectId: null,
      content: 'global content',
      baseVersion: 1,
      schemaVersion: 1,
      status: 'modified',
      statusReason: 'changed',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })) as never;
    expect(buildSkillRow(queries, 'adversarial-review', null)).toEqual(
      expect.objectContaining({
        source: 'global',
        content: 'global content',
        statusReason: 'changed',
      }),
    );

    queries.skills.get = vi.fn((_projectId, phase) => ({
      phase,
      projectId: 'project-1',
      content: 'project content',
      baseVersion: 1,
      schemaVersion: 1,
      status: 'missing-slot',
      statusReason: 'missing {{slot}}',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })) as never;
    expect(buildSkillRow(queries, 'plan-execution', 'project-1')).toEqual(
      expect.objectContaining({
        source: 'project',
        projectId: 'project-1',
        content: 'project content',
      }),
    );
  });
});

describe('transitionThreadPhase', () => {
  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    },
  } as const;

  const threadQueries = {
    updateStatus: vi.fn(),
    getById: vi.fn(),
    recordFailure: vi.fn(),
  };
  const githubIssueQueries = {
    getByThreadId: vi.fn(),
    getByNumber: vi.fn(),
    updatePipelineStatus: vi.fn(),
    list: vi.fn(),
  };
  const queries = {
    threads: {
      updateStatus: threadQueries.updateStatus,
      getById: threadQueries.getById,
      recordFailure: threadQueries.recordFailure,
    },
    githubIssues: {
      getByThreadId: githubIssueQueries.getByThreadId,
      getByNumber: githubIssueQueries.getByNumber,
      updatePipelineStatus: githubIssueQueries.updatePipelineStatus,
      list: githubIssueQueries.list,
    },
  } as unknown as Queries;

  const emitter = {
    emit: vi.fn(),
  } as unknown as PipelineEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates thread and linked issue state before emitting the canonical phase event', () => {
    threadQueries.getById.mockReturnValue({
      id: 'thread-1',
      projectId: 'project-1',
      githubIssueNumber: 42,
      status: 'planning',
    });
    githubIssueQueries.getByThreadId.mockReturnValue({
      id: 'issue-1',
      projectId: 'project-1',
    });
    githubIssueQueries.getByNumber.mockReturnValue({
      id: 'issue-1',
      projectId: 'project-1',
    });
    githubIssueQueries.list.mockReturnValue([{ id: 'issue-1' }]);

    transitionThreadPhase(mainWindow as never, queries, emitter, {
      threadId: 'thread-1',
      phase: 'approval',
    });

    expect(threadQueries.updateStatus).toHaveBeenCalledWith('thread-1', 'approval');
    expect(githubIssueQueries.updatePipelineStatus).toHaveBeenCalledWith('issue-1', 'approval');
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [{ id: 'issue-1' }],
    });
    expect(emitter.emit).toHaveBeenCalledWith({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'approval',
    });
  });

  it('records the error message for failed transitions even without a linked issue', () => {
    threadQueries.getById
      .mockReturnValueOnce({
        id: 'thread-2',
        projectId: 'project-1',
        githubIssueNumber: null,
        status: 'executing',
      })
      .mockReturnValueOnce({
        id: 'thread-2',
        projectId: 'project-1',
        githubIssueNumber: null,
        status: 'executing',
      });
    githubIssueQueries.getByThreadId.mockReturnValue(null);

    transitionThreadPhase(mainWindow as never, queries, emitter, {
      threadId: 'thread-2',
      phase: 'failed',
      errorMessage: 'boom',
    });

    expect(threadQueries.recordFailure).toHaveBeenCalledWith('thread-2', 'executing', 'boom');
    expect(threadQueries.updateStatus).not.toHaveBeenCalled();
    expect(githubIssueQueries.updatePipelineStatus).not.toHaveBeenCalled();
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith({
      type: 'pipeline:phase',
      threadId: 'thread-2',
      phase: 'failed',
    });
  });
});

describe('sendGithubIssuesUpdated', () => {
  const githubIssueQueries = {
    list: vi.fn(() => [{ id: 'issue-1' }]),
  };
  const queries = {
    githubIssues: githubIssueQueries,
  } as unknown as Queries;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends the latest project issue list when the window is live', () => {
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
      },
    };

    sendGithubIssuesUpdated(mainWindow as never, queries, 'project-1');

    expect(githubIssueQueries.list).toHaveBeenCalledWith('project-1');
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [{ id: 'issue-1' }],
    });
  });

  it('skips DB work for destroyed windows and swallows renderer-disposal sends', () => {
    const destroyedWindow = {
      isDestroyed: vi.fn(() => true),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
      },
    };

    sendGithubIssuesUpdated(destroyedWindow as never, queries, 'project-1');

    expect(githubIssueQueries.list).not.toHaveBeenCalled();
    expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();

    const disposedWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(() => {
          throw new Error('Render frame disposed');
        }),
      },
    };

    expect(() =>
      sendGithubIssuesUpdated(disposedWindow as never, queries, 'project-1'),
    ).not.toThrow();
    expect(githubIssueQueries.list).toHaveBeenCalledWith('project-1');
  });
});

describe('attachIssueToConfiguredProjectBoard', () => {
  const project = {
    githubProjectUrl: 'https://github.com/users/decod3rs/projects/7',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null without calling GitHub when project URL or issue URL is missing', async () => {
    const ghCli = {
      addIssueToProject: vi.fn(),
    };

    await expect(
      attachIssueToConfiguredProjectBoard(
        { githubProjectUrl: null } as never,
        ghCli as never,
        42,
        'https://github.com/shipshitdev/shipcode/issues/42',
        'test',
      ),
    ).resolves.toBeNull();
    await expect(
      attachIssueToConfiguredProjectBoard(project as never, ghCli as never, 42, null, 'test'),
    ).resolves.toBeNull();

    expect(ghCli.addIssueToProject).not.toHaveBeenCalled();
  });

  it('attaches issues to the configured GitHub project and clamps attach failures', async () => {
    const ghCli = {
      addIssueToProject: vi.fn().mockResolvedValueOnce(undefined),
    };

    await expect(
      attachIssueToConfiguredProjectBoard(
        project as never,
        ghCli as never,
        42,
        'https://github.com/shipshitdev/shipcode/issues/42',
        'test',
      ),
    ).resolves.toBeNull();
    expect(ghCli.addIssueToProject).toHaveBeenCalledWith({
      owner: 'decod3rs',
      projectNumber: 7,
      issueUrl: 'https://github.com/shipshitdev/shipcode/issues/42',
    });

    ghCli.addIssueToProject.mockRejectedValueOnce(new Error('attach failed\nmore detail'));

    await expect(
      attachIssueToConfiguredProjectBoard(
        project as never,
        ghCli as never,
        42,
        'https://github.com/shipshitdev/shipcode/issues/42',
        'test',
      ),
    ).resolves.toBe('attach failed');
  });
});
