import type { Project } from '@shipcode/shared';
import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerProjectHandlers } from './register-project-handlers';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const { createIssueMock } = vi.hoisted(() => ({
  createIssueMock: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: {},
  shell: {
    openPath: vi.fn(),
  },
}));

vi.mock('@shipcode/agents', () => ({
  GhCli: class {
    createIssue = createIssueMock;
    getRepoMetadata = vi.fn();
  },
  checkCliProviderUsage: vi.fn(),
  checkDesktopApps: vi.fn(),
  checkIntegrationStatus: vi.fn(),
  checkSystemHealthWithAuth: vi.fn(),
  detectProjectSetup: vi.fn(),
  inspectProjectSetup: vi.fn(() => ({
    status: 'ready',
    path: '/tmp/shipcode',
    error: null,
  })),
  validateOpenRouterModel: vi.fn(),
  writeProjectSetup: vi.fn(),
}));

vi.mock('@shipcode/git', () => ({
  GitService: class {
    getRemoteUrl = vi.fn(async () => 'git@github.com:shipshitdev/shipcode.git');
    getDefaultBranch = vi.fn(async () => 'main');
  },
  WorktreeManager: class {},
}));

describe('registerProjectHandlers', () => {
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
    on: vi.fn(),
  } as unknown as IpcMain;

  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    },
  };

  const baseProject: Project = {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
    gitRemote: null,
    githubRepoId: null,
    githubRepoFullName: null,
    starterIssueNumber: null,
    starterIssueCreatedAt: null,
    githubProjectUrl: null,
    plannerModelOverride: null,
    reviewerModelOverride: null,
    executorModelOverride: null,
    verifierModelOverride: null,
    plannerModelIdOverride: null,
    reviewerModelIdOverride: null,
    executorModelIdOverride: null,
    verifierModelIdOverride: null,
    plannerReasoningEffortOverride: null,
    reviewerReasoningEffortOverride: null,
    executorReasoningEffortOverride: null,
    verifierReasoningEffortOverride: null,
    revisionCountOverride: null,
    discordRouting: 'inherit' as const,
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit' as const,
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  it('seeds a starter issue on first GitHub-backed project import', async () => {
    let project = { ...baseProject };
    let issues: Array<{ issueNumber: number; title: string }> = [];

    const queries = {
      projects: {
        add: vi.fn(
          (
            projectPath: string,
            options?: { githubRepoId?: string | null; githubRepoFullName?: string | null },
          ) => {
            project = {
              ...project,
              path: projectPath,
              githubRepoId: options?.githubRepoId ?? null,
              githubRepoFullName: options?.githubRepoFullName ?? null,
            };
            return project;
          },
        ),
        getById: vi.fn(() => project),
        updateGitInfo: vi.fn((_id: string, gitRemote: string | null, defaultBranch: string) => {
          project = { ...project, gitRemote, defaultBranch };
        }),
        updateGithubRepoIdentity: vi.fn(
          (
            _id: string,
            identity: { githubRepoId: string | null; githubRepoFullName: string | null },
          ) => {
            project = { ...project, ...identity };
          },
        ),
        getByGithubRepoIdentity: vi.fn(() => null),
        markStarterIssueSeeded: vi.fn(
          (
            _id: string,
            fields: { starterIssueNumber: number | null; starterIssueCreatedAt?: string | null },
          ) => {
            project = {
              ...project,
              starterIssueNumber: fields.starterIssueNumber,
              starterIssueCreatedAt: fields.starterIssueCreatedAt ?? '2026-04-21T10:00:00.000Z',
            };
          },
        ),
        list: vi.fn(() => []),
        listVisible: vi.fn(() => []),
        listArchived: vi.fn(() => []),
        remove: vi.fn(),
        getByPath: vi.fn(),
        archiveIfIdle: vi.fn(),
        unarchive: vi.fn(),
        hide: vi.fn(),
        unhide: vi.fn(),
        updatePath: vi.fn(),
        updateGithubProjectUrl: vi.fn(),
        updateNotifyGithubUser: vi.fn(),
        updateModelOverrides: vi.fn(),
        updateNotificationRouting: vi.fn(),
        updateDefaultBranch: vi.fn(),
      },
      githubIssues: {
        upsert: vi.fn((record: { issueNumber: number; title: string }) => {
          issues = [record];
          return {
            id: 'issue-101',
            ...record,
          };
        }),
        list: vi.fn(() => issues),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor' })),
      },
      threads: {
        listByProject: vi.fn(() => []),
      },
    };

    createIssueMock.mockResolvedValue({
      number: 101,
      title: 'Ship your first change with ShipCode',
      body: 'starter',
      labels: [],
      assignee: null,
      state: 'open',
    });

    registerProjectHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: {} as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
      emitter: {} as never,
      notificationService: {} as never,
    });

    const addProject = handlers.get('project:add');
    if (!addProject) throw new Error('project:add handler not registered');

    const result = (await addProject(undefined, {
      path: '/tmp/shipcode',
      repo: { id: 'R_kgDOStarter', name: 'shipshitdev/shipcode' },
    })) as Project;

    expect(createIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ship your first change with ShipCode',
        labels: [],
      }),
    );
    expect(queries.projects.updateGithubRepoIdentity).toHaveBeenCalledWith('project-1', {
      githubRepoId: 'R_kgDOStarter',
      githubRepoFullName: 'shipshitdev/shipcode',
    });
    expect(queries.projects.markStarterIssueSeeded).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ starterIssueNumber: 101 }),
    );
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues,
    });
    expect(result.starterIssueNumber).toBe(101);
  });

  it('reuses an existing seeded starter issue for the same GitHub repo identity', async () => {
    let project = { ...baseProject };

    const queries = {
      projects: {
        add: vi.fn(
          (
            projectPath: string,
            options?: { githubRepoId?: string | null; githubRepoFullName?: string | null },
          ) => {
            project = {
              ...project,
              path: projectPath,
              githubRepoId: options?.githubRepoId ?? null,
              githubRepoFullName: options?.githubRepoFullName ?? null,
            };
            return project;
          },
        ),
        getById: vi.fn(() => project),
        updateGitInfo: vi.fn((_id: string, gitRemote: string | null, defaultBranch: string) => {
          project = { ...project, gitRemote, defaultBranch };
        }),
        updateGithubRepoIdentity: vi.fn(
          (
            _id: string,
            identity: { githubRepoId: string | null; githubRepoFullName: string | null },
          ) => {
            project = { ...project, ...identity };
          },
        ),
        getByGithubRepoIdentity: vi.fn(() => ({
          ...baseProject,
          id: 'project-existing',
          githubRepoId: 'R_kgDOStarter',
          githubRepoFullName: 'shipshitdev/shipcode',
          starterIssueNumber: 55,
          starterIssueCreatedAt: '2026-04-20T00:00:00.000Z',
        })),
        markStarterIssueSeeded: vi.fn(
          (
            _id: string,
            fields: { starterIssueNumber: number | null; starterIssueCreatedAt?: string | null },
          ) => {
            project = {
              ...project,
              starterIssueNumber: fields.starterIssueNumber,
              starterIssueCreatedAt: fields.starterIssueCreatedAt ?? '2026-04-20T00:00:00.000Z',
            };
          },
        ),
        list: vi.fn(() => []),
        listVisible: vi.fn(() => []),
        listArchived: vi.fn(() => []),
        remove: vi.fn(),
        getByPath: vi.fn(),
        archiveIfIdle: vi.fn(),
        unarchive: vi.fn(),
        hide: vi.fn(),
        unhide: vi.fn(),
        updatePath: vi.fn(),
        updateGithubProjectUrl: vi.fn(),
        updateNotifyGithubUser: vi.fn(),
        updateModelOverrides: vi.fn(),
        updateNotificationRouting: vi.fn(),
        updateDefaultBranch: vi.fn(),
      },
      githubIssues: {
        upsert: vi.fn(),
        list: vi.fn(() => []),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor' })),
      },
      threads: {
        listByProject: vi.fn(() => []),
      },
    };

    registerProjectHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: {} as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
      emitter: {} as never,
      notificationService: {} as never,
    });

    const addProject = handlers.get('project:add');
    if (!addProject) throw new Error('project:add handler not registered');

    const result = (await addProject(undefined, {
      path: '/tmp/shipcode',
      repo: { id: 'R_kgDOStarter', name: 'shipshitdev/shipcode' },
    })) as Project;

    expect(createIssueMock).not.toHaveBeenCalled();
    expect(queries.projects.markStarterIssueSeeded).toHaveBeenCalledWith('project-1', {
      starterIssueNumber: 55,
      starterIssueCreatedAt: '2026-04-20T00:00:00.000Z',
    });
    expect(result.starterIssueNumber).toBe(55);
  });
});
