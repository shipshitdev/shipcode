import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDesktopApps } from '@shipcode/agents';
import type { Project } from '@shipcode/shared';
import { resolveWorktreeParent } from '@shipcode/shared/worktree-path';
import type { IpcMain } from 'electron';
import { shell } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const { createIssueMock, execMock, execFileMock, worktreeMoveMock, worktreeRepairMock } =
  vi.hoisted(() => ({
    createIssueMock: vi.fn(),
    execMock: vi.fn((_command: string, optionsOrCallback?: unknown, maybeCallback?: unknown) => {
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
      if (typeof callback === 'function') {
        callback(null, '', '');
      }
    }),
    execFileMock: vi.fn(
      (_file: string, _args: string[], optionsOrCallback?: unknown, maybeCallback?: unknown) => {
        const callback =
          typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
        if (typeof callback === 'function') {
          callback(null, '', '');
        }
      },
    ),
    worktreeMoveMock: vi.fn(async () => undefined),
    worktreeRepairMock: vi.fn(async () => undefined),
  }));

vi.mock('../logger.service', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  logEvent: vi.fn(),
}));

vi.mock('electron', () => ({
  app: undefined,
  dialog: {},
  shell: {
    openPath: vi.fn(),
  },
}));

vi.mock('@shipcode/agents', () => ({
  GhCli: class {
    createIssue = createIssueMock;
    getRepoMetadata = vi.fn();
    ensureLabels = vi.fn(async () => ({ created: [], alreadyPresent: [], failed: [] }));
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

vi.mock('node:child_process', () => ({
  default: {
    exec: execMock,
    execFile: execFileMock,
  },
  exec: execMock,
  execFile: execFileMock,
}));

const { registerProjectHandlers } = await import('./register-project-handlers');

vi.mock('@shipcode/git', () => ({
  GitService: class {
    getRemoteUrl = vi.fn(async () => 'git@github.com:shipshitdev/shipcode.git');
    getDefaultBranch = vi.fn(async () => 'main');
  },
  WorktreeManager: class {
    move = worktreeMoveMock;
    repair = worktreeRepairMock;
  },
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
    githubStatusMapping: null,
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
    requireApprovalOverride: null,
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

  function registerOpenPathHandler(project: Project = baseProject) {
    const queries = {
      projects: {
        getById: vi.fn(() => project),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor', terminalOpenTarget: 'terminal' })),
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

    const openPath = handlers.get('project:open-path');
    if (!openPath) throw new Error('project:open-path handler not registered');
    return { openPath, queries };
  }

  function makeDesktopApps() {
    return {
      cursor: {
        key: 'cursor',
        label: 'Cursor',
        available: true,
        path: '/Applications/Cursor.app',
        error: null,
      },
      finder: {
        key: 'finder',
        label: 'Finder',
        available: true,
        path: '/System/Library/CoreServices/Finder.app',
        error: null,
      },
      terminal: {
        key: 'terminal',
        label: 'Terminal',
        available: true,
        path: '/System/Applications/Utilities/Terminal.app',
        error: null,
      },
      ghostty: {
        key: 'ghostty',
        label: 'Ghostty',
        available: true,
        path: '/Applications/Ghostty.app',
        error: null,
      },
      vscode: {
        key: 'vscode',
        label: 'Visual Studio Code',
        available: true,
        path: '/Applications/Visual Studio Code.app',
        error: null,
      },
      t3code: {
        key: 't3code',
        label: 'T3 Code',
        available: true,
        path: '/Applications/T3 Code.app',
        error: null,
      },
    } as const;
  }

  async function withDarwin<T>(callback: () => Promise<T>): Promise<T> {
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      return await callback();
    } finally {
      Object.defineProperty(process, 'platform', { value: platform });
    }
  }

  it('repairs and moves managed worktrees when relinking a renamed project path', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-relink-'));
    const oldProjectPath = path.join(tmp, 'old-repo');
    const nextProjectPath = path.join(tmp, 'new-repo');
    const worktreeRoot = path.join(tmp, 'worktrees');
    fs.mkdirSync(oldProjectPath, { recursive: true });
    fs.mkdirSync(nextProjectPath, { recursive: true });

    const oldParent = resolveWorktreeParent(oldProjectPath, worktreeRoot);
    const nextParent = resolveWorktreeParent(nextProjectPath, worktreeRoot);
    const oldWorktreePath = path.join(oldParent, '56-chore');
    const nextWorktreePath = path.join(nextParent, '56-chore');
    fs.mkdirSync(oldWorktreePath, { recursive: true });

    let project = { ...baseProject, path: oldProjectPath };
    const queries = {
      projects: {
        getById: vi.fn(() => project),
        getByPath: vi.fn(() => null),
        updatePath: vi.fn((_id: string, projectPath: string) => {
          project = { ...project, path: projectPath };
        }),
        updateGitInfo: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor', worktreeRoot })),
      },
      threads: {
        list: vi.fn(() => [
          {
            id: 'thread-56',
            worktreeBranch: 'ship/56-chore',
            worktreePath: oldWorktreePath,
          },
        ]),
        setWorktree: vi.fn(),
        clearWorktree: vi.fn(),
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

    const relinkPath = handlers.get('project:relink-path');
    if (!relinkPath) throw new Error('project:relink-path handler not registered');

    await relinkPath(undefined, { projectId: 'project-1', path: nextProjectPath });

    expect(worktreeRepairMock).toHaveBeenCalledWith([oldWorktreePath]);
    expect(worktreeMoveMock).toHaveBeenCalledWith(oldWorktreePath, nextWorktreePath);
    expect(queries.threads.setWorktree).toHaveBeenCalledWith(
      'thread-56',
      'ship/56-chore',
      nextWorktreePath,
    );
    expect(queries.threads.clearWorktree).not.toHaveBeenCalled();
    expect(queries.projects.updatePath).toHaveBeenCalledWith('project-1', nextProjectPath);
  });

  it('clears managed worktree paths that are missing after a project relink', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-relink-missing-'));
    const oldProjectPath = path.join(tmp, 'old-repo');
    const nextProjectPath = path.join(tmp, 'new-repo');
    const worktreeRoot = path.join(tmp, 'worktrees');
    fs.mkdirSync(nextProjectPath, { recursive: true });

    const oldWorktreePath = path.join(
      resolveWorktreeParent(oldProjectPath, worktreeRoot),
      '12-docs',
    );

    let project = { ...baseProject, path: oldProjectPath };
    const queries = {
      projects: {
        getById: vi.fn(() => project),
        getByPath: vi.fn(() => null),
        updatePath: vi.fn((_id: string, projectPath: string) => {
          project = { ...project, path: projectPath };
        }),
        updateGitInfo: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor', worktreeRoot })),
      },
      threads: {
        list: vi.fn(() => [
          {
            id: 'thread-12',
            worktreeBranch: 'ship/12-docs',
            worktreePath: oldWorktreePath,
          },
        ]),
        setWorktree: vi.fn(),
        clearWorktree: vi.fn(),
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

    const relinkPath = handlers.get('project:relink-path');
    if (!relinkPath) throw new Error('project:relink-path handler not registered');

    await relinkPath(undefined, { projectId: 'project-1', path: nextProjectPath });

    expect(worktreeRepairMock).not.toHaveBeenCalled();
    expect(worktreeMoveMock).not.toHaveBeenCalled();
    expect(queries.threads.clearWorktree).toHaveBeenCalledWith('thread-12');
    expect(queries.threads.setWorktree).not.toHaveBeenCalled();
    expect(queries.projects.updatePath).toHaveBeenCalledWith('project-1', nextProjectPath);
  });

  it('opens the project in Terminal.app at the project path', async () => {
    await withDarwin(async () => {
      const project = { ...baseProject, path: "/tmp/ShipCode's Worktree" };
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.mocked(checkDesktopApps).mockResolvedValue(makeDesktopApps() as never);

      const { openPath } = registerOpenPathHandler(project);

      await openPath(undefined, { projectId: project.id, target: 'terminal' });

      expect(execFileMock).toHaveBeenCalledTimes(1);
      expect(execFileMock).toHaveBeenCalledWith(
        'open',
        ['-a', 'Terminal', project.path],
        { timeout: 10_000 },
        expect.any(Function),
      );
      expect(shell.openPath).not.toHaveBeenCalled();
      existsSpy.mockRestore();
    });
  });

  it('opens the project in Finder when the configured default opener is unavailable', async () => {
    await withDarwin(async () => {
      const project = { ...baseProject, path: '/tmp/ShipCode Worktree' };
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.mocked(checkDesktopApps).mockResolvedValue({
        ...makeDesktopApps(),
        cursor: {
          key: 'cursor',
          label: 'Cursor',
          available: false,
          path: null,
          error: 'Cursor missing',
        },
      } as never);

      const { openPath } = registerOpenPathHandler(project);

      await openPath(undefined, { projectId: project.id, target: 'default' });

      expect(shell.openPath).toHaveBeenCalledWith(project.path);
      expect(execFileMock).not.toHaveBeenCalled();
      existsSpy.mockRestore();
    });
  });

  it('rejects project open requests for missing folders and unsupported platforms', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.mocked(checkDesktopApps).mockResolvedValue(makeDesktopApps() as never);
    const { openPath } = registerOpenPathHandler(baseProject);

    await expect(
      openPath(undefined, { projectId: baseProject.id, target: 'cursor' }),
    ).rejects.toThrow(`Project folder does not exist: ${baseProject.path}`);

    existsSpy.mockReturnValue(true);
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      await expect(
        openPath(undefined, { projectId: baseProject.id, target: 'cursor' }),
      ).rejects.toThrow('Project opener actions are currently supported on macOS only');
    } finally {
      Object.defineProperty(process, 'platform', { value: platform });
    }

    existsSpy.mockRestore();
  });

  it('rejects default terminal open requests when no terminal app is available', async () => {
    await withDarwin(async () => {
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.mocked(checkDesktopApps).mockResolvedValue({
        ...makeDesktopApps(),
        terminal: {
          key: 'terminal',
          label: 'Terminal',
          available: false,
          path: null,
          error: 'Terminal missing',
        },
        ghostty: {
          key: 'ghostty',
          label: 'Ghostty',
          available: false,
          path: null,
          error: 'Ghostty missing',
        },
      } as never);
      const { openPath } = registerOpenPathHandler(baseProject);

      await expect(
        openPath(undefined, { projectId: baseProject.id, target: 'default-terminal' }),
      ).rejects.toThrow('No supported terminal app is available');

      existsSpy.mockRestore();
    });
  });

  it('updates a project name through project:set-name', async () => {
    const updatedProject = { ...baseProject, name: 'Gateway Remastered' };
    const queries = {
      projects: {
        getById: vi.fn().mockReturnValueOnce(baseProject).mockReturnValueOnce(updatedProject),
        updateName: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor' })),
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

    const setName = handlers.get('project:set-name');
    if (!setName) throw new Error('project:set-name handler not registered');

    const result = (await setName(undefined, {
      projectId: baseProject.id,
      name: '  Gateway Remastered  ',
    })) as Project;

    expect(queries.projects.updateName).toHaveBeenCalledWith(baseProject.id, 'Gateway Remastered');
    expect(result.name).toBe('Gateway Remastered');
  });

  it('rejects empty project names and missing projects during rename', async () => {
    const queries = {
      projects: {
        getById: vi.fn().mockReturnValueOnce(baseProject).mockReturnValueOnce(null),
        updateName: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor' })),
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

    const setName = handlers.get('project:set-name');
    if (!setName) throw new Error('project:set-name handler not registered');

    await expect(setName(undefined, { projectId: baseProject.id, name: '   ' })).rejects.toThrow(
      'Project name is required',
    );
    await expect(setName(undefined, { projectId: baseProject.id, name: 'Next' })).rejects.toThrow(
      `Project ${baseProject.id} not found`,
    );
    expect(queries.projects.updateName).not.toHaveBeenCalled();
  });

  it('opens the project in Ghostty with an explicit working directory', async () => {
    await withDarwin(async () => {
      const project = { ...baseProject, path: '/tmp/ShipCode Worktree' };
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.mocked(checkDesktopApps).mockResolvedValue(makeDesktopApps() as never);

      const { openPath } = registerOpenPathHandler(project);

      await openPath(undefined, { projectId: project.id, target: 'ghostty' });

      expect(execFileMock).toHaveBeenCalledTimes(1);
      expect(execFileMock).toHaveBeenCalledWith(
        'open',
        ['-na', 'Ghostty', '--args', '--working-directory=/tmp/ShipCode Worktree'],
        { timeout: 10_000 },
        expect.any(Function),
      );
      expect(shell.openPath).not.toHaveBeenCalled();
      existsSpy.mockRestore();
    });
  });

  it('opens the configured terminal target when requested as the default terminal', async () => {
    await withDarwin(async () => {
      const project = { ...baseProject, path: '/tmp/ShipCode Worktree' };
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.mocked(checkDesktopApps).mockResolvedValue(makeDesktopApps() as never);

      const { openPath, queries } = registerOpenPathHandler(project);
      queries.settings.get.mockReturnValue({
        projectOpenTarget: 'cursor',
        terminalOpenTarget: 'ghostty',
      });

      await openPath(undefined, { projectId: project.id, target: 'default-terminal' });

      expect(execFileMock).toHaveBeenCalledWith(
        'open',
        ['-na', 'Ghostty', '--args', '--working-directory=/tmp/ShipCode Worktree'],
        { timeout: 10_000 },
        expect.any(Function),
      );
      existsSpy.mockRestore();
    });
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

  it('archives projects with the correct idle guard for present and missing folders', async () => {
    const existsSpy = vi
      .spyOn(fs, 'existsSync')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
        archiveIfIdle: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(false),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor' })),
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

    const archive = handlers.get('project:archive');
    if (!archive) throw new Error('project:archive handler not registered');

    await expect(archive(undefined, { projectId: baseProject.id })).rejects.toThrow(
      'Cannot archive this missing project while a pipeline is still active. Stop running pipelines first.',
    );
    expect(queries.projects.archiveIfIdle).toHaveBeenCalledWith(baseProject.id, {
      ignoreAttentionOnly: true,
    });

    await expect(archive(undefined, { projectId: baseProject.id })).rejects.toThrow(
      'Cannot archive a project with active work. Stop running pipelines and dismiss notifications first.',
    );
    expect(queries.projects.archiveIfIdle).toHaveBeenLastCalledWith(baseProject.id, {
      ignoreAttentionOnly: false,
    });

    existsSpy.mockRestore();
  });

  it('marks only idle, failed, and completed threads as done', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor' })),
      },
      threads: {
        getById: vi
          .fn()
          .mockReturnValueOnce(null)
          .mockReturnValueOnce({ id: 'thread-1', status: 'executing' })
          .mockReturnValueOnce({ id: 'thread-1', status: 'failed' }),
        markDone: vi.fn(),
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

    const markDone = handlers.get('thread:mark-done');
    if (!markDone) throw new Error('thread:mark-done handler not registered');

    expect(() => markDone(undefined, { threadId: 'thread-1' })).toThrow(
      'Thread thread-1 not found',
    );
    expect(() => markDone(undefined, { threadId: 'thread-1' })).toThrow(
      'Cannot mark thread as done while in executing phase',
    );
    markDone(undefined, { threadId: 'thread-1' });

    expect(queries.threads.markDone).toHaveBeenCalledWith('thread-1');
  });

  it('resolves filesystem start directories and lists child directories with error states', async () => {
    const homeDir = os.homedir();
    const queries = {
      projects: {},
      settings: {
        get: vi
          .fn()
          .mockReturnValueOnce({})
          .mockReturnValueOnce({ addProjectStartsIn: '~' })
          .mockReturnValueOnce({ addProjectStartsIn: '~/dev' })
          .mockReturnValueOnce({ addProjectStartsIn: '/tmp/missing' })
          .mockReturnValue({ addProjectStartsIn: 'relative' }),
      },
    };
    const existsSpy = vi
      .spyOn(fs, 'existsSync')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const readdirSpy = vi
      .spyOn(fs.promises, 'readdir')
      .mockResolvedValueOnce([
        { name: 'zeta', isDirectory: () => true },
        { name: '.hidden', isDirectory: () => true },
        { name: 'alpha', isDirectory: () => true },
        { name: 'file.txt', isDirectory: () => false },
      ] as never)
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
      .mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));

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

    const resolveStartDir = handlers.get('fs:resolve-start-dir');
    const listDirectories = handlers.get('fs:list-directories');
    if (!resolveStartDir || !listDirectories) {
      throw new Error('filesystem handlers not registered');
    }

    expect(resolveStartDir()).toEqual({ resolvedPath: homeDir });
    expect(resolveStartDir()).toEqual({ resolvedPath: homeDir });
    expect(resolveStartDir()).toEqual({ resolvedPath: path.join(homeDir, 'dev') });
    expect(resolveStartDir()).toEqual({ resolvedPath: homeDir });
    expect(resolveStartDir()).toEqual({ resolvedPath: homeDir });

    await expect(listDirectories(undefined, { dirPath: '/tmp' })).resolves.toEqual({
      entries: [
        { name: 'alpha', absolutePath: '/tmp/alpha' },
        { name: 'zeta', absolutePath: '/tmp/zeta' },
      ],
      error: null,
    });
    await expect(listDirectories(undefined, { dirPath: '/missing' })).resolves.toEqual({
      entries: [],
      error: 'not-found',
    });
    await expect(listDirectories(undefined, { dirPath: '/denied' })).resolves.toEqual({
      entries: [],
      error: 'permission-denied',
    });

    existsSpy.mockRestore();
    readdirSpy.mockRestore();
  });
});
