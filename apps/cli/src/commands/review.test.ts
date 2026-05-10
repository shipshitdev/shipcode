import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createCliContextMock,
  requireOnboardingMock,
  routeFromLabelsMock,
  createPipelineMock,
  startFromGitHubIssueMock,
  ghGetIssueMock,
  getThreadByIssueMock,
  getLatestPlanMock,
  getReviewByPlanIdMock,
} = vi.hoisted(() => ({
  createCliContextMock: vi.fn(),
  requireOnboardingMock: vi.fn(),
  routeFromLabelsMock: vi.fn(),
  createPipelineMock: vi.fn(),
  startFromGitHubIssueMock: vi.fn(),
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
}));

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
    createPipelineMock.mockReturnValue({
      startFromGitHubIssue: startFromGitHubIssueMock,
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
        getByProjectAndGithubIssue: getThreadByIssueMock,
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
    startFromGitHubIssueMock.mockResolvedValue(undefined);
  });

  it('fetches the issue, routes labels, starts the pipeline, and prints the generated review', async () => {
    await reviewCommand('7');

    expect(ghGetIssueMock).toHaveBeenCalledWith(7);
    expect(startFromGitHubIssueMock).toHaveBeenCalledWith(
      'project-1',
      '/repo',
      {
        number: 7,
        title: 'Review branch',
        body: 'Check plan',
        labels: ['shipcode:agent:codex/gpt-5.4'],
      },
      'codex',
      { baseBranch: 'develop', executorModelOverride: 'gpt-5.4' },
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

    expect(startFromGitHubIssueMock).toHaveBeenCalledWith(
      'project-1',
      '/repo',
      expect.any(Object),
      'codex',
      { baseBranch: 'develop', executorModelOverride: null },
    );
  });

  it('falls back to Claude routing when label routing returns an error', async () => {
    routeFromLabelsMock.mockReturnValueOnce({ error: 'bad label' });

    await reviewCommand('7');

    expect(startFromGitHubIssueMock).toHaveBeenCalledWith(
      'project-1',
      '/repo',
      expect.any(Object),
      'claude',
      { baseBranch: 'develop', executorModelOverride: null },
    );
  });

  it('exits when the pipeline run does not persist a thread', async () => {
    getThreadByIssueMock.mockReturnValueOnce(null);

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
