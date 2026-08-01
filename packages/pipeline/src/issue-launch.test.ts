import type {
  GitHubIssueCacheRecord,
  Project,
  ResolvedIssuePhaseModels,
  Thread,
} from '@shipcode/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ISSUE_LAUNCH_MODE, launchIssuePipeline } from './issue-launch';

const project = {
  id: 'project-1',
  path: '/repo',
  gitRemote: 'https://github.com/acme/repo.git',
  defaultBranch: 'master',
} as Project;

const phaseModels: ResolvedIssuePhaseModels = {
  plannerModel: 'codex',
  reviewerModel: 'claude',
  verifierModel: 'codex',
  executorModel: 'openrouter',
  plannerModelId: 'gpt-5.6-sol',
  reviewerModelId: 'claude-opus-4-8',
  verifierModelId: null,
  executorModelId: 'openrouter/auto',
  plannerReasoningEffort: 'high',
  reviewerReasoningEffort: 'high',
  verifierReasoningEffort: 'medium',
  executorReasoningEffort: 'low',
};

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Fix launch orchestration',
    body: 'Use one launch path.',
    labels: ['bug'],
    assignee: null,
    state: 'open',
    pipelineStatus: 'planning',
    threadId: null,
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
    linkedPrNumber: null,
    linkedPrUrl: null,
    linkedPrIsDraft: false,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: '2026-07-14T00:00:00.000Z',
    priorityRank: 'p2',
    priorityRaw: 'P2',
    priorityFetchedAt: '2026-07-14T00:00:00.000Z',
    isQuickMode: false,
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-new',
    projectId: 'project-1',
    title: 'Fix launch orchestration',
    prompt: 'Use one launch path.',
    status: 'idle',
    worktreePath: '/tmp/worktree',
    worktreeBranch: 'shipcode/thread-new',
    ...overrides,
  } as Thread;
}

