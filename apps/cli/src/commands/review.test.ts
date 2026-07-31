import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createCliContextMock,
  requireOnboardingMock,
  routeFromLabelsMock,
  createPipelineMock,
  launchIssuePipelineMock,
  upsertIssueMock,
  ghGetIssueMock,
  getThreadByIssueMock,
  getLatestPlanMock,
  getReviewByPlanIdMock,
} = vi.hoisted(() => ({
  createCliContextMock: vi.fn(),
  requireOnboardingMock: vi.fn(),
  routeFromLabelsMock: vi.fn(),
  createPipelineMock: vi.fn(),
  launchIssuePipelineMock: vi.fn(),
  upsertIssueMock: vi.fn(),
  ghGetIssueMock: vi.fn(),
  getThreadByIssueMock: vi.fn(),
  getLatestPlanMock: vi.fn(),
  getReviewByPlanIdMock: vi.fn(),
}));

vi.mock('../context', () => ({
  createCliContext: createCliContextMock,
}));

vi.mock('./guard', () => ({
  requireOnboarding: requireOnboardingMock,
}));

vi.mock('@shipcode/agents', () => ({
  routeFromLabels: routeFromLabelsMock,
}));

vi.mock('@shipcode/pipeline', () => ({
  createPipeline: createPipelineMock,
  launchIssuePipeline: launchIssuePipelineMock,
}));

vi.mock('@shipcode/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipcode/shared')>();
  return {
    ...actual,
    resolveIssuePhaseModels: vi.fn(() => ({
      plannerModel: 'codex',
      reviewerModel: 'codex',
      verifierModel: 'codex',
      executorModel: 'codex',
      plannerModelId: null,
      reviewerModelId: null,
      verifierModelId: null,
      executorModelId: null,
      plannerReasoningEffort: 'high',
      reviewerReasoningEffort: 'high',
      verifierReasoningEffort: 'high',
      executorReasoningEffort: 'high',
    })),
    resolveProviderReasoningEffort: vi.fn(() => ({ effective: 'high' })),
  };
});

import { reviewCommand } from './review';

describe('reviewCommand', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    requireOnboardingMock.mockReturnValue(true);
    routeFromLabelsMock.mockReturnValue({
      executorModel: 'codex',
      modelOverride: 'gpt-5.4',
    });
    createPipelineMock.mockReturnValue({});
    launchIssuePipelineMock.mockResolvedValue({ id: 'thread-1' });
    upsertIssueMock.mockReturnValue({
      id: 'issue-cache-7',
      issueNumber: 7,
      requireApprovalOverride: null,
    });
    createCliContextMock.mockReturnValue({
      project: {
        id: 'project-1',
        path: '/repo',
        defaultBranch: 'develop',
      },
      pipelineDeps: { deps: true },
      ghCli: {
        getIssue: ghGetIssueMock,
      },
      threads: {
        getById: vi.fn(() => ({ id: 'thread-1', status: 'approval' })),
        getByProjectAndGithubIssue: getThreadByIssueMock,
      },
      githubIssues: {
        upsert: upsertIssueMock,
        updateRequireApprovalOverride: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ executorReasoningEffort: 'high' })),
      },
      plans: {
        getLatest: getLatestPlanMock,
      },
      reviews: {
        getByPlanId: getReviewByPlanIdMock,
      },
    });
    ghGetIssueMock.mockResolvedValue({
      number: 7,
      title: 'Review branch',
      body: 'Check plan',
      labels: ['shipcode:agent:codex/gpt-5.4'],
    });
    getThreadByIssueMock.mockReturnValue({
      id: 'thread-1',
      status: 'approval',
    });
    getLatestPlanMock.mockReturnValue({
      id: 'plan-1',
      structured: { objective: 'Ship review tests' },
    });
    getReviewByPlanIdMock.mockReturnValue({
      id: 'review-1',
      decision: 'approve',
    });
  });

  it('fetches the issue, routes labels, starts the pipeline, and prints the generated review', async () => {
    await reviewCommand('7');

    expect(ghGetIssueMock).toHaveBeenCalledWith(7);
    expect(launchIssuePipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({ pipeline: expect.any(Object) }),
      expect.objectContaining({
        issue: expect.objectContaining({
          id: 'issue-cache-7',
          issueNumber: 7,
          requireApprovalOverride: true,
        }),
        phaseModels: expect.objectContaining({
          executorModel: 'codex',
          executorModelId: 'gpt-5.4',
        }),
        executorModelOverride: 'gpt-5.4',
      }),
    );
    expect(getReviewByPlanIdMock).toHaveBeenCalledWith('plan-1');
    expect(logSpy).toHaveBeenCalledWith('\n--- Review Output ---');
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ id: 'review-1', decision: 'approve' }, null, 2),
    );
    expect(logSpy).toHaveBeenCalledWith('\nThread status: approval');
  });

  it('returns before doing work when onboarding is incomplete', async () => {
    requireOnboardingMock.mockReturnValueOnce(false);

    await reviewCommand('7');

    expect(createCliContextMock).not.toHaveBeenCalled();
  });

  it('passes null when successful routing has no model override', async () => {
    routeFromLabelsMock.mockReturnValueOnce({ executorModel: 'codex' });

    await reviewCommand('7');

    expect(launchIssuePipelineMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        phaseModels: expect.objectContaining({ executorModel: 'codex' }),
        executorModelOverride: null,
      }),
    );
  });

  it('falls back to Codex routing when label routing returns an error', async () => {
    routeFromLabelsMock.mockReturnValueOnce({ error: 'bad label' });

    await reviewCommand('7');

    expect(launchIssuePipelineMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        phaseModels: expect.objectContaining({ executorModel: 'codex' }),
        executorModelOverride: null,
      }),
    );
  });

  it('exits when the pipeline run does not persist a thread', async () => {
    const base = createCliContextMock();
    createCliContextMock.mockReturnValueOnce({
      ...base,
      threads: {
        getById: vi
          .fn()
          .mockReturnValueOnce({ id: 'thread-1', status: 'approval' })
          .mockReturnValue(null),
        getByProjectAndGithubIssue: vi.fn(() => null),
      },
    });

    await expect(reviewCommand('7')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('Thread not found after pipeline run.');
  });

  it('prints no-output branches when the plan or review is missing', async () => {
    getLatestPlanMock.mockReturnValueOnce(null);

    await reviewCommand('7');

    expect(logSpy).toHaveBeenCalledWith(
      '\nNo plan generated (pipeline may have failed before plan phase).',
    );

    getReviewByPlanIdMock.mockReturnValueOnce(null);

    await reviewCommand('7');

    expect(logSpy).toHaveBeenCalledWith(
      '\nNo review generated (pipeline may have stopped before review phase).',
    );
  });
});
