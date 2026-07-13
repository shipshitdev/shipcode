import fs from 'node:fs';
import os from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCliContext } from './context';

const mocks = vi.hoisted(() => {
  const state = {
    projects: [{ id: 'project-1', path: '/repo' }],
    addedProject: { id: 'project-added', path: '/new-repo' },
    openRouterOptions: null as null | {
      getApiKey: () => string | undefined;
      getSettings: () => unknown;
    },
  };

  class Query {
    db: unknown;
    constructor(db: unknown) {
      this.db = db;
    }
  }

  class ProjectQueries extends Query {
    list = vi.fn(() => state.projects);
    add = vi.fn((path: string) => ({ ...state.addedProject, path }));
  }

  class SettingsQueries extends Query {
    get = vi.fn(() => ({ telemetryEnabled: true }));
  }

  return {
    state,
    db: { path: '/data/db.sqlite' },
    getDatabase: vi.fn(() => ({ path: '/data/db.sqlite' })),
    ProjectQueries,
    SettingsQueries,
    Query,
    createCliEmitter: vi.fn(() => ({ emit: vi.fn() })),
    createClaudeCliProvider: vi.fn(() => ({ kind: 'claude' })),
    createCodexCliProvider: vi.fn(() => ({ kind: 'codex' })),
    createGrokCliProvider: vi.fn(() => ({ kind: 'grok' })),
    createOpenRouterProvider: vi.fn((options) => {
      state.openRouterOptions = options;
      return { kind: 'openrouter' };
    }),
    createProviderRegistry: vi.fn((providers) => ({ providers })),
    GhCli: vi.fn(function MockGhCli(path: string) {
      return { path };
    }),
    ProcessManager: vi.fn(function MockProcessManager() {
      return { processes: [] };
    }),
  };
});

vi.mock('@shipcode/db', () => ({
  AgentConversationQueries: mocks.Query,
  CheckpointQueries: mocks.Query,
  DiffQueries: mocks.Query,
  FeatureQaResultQueries: mocks.Query,
  GitHubIssueQueries: mocks.Query,
  getDatabase: mocks.getDatabase,
  PhaseLogQueries: mocks.Query,
  PipelineRunQueries: mocks.Query,
  PipelineStepQueries: mocks.Query,
  PlanQueries: mocks.Query,
  ProjectFailureQueries: mocks.Query,
  ProjectQueries: mocks.ProjectQueries,
  ReviewQueries: mocks.Query,
  SettingsQueries: mocks.SettingsQueries,
  SkillsQueries: mocks.Query,
  TaskGraphQueries: mocks.Query,
  TerminalEventQueries: mocks.Query,
  ThreadQueries: mocks.Query,
  VerificationQueries: mocks.Query,
}));

vi.mock('@shipcode/agents', () => ({
  createClaudeCliProvider: mocks.createClaudeCliProvider,
  createCodexCliProvider: mocks.createCodexCliProvider,
  createGrokCliProvider: mocks.createGrokCliProvider,
  createOpenRouterProvider: mocks.createOpenRouterProvider,
  createProviderRegistry: mocks.createProviderRegistry,
  GhCli: mocks.GhCli,
  ProcessManager: mocks.ProcessManager,
}));

vi.mock('./adapters/cli-emitter', () => ({
  createCliEmitter: mocks.createCliEmitter,
}));

describe('createCliContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.projects = [{ id: 'project-1', path: '/repo' }];
    mocks.state.openRouterOptions = null;
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(os, 'homedir').mockReturnValue('/home/tester');
  });

  it('builds query objects, providers, and resolves an existing project', () => {
    const context = createCliContext('/repo');

    expect(fs.mkdirSync).toHaveBeenCalledWith('/home/tester/.shipcode/data', { recursive: true });
    expect(mocks.getDatabase).toHaveBeenCalledWith('/home/tester/.shipcode/data');
    expect(context.project).toEqual({ id: 'project-1', path: '/repo' });
    expect(mocks.GhCli).toHaveBeenCalledWith('/repo');
    expect(mocks.createProviderRegistry).toHaveBeenCalledWith({
      claude: { kind: 'claude' },
      codex: { kind: 'codex' },
      grok: { kind: 'grok' },
      openrouter: { kind: 'openrouter' },
    });
    expect(context.pipelineDeps.projects).toBe(context.projects);
    expect(context.pipelineDeps.phaseLogs).toBe(context.phaseLogs);
    expect(context.pipelineDeps.emitter).toBe(context.emitter);
    expect(mocks.state.openRouterOptions?.getApiKey()).toBe('openrouter-key');
    expect(mocks.state.openRouterOptions?.getSettings()).toEqual({ telemetryEnabled: true });
  });

  it('adds the current cwd as a project when it is not known yet', () => {
    mocks.state.projects = [];

    const context = createCliContext('/new-repo');

    expect(context.project).toEqual({ id: 'project-added', path: '/new-repo' });
  });

  it('uses os.homedir() regardless of HOME env var', () => {
    delete process.env.HOME;
    vi.spyOn(os, 'homedir').mockReturnValue('/fallback-home');

    createCliContext('/repo');

    expect(fs.mkdirSync).toHaveBeenCalledWith('/fallback-home/.shipcode/data', { recursive: true });
    expect(mocks.getDatabase).toHaveBeenCalledWith('/fallback-home/.shipcode/data');
  });
});
