import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineDeps, PipelineStartOptions } from '../types';
import { bootstrapPipelineRun } from './run-bootstrap';
import type { PipelineContextHelpers } from './shared';

const { mockGetDefaultBranch, mockResolveForkPointSha } = vi.hoisted(() => ({
  mockGetDefaultBranch: vi.fn<() => Promise<string>>(),
  mockResolveForkPointSha: vi.fn<(cwd: string, baseBranch: string) => Promise<string>>(),
}));

vi.mock('@shipcode/git', () => ({
  GitService: class {
    getDefaultBranch = mockGetDefaultBranch;
  },
  resolveForkPointSha: mockResolveForkPointSha,
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
    mockGetDefaultBranch.mockReset();
    mockResolveForkPointSha.mockReset();
    mockGetDefaultBranch.mockResolvedValue('develop');
    mockResolveForkPointSha.mockResolvedValue('fork-sha');
  });

  for (const githubIssueNumber of [42, null]) {
    it(`seeds the shared autonomous context for githubIssueNumber=${githubIssueNumber}`, async () => {
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

      const result = await bootstrapPipelineRun(harness.deps, harness.contextHelpers, {
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

  it('falls back to main and an empty fork point while applying setting defaults', async () => {
    mockGetDefaultBranch.mockRejectedValue(new Error('git unavailable'));
    mockResolveForkPointSha.mockResolvedValue('');
    const harness = makeHarness();
    harness.createRun.mockReturnValue(null);

    const result = await bootstrapPipelineRun(harness.deps, harness.contextHelpers, {
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

  it('uses an explicit base branch without probing origin HEAD', async () => {
    mockGetDefaultBranch.mockRejectedValue(new Error('unexpected origin probe'));
    mockResolveForkPointSha.mockResolvedValue('release-sha');
    const harness = makeHarness();

    const result = await bootstrapPipelineRun(harness.deps, harness.contextHelpers, {
      threadId: 'thread-3',
      projectPath: '/repo',
      githubIssueNumber: 7,
      githubIssueTitle: 'Explicit base',
      executorModel: 'codex',
      options: { baseBranch: 'release' },
      createRun: harness.createRun,
    });

    expect(result).toMatchObject({ baseBranch: 'release', forkPointSha: 'release-sha' });
    expect(mockGetDefaultBranch).not.toHaveBeenCalled();
    expect(mockResolveForkPointSha).toHaveBeenCalledWith('/repo', 'release');
  });

  // Regression for #533: a clone that only ever ran ShipCode worktrees has
  // `origin/master` but no local `master`. The old resolver hardcoded 'main' on
  // any probe failure and then rev-parsed the bare name, so both the base
  // branch and the fork point came out wrong.
  it('records the origin trunk and its fork point for a repo with no local master', async () => {
    mockGetDefaultBranch.mockResolvedValue('master');
    mockResolveForkPointSha.mockImplementation(async (_cwd, baseBranch) =>
      baseBranch === 'master' ? 'origin-master-sha' : '',
    );
    const harness = makeHarness();

    const result = await bootstrapPipelineRun(harness.deps, harness.contextHelpers, {
      threadId: 'thread-4',
      projectPath: '/repo',
      githubIssueNumber: 533,
      githubIssueTitle: 'Master-only trunk',
      executorModel: 'claude',
      createRun: harness.createRun,
    });

    expect(result).toMatchObject({ baseBranch: 'master', forkPointSha: 'origin-master-sha' });
    expect(mockResolveForkPointSha).toHaveBeenCalledWith('/repo', 'master');
    expect(harness.updateAutonomousFields).toHaveBeenCalledWith(
      'thread-4',
      expect.objectContaining({ baseBranch: 'master', forkPointSha: 'origin-master-sha' }),
    );
  });
});
