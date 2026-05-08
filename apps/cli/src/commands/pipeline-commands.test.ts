import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createCliContextMock,
  requireOnboardingMock,
  getThreadForIssueOrExitMock,
  routeFromLabelsMock,
  createPipelineMock,
  startFromGitHubIssueMock,
  rehydrateContextMock,
  startExecutionMock,
  startVerificationMock,
  startShippingMock,
  startPlanGenerationMock,
  ghGetIssueMock,
  getThreadByIssueMock,
  getLatestPlanMock,
  getReviewByPlanIdMock,
  updatePlanStatusMock,
  getLatestCheckpointMock,
  getLatestVerificationMock,
} = vi.hoisted(() => ({
  createCliContextMock: vi.fn(),
  requireOnboardingMock: vi.fn(),
  getThreadForIssueOrExitMock: vi.fn(),
  routeFromLabelsMock: vi.fn(),
  createPipelineMock: vi.fn(),
  startFromGitHubIssueMock: vi.fn(),
  rehydrateContextMock: vi.fn(),
  startExecutionMock: vi.fn(),
  startVerificationMock: vi.fn(),
  startShippingMock: vi.fn(),
  startPlanGenerationMock: vi.fn(),
  ghGetIssueMock: vi.fn(),
  getThreadByIssueMock: vi.fn(),
  getLatestPlanMock: vi.fn(),
  getReviewByPlanIdMock: vi.fn(),
  updatePlanStatusMock: vi.fn(),
  getLatestCheckpointMock: vi.fn(),
  getLatestVerificationMock: vi.fn(),
}));

vi.mock('../context', () => ({
  createCliContext: createCliContextMock,
}));

vi.mock('./guard', () => ({
  requireOnboarding: requireOnboardingMock,
}));

vi.mock('./issue-helpers', () => ({
  parseIssueNumber: (value: string) => Number(value),
  getThreadForIssueOrExit: getThreadForIssueOrExitMock,
}));

vi.mock('@shipcode/agents', () => ({
  routeFromLabels: routeFromLabelsMock,
}));

vi.mock('@shipcode/pipeline', () => ({
  createPipeline: createPipelineMock,
}));

import { approveCommand } from './approve';
import { planCommand } from './plan';
import { retryCommand } from './retry';
import { reviewCommand } from './review';

