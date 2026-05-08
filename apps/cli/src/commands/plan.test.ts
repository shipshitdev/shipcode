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
} = vi.hoisted(() => ({
  createCliContextMock: vi.fn(),
  requireOnboardingMock: vi.fn(),
  routeFromLabelsMock: vi.fn(),
  createPipelineMock: vi.fn(),
  startFromGitHubIssueMock: vi.fn(),
  ghGetIssueMock: vi.fn(),
  getThreadByIssueMock: vi.fn(),
  getLatestPlanMock: vi.fn(),
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

import { planCommand } from './plan';

describe('planCommand', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  });

  const structuredPlan = {
    id: 'plan-1',
    threadId: 'thread-1',
    version: 1,
    objective: 'Increase coverage',
    files: [],
    steps: [],
    acceptanceCriteria: [],
    outOfScope: [],
    estimatedComplexity: 'low',
    dependencies: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    requireOnboardingMock.mockReturnValue(true);
    routeFromLabelsMock.mockReturnValue({
      executorModel: 'openrouter',
      modelOverride: 'openrouter/auto',
    });
    createPipelineMock.mockReturnValue({
      startFromGitHubIssue: startFromGitHubIssueMock,
    });
    createCliContextMock.mockReturnValue({
      project: {
        id: 'project-1',
        path: '/repo',
        defaultBranch: 'main',
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
    });
    ghGetIssueMock.mockResolvedValue({
      number: 42,
      title: 'Ship coverage',
      body: 'Add tests',
      labels: ['shipcode:agent:openrouter/auto'],
    });
    getThreadByIssueMock.mockReturnValue({
      id: 'thread-1',
      status: 'awaiting_approval',
    });
    getLatestPlanMock.mockReturnValue({
      id: 'plan-1',
      structured: structuredPlan,
    });
    startFromGitHubIssueMock.mockResolvedValue(undefined);
  });

  it('fetches the issue, routes labels, starts the pipeline, and prints the generated plan', async () => {
    await planCommand('42');

    expect(ghGetIssueMock).toHaveBeenCalledWith(42);
    expect(startFromGitHubIssueMock).toHaveBeenCalledWith(
      'project-1',
      '/repo',
      {
        number: 42,
        title: 'Ship coverage',
        body: 'Add tests',
        labels: ['shipcode:agent:openrouter/auto'],
      },
      'openrouter',
      { baseBranch: 'main', executorModelOverride: 'openrouter/auto' },
    );
    expect(logSpy).toHaveBeenCalledWith('\n--- Plan Output ---');
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(structuredPlan, null, 2));
    expect(logSpy).toHaveBeenCalledWith('\nThread status: awaiting_approval');
  });

  it('falls back to Claude routing when label routing returns an error', async () => {
    routeFromLabelsMock.mockReturnValueOnce({ error: 'bad label' });

    await planCommand('42');

    expect(startFromGitHubIssueMock).toHaveBeenCalledWith(
      'project-1',
      '/repo',
      expect.any(Object),
      'claude',
      { baseBranch: 'main', executorModelOverride: null },
    );
  });

  it('exits when the pipeline run does not persist a thread', async () => {
    getThreadByIssueMock.mockReturnValueOnce(null);

    await expect(planCommand('42')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('Thread not found after pipeline run.');
  });

  it('prints the no-output branch when no structured plan is available', async () => {
    getLatestPlanMock.mockReturnValueOnce(null);

    await planCommand('42');

    expect(logSpy).toHaveBeenCalledWith(
      '\nNo plan generated (pipeline may have failed or entered clarification).',
    );
  });
});
