import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createCliContextMock,
  requireOnboardingMock,
  createPipelineMock,
  rehydrateContextMock,
  startExecutionMock,
  getThreadByIssueMock,
  getLatestPlanMock,
  updatePlanStatusMock,
} = vi.hoisted(() => ({
  createCliContextMock: vi.fn(),
  requireOnboardingMock: vi.fn(),
  createPipelineMock: vi.fn(),
  rehydrateContextMock: vi.fn(),
  startExecutionMock: vi.fn(),
  getThreadByIssueMock: vi.fn(),
  getLatestPlanMock: vi.fn(),
  updatePlanStatusMock: vi.fn(),
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

vi.mock('@shipcode/shared', () => ({
  PIPELINE_PHASE: {
    approval: 'approval',
  },
}));

import { approveCommand } from './approve';

describe('approveCommand', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
        updateStatus: updatePlanStatusMock,
      },
    });
    getThreadByIssueMock.mockReturnValue({
      id: 'thread-1',
      title: 'Ship coverage',
      status: 'approval',
    });
    getLatestPlanMock.mockReturnValue({
      id: 'plan-1',
      structured: structuredPlan,
    });
    startExecutionMock.mockResolvedValue(undefined);
  });

  it('exits on invalid issue numbers before looking up a thread', async () => {
    await expect(approveCommand('abc')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('Invalid issue number:', 'abc');
    expect(getThreadByIssueMock).not.toHaveBeenCalled();
  });

  it('exits when no thread exists for the issue', async () => {
    getThreadByIssueMock.mockReturnValueOnce(null);

    await expect(approveCommand('42')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('No thread found for issue #42 in this project.');
  });

  it('exits when the thread is not in approval', async () => {
    getThreadByIssueMock.mockReturnValueOnce({
      id: 'thread-1',
      title: 'Ship coverage',
      status: 'executing',
    });

    await expect(approveCommand('42')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith(
      'Thread is in "executing" state, not "approval". Cannot approve.',
    );
  });

  it('exits when the latest plan is missing or unstructured', async () => {
    getLatestPlanMock.mockReturnValueOnce({ id: 'plan-1', structured: null });

    await expect(approveCommand('42')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('No plan found for this thread.');
  });

  it('marks the plan approved and resumes execution from the structured plan', async () => {
    await approveCommand('42');

    expect(createPipelineMock).toHaveBeenCalledWith({ deps: true });
    expect(rehydrateContextMock).toHaveBeenCalledWith('thread-1', '/repo', 'Ship coverage');
    expect(updatePlanStatusMock).toHaveBeenCalledWith('plan-1', 'approved');
    expect(startExecutionMock).toHaveBeenCalledWith('thread-1', structuredPlan);
    expect(logSpy).toHaveBeenCalledWith('Plan objective: Increase coverage');
    expect(logSpy).toHaveBeenCalledWith('\nExecution started.');
  });
});