describe('pipeline CLI commands', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  });

  const structuredPlan = {
    objective: 'Increase coverage',
    tasks: [],
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
      rehydrateContext: rehydrateContextMock,
      startExecution: startExecutionMock,
      startVerification: startVerificationMock,
      startShipping: startShippingMock,
      startPlanGeneration: startPlanGenerationMock,
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
        updateStatus: updatePlanStatusMock,
      },
      reviews: {
        getByPlanId: getReviewByPlanIdMock,
      },
      checkpoints: {
        getLatest: getLatestCheckpointMock,
      },
      verifications: {
        getLatest: getLatestVerificationMock,
      },
    });
    getThreadForIssueOrExitMock.mockReturnValue({
      id: 'thread-1',
      title: 'Ship coverage',
      status: 'awaiting_approval',
      prompt: 'Fix tests',
      worktreePath: '/tmp/worktree',
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
    getReviewByPlanIdMock.mockReturnValue({
      id: 'review-1',
      decision: 'approve',
    });
    getLatestCheckpointMock.mockReturnValue({
      phase: 'executing',
      reason: 'verification failed',
    });
    getLatestVerificationMock.mockReturnValue(null);
  });

  it('does not create a context when onboarding is incomplete', async () => {
    requireOnboardingMock.mockReturnValueOnce(false);

    await approveCommand('42');

    expect(createCliContextMock).not.toHaveBeenCalled();
    expect(createPipelineMock).not.toHaveBeenCalled();
  });

  it('approves an awaiting thread and resumes execution from the latest plan', async () => {
    await approveCommand('42');

    expect(updatePlanStatusMock).toHaveBeenCalledWith('plan-1', 'approved');
    expect(rehydrateContextMock).toHaveBeenCalledWith('thread-1', '/repo', 'Ship coverage');
    expect(startExecutionMock).toHaveBeenCalledWith('thread-1', structuredPlan);
    expect(logSpy).toHaveBeenCalledWith('Approving plan for issue #42: Ship coverage');
    expect(logSpy).toHaveBeenCalledWith('\nExecution started.');
  });

  it('rejects approve when the thread is not awaiting approval or has no plan', async () => {
    getThreadForIssueOrExitMock.mockReturnValueOnce({
      id: 'thread-1',
      title: 'Ship coverage',
      status: 'executing',
    });

    await expect(approveCommand('42')).rejects.toThrow('process.exit:1');
    expect(errorSpy).toHaveBeenCalledWith(
      'Thread is in "executing" state, not "awaiting_approval". Cannot approve.',
    );

    getThreadForIssueOrExitMock.mockReturnValueOnce({
      id: 'thread-1',
      title: 'Ship coverage',
      status: 'awaiting_approval',
    });
    getLatestPlanMock.mockReturnValueOnce(null);

    await expect(approveCommand('42')).rejects.toThrow('process.exit:1');
    expect(errorSpy).toHaveBeenCalledWith('No plan found for this thread.');
  });

  it('runs plan generation and prints a structured plan when one is saved', async () => {
    await planCommand('42');

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

  it('falls back to claude routing and exits if plan command cannot find the thread', async () => {
    routeFromLabelsMock.mockReturnValueOnce({ error: 'bad label' });
    getThreadByIssueMock.mockReturnValueOnce(null);

    await expect(planCommand('42')).rejects.toThrow('process.exit:1');

    expect(startFromGitHubIssueMock).toHaveBeenCalledWith(
      'project-1',
      '/repo',
      expect.any(Object),
      'claude',
      { baseBranch: 'main', executorModelOverride: null },
    );
    expect(errorSpy).toHaveBeenCalledWith('Thread not found after pipeline run.');
  });

  it('prints plan and review outcomes from review command', async () => {
    await reviewCommand('42');

    expect(getReviewByPlanIdMock).toHaveBeenCalledWith('plan-1');
    expect(logSpy).toHaveBeenCalledWith('\n--- Review Output ---');
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ id: 'review-1', decision: 'approve' }, null, 2),
    );
  });

  it('prints review fallback messages when plan or review records are missing', async () => {
    getLatestPlanMock.mockReturnValueOnce(null);

    await reviewCommand('42');

    expect(logSpy).toHaveBeenCalledWith(
      '\nNo plan generated (pipeline may have failed before plan phase).',
    );

    getLatestPlanMock.mockReturnValueOnce({ id: 'plan-1', structured: structuredPlan });
    getReviewByPlanIdMock.mockReturnValueOnce(null);

    await reviewCommand('42');

    expect(logSpy).toHaveBeenCalledWith(
      '\nNo review generated (pipeline may have stopped before review phase).',
    );
  });

  it('retries from executing, verifying, shipping, and fallback checkpoints', async () => {
    await retryCommand('42');
    expect(startExecutionMock).toHaveBeenCalledWith('thread-1', structuredPlan);

    getLatestCheckpointMock.mockReturnValueOnce({ phase: 'verifying', reason: 'tests failed' });
    await retryCommand('42');
    expect(startVerificationMock).toHaveBeenCalledWith('thread-1');

    getLatestCheckpointMock.mockReturnValueOnce({ phase: 'shipping', reason: 'push failed' });
    await retryCommand('42');
    expect(startShippingMock).toHaveBeenCalledWith('thread-1');

    getLatestCheckpointMock.mockReturnValueOnce({ phase: 'planning', reason: 'manual retry' });
    await retryCommand('42');
    expect(startPlanGenerationMock).toHaveBeenCalledWith(
      'thread-1',
      'Fix tests',
      '/repo',
      '/tmp/worktree',
    );
  });

  it('rejects retry when there is no checkpoint or no plan for execution retry', async () => {
    getLatestCheckpointMock.mockReturnValueOnce(null);

    await expect(retryCommand('42')).rejects.toThrow('process.exit:1');
    expect(errorSpy).toHaveBeenCalledWith(
      'No checkpoint found for this thread. Nothing to retry from.',
    );

    getLatestCheckpointMock.mockReturnValueOnce({
      phase: 'executing',
      reason: 'verification failed',
    });
    getLatestPlanMock.mockReturnValueOnce(null);

    await expect(retryCommand('42')).rejects.toThrow('process.exit:1');
    expect(errorSpy).toHaveBeenCalledWith('No plan found for retry.');
  });
});