describe('launchIssuePipeline', () => {
  const newThread = makeThread();
  const threads = {
    getById: vi.fn(() => null as Thread | null),
    create: vi.fn(() => newThread),
    updateIssueContent: vi.fn(),
    setGithubIssue: vi.fn(),
    setGithubIssueNumber: vi.fn(),
    setPhaseModels: vi.fn(),
    resetFailureTracking: vi.fn(),
  };
  const githubIssues = { updatePipelineStatus: vi.fn(), linkThread: vi.fn() };
  const plans = { supersedeAll: vi.fn(), supersedeAllForIssue: vi.fn() };
  const pipeline = {
    startFromGitHubIssue: vi.fn(async () => undefined),
    startFromQuickTask: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    threads.getById.mockReturnValue(null);
    pipeline.startFromGitHubIssue.mockResolvedValue(undefined);
    pipeline.startFromQuickTask.mockResolvedValue(undefined);
  });

  it('creates, links, prepares, and launches a thread through one coordinator', async () => {
    const validatePhaseModels = vi.fn(async () => undefined);
    const onIssueStarted = vi.fn();
    const onIssueLinked = vi.fn();

    const result = await launchIssuePipeline(
      {
        threads: threads as never,
        githubIssues: githubIssues as never,
        plans: plans as never,
        pipeline,
      },
      { project, issue: makeIssue(), phaseModels, executorModelOverride: 'openrouter/auto' },
      { validatePhaseModels, onIssueStarted, onIssueLinked },
    );

    expect(result).toBe(newThread);
    expect(threads.create).toHaveBeenCalledWith(
      'project-1',
      'Use one launch path.',
      'Fix launch orchestration',
    );
    expect(githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-1', 'planning');
    expect(onIssueStarted).toHaveBeenCalledOnce();
    expect(threads.setGithubIssue).toHaveBeenCalledWith(
      'thread-new',
      42,
      'https://github.com/acme/repo.git',
    );
    expect(githubIssues.linkThread).toHaveBeenCalledWith('issue-1', 'thread-new');
    expect(onIssueLinked).toHaveBeenCalledWith(newThread);
    expect(validatePhaseModels).toHaveBeenCalledWith(phaseModels);
    expect(threads.setPhaseModels).toHaveBeenCalledWith('thread-new', phaseModels);
    expect(threads.resetFailureTracking).toHaveBeenCalledWith('thread-new');
    expect(plans.supersedeAll).toHaveBeenCalledWith('thread-new');
    expect(plans.supersedeAllForIssue).toHaveBeenCalledWith('project-1', 42, 'thread-new');
    expect(pipeline.startFromGitHubIssue).toHaveBeenCalledWith(
      'thread-new',
      '/repo',
      {
        number: 42,
        title: 'Fix launch orchestration',
        body: 'Use one launch path.',
        labels: ['bug'],
      },
      'openrouter',
      expect.objectContaining({
        baseBranch: 'master',
        worktreePath: '/tmp/worktree',
        executorModelOverride: 'openrouter/auto',
        executorModelIdOverride: 'openrouter/auto',
      }),
    );
  });

  it('reuses an idle linked thread and refreshes its issue content', async () => {
    const reusableThread = makeThread({ id: 'thread-existing' });
    threads.getById.mockReturnValue(reusableThread);

    const result = await launchIssuePipeline(
      {
        threads: threads as never,
        githubIssues: githubIssues as never,
        plans: plans as never,
        pipeline,
      },
      {
        project,
        issue: makeIssue({ threadId: 'thread-existing', body: null }),
        phaseModels,
      },
    );

    expect(result).toBe(reusableThread);
    expect(threads.create).not.toHaveBeenCalled();
    expect(threads.updateIssueContent).toHaveBeenCalledWith(
      'thread-existing',
      'Fix launch orchestration',
      'Fix launch orchestration',
    );
  });

  it('rejects an active linked thread before mutating launch state', async () => {
    threads.getById.mockReturnValue(makeThread({ id: 'thread-active', status: 'executing' }));

    await expect(
      launchIssuePipeline(
        {
          threads: threads as never,
          githubIssues: githubIssues as never,
          plans: plans as never,
          pipeline,
        },
        { project, issue: makeIssue({ threadId: 'thread-active' }), phaseModels },
      ),
    ).rejects.toThrow('Issue #42 already has active thread');

    expect(threads.setGithubIssue).not.toHaveBeenCalled();
    expect(githubIssues.updatePipelineStatus).not.toHaveBeenCalled();
    expect(githubIssues.linkThread).not.toHaveBeenCalled();
    expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
  });

  it('reports launch failures with the prepared thread and rethrows', async () => {
    const error = new Error('provider unavailable');
    const onLaunchError = vi.fn();
    pipeline.startFromGitHubIssue.mockRejectedValueOnce(error);

    await expect(
      launchIssuePipeline(
        {
          threads: threads as never,
          githubIssues: githubIssues as never,
          plans: plans as never,
          pipeline,
        },
        { project, issue: makeIssue(), phaseModels },
        { onLaunchError },
      ),
    ).rejects.toBe(error);

    expect(onLaunchError).toHaveBeenCalledWith(error, newThread);
  });

  it('routes a validatePhaseModels rejection through onLaunchError instead of stranding the thread', async () => {
    const error = new Error('unsupported model / missing API key');
    const validatePhaseModels = vi.fn(async () => {
      throw error;
    });
    const onLaunchError = vi.fn();

    await expect(
      launchIssuePipeline(
        {
          threads: threads as never,
          githubIssues: githubIssues as never,
          plans: plans as never,
          pipeline,
        },
        { project, issue: makeIssue(), phaseModels },
        { validatePhaseModels, onLaunchError },
      ),
    ).rejects.toBe(error);

    // Validation runs inside the try, so the failure is reported and the thread is
    // never persisted/launched (avoiding a thread stuck forever in `planning`).
    expect(onLaunchError).toHaveBeenCalledWith(error, newThread);
    expect(threads.setPhaseModels).not.toHaveBeenCalled();
    expect(plans.supersedeAll).not.toHaveBeenCalled();
    expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
  });

  describe('quick-task mode', () => {
    const quickThread = makeThread({ id: 'thread-quick', title: 'Local fix', prompt: 'Fix it' });
    const quickIssue = makeIssue({
      id: 'issue-quick',
      issueNumber: -1,
      title: 'Local fix',
      body: 'Fix it',
      labels: [],
      threadId: 'thread-quick',
      isQuickMode: true,
    });

    const deps = () => ({
      threads: threads as never,
      githubIssues: githubIssues as never,
      plans: plans as never,
      pipeline,
    });

    it('dispatches through startFromQuickTask with the shared phase-model options bag', async () => {
      threads.getById.mockReturnValue(quickThread);
      const validatePhaseModels = vi.fn(async () => undefined);
      const onIssueStarted = vi.fn();
      const onIssueLinked = vi.fn();

      const result = await launchIssuePipeline(
        deps(),
        { project, issue: quickIssue, phaseModels, mode: ISSUE_LAUNCH_MODE.quickTask },
        { validatePhaseModels, onIssueStarted, onIssueLinked },
      );

      expect(result).toBe(quickThread);
      expect(threads.create).not.toHaveBeenCalled();
      expect(githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-quick', 'planning');
      expect(onIssueStarted).toHaveBeenCalledOnce();
      expect(onIssueLinked).toHaveBeenCalledWith(quickThread);
      expect(validatePhaseModels).toHaveBeenCalledWith(phaseModels);
      expect(threads.setPhaseModels).toHaveBeenCalledWith('thread-quick', phaseModels);
      expect(threads.resetFailureTracking).toHaveBeenCalledWith('thread-quick');
      expect(plans.supersedeAll).toHaveBeenCalledWith('thread-quick');
      expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
      expect(pipeline.startFromQuickTask).toHaveBeenCalledWith(
        'thread-quick',
        '/repo',
        { issueNumber: -1, title: 'Local fix', text: 'Fix it' },
        'openrouter',
        expect.objectContaining({
          baseBranch: 'master',
          worktreePath: '/tmp/worktree',
          plannerModel: 'codex',
          reviewerModel: 'claude',
          verifierModel: 'codex',
          plannerModelIdOverride: 'gpt-5.6-sol',
          reviewerModelIdOverride: 'claude-opus-4-8',
          executorModelIdOverride: 'openrouter/auto',
          verifierModelIdOverride: null,
          plannerReasoningEffort: 'high',
          reviewerReasoningEffort: 'high',
          executorReasoningEffort: 'low',
          verifierReasoningEffort: 'medium',
        }),
      );
    });

    it('stamps the sentinel issue number without a github repo association', async () => {
      threads.getById.mockReturnValue(quickThread);

      await launchIssuePipeline(deps(), {
        project,
        issue: quickIssue,
        phaseModels,
        mode: ISSUE_LAUNCH_MODE.quickTask,
      });

      expect(threads.setGithubIssueNumber).toHaveBeenCalledWith('thread-quick', -1);
      expect(threads.setGithubIssue).not.toHaveBeenCalled();
    });

    it('never creates a thread for a quick task with no linked thread', async () => {
      await expect(
        launchIssuePipeline(deps(), {
          project,
          issue: makeIssue({ ...quickIssue, threadId: null }),
          phaseModels,
          mode: ISSUE_LAUNCH_MODE.quickTask,
        }),
      ).rejects.toThrow('Quick task -1 has no linked thread');

      expect(threads.create).not.toHaveBeenCalled();
      expect(githubIssues.updatePipelineStatus).not.toHaveBeenCalled();
      expect(pipeline.startFromQuickTask).not.toHaveBeenCalled();
    });

    it('fails when the linked thread row is missing', async () => {
      threads.getById.mockReturnValue(null);

      await expect(
        launchIssuePipeline(deps(), {
          project,
          issue: quickIssue,
          phaseModels,
          mode: ISSUE_LAUNCH_MODE.quickTask,
        }),
      ).rejects.toThrow('Quick task -1: thread thread-quick missing');

      expect(pipeline.startFromQuickTask).not.toHaveBeenCalled();
    });

    it('rejects a quick task whose thread is already running', async () => {
      threads.getById.mockReturnValue(makeThread({ id: 'thread-quick', status: 'executing' }));

      await expect(
        launchIssuePipeline(deps(), {
          project,
          issue: quickIssue,
          phaseModels,
          mode: ISSUE_LAUNCH_MODE.quickTask,
        }),
      ).rejects.toThrow('Quick task -1 already has active thread');

      expect(githubIssues.updatePipelineStatus).not.toHaveBeenCalled();
      expect(pipeline.startFromQuickTask).not.toHaveBeenCalled();
    });

    it('routes quick-task validation failures through onLaunchError', async () => {
      threads.getById.mockReturnValue(quickThread);
      const error = new Error('unsupported model / missing API key');
      const onLaunchError = vi.fn();

      await expect(
        launchIssuePipeline(
          deps(),
          { project, issue: quickIssue, phaseModels, mode: ISSUE_LAUNCH_MODE.quickTask },
          {
            validatePhaseModels: vi.fn(async () => {
              throw error;
            }),
            onLaunchError,
          },
        ),
      ).rejects.toBe(error);

      expect(onLaunchError).toHaveBeenCalledWith(error, quickThread);
      expect(threads.setPhaseModels).not.toHaveBeenCalled();
      expect(pipeline.startFromQuickTask).not.toHaveBeenCalled();
    });

    it('routes quick-task dispatch failures through onLaunchError', async () => {
      threads.getById.mockReturnValue(quickThread);
      const error = new Error('worktree busy');
      const onLaunchError = vi.fn();
      pipeline.startFromQuickTask.mockRejectedValueOnce(error);

      await expect(
        launchIssuePipeline(
          deps(),
          { project, issue: quickIssue, phaseModels, mode: ISSUE_LAUNCH_MODE.quickTask },
          { onLaunchError },
        ),
      ).rejects.toBe(error);

      expect(onLaunchError).toHaveBeenCalledWith(error, quickThread);
    });
  });
});
