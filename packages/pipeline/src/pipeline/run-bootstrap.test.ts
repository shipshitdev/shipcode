import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineDeps, PipelineStartOptions } from '../types';
import type { PipelineContextHelpers } from './shared';
import { bootstrapPipelineRun } from './run-bootstrap';

const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((command: string, args: string[] = [], options?: object) =>
    mockExecFileSync([command, ...args].join(' '), options),
  ),
}));

const settings = {
  plannerModel: 'claude',
  reviewerModel: 'codex',
  verifierModel: 'claude',
  plannerReasoningEffort: 'medium',
  reviewerReasoningEffort: 'high',
  executorReasoningEffort: 'medium',
  verifierReasoningEffort: 'high',
};

function makeHarness() {
  const updateAutonomousFields = vi.fn();
  const clearClarification = vi.fn();
  const getSettings = vi.fn(() => settings);
  const ensureContext = vi.fn();
  const createRun = vi.fn<() => string | null>(() => 'run-1');

  return {
    deps: {
      settings: { get: getSettings },
      threads: { updateAutonomousFields, clearClarification },
    } as unknown as PipelineDeps,
    contextHelpers: { ensureContext } as unknown as PipelineContextHelpers,
    updateAutonomousFields,
    clearClarification,
    getSettings,
    ensureContext,
    createRun,
  };
}

describe('bootstrapPipelineRun', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  for (const githubIssueNumber of [42, null]) {
    it(`seeds the shared autonomous context for githubIssueNumber=${githubIssueNumber}`, () => {
      mockExecFileSync.mockImplementation((command: string) => {
        if (command.includes('symbolic-ref')) return 'origin/develop';
        if (command.includes('rev-parse')) return 'fork-sha';
        return '';
      });
      const harness = makeHarness();
      const options: PipelineStartOptions = {
        worktreePath: '/tmp/worktree',
        executorModelOverride: 'openrouter/custom',
        plannerModel: 'codex',
        reviewerModel: 'claude',
        verifierModel: 'openrouter',
        plannerModelIdOverride: 'planner-id',
        reviewerModelIdOverride: 'reviewer-id',
        executorModelIdOverride: 'executor-id',
        verifierModelIdOverride: 'verifier-id',
        plannerReasoningEffort: 'high',
        reviewerReasoningEffort: 'medium',
        executorReasoningEffort: 'low',
        verifierReasoningEffort: 'high',
      };

      const result = bootstrapPipelineRun(harness.deps, harness.contextHelpers, {
        threadId: 'thread-1',
        projectPath: '/repo',
        githubIssueNumber,
        githubIssueTitle: 'Shared bootstrap',
        executorModel: 'openrouter',
        options,
        createRun: harness.createRun,
      });

      expect(result).toEqual({
        settings,
        worktreePath: '/tmp/worktree',
        baseBranch: 'develop',
        forkPointSha: 'fork-sha',
      });
      expect(harness.updateAutonomousFields).toHaveBeenCalledWith('thread-1', {
        autonomous: true,
        reviewRound: 0,
        executorModel: 'openrouter',
        baseBranch: 'develop',
        forkPointSha: 'fork-sha',
      });
      expect(harness.clearClarification).toHaveBeenCalledWith('thread-1');
      expect(harness.createRun).toHaveBeenCalledOnce();
      expect(harness.ensureContext).toHaveBeenCalledWith('thread-1', {
        projectPath: '/repo',
        runId: 'run-1',
        worktreePath: '/tmp/worktree',
        retryCount: 0,
        autonomous: true,
        reviewRound: 0,
        clarificationRound: 0,
        clarificationRequest: null,
        clarificationAnswers: [],
        clarificationHistory: [],
        verificationRetries: 0,
        githubIssueNumber,
        githubIssueTitle: 'Shared bootstrap',
        githubRepo: null,
        plannerModel: 'codex',
        reviewerModel: 'claude',
        verifierModel: 'openrouter',
        executorModel: 'openrouter',
        plannerModelIdOverride: 'planner-id',
        reviewerModelIdOverride: 'reviewer-id',
        executorModelIdOverride: 'executor-id',
        verifierModelIdOverride: 'verifier-id',
        plannerReasoningEffort: 'high',
        reviewerReasoningEffort: 'medium',
        executorReasoningEffort: 'low',
        verifierReasoningEffort: 'high',
        executorModelOverride: 'openrouter/custom',
        baseBranch: 'develop',
        forkPointSha: 'fork-sha',
        activeProcessId: null,
        cancelled: false,
        verifiedSha: null,
      });
      expect(harness.updateAutonomousFields.mock.invocationCallOrder[0]).toBeLessThan(
        harness.createRun.mock.invocationCallOrder[0],
      );
      expect(harness.createRun.mock.invocationCallOrder[0]).toBeLessThan(
        harness.ensureContext.mock.invocationCallOrder[0],
      );
    });
  }

  it('falls back to main and an empty fork point while applying setting defaults', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('git unavailable');
    });
    const harness = makeHarness();
    harness.createRun.mockReturnValue(null);

    const result = bootstrapPipelineRun(harness.deps, harness.contextHelpers, {
      threadId: 'thread-2',
      projectPath: '/repo',
      githubIssueNumber: null,
      githubIssueTitle: 'Fallback',
      executorModel: 'claude',
      createRun: harness.createRun,
    });

    expect(result).toMatchObject({
      worktreePath: null,
      baseBranch: 'main',
      forkPointSha: '',
    });
    expect(harness.ensureContext).toHaveBeenCalledWith(
      'thread-2',
      expect.objectContaining({
        runId: null,
        plannerModel: 'claude',
        reviewerModel: 'codex',
        verifierModel: 'claude',
        plannerReasoningEffort: 'medium',
        reviewerReasoningEffort: 'high',
        executorReasoningEffort: 'medium',
        verifierReasoningEffort: 'high',
      }),
    );
  });

  it('uses an explicit base branch without probing origin HEAD', () => {
    mockExecFileSync.mockImplementation((command: string) => {
      if (command.includes('symbolic-ref')) throw new Error('unexpected origin probe');
      if (command === 'git rev-parse release') return 'release-sha';
      return '';
    });
    const harness = makeHarness();

    const result = bootstrapPipelineRun(harness.deps, harness.contextHelpers, {
      threadId: 'thread-3',
      projectPath: '/repo',
      githubIssueNumber: 7,
      githubIssueTitle: 'Explicit base',
      executorModel: 'codex',
      options: { baseBranch: 'release' },
      createRun: harness.createRun,
    });

    expect(result).toMatchObject({ baseBranch: 'release', forkPointSha: 'release-sha' });
    expect(mockExecFileSync).toHaveBeenCalledOnce();
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git rev-parse release',
      expect.objectContaining({ cwd: '/repo' }),
    );
  });
});
