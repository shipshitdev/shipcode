import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createCliContextMock,
  requireOnboardingMock,
  createPipelineMock,
  rehydrateContextMock,
  startExecutionMock,
  startVerificationMock,
  startShippingMock,
  startPlanGenerationMock,
  getThreadByIssueMock,
  getLatestPlanMock,
  getLatestCheckpointMock,
  getLatestVerificationMock,
} = vi.hoisted(() => ({
  createCliContextMock: vi.fn(),
  requireOnboardingMock: vi.fn(),
  createPipelineMock: vi.fn(),
  rehydrateContextMock: vi.fn(),
  startExecutionMock: vi.fn(),
  startVerificationMock: vi.fn(),
  startShippingMock: vi.fn(),
  startPlanGenerationMock: vi.fn(),
  getThreadByIssueMock: vi.fn(),
  getLatestPlanMock: vi.fn(),
  getLatestCheckpointMock: vi.fn(),
  getLatestVerificationMock: vi.fn(),
}));

vi.mock('../context', () => ({
  createCliContext: createCliContextMock,
}));

vi.mock('./guard', () => ({
  requireOnboarding: requireOnboardingMock,
}));

vi.mock('@shipcode/pipeline', () => ({
  createPipeline: createPipelineMock,
}));

import { retryCommand } from './retry';

describe('retryCommand', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  });

  const structuredPlan = {
    objective: 'Increase coverage',
    files: [],
    steps: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    requireOnboardingMock.mockReturnValue(true);
    createPipelineMock.mockReturnValue({
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
      },
      pipelineDeps: { deps: true },
      threads: {
        getByProjectAndGithubIssue: getThreadByIssueMock,
      },
      plans: {
        getLatest: getLatestPlanMock,
      },
      checkpoints: {
        getLatest: getLatestCheckpointMock,
      },
      verifications: {
        getLatest: getLatestVerificationMock,
      },
    });
    getThreadByIssueMock.mockReturnValue({
      id: 'thread-1',
      title: 'Ship coverage',
      status: 'failed',
      prompt: 'Fix tests',
      worktreePath: '/tmp/worktree',
    });
    getLatestPlanMock.mockReturnValue({
      id: 'plan-1',
      structured: structuredPlan,
    });
    getLatestCheckpointMock.mockReturnValue({
      phase: 'executing',
      reason: 'verification failed',
    });
    getLatestVerificationMock.mockReturnValue(null);
  });

  it('exits on invalid issue numbers before looking up a thread', async () => {
    await expect(retryCommand('abc')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('Invalid issue number:', 'abc');
    expect(getThreadByIssueMock).not.toHaveBeenCalled();
  });

  it('exits when no thread exists for the issue', async () => {
    getThreadByIssueMock.mockReturnValueOnce(null);

    await expect(retryCommand('42')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('No thread found for issue #42 in this project.');
  });

  it('exits when there is no checkpoint', async () => {
    getLatestCheckpointMock.mockReturnValueOnce(null);

    await expect(retryCommand('42')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith(
      'No checkpoint found for this thread. Nothing to retry from.',
    );
  });

  it('exits when execution retry has no structured plan', async () => {
    getLatestPlanMock.mockReturnValueOnce({ id: 'plan-1', structured: null });

    await expect(retryCommand('42')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('No plan found for retry.');
  });

  it('resumes execution from an executing checkpoint', async () => {
    await retryCommand('42');

    expect(rehydrateContextMock).toHaveBeenCalledWith('thread-1', '/repo', 'Ship coverage');
    expect(startExecutionMock).toHaveBeenCalledWith('thread-1', structuredPlan);
  });

  it('resumes execution when current-plan verification failed with structured findings', async () => {
    getLatestCheckpointMock.mockReturnValueOnce({
      phase: 'verifying',
      reason: 'verification failed',
    });
    getLatestVerificationMock.mockReturnValueOnce({
      id: 'verification-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      result: 'failed',
      structured: {
        result: 'failed',
        summary: 'Needs fixes',
        criteriaResults: [],
        issues: [{ severity: 'high', title: 'Test failed' }],
      },
    });

    await retryCommand('42');

    expect(startExecutionMock).toHaveBeenCalledWith('thread-1', structuredPlan);
    expect(startVerificationMock).not.toHaveBeenCalled();
  });

  it('re-runs verification when current-plan verification failed without structured findings', async () => {
    getLatestCheckpointMock.mockReturnValueOnce({
      phase: 'verifying',
      reason: 'verification failed',
    });
    getLatestVerificationMock.mockReturnValueOnce({
      id: 'verification-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      result: 'failed',
      structured: null,
    });

    await retryCommand('42');

    expect(startVerificationMock).toHaveBeenCalledWith('thread-1');
    expect(startExecutionMock).not.toHaveBeenCalled();
  });

  it('re-runs verification when the latest verification is for an older plan', async () => {
    getLatestCheckpointMock.mockReturnValueOnce({
      phase: 'verifying',
      reason: 'verification failed',
    });
    getLatestVerificationMock.mockReturnValueOnce({
      id: 'verification-1',
      threadId: 'thread-1',
      planId: 'older-plan',
      result: 'failed',
      structured: { result: 'failed', summary: 'Old feedback', criteriaResults: [], issues: [] },
    });

    await retryCommand('42');

    expect(startVerificationMock).toHaveBeenCalledWith('thread-1');
  });

  it('resumes shipping from a shipping checkpoint', async () => {
    getLatestCheckpointMock.mockReturnValueOnce({ phase: 'shipping', reason: 'push failed' });

    await retryCommand('42');

    expect(startShippingMock).toHaveBeenCalledWith('thread-1');
  });

  it('falls back to plan generation for unknown checkpoint phases', async () => {
    getLatestCheckpointMock.mockReturnValueOnce({ phase: 'planning', reason: 'manual retry' });

    await retryCommand('42');

    expect(startPlanGenerationMock).toHaveBeenCalledWith(
      'thread-1',
      'Fix tests',
      '/repo',
      '/tmp/worktree',
    );
  });
});
