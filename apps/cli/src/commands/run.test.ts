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
  startFromGitHubIssueMock,
  settingsGetMock,
} = vi.hoisted(() => ({
  requireOnboardingMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  getDatabaseMock: vi.fn(),
  addProjectMock: vi.fn(),
  listProjectsMock: vi.fn(),
  getIssueMock: vi.fn(),
  routeFromLabelsMock: vi.fn(),
  createCliEmitterMock: vi.fn(),
  startFromGitHubIssueMock: vi.fn(),
  settingsGetMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    mkdirSync: mkdirSyncMock,
  },
}));

vi.mock('@shipcode/db', () => ({
  getDatabase: getDatabaseMock,
  ProjectQueries: class {
    list = listProjectsMock;
    add = addProjectMock;
  },
  ThreadQueries: class {},
  PlanQueries: class {},
  ReviewQueries: class {},
  DiffQueries: class {},
  VerificationQueries: class {},
  GitHubIssueQueries: class {},
  CheckpointQueries: class {},
  TerminalEventQueries: class {},
  PipelineStepQueries: class {},
  SettingsQueries: class {
    get = settingsGetMock;
  },
  SkillsQueries: class {},
}));

vi.mock('@shipcode/agents', () => ({
  ProcessManager: class {},
  GhCli: class {
    getIssue = getIssueMock;
  },
  routeFromLabels: routeFromLabelsMock,
  createClaudeCliProvider: vi.fn(() => ({ id: 'claude' })),
  createCodexCliProvider: vi.fn(() => ({ id: 'codex' })),
  createOpenRouterProvider: vi.fn(() => ({ id: 'openrouter' })),
  createProviderRegistry: vi.fn((providers) => providers),
}));

vi.mock('@shipcode/pipeline', () => ({
  createPipeline: vi.fn(() => ({
    startFromGitHubIssue: startFromGitHubIssueMock,
  })),
}));

vi.mock('../adapters/cli-emitter', () => ({
  createCliEmitter: createCliEmitterMock,
}));

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
        defaultBranch: 'develop',
      },
    ]);
    getIssueMock.mockResolvedValue({
      number: 42,
      title: 'Add OpenRouter issue routing',
      body: 'Implement it',
      labels: ['agent:openrouter/auto'],
    });
    routeFromLabelsMock.mockReturnValue({
      executorModel: 'openrouter',
      modelOverride: 'openrouter/auto',
    });
    createCliEmitterMock.mockReturnValue({});
    settingsGetMock.mockReturnValue({});
    startFromGitHubIssueMock.mockResolvedValue(undefined);
  });

  it('exits on invalid issue numbers before starting the pipeline', async () => {
    await expect(runCommand('not-a-number')).rejects.toThrow('process.exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Invalid issue number:', 'not-a-number');
    expect(startFromGitHubIssueMock).not.toHaveBeenCalled();
  });

  it('routes executor model and override from labels into startFromGitHubIssue', async () => {
    await runCommand('42');

    expect(startFromGitHubIssueMock).toHaveBeenCalledWith(
      'project-1',
      process.cwd(),
      {
        number: 42,
        title: 'Add OpenRouter issue routing',
        body: 'Implement it',
        labels: ['agent:openrouter/auto'],
      },
      'openrouter',
      {
        baseBranch: 'develop',
        executorModelOverride: 'openrouter/auto',
      },
    );
    expect(logSpy).toHaveBeenCalledWith('Model: openrouter (openrouter/auto)');
  });

  it('falls back to claude when label routing returns an error', async () => {
    routeFromLabelsMock.mockReturnValueOnce({
      error: 'unknown label',
    });

    await runCommand('42');

    expect(startFromGitHubIssueMock).toHaveBeenCalledWith(
      'project-1',
      process.cwd(),
      expect.any(Object),
      'claude',
      {
        baseBranch: 'develop',
        executorModelOverride: null,
      },
    );
    expect(logSpy).toHaveBeenCalledWith('Model: claude');
  });
});
