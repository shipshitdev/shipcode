import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireOnboardingMock,
  mkdirSyncMock,
  getDatabaseMock,
  addProjectMock,
  listProjectsMock,
  getIssueMock,
  routeFromLabelsMock,
  createCliEmitterMock,
  launchIssuePipelineMock,
  upsertIssueMock,
  settingsGetMock,
  EmptyQuery,
} = vi.hoisted(() => ({
  requireOnboardingMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  getDatabaseMock: vi.fn(),
  addProjectMock: vi.fn(),
  listProjectsMock: vi.fn(),
  getIssueMock: vi.fn(),
  routeFromLabelsMock: vi.fn(),
  createCliEmitterMock: vi.fn(),
  launchIssuePipelineMock: vi.fn(),
  upsertIssueMock: vi.fn(),
  settingsGetMock: vi.fn(),
  EmptyQuery: class {},
}));

vi.mock('node:fs', () => ({
  default: {
    mkdirSync: mkdirSyncMock,
  },
}));

vi.mock('@shipcode/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipcode/db')>();
  return {
    ...actual,
    getDatabase: getDatabaseMock,
    ProjectQueries: class {
      list = listProjectsMock;
      add = addProjectMock;
    },
    SettingsQueries: class {
      get = settingsGetMock;
    },
    GitHubIssueQueries: class {
      upsert = upsertIssueMock;
    },
    TaskGraphQueries: EmptyQuery,
  };
});

vi.mock('@shipcode/agents', () => ({
  ProcessManager: class {},
  GhCli: class {
    getIssue = getIssueMock;
  },
  routeFromLabels: routeFromLabelsMock,
  createClaudeCliProvider: vi.fn(() => ({ id: 'claude' })),
  createCodexCliProvider: vi.fn(() => ({ id: 'codex' })),
  createGrokCliProvider: vi.fn(() => ({ id: 'grok' })),
  createOpenRouterProvider: vi.fn(() => ({ id: 'openrouter' })),
  createProviderRegistry: vi.fn((providers) => providers),
}));

vi.mock('@shipcode/pipeline', () => ({
  createPipeline: vi.fn(() => ({})),
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

vi.mock('../adapters/cli-emitter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters/cli-emitter')>();
  return {
    ...actual,
    createCliEmitter: createCliEmitterMock,
  };
});

vi.mock('./guard', () => ({
  requireOnboarding: requireOnboardingMock,
}));

import { runCommand } from './run';

describe('runCommand', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const _exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  }) as unknown as ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    requireOnboardingMock.mockReturnValue(true);
    getDatabaseMock.mockReturnValue({});
    listProjectsMock.mockReturnValue([
      {
        id: 'project-1',
        path: process.cwd(),
        gitRemote: 'https://github.com/acme/repo.git',
        defaultBranch: 'develop',
      },
    ]);
    getIssueMock.mockResolvedValue({
      number: 42,
      title: 'Add OpenRouter issue routing',
      body: 'Implement it',
      labels: ['shipcode:agent:openrouter/auto'],
    });
    routeFromLabelsMock.mockReturnValue({
      executorModel: 'openrouter',
      modelOverride: 'openrouter/auto',
    });
    createCliEmitterMock.mockReturnValue({});
    settingsGetMock.mockReturnValue({ executorReasoningEffort: 'high' });
    upsertIssueMock.mockReturnValue({ id: 'issue-cache-42', issueNumber: 42 });
    launchIssuePipelineMock.mockResolvedValue({ id: 'thread-1' });
  });

  it('exits on invalid issue numbers before starting the pipeline', async () => {
    await expect(runCommand('not-a-number')).rejects.toThrow('process.exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Invalid issue number:', 'not-a-number');
    expect(launchIssuePipelineMock).not.toHaveBeenCalled();
  });

  it('returns before parsing when onboarding is incomplete', async () => {
    requireOnboardingMock.mockReturnValueOnce(false);

    await runCommand('not-a-number');

    expect(getIssueMock).not.toHaveBeenCalled();
    expect(launchIssuePipelineMock).not.toHaveBeenCalled();
  });

  it('routes executor model and override from labels into the shared issue launcher', async () => {
    await runCommand('42');

    expect(launchIssuePipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({ pipeline: expect.any(Object) }),
      expect.objectContaining({
        issue: { id: 'issue-cache-42', issueNumber: 42 },
        phaseModels: expect.objectContaining({
          executorModel: 'openrouter',
          executorModelId: 'openrouter/auto',
        }),
        executorModelOverride: 'openrouter/auto',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith('Model: openrouter (openrouter/auto)');
  });

  it('strips terminal control sequences from issue titles before logging', async () => {
    getIssueMock.mockResolvedValueOnce({
      number: 42,
      title: '\u001b[2JAdd routing\u0007',
      body: 'Implement it',
      labels: ['shipcode:agent:openrouter/auto'],
    });

    await runCommand('42');

    expect(logSpy).toHaveBeenCalledWith('Issue: Add routing');
  });

  it('omits the model override label when successful routing has no override', async () => {
    routeFromLabelsMock.mockReturnValueOnce({ executorModel: 'codex' });

    await runCommand('42');

    expect(launchIssuePipelineMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        phaseModels: expect.objectContaining({ executorModel: 'codex' }),
        executorModelOverride: null,
      }),
    );
    expect(logSpy).toHaveBeenCalledWith('Model: codex');
  });

  it('falls back to codex when label routing returns an error', async () => {
    routeFromLabelsMock.mockReturnValueOnce({
      error: 'unknown label',
    });

    await runCommand('42');

    expect(launchIssuePipelineMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        phaseModels: expect.objectContaining({ executorModel: 'codex' }),
        executorModelOverride: null,
      }),
    );
    expect(logSpy).toHaveBeenCalledWith('Model: codex');
  });
});
