import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  checkCliProviderUsage,
  checkDesktopApps,
  checkIntegrationStatus,
  checkSystemHealthWithAuth,
  detectProjectSetup,
  validateOpenRouterModel,
} from '@shipcode/agents';
import type { AppSettings, Project } from '@shipcode/shared';
import { resolveWorktreeParent } from '@shipcode/shared/worktree-path';
import type { IpcMain } from 'electron';
import { dialog, shell } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const {
  createIssueMock,
  execMock,
  execFileMock,
  getRepoMetadataMock,
  gitCommitMock,
  gitFetchMock,
  gitGetDiffAgainstHeadMock,
  gitGetDiffStatMock,
  gitGetRemoteUrlMock,
  gitGetStatusMock,
  gitListBranchesMock,
  gitPushMock,
  configureMainTelemetryMock,
  ensureLabelsMock,
  inspectProjectSetupMock,
  isWorktreeLockedMock,
  runAutoCommitWorkflowMock,
  runCleanupAnalyzeMock,
  runCleanupApplyMock,
  validateProjectStatusFieldMock,
  withWorktreeLockMock,
  writeProjectSetupMock,
  worktreeListMock,
  worktreeMoveMock,
  worktreeRepairMock,
  worktreeRemoveMock,
} = vi.hoisted(() => ({
  createIssueMock: vi.fn(),
  execMock: vi.fn((_command: string, optionsOrCallback?: unknown, maybeCallback?: unknown) => {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    if (typeof callback === 'function') {
      callback(null, '', '');
    }
  }),
  execFileMock: vi.fn(
    (_file: string, _args: string[], optionsOrCallback?: unknown, maybeCallback?: unknown) => {
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
      if (typeof callback === 'function') {
        callback(null, '', '');
      }
    },
  ),
  getRepoMetadataMock: vi.fn(),
  gitCommitMock: vi.fn(async () => ({ hash: 'abc123' })),
  gitFetchMock: vi.fn(async () => undefined),
  gitGetDiffAgainstHeadMock: vi.fn(async () => ''),
  gitGetDiffStatMock: vi.fn(async () => ''),
  gitGetRemoteUrlMock: vi.fn(async () => 'git@github.com:shipshitdev/shipcode.git'),
  gitGetStatusMock: vi.fn(async () => ({
    branch: 'main',
    commitHash: 'abc123',
    isDirty: false,
    untrackedCount: 0,
    stagedCount: 0,
    modifiedCount: 0,
    aheadCount: 0,
    behindCount: 0,
    compareRef: 'origin/main',
    preCommitHookPath: null,
  })),
  gitListBranchesMock: vi.fn(async () => ['main', 'develop']),
  gitPushMock: vi.fn(async () => ({ pushed: true })),
  configureMainTelemetryMock: vi.fn(async () => undefined),
  ensureLabelsMock: vi.fn(async () => ({ created: [], alreadyPresent: [], failed: [] })),
  inspectProjectSetupMock: vi.fn(() => ({
    status: 'ready',
    path: '/tmp/shipcode',
    error: null,
  })),
  isWorktreeLockedMock: vi.fn(() => false),
  runAutoCommitWorkflowMock: vi.fn(async () => ({ committed: true })),
  runCleanupAnalyzeMock: vi.fn(async () => ({ items: [{ id: 'stale-worktree' }] })),
  runCleanupApplyMock: vi.fn(async () => ({ removed: ['stale-worktree'] })),
  validateProjectStatusFieldMock: vi.fn(),
  withWorktreeLockMock: vi.fn(async (_worktreePath: string, callback: () => Promise<unknown>) =>
    callback(),
  ),
  writeProjectSetupMock: vi.fn(),
  worktreeListMock: vi.fn(async (): Promise<Array<{ path: string; branch: string }>> => []),
  worktreeMoveMock: vi.fn(async () => undefined),
  worktreeRepairMock: vi.fn(async () => undefined),
  worktreeRemoveMock: vi.fn(async () => ({ success: true, error: null })),
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
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
}));

vi.mock('@shipcode/agents', () => ({
  GhCli: class {
    createIssue = createIssueMock;
    getRepoMetadata = getRepoMetadataMock;
    ensureLabels = ensureLabelsMock;
  },
  checkCliProviderUsage: vi.fn(),
  checkDesktopApps: vi.fn(),
  checkIntegrationStatus: vi.fn(),
  checkSystemHealthWithAuth: vi.fn(),
  detectProjectSetup: vi.fn(),
  inspectProjectSetup: inspectProjectSetupMock,
  validateOpenRouterModel: vi.fn(),
  validateProjectStatusField: validateProjectStatusFieldMock,
  writeProjectSetup: writeProjectSetupMock,
}));

vi.mock('node:child_process', () => ({
  default: {
    exec: execMock,
    execFile: execFileMock,
  },
  exec: execMock,
  execFile: execFileMock,
}));

vi.mock('../git-workflows', () => ({
  runAutoCommitWorkflow: runAutoCommitWorkflowMock,
  runCleanupAnalyze: runCleanupAnalyzeMock,
  runCleanupApply: runCleanupApplyMock,
}));

vi.mock('../worktree-locks', () => ({
  isWorktreeLocked: isWorktreeLockedMock,
  withWorktreeLock: withWorktreeLockMock,
}));

vi.mock('../telemetry', () => ({
  configureMainTelemetry: configureMainTelemetryMock,
  getTelemetryStatus: vi.fn(() => ({ enabled: false })),
}));

const { registerProjectHandlers } = await import('./register-project-handlers');

vi.mock('@shipcode/git', () => ({
  GitService: class {
    commit = gitCommitMock;
    fetch = gitFetchMock;
    getDiffAgainstHead = gitGetDiffAgainstHeadMock;
    getDiffStat = gitGetDiffStatMock;
    getRemoteUrl = gitGetRemoteUrlMock;
    getDefaultBranch = vi.fn(async () => 'main');
    getStatus = gitGetStatusMock;
    listBranches = gitListBranchesMock;
    push = gitPushMock;
  },
  WorktreeManager: class {
    list = worktreeListMock;
    move = worktreeMoveMock;
    repair = worktreeRepairMock;
    remove = worktreeRemoveMock;
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
    isWorktreeLockedMock.mockReturnValue(false);
    runAutoCommitWorkflowMock.mockResolvedValue({ committed: true });
    runCleanupAnalyzeMock.mockResolvedValue({ items: [{ id: 'stale-worktree' }] });
    runCleanupApplyMock.mockResolvedValue({ removed: ['stale-worktree'] });
    withWorktreeLockMock.mockImplementation(
      async (_worktreePath: string, callback: () => Promise<unknown>) => callback(),
    );
    worktreeListMock.mockResolvedValue([]);
    getRepoMetadataMock.mockReset();
    getRepoMetadataMock.mockResolvedValue({
      githubRepoId: 'R_repo',
      githubRepoFullName: 'shipshitdev/shipcode',
    });
    ensureLabelsMock.mockResolvedValue({ created: [], alreadyPresent: [], failed: [] });
    configureMainTelemetryMock.mockResolvedValue(undefined);
  });

  async function flushBackgroundTasks() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

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

  it('repairs relinked worktrees that already exist at the new project path', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-relink-existing-'));
    const oldProjectPath = path.join(tmp, 'old-repo');
    const nextProjectPath = path.join(tmp, 'new-repo');
    const worktreeRoot = path.join(tmp, 'worktrees');
    fs.mkdirSync(nextProjectPath, { recursive: true });

    const oldParent = resolveWorktreeParent(oldProjectPath, worktreeRoot);
    const nextParent = resolveWorktreeParent(nextProjectPath, worktreeRoot);
    const oldWorktreePath = path.join(oldParent, '88-existing');
    const nextWorktreePath = path.join(nextParent, '88-existing');
    fs.mkdirSync(nextWorktreePath, { recursive: true });

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
            id: 'thread-88',
            worktreeBranch: 'ship/88-existing',
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

    expect(worktreeRepairMock).toHaveBeenCalledWith([nextWorktreePath]);
    expect(worktreeMoveMock).not.toHaveBeenCalled();
    expect(queries.threads.setWorktree).toHaveBeenCalledWith(
      'thread-88',
      'ship/88-existing',
      nextWorktreePath,
    );
    expect(queries.threads.clearWorktree).not.toHaveBeenCalled();
  });

  it('skips incomplete relink thread worktree records and tolerates relinked repair failures', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-relink-incomplete-'));
    const oldProjectPath = path.join(tmp, 'old-repo');
    const nextProjectPath = path.join(tmp, 'new-repo');
    const worktreeRoot = path.join(tmp, 'worktrees');
    fs.mkdirSync(nextProjectPath, { recursive: true });

    const oldParent = resolveWorktreeParent(oldProjectPath, worktreeRoot);
    const nextParent = resolveWorktreeParent(nextProjectPath, worktreeRoot);
    const oldWorktreePath = path.join(oldParent, '77-existing');
    const nextWorktreePath = path.join(nextParent, '77-existing');
    fs.mkdirSync(nextWorktreePath, { recursive: true });
    worktreeRepairMock.mockRejectedValueOnce(new Error('repair relinked failed'));

    const project = { ...baseProject, path: oldProjectPath };
    const queries = {
      projects: {
        getById: vi.fn(() => project),
        getByPath: vi.fn(() => null),
        updatePath: vi.fn(),
        updateGitInfo: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor', worktreeRoot })),
      },
      threads: {
        list: vi.fn(() => [
          { id: 'thread-no-path', worktreeBranch: 'ship/no-path', worktreePath: null },
          { id: 'thread-no-branch', worktreeBranch: null, worktreePath: oldWorktreePath },
          {
            id: 'thread-77',
            worktreeBranch: 'ship/77-existing',
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

    expect(worktreeRepairMock).toHaveBeenCalledWith([nextWorktreePath]);
    expect(queries.threads.setWorktree).toHaveBeenCalledWith(
      'thread-77',
      'ship/77-existing',
      nextWorktreePath,
    );
    expect(queries.threads.setWorktree).toHaveBeenCalledTimes(1);
    expect(queries.threads.clearWorktree).not.toHaveBeenCalled();
  });

  it('repairs and moves ShipCode worktrees discovered from git even when no thread tracks them', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-relink-orphan-'));
    const oldProjectPath = path.join(tmp, 'old-repo');
    const nextProjectPath = path.join(tmp, 'new-repo');
    const worktreeRoot = path.join(tmp, 'worktrees');
    fs.mkdirSync(nextProjectPath, { recursive: true });

    const oldParent = resolveWorktreeParent(oldProjectPath, worktreeRoot);
    const nextParent = resolveWorktreeParent(nextProjectPath, worktreeRoot);
    const oldWorktreePath = path.join(oldParent, 'orphaned-worktree');
    const nextWorktreePath = path.join(nextParent, 'orphaned-worktree');
    fs.mkdirSync(oldWorktreePath, { recursive: true });
    worktreeListMock.mockResolvedValueOnce([
      {
        path: oldWorktreePath,
        branch: 'shipcode/orphaned-worktree',
      },
    ]);

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
        list: vi.fn(() => []),
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
    expect(queries.threads.setWorktree).not.toHaveBeenCalled();
    expect(queries.threads.clearWorktree).not.toHaveBeenCalled();
    expect(queries.projects.updatePath).toHaveBeenCalledWith('project-1', nextProjectPath);
  });

  it('does not move relink worktrees that are outside the old derived worktree parent', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-relink-outside-'));
    const oldProjectPath = path.join(tmp, 'old-repo');
    const nextProjectPath = path.join(tmp, 'new-repo');
    const worktreeRoot = path.join(tmp, 'worktrees');
    const outsideWorktreePath = path.join(tmp, 'external-worktree');
    fs.mkdirSync(nextProjectPath, { recursive: true });
    fs.mkdirSync(outsideWorktreePath, { recursive: true });

    const project = { ...baseProject, path: oldProjectPath };
    const queries = {
      projects: {
        getById: vi.fn(() => project),
        getByPath: vi.fn(() => null),
        updatePath: vi.fn(),
        updateGitInfo: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor', worktreeRoot })),
      },
      threads: {
        list: vi.fn(() => [
          {
            id: 'thread-outside',
            worktreeBranch: 'ship/outside',
            worktreePath: outsideWorktreePath,
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

    expect(worktreeRepairMock).toHaveBeenCalledWith([outsideWorktreePath]);
    expect(worktreeMoveMock).not.toHaveBeenCalled();
    expect(queries.threads.setWorktree).not.toHaveBeenCalled();
    expect(queries.threads.clearWorktree).not.toHaveBeenCalled();
    expect(queries.projects.updatePath).toHaveBeenCalledWith('project-1', nextProjectPath);
  });

  it('continues relinking when worktree repair and move best-effort operations fail', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-relink-best-effort-'));
    const oldProjectPath = path.join(tmp, 'old-repo');
    const nextProjectPath = path.join(tmp, 'new-repo');
    const worktreeRoot = path.join(tmp, 'worktrees');
    fs.mkdirSync(nextProjectPath, { recursive: true });

    const oldParent = resolveWorktreeParent(oldProjectPath, worktreeRoot);
    const nextParent = resolveWorktreeParent(nextProjectPath, worktreeRoot);
    const oldWorktreePath = path.join(oldParent, '99-failing');
    const nextWorktreePath = path.join(nextParent, '99-failing');
    fs.mkdirSync(oldWorktreePath, { recursive: true });
    worktreeRepairMock.mockRejectedValueOnce(new Error('repair failed'));
    worktreeMoveMock.mockRejectedValueOnce(new Error('move failed'));

    const project = { ...baseProject, path: oldProjectPath };
    const queries = {
      projects: {
        getById: vi.fn(() => project),
        getByPath: vi.fn(() => null),
        updatePath: vi.fn(),
        updateGitInfo: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor', worktreeRoot })),
      },
      threads: {
        list: vi.fn(() => [
          {
            id: 'thread-99',
            worktreeBranch: 'ship/99-failing',
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
    expect(queries.threads.setWorktree).not.toHaveBeenCalled();
    expect(queries.projects.updatePath).toHaveBeenCalledWith('project-1', nextProjectPath);
  });

  it('rejects invalid relink targets before mutating project paths', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-relink-guards-'));
    const existingPath = path.join(tmp, 'existing');
    fs.mkdirSync(existingPath, { recursive: true });
    const queries = {
      projects: {
        getById: vi
          .fn()
          .mockReturnValueOnce(null)
          .mockReturnValueOnce(baseProject)
          .mockReturnValueOnce(baseProject),
        getByPath: vi.fn(() => ({ ...baseProject, id: 'other-project' })),
        updatePath: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor', worktreeRoot: null })),
      },
      threads: {
        list: vi.fn(() => []),
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

    await expect(
      relinkPath(undefined, { projectId: 'project-1', path: existingPath }),
    ).rejects.toThrow('Project project-1 not found');
    await expect(
      relinkPath(undefined, {
        projectId: 'project-1',
        path: path.join(tmp, 'missing'),
      }),
    ).rejects.toThrow('Selected folder does not exist:');
    await expect(
      relinkPath(undefined, { projectId: 'project-1', path: existingPath }),
    ).rejects.toThrow(`Another project already points to ${existingPath}`);
    expect(queries.projects.updatePath).not.toHaveBeenCalled();
  });

  it('continues relinking when discovered worktree listing fails', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-relink-list-fail-'));
    const nextProjectPath = path.join(tmp, 'next');
    fs.mkdirSync(nextProjectPath, { recursive: true });
    worktreeListMock.mockRejectedValueOnce(new Error('list failed'));
    const updatedProject = { ...baseProject, path: nextProjectPath };
    const queries = {
      projects: {
        getById: vi.fn().mockReturnValueOnce(baseProject).mockReturnValue(updatedProject),
        getByPath: vi.fn(() => null),
        updatePath: vi.fn(),
        updateGitInfo: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor', worktreeRoot: null })),
      },
      threads: {
        list: vi.fn(() => []),
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

    await expect(
      relinkPath(undefined, { projectId: 'project-1', path: nextProjectPath }),
    ).resolves.toMatchObject({ path: nextProjectPath });
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

  it('rejects project open requests when the resolved app is unavailable', async () => {
    await withDarwin(async () => {
      vi.mocked(checkDesktopApps).mockResolvedValue({
        cursor: { available: false, label: 'Cursor', error: 'Cursor is not installed' },
        finder: { available: true, label: 'Finder' },
        terminal: { available: true, label: 'Terminal' },
        ghostty: { available: false, label: 'Ghostty' },
        vscode: { available: false, label: 'Visual Studio Code' },
        t3code: { available: false, label: 'T3 Code' },
      } as never);
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const { openPath } = registerOpenPathHandler(baseProject);

      await expect(
        openPath(undefined, { projectId: baseProject.id, target: 'cursor' }),
      ).rejects.toThrow('Cursor is not installed');
      expect(execFileMock).not.toHaveBeenCalled();

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

  it('rejects project rename when the row disappears after update', async () => {
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

    await expect(setName(undefined, { projectId: baseProject.id, name: 'Next' })).rejects.toThrow(
      `Project ${baseProject.id} not found after name update`,
    );
    expect(queries.projects.updateName).toHaveBeenCalledWith(baseProject.id, 'Next');
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

  it('falls back to an available terminal and returns the configured project opener when available', async () => {
    await withDarwin(async () => {
      const project = { ...baseProject, path: '/tmp/ShipCode Worktree' };
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
      } as never);

      const { openPath, queries } = registerOpenPathHandler(project);
      queries.settings.get.mockReturnValue({
        projectOpenTarget: 'cursor',
        terminalOpenTarget: 'terminal',
      });

      await openPath(undefined, { projectId: project.id, target: 'default-terminal' });
      expect(execFileMock).toHaveBeenCalledWith(
        'open',
        ['-na', 'Ghostty', '--args', `--working-directory=${project.path}`],
        { timeout: 10_000 },
        expect.any(Function),
      );

      await openPath(undefined, { projectId: project.id, target: 'default' });
      expect(execFileMock).toHaveBeenLastCalledWith(
        'open',
        ['-a', 'Cursor', project.path],
        { timeout: 10_000 },
        expect.any(Function),
      );

      existsSpy.mockRestore();
    });
  });

  it('covers project opener fallback, Finder errors, explicit app opens, and missing projects', async () => {
    await withDarwin(async () => {
      const project = { ...baseProject, path: '/tmp/ShipCode Worktree' };
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      vi.mocked(checkDesktopApps).mockResolvedValue({
        ...makeDesktopApps(),
        cursor: { key: 'cursor', label: 'Cursor', available: false, path: null, error: null },
        finder: { key: 'finder', label: 'Finder', available: false, path: null, error: null },
        terminal: { key: 'terminal', label: 'Terminal', available: false, path: null, error: null },
        ghostty: { key: 'ghostty', label: 'Ghostty', available: false, path: null, error: null },
        vscode: {
          key: 'vscode',
          label: 'Visual Studio Code',
          available: false,
          path: null,
          error: null,
        },
        t3code: { key: 't3code', label: 'T3 Code', available: false, path: null, error: null },
      } as never);
      const { openPath, queries } = registerOpenPathHandler(project);

      await expect(
        openPath(undefined, { projectId: project.id, target: 'default' }),
      ).rejects.toThrow('No supported project opener app is available');

      vi.mocked(checkDesktopApps).mockResolvedValue(makeDesktopApps() as never);
      vi.mocked(shell.openPath).mockResolvedValueOnce('Finder failed' as never);
      await expect(
        openPath(undefined, { projectId: project.id, target: 'finder' }),
      ).rejects.toThrow('Finder failed');

      await openPath(undefined, { projectId: project.id, target: 'vscode' });
      expect(execFileMock).toHaveBeenLastCalledWith(
        'open',
        ['-a', 'Visual Studio Code', project.path],
        { timeout: 10_000 },
        expect.any(Function),
      );

      queries.projects.getById.mockReturnValueOnce(null as never);
      await expect(
        openPath(undefined, { projectId: project.id, target: 'cursor' }),
      ).rejects.toThrow(`Project ${project.id} not found`);

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

    expect(result.starterIssueNumber).toBeNull();
    await flushBackgroundTasks();

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

    expect(result.starterIssueNumber).toBeNull();
    await flushBackgroundTasks();

    expect(createIssueMock).not.toHaveBeenCalled();
    expect(queries.projects.markStarterIssueSeeded).toHaveBeenCalledWith('project-1', {
      starterIssueNumber: 55,
      starterIssueCreatedAt: '2026-04-20T00:00:00.000Z',
    });
  });

  it('adds GitHub projects even when repo metadata and starter issue seeding fail', async () => {
    let project = { ...baseProject };
    gitGetRemoteUrlMock.mockResolvedValueOnce('https://github.com/shipshitdev/shipcode.git');
    getRepoMetadataMock.mockRejectedValueOnce(new Error('metadata failed'));
    createIssueMock.mockRejectedValueOnce(new Error('starter failed'));
    const queries = {
      projects: {
        add: vi.fn((projectPath: string) => {
          project = { ...project, path: projectPath };
          return project;
        }),
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
        markStarterIssueSeeded: vi.fn(),
        list: vi.fn(() => []),
        listVisible: vi.fn(() => []),
        listArchived: vi.fn(() => []),
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

    await expect(
      addProject(undefined, { path: '/tmp/shipcode', repo: null }),
    ).resolves.toMatchObject({
      id: 'project-1',
    });
    expect(queries.projects.updateGitInfo).toHaveBeenCalledWith(
      'project-1',
      'https://github.com/shipshitdev/shipcode.git',
      'main',
    );
    expect(queries.projects.updateGithubRepoIdentity).not.toHaveBeenCalled();
    expect(createIssueMock).not.toHaveBeenCalled();

    project = {
      ...project,
      githubRepoId: 'R_repo',
      githubRepoFullName: 'shipshitdev/shipcode',
    };
    await expect(
      addProject(undefined, {
        path: '/tmp/shipcode',
        repo: { id: 'R_repo', name: 'shipshitdev/shipcode' },
      }),
    ).resolves.toMatchObject({ id: 'project-1' });
    await flushBackgroundTasks();
    expect(createIssueMock).toHaveBeenCalledTimes(1);
    expect(queries.projects.markStarterIssueSeeded).not.toHaveBeenCalled();
  });

  it('adds projects when remotes are non-GitHub and when git metadata refresh fails', async () => {
    let project = { ...baseProject };
    const queries = {
      projects: {
        add: vi.fn((projectPath: string) => {
          project = { ...project, path: projectPath };
          return project;
        }),
        getById: vi.fn(() => project),
        updateGitInfo: vi.fn((_id: string, gitRemote: string | null, defaultBranch: string) => {
          project = { ...project, gitRemote, defaultBranch };
        }),
        updateGithubRepoIdentity: vi.fn(),
        getByGithubRepoIdentity: vi.fn(() => null),
        markStarterIssueSeeded: vi.fn(),
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
    gitGetRemoteUrlMock.mockResolvedValueOnce('ssh://git.example.com/shipcode.git');

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

    await expect(
      addProject(undefined, { path: '/tmp/non-github', repo: null }),
    ).resolves.toMatchObject({ id: baseProject.id });
    expect(queries.projects.updateGithubRepoIdentity).not.toHaveBeenCalled();
    expect(createIssueMock).not.toHaveBeenCalled();

    gitGetRemoteUrlMock.mockRejectedValueOnce(new Error('not a git repo'));
    await expect(addProject(undefined, { path: '/tmp/no-git', repo: null })).resolves.toMatchObject(
      {
        id: baseProject.id,
      },
    );
  });

  it('tolerates label failures while seeding the starter issue in the background', async () => {
    let project: Project | null = { ...baseProject };
    const queries = {
      projects: {
        add: vi.fn(
          (
            projectPath: string,
            options?: { githubRepoId?: string | null; githubRepoFullName?: string | null },
          ) => {
            project = {
              ...baseProject,
              path: projectPath,
              githubRepoId: options?.githubRepoId ?? null,
              githubRepoFullName: options?.githubRepoFullName ?? null,
            };
            return project;
          },
        ),
        getById: vi.fn(() => project),
        updateGitInfo: vi.fn(),
        updateGithubRepoIdentity: vi.fn(
          (
            _id: string,
            identity: { githubRepoId: string | null; githubRepoFullName: string | null },
          ) => {
            project = project ? { ...project, ...identity } : project;
          },
        ),
        getByGithubRepoIdentity: vi.fn(() => null),
        markStarterIssueSeeded: vi.fn(
          (
            _id: string,
            fields: { starterIssueNumber: number | null; starterIssueCreatedAt?: string | null },
          ) => {
            project = project
              ? {
                  ...project,
                  starterIssueNumber: fields.starterIssueNumber,
                  starterIssueCreatedAt: fields.starterIssueCreatedAt ?? null,
                }
              : project;
          },
        ),
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
    ensureLabelsMock.mockRejectedValueOnce(new Error('labels failed'));
    createIssueMock.mockResolvedValueOnce({
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

    await expect(
      addProject(undefined, {
        path: '/tmp/shipcode',
        repo: { id: 'R_repo', name: 'shipshitdev/shipcode' },
      }),
    ).resolves.toMatchObject({ id: baseProject.id });
    await flushBackgroundTasks();

    expect(ensureLabelsMock).toHaveBeenCalledWith(expect.any(Array));
    expect(createIssueMock).toHaveBeenCalledTimes(1);
    expect(queries.projects.markStarterIssueSeeded).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ starterIssueNumber: 101 }),
    );
  });

  it('skips background GitHub onboarding when the project row has disappeared', async () => {
    let project: Project | null = { ...baseProject };
    const queries = {
      projects: {
        add: vi.fn(
          (
            projectPath: string,
            options?: { githubRepoId?: string | null; githubRepoFullName?: string | null },
          ) => {
            project = {
              ...baseProject,
              path: projectPath,
              githubRepoId: options?.githubRepoId ?? null,
              githubRepoFullName: options?.githubRepoFullName ?? null,
            };
            return project;
          },
        ),
        getById: vi.fn(() => project),
        updateGitInfo: vi.fn(),
        updateGithubRepoIdentity: vi.fn(() => {
          project = null;
        }),
        getByGithubRepoIdentity: vi.fn(() => null),
        markStarterIssueSeeded: vi.fn(),
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

    await expect(
      addProject(undefined, {
        path: '/tmp/shipcode',
        repo: { id: 'R_repo', name: 'shipshitdev/shipcode' },
      }),
    ).resolves.toBeNull();
    await flushBackgroundTasks();

    expect(ensureLabelsMock).not.toHaveBeenCalled();
    expect(createIssueMock).not.toHaveBeenCalled();
    expect(queries.projects.markStarterIssueSeeded).not.toHaveBeenCalled();
  });

  it('archives projects with the correct idle guard for present and missing folders', async () => {
    const existsSpy = vi
      .spyOn(fs, 'existsSync')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
        hasLiveWork: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true),
        archiveIfIdle: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(false),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor', worktreeRoot: '/tmp/worktrees' })),
      },
      threads: {
        list: vi.fn(() => []),
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
    expect(queries.projects.hasLiveWork).toHaveBeenCalledWith(baseProject.id, {
      ignoreAttentionOnly: true,
    });

    await expect(archive(undefined, { projectId: baseProject.id })).rejects.toThrow(
      'Cannot archive a project with active work. Stop running pipelines and dismiss notifications first.',
    );
    expect(queries.projects.hasLiveWork).toHaveBeenLastCalledWith(baseProject.id, {
      ignoreAttentionOnly: false,
    });
    expect(queries.projects.archiveIfIdle).not.toHaveBeenCalled();

    existsSpy.mockRestore();
  });

  it('archives a project after cleaning up tracked worktrees', async () => {
    const worktreeThread = {
      id: 'thread-1',
      worktreeBranch: 'ship/42-fix',
      worktreePath: '/tmp/worktrees/project/thread-1',
    };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
        hasLiveWork: vi.fn(() => false),
        archiveIfIdle: vi.fn(() => true),
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: '/tmp/worktrees' })),
      },
      threads: {
        list: vi.fn(() => [
          worktreeThread,
          { id: 'thread-2', worktreeBranch: null, worktreePath: null },
        ]),
      },
    };
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

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

    await expect(archive(undefined, { projectId: baseProject.id })).resolves.toBeUndefined();

    expect(worktreeRemoveMock).toHaveBeenCalledWith(
      worktreeThread.worktreePath,
      worktreeThread.worktreeBranch,
    );
    expect(queries.projects.archiveIfIdle).toHaveBeenCalledWith(baseProject.id, {
      ignoreAttentionOnly: false,
    });

    existsSpy.mockRestore();
  });

  it('removes a project after cleaning up tracked worktrees by persisted path and branch', async () => {
    const worktreeThread = {
      id: 'thread-1',
      worktreeBranch: 'ship/42-fix',
      worktreePath: '/tmp/worktrees/project/thread-1',
    };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
        hasLiveWork: vi.fn(() => false),
        removeIfIdle: vi.fn(() => true),
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: '/tmp/worktrees' })),
      },
      threads: {
        list: vi.fn(() => [
          worktreeThread,
          { id: 'thread-2', worktreeBranch: null, worktreePath: null },
        ]),
      },
    };
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

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

    const remove = handlers.get('project:remove');
    if (!remove) throw new Error('project:remove handler not registered');

    await expect(remove(undefined, { projectId: baseProject.id })).resolves.toBeUndefined();

    expect(queries.projects.hasLiveWork).toHaveBeenCalledWith(baseProject.id, {
      ignoreAttentionOnly: false,
    });
    expect(worktreeRemoveMock).toHaveBeenCalledTimes(1);
    expect(worktreeRemoveMock).toHaveBeenCalledWith(
      worktreeThread.worktreePath,
      worktreeThread.worktreeBranch,
    );
    expect(queries.projects.removeIfIdle).toHaveBeenCalledWith(baseProject.id, {
      ignoreAttentionOnly: false,
    });

    existsSpy.mockRestore();
  });

  it('keeps the project row when tracked worktree cleanup fails during removal', async () => {
    worktreeRemoveMock.mockResolvedValueOnce({
      success: false,
      error: 'branch is checked out elsewhere' as never,
    });
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
        hasLiveWork: vi.fn(() => false),
        removeIfIdle: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: '/tmp/worktrees' })),
      },
      threads: {
        list: vi.fn(() => [
          {
            id: 'thread-1',
            worktreeBranch: 'ship/42-fix',
            worktreePath: '/tmp/worktrees/project/thread-1',
          },
        ]),
      },
    };
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

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

    const remove = handlers.get('project:remove');
    if (!remove) throw new Error('project:remove handler not registered');

    await expect(remove(undefined, { projectId: baseProject.id })).rejects.toThrow(
      'Failed to clean up 1 worktree(s). Project not removed:',
    );

    expect(queries.projects.removeIfIdle).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });

  it('uses distinct removal guard errors for active present and missing projects', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
        hasLiveWork: vi.fn(() => true),
        removeIfIdle: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: '/tmp/worktrees' })),
      },
      threads: {
        list: vi.fn(() => []),
      },
    };
    const existsSpy = vi
      .spyOn(fs, 'existsSync')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

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

    const remove = handlers.get('project:remove');
    if (!remove) throw new Error('project:remove handler not registered');

    await expect(remove(undefined, { projectId: baseProject.id })).rejects.toThrow(
      'Cannot remove this missing project while a pipeline is still active. Stop running pipelines first.',
    );
    expect(queries.projects.hasLiveWork).toHaveBeenCalledWith(baseProject.id, {
      ignoreAttentionOnly: true,
    });

    await expect(remove(undefined, { projectId: baseProject.id })).rejects.toThrow(
      'Cannot remove a project with active work. Stop running pipelines and dismiss notifications first.',
    );
    expect(queries.projects.hasLiveWork).toHaveBeenLastCalledWith(baseProject.id, {
      ignoreAttentionOnly: false,
    });
    expect(queries.projects.removeIfIdle).not.toHaveBeenCalled();

    existsSpy.mockRestore();
  });

  it('keeps the project row when work appears after removal cleanup', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
        hasLiveWork: vi.fn(() => false),
        removeIfIdle: vi.fn(() => false),
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: '/tmp/worktrees' })),
      },
      threads: {
        list: vi.fn(() => []),
      },
    };
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

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

    const remove = handlers.get('project:remove');
    if (!remove) throw new Error('project:remove handler not registered');

    await expect(remove(undefined, { projectId: baseProject.id })).rejects.toThrow(
      'New work appeared during cleanup. Project not removed. Retry after stopping pipelines.',
    );
    expect(queries.projects.removeIfIdle).toHaveBeenCalledWith(baseProject.id, {
      ignoreAttentionOnly: false,
    });

    existsSpy.mockRestore();
  });

  it('closes only idle, failed, and completed threads', async () => {
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
        clearDoneAt: vi.fn(),
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
      'Cannot close thread while in executing phase',
    );
    markDone(undefined, { threadId: 'thread-1' });

    expect(queries.threads.markDone).toHaveBeenCalledWith('thread-1');
  });

  it('changes completed automation runs between completed and closed', () => {
    const completedThread = { id: 'thread-1', status: 'completed' };
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
          .mockReturnValueOnce(completedThread)
          .mockReturnValueOnce({ ...completedThread, doneAt: '2026-05-13T08:00:00.000Z' })
          .mockReturnValueOnce({ ...completedThread, doneAt: '2026-05-13T08:00:00.000Z' })
          .mockReturnValueOnce({ ...completedThread, doneAt: null })
          .mockReturnValueOnce({ id: 'thread-1', status: 'executing' }),
        markDone: vi.fn(),
        clearDoneAt: vi.fn(),
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

    const setDoneStatus = handlers.get('thread:set-done-status');
    if (!setDoneStatus) throw new Error('thread:set-done-status handler not registered');

    expect(setDoneStatus(undefined, { threadId: 'thread-1', status: 'closed' })).toEqual({
      ...completedThread,
      doneAt: '2026-05-13T08:00:00.000Z',
    });
    expect(queries.threads.markDone).toHaveBeenCalledWith('thread-1');

    expect(setDoneStatus(undefined, { threadId: 'thread-1', status: 'completed' })).toEqual({
      ...completedThread,
      doneAt: null,
    });
    expect(queries.threads.clearDoneAt).toHaveBeenCalledWith('thread-1');

    expect(() => setDoneStatus(undefined, { threadId: 'thread-1', status: 'closed' })).toThrow(
      'Cannot change done status while in executing phase',
    );
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

  it('lists code tree entries with ignore filtering, sorting, sizes, and dirty markers', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-code-tree-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'app.ts'), 'export const app = true;\n');
    fs.writeFileSync(path.join(tmp, 'README.md'), '# ShipCode\n');
    fs.writeFileSync(path.join(tmp, '.DS_Store'), '');
    gitGetStatusMock.mockResolvedValueOnce({
      branch: 'main',
      commitHash: 'abc123',
      isDirty: true,
      untrackedCount: 0,
      stagedCount: 0,
      modifiedCount: 2,
      aheadCount: 0,
      behindCount: 0,
      compareRef: 'origin/main',
      preCommitHookPath: null,
    });
    gitGetDiffStatMock.mockResolvedValueOnce('src/app.ts | 2 +-\nREADME.md | 1 +');

    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: tmp })),
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: '/tmp/worktrees' })),
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

    const listTree = handlers.get('code:list-tree');
    if (!listTree) throw new Error('code:list-tree handler not registered');

    await expect(
      listTree(undefined, { projectId: baseProject.id, worktreePath: tmp }),
    ).resolves.toEqual([
      { name: 'src', relativePath: 'src', type: 'dir', sizeBytes: null, isModified: true },
      {
        name: 'README.md',
        relativePath: 'README.md',
        type: 'file',
        sizeBytes: Buffer.byteLength('# ShipCode\n'),
        isModified: true,
      },
    ]);
    expect(gitGetDiffStatMock).toHaveBeenCalledWith(tmp);
  });

  it('covers code browser guard and best-effort stat paths', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-code-guards-'));
    const worktreePath = path.join(tmp, 'worktree');
    fs.mkdirSync(path.join(worktreePath, 'src'), { recursive: true });
    fs.writeFileSync(path.join(worktreePath, 'src', 'app.ts'), 'export const app = true;\n');
    fs.writeFileSync(path.join(worktreePath, 'README.md'), '# ShipCode\n');

    const thread = {
      id: 'thread-1',
      title: 'Code guards',
      status: 'completed',
      worktreeBranch: 'shipcode/thread-1',
      worktreePath,
      githubIssueNumber: null,
    };
    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: tmp })),
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: path.join(tmp, 'worktrees') })),
      },
      threads: {
        list: vi.fn(() => [thread]),
      },
      githubIssues: {
        getByThreadId: vi.fn(() => null),
      },
    };
    worktreeListMock.mockResolvedValue([{ path: worktreePath, branch: 'shipcode/thread-1' }]);
    gitGetStatusMock.mockResolvedValueOnce({
      branch: 'shipcode/thread-1',
      commitHash: 'abc123',
      isDirty: true,
      untrackedCount: 0,
      stagedCount: 0,
      modifiedCount: 2,
      aheadCount: 0,
      behindCount: 0,
      compareRef: 'main',
      preCommitHookPath: null,
    });
    gitGetDiffStatMock.mockRejectedValueOnce(new Error('diff stat failed'));

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

    const listTree = handlers.get('code:list-tree');
    const readFile = handlers.get('code:read-file');
    const fileDiff = handlers.get('code:file-diff');
    const worktreeDiff = handlers.get('git:worktree-diff');
    if (!listTree || !readFile || !fileDiff || !worktreeDiff) {
      throw new Error('code browser handlers not registered');
    }

    await expect(
      listTree(undefined, { projectId: baseProject.id, worktreePath }),
    ).resolves.toMatchObject([
      { name: 'src', type: 'dir', isModified: false },
      { name: 'README.md', type: 'file', isModified: false },
    ]);
    await expect(
      listTree(undefined, { projectId: baseProject.id, worktreePath, relativePath: 'README.md' }),
    ).rejects.toThrow('Not a directory');
    await expect(
      listTree(undefined, { projectId: baseProject.id, worktreePath, relativePath: 'missing' }),
    ).rejects.toThrow('Not a directory');
    await expect(
      listTree(undefined, {
        projectId: baseProject.id,
        worktreePath: path.join(tmp, 'unknown-worktree'),
      }),
    ).rejects.toThrow('Worktree not associated with this project');

    queries.projects.getById.mockReturnValueOnce(null as never);
    await expect(listTree(undefined, { projectId: baseProject.id, worktreePath })).rejects.toThrow(
      `Project ${baseProject.id} not found`,
    );

    await expect(
      readFile(undefined, { projectId: baseProject.id, worktreePath, relativePath: 'src' }),
    ).rejects.toThrow('Not a file');
    queries.projects.getById.mockReturnValueOnce(null as never);
    await expect(
      readFile(undefined, { projectId: baseProject.id, worktreePath, relativePath: 'README.md' }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);

    queries.projects.getById.mockReturnValueOnce(null as never);
    await expect(
      fileDiff(undefined, { projectId: baseProject.id, worktreePath, relativePath: 'README.md' }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      worktreeDiff(undefined, {
        projectId: baseProject.id,
        worktreePath: path.join(tmp, 'missing'),
      }),
    ).rejects.toThrow('Worktree not found for this project');
  });

  it('lists project-root code trees when git status, diff stat, and file stat are unavailable', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-code-best-effort-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'app.ts'), 'export const app = true;\n');
    fs.writeFileSync(path.join(tmp, 'README.md'), '# ShipCode\n');
    fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), '# Changes\n');

    const originalStat = fsp.stat.bind(fsp);
    const statSpy = vi.spyOn(fsp, 'stat').mockImplementation(async (targetPath, options) => {
      if (String(targetPath).endsWith('README.md')) {
        throw new Error('stat failed');
      }
      return originalStat(targetPath, options as never);
    });
    gitGetStatusMock.mockRejectedValueOnce(new Error('status failed')).mockResolvedValueOnce({
      branch: 'main',
      commitHash: 'abc123',
      isDirty: true,
      untrackedCount: 0,
      stagedCount: 0,
      modifiedCount: 1,
      aheadCount: 0,
      behindCount: 0,
      compareRef: 'origin/main',
      preCommitHookPath: null,
    });
    gitGetDiffStatMock.mockRejectedValueOnce(new Error('diff stat failed'));

    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: tmp })),
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: '/tmp/worktrees' })),
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

    const listTree = handlers.get('code:list-tree');
    if (!listTree) throw new Error('code:list-tree handler not registered');

    await expect(
      listTree(undefined, { projectId: baseProject.id, worktreePath: tmp }),
    ).resolves.toEqual([
      { name: 'src', relativePath: 'src', type: 'dir', sizeBytes: null, isModified: false },
      { name: 'tests', relativePath: 'tests', type: 'dir', sizeBytes: null, isModified: false },
      {
        name: 'CHANGELOG.md',
        relativePath: 'CHANGELOG.md',
        type: 'file',
        sizeBytes: Buffer.byteLength('# Changes\n'),
        isModified: false,
      },
      {
        name: 'README.md',
        relativePath: 'README.md',
        type: 'file',
        sizeBytes: null,
        isModified: false,
      },
    ]);
    await expect(
      listTree(undefined, { projectId: baseProject.id, worktreePath: tmp }),
    ).resolves.toEqual([
      { name: 'src', relativePath: 'src', type: 'dir', sizeBytes: null, isModified: false },
      { name: 'tests', relativePath: 'tests', type: 'dir', sizeBytes: null, isModified: false },
      {
        name: 'CHANGELOG.md',
        relativePath: 'CHANGELOG.md',
        type: 'file',
        sizeBytes: Buffer.byteLength('# Changes\n'),
        isModified: false,
      },
      {
        name: 'README.md',
        relativePath: 'README.md',
        type: 'file',
        sizeBytes: null,
        isModified: false,
      },
    ]);

    statSpy.mockRestore();
  });

  it('reads text, binary, truncated, and escaping code files from a project worktree', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-code-read-'));
    fs.writeFileSync(path.join(tmp, 'plain.txt'), 'plain text');
    fs.writeFileSync(path.join(tmp, 'binary.dat'), Buffer.from([0x41, 0x00, 0x42]));
    fs.writeFileSync(path.join(tmp, 'large.txt'), Buffer.alloc(512 * 1024 + 1, 'a'));

    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: tmp })),
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: '/tmp/worktrees' })),
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

    const readFile = handlers.get('code:read-file');
    if (!readFile) throw new Error('code:read-file handler not registered');

    await expect(
      readFile(undefined, {
        projectId: baseProject.id,
        worktreePath: tmp,
        relativePath: 'plain.txt',
      }),
    ).resolves.toEqual({
      relativePath: 'plain.txt',
      content: 'plain text',
      isBinary: false,
      sizeBytes: Buffer.byteLength('plain text'),
      truncated: false,
    });
    await expect(
      readFile(undefined, {
        projectId: baseProject.id,
        worktreePath: tmp,
        relativePath: 'binary.dat',
      }),
    ).resolves.toEqual({
      relativePath: 'binary.dat',
      content: '',
      isBinary: true,
      sizeBytes: 3,
      truncated: false,
    });
    await expect(
      readFile(undefined, {
        projectId: baseProject.id,
        worktreePath: tmp,
        relativePath: 'large.txt',
      }),
    ).resolves.toMatchObject({
      relativePath: 'large.txt',
      isBinary: false,
      sizeBytes: 512 * 1024 + 1,
      truncated: true,
    });
    await expect(
      readFile(undefined, {
        projectId: baseProject.id,
        worktreePath: tmp,
        relativePath: '../outside.txt',
      }),
    ).rejects.toThrow('Path escapes worktree');
  });

  it('serves git visualizer data and worktree diffs for tracked ShipCode worktrees', async () => {
    const worktreePath = '/tmp/worktrees/project-1/thread-1';
    const thread = {
      id: 'thread-1',
      title: 'Fix the thing',
      status: 'completed',
      worktreeBranch: 'shipcode/thread-1',
      worktreePath,
      githubIssueNumber: 42,
    };
    const issue = {
      id: 'issue-42',
      projectId: baseProject.id,
      issueNumber: 42,
      title: 'GitHub issue title',
    };
    worktreeListMock.mockResolvedValueOnce([{ path: worktreePath, branch: 'shipcode/thread-1' }]);
    gitGetDiffAgainstHeadMock.mockResolvedValueOnce(
      [
        'diff --git a/src/app.ts b/src/app.ts',
        'index 1111111..2222222 100644',
        '--- a/src/app.ts',
        '+++ b/src/app.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        '',
      ].join('\n'),
    );

    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: '/tmp/worktrees' })),
      },
      threads: {
        list: vi.fn(() => [thread]),
      },
      githubIssues: {
        getByThreadId: vi.fn(() => issue),
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

    const visualizerData = handlers.get('git:visualizer-data');
    const worktreeDiff = handlers.get('git:worktree-diff');
    if (!visualizerData || !worktreeDiff) throw new Error('git visualizer handlers not registered');

    await expect(visualizerData(undefined, { projectId: baseProject.id })).resolves.toMatchObject({
      branches: ['main', 'develop'],
      worktrees: [
        expect.objectContaining({ id: `main:${baseProject.id}`, kind: 'main' }),
        expect.objectContaining({
          id: `worktree:${worktreePath}`,
          kind: 'shipcode',
          threadId: 'thread-1',
          issueNumber: 42,
          title: 'GitHub issue title',
          status: 'completed',
        }),
      ],
    });

    worktreeListMock.mockResolvedValueOnce([{ path: worktreePath, branch: 'shipcode/thread-1' }]);
    const records = (await worktreeDiff(undefined, {
      projectId: baseProject.id,
      worktreePath,
    })) as Array<{ id: string; threadId: string; filePath: string }>;

    expect(records[0]).toMatchObject({
      id: 'thread-1:0:src/app.ts',
      threadId: 'thread-1',
      filePath: 'src/app.ts',
    });
    expect(gitGetDiffAgainstHeadMock).toHaveBeenCalledWith(worktreePath);
  });

  it('restores checkpoints and resets linked GitHub issues to todo', async () => {
    const checkpoint = {
      id: 'checkpoint-1',
      threadId: 'thread-1',
      commitSha: 'abc1234',
    };
    const issue = { id: 'issue-1', projectId: baseProject.id };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor' })),
      },
      checkpoints: {
        getById: vi.fn(() => checkpoint),
      },
      threads: {
        getById: vi.fn(() => ({ id: 'thread-1', worktreePath: '/tmp/worktree' })),
        updateStatus: vi.fn(),
      },
      githubIssues: {
        getByThreadId: vi.fn(() => issue),
        resetToTodo: vi.fn(() => false),
        reconcileCompletedFromEvidence: vi.fn(),
        list: vi.fn(() => [issue]),
      },
    };
    const pipeline = {
      listActive: vi.fn(() => []),
    };

    registerProjectHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: pipeline as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
      emitter: {} as never,
      notificationService: {} as never,
    });

    const restore = handlers.get('checkpoint:restore');
    if (!restore) throw new Error('checkpoint:restore handler not registered');

    await expect(
      restore(undefined, { threadId: 'thread-1', checkpointId: checkpoint.id }),
    ).resolves.toEqual({ restored: true, checkpoint });
    expect(execMock).toHaveBeenCalledWith(
      'git reset --hard abc1234',
      { cwd: '/tmp/worktree', timeout: 15_000 },
      expect.any(Function),
    );
    expect(execMock).toHaveBeenCalledWith(
      'git clean -fd',
      { cwd: '/tmp/worktree', timeout: 15_000 },
      expect.any(Function),
    );
    expect(queries.githubIssues.reconcileCompletedFromEvidence).toHaveBeenCalledWith('issue-1');
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('pipeline:phase', {
      threadId: 'thread-1',
      phase: 'idle',
    });
  });

  it('runs auto-commit with locks and clamps workflow failures', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      settings: {
        get: vi.fn(() => ({
          autoCommitProvider: 'claude',
          autoCommitModel: 'claude-sonnet-4-5',
          autoCommitMode: 'checkpoint',
        })),
      },
    };
    const pipeline = {
      listActive: vi.fn(() => []),
    };

    registerProjectHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: pipeline as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
      emitter: {} as never,
      notificationService: {} as never,
    });

    const autoCommit = handlers.get('git:auto-commit');
    if (!autoCommit) throw new Error('git:auto-commit handler not registered');

    await expect(
      autoCommit(undefined, { projectId: baseProject.id, worktreePath: '/tmp/worktree' }),
    ).resolves.toEqual({ committed: true });
    expect(withWorktreeLockMock).toHaveBeenCalledWith('/tmp/worktree', expect.any(Function));
    expect(runAutoCommitWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project: baseProject,
        worktreePath: '/tmp/worktree',
        provider: 'claude',
        model: 'claude-sonnet-4-5',
        mode: 'checkpoint',
        apiKey: undefined,
      }),
    );

    runAutoCommitWorkflowMock.mockRejectedValueOnce(new Error(`${'x'.repeat(400)}\nstack`));
    await expect(
      autoCommit(undefined, { projectId: baseProject.id, worktreePath: '/tmp/worktree' }),
    ).rejects.toThrow('xxx');
  });

  it('rejects auto-commit for locked, active, and unconfigured OpenRouter worktrees', async () => {
    const settings = {
      autoCommitProvider: 'claude',
      autoCommitModel: 'claude-sonnet-4-5',
      autoCommitMode: 'checkpoint',
    };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      settings: {
        get: vi.fn(() => settings),
      },
    };
    const pipeline = {
      listActive: vi.fn(() => [] as Array<{ worktreePath: string }>),
    };

    registerProjectHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: pipeline as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
      emitter: {} as never,
      notificationService: {} as never,
    });

    const autoCommit = handlers.get('git:auto-commit');
    if (!autoCommit) throw new Error('git:auto-commit handler not registered');

    isWorktreeLockedMock.mockReturnValueOnce(true);
    await expect(
      autoCommit(undefined, { projectId: baseProject.id, worktreePath: '/tmp/worktree' }),
    ).rejects.toThrow('Auto-commit already running for this worktree');

    pipeline.listActive.mockReturnValueOnce([{ worktreePath: '/tmp/worktree' }]);
    await expect(
      autoCommit(undefined, { projectId: baseProject.id, worktreePath: '/tmp/worktree' }),
    ).rejects.toThrow('Pipeline is active in this worktree');

    queries.settings.get.mockReturnValueOnce({
      ...settings,
      autoCommitProvider: 'openrouter',
    });
    await expect(
      autoCommit(undefined, { projectId: baseProject.id, worktreePath: '/tmp/worktree' }),
    ).rejects.toThrow('OPENROUTER_API_KEY is not set');
  });

  it('runs cleanup analyze/apply with managed branches and clamps cleanup failures', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      settings: {
        get: vi.fn(() => ({ cleanupCriteria: { deleteMerged: true } })),
      },
      threads: {
        list: vi.fn(() => [
          { id: 'thread-1', worktreeBranch: 'shipcode/thread-1' },
          { id: 'thread-2', worktreeBranch: null },
        ]),
      },
    };
    const pipeline = {
      listActive: vi.fn(() => [{ threadId: 'thread-active', worktreePath: '/tmp/active' }]),
    };

    registerProjectHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: pipeline as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
      emitter: {} as never,
      notificationService: {} as never,
    });

    const analyze = handlers.get('git:cleanup-analyze');
    const apply = handlers.get('git:cleanup-apply');
    if (!analyze || !apply) throw new Error('cleanup handlers not registered');

    await expect(analyze(undefined, { projectId: baseProject.id })).resolves.toEqual({
      items: [{ id: 'stale-worktree' }],
    });
    expect(runCleanupAnalyzeMock).toHaveBeenCalledWith({
      project: baseProject,
      criteria: { deleteMerged: true },
      activeSummaries: [{ threadId: 'thread-active', worktreePath: '/tmp/active' }],
      managedBranches: ['shipcode/thread-1'],
    });

    await expect(
      apply(undefined, { projectId: baseProject.id, itemIds: ['stale-worktree'] }),
    ).resolves.toEqual({ removed: ['stale-worktree'] });
    expect(runCleanupApplyMock).toHaveBeenCalledWith({
      project: baseProject,
      items: [{ id: 'stale-worktree' }],
      itemIds: ['stale-worktree'],
      lockFor: withWorktreeLockMock,
    });

    runCleanupAnalyzeMock.mockRejectedValueOnce(new Error(`${'cleanup failed '.repeat(40)}`));
    await expect(analyze(undefined, { projectId: baseProject.id })).rejects.toThrow(
      'cleanup failed',
    );

    runCleanupAnalyzeMock.mockResolvedValueOnce({ items: [{ id: 'stale-worktree' }] });
    runCleanupApplyMock.mockRejectedValueOnce(new Error(`${'apply failed '.repeat(40)}`));
    await expect(
      apply(undefined, { projectId: baseProject.id, itemIds: ['stale-worktree'] }),
    ).rejects.toThrow('apply failed');
  });

  it('auto-detects GitHub project status mapping when saving a project URL', async () => {
    let project: Project = {
      ...baseProject,
      githubProjectUrl: null,
      githubStatusMapping: null,
    };
    const mapping = {
      fieldId: 'PVTSSF_lAD',
      todoOptionId: 'todo',
      inProgressOptionId: 'progress',
      doneOptionId: 'done',
    };
    const queries = {
      projects: {
        getById: vi.fn(() => project),
        updateGithubProjectUrl: vi.fn((_projectId: string, url: string | null) => {
          project = { ...project, githubProjectUrl: url };
        }),
        setGithubStatusMapping: vi.fn((_projectId: string, nextMapping: typeof mapping) => {
          project = { ...project, githubStatusMapping: nextMapping as never };
        }),
        clearGithubStatusMapping: vi.fn(() => {
          project = { ...project, githubStatusMapping: null };
        }),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor' })),
      },
    };
    validateProjectStatusFieldMock.mockImplementationOnce(
      async ({ onWarn }: { onWarn: (message: string) => void }) => {
        onWarn('missing optional status labels');
        return {
          ok: true,
          mapping,
        };
      },
    );

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

    const setGithubProjectUrl = handlers.get('project:set-github-project-url');
    if (!setGithubProjectUrl) {
      throw new Error('project:set-github-project-url handler not registered');
    }

    await expect(
      setGithubProjectUrl(undefined, {
        projectId: baseProject.id,
        url: 'https://github.com/orgs/shipshitdev/projects/1',
      }),
    ).resolves.toMatchObject({
      githubProjectUrl: 'https://github.com/orgs/shipshitdev/projects/1',
      githubStatusMapping: mapping,
    });
    expect(validateProjectStatusFieldMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: baseProject.path,
        projectUrl: 'https://github.com/orgs/shipshitdev/projects/1',
      }),
    );
    expect(queries.projects.setGithubStatusMapping).toHaveBeenCalledWith(baseProject.id, mapping);
  });

  it('serves thread panel data with latest plan statuses', async () => {
    const thread = { id: 'thread-1', projectId: baseProject.id };
    const statusMap = new Map([['thread-1', 'approved']]);
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor' })),
      },
      threads: {
        list: vi.fn(() => [thread]),
      },
      plans: {
        getLatestStatusByThreadIds: vi.fn(() => statusMap),
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

    const getData = handlers.get('thread-panel:get-data');
    if (!getData) throw new Error('thread-panel:get-data handler not registered');

    await expect(getData(undefined, { projectId: baseProject.id })).resolves.toMatchObject({
      project: expect.objectContaining({ id: baseProject.id }),
      threads: [thread],
      latestPlanStatusByThreadId: { 'thread-1': 'approved' },
      branches: ['main', 'develop'],
    });
    expect(queries.plans.getLatestStatusByThreadIds).toHaveBeenCalledWith(['thread-1']);
  });

  it('returns project details, file diffs, and chat notification tests', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-file-diff-'));
    const queries = {
      projects: {
        getById: vi.fn(() => ({ ...baseProject, path: tmp })),
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: '/tmp/worktrees' })),
      },
    };
    const chatNotificationService = {
      sendTest: vi.fn(async () => ({ ok: true })),
    };

    registerProjectHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: {} as never,
      chatNotificationService: chatNotificationService as never,
      processManager: {} as never,
      emitter: {} as never,
      notificationService: {} as never,
    });

    expect(handlers.get('project:get')?.(undefined, { projectId: baseProject.id })).toMatchObject({
      id: baseProject.id,
      path: tmp,
    });
    await expect(
      handlers.get('code:file-diff')?.(undefined, {
        projectId: baseProject.id,
        worktreePath: tmp,
        relativePath: 'README.md',
      }),
    ).resolves.toBeNull();
    await expect(
      handlers.get('integrations:test-chat')?.(undefined, {
        provider: 'discord',
      }),
    ).resolves.toEqual({ ok: true });
    expect(chatNotificationService.sendTest).toHaveBeenCalledWith('discord', null);
  });

  it('rejects invalid project mutation inputs and missing updated rows', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
        updateDefaultBranch: vi.fn(),
        updateGithubProjectUrl: vi.fn(),
        clearGithubStatusMapping: vi.fn(),
        updateNotificationRouting: vi.fn(),
        updateModelOverrides: vi.fn(),
        updateNotifyGithubUser: vi.fn(),
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

    await expect(
      handlers.get('project:set-default-branch')?.(undefined, {
        projectId: baseProject.id,
        branch: '',
      }),
    ).rejects.toThrow('branch is required');
    await expect(
      handlers.get('project:set-default-branch')?.(undefined, {
        projectId: baseProject.id,
        branch: 'missing',
      }),
    ).rejects.toThrow("Branch 'missing' not found in project ShipCode");
    await expect(
      handlers.get('project:set-github-project-url')?.(undefined, {
        projectId: baseProject.id,
        url: 'https://example.com/not-github',
      }),
    ).rejects.toThrow();

    queries.projects.getById.mockReturnValueOnce(baseProject).mockReturnValueOnce(null as never);
    await expect(
      handlers.get('project:set-default-branch')?.(undefined, {
        projectId: baseProject.id,
        branch: 'develop',
      }),
    ).rejects.toThrow(`Project ${baseProject.id} not found after default branch update`);

    queries.projects.getById.mockReturnValueOnce(baseProject).mockReturnValueOnce(null as never);
    gitGetRemoteUrlMock.mockResolvedValueOnce(baseProject.gitRemote as string);
    await expect(
      handlers.get('project:refresh-git-remote')?.(undefined, { projectId: baseProject.id }),
    ).rejects.toThrow(`Project ${baseProject.id} not found after remote refresh`);

    queries.projects.getById.mockReturnValueOnce(baseProject).mockReturnValueOnce(null as never);
    await expect(
      handlers.get('project:set-github-project-url')?.(undefined, {
        projectId: baseProject.id,
        url: null,
      }),
    ).rejects.toThrow(`Project ${baseProject.id} not found after GitHub URL update`);

    queries.projects.getById.mockReturnValueOnce(baseProject).mockReturnValueOnce(null as never);
    await expect(
      handlers.get('project:set-notification-routing')?.(undefined, {
        projectId: baseProject.id,
        routing: {
          discordRouting: 'inherit',
          discordWebhookUrlOverride: null,
          telegramRouting: 'inherit',
          telegramChatIdOverride: null,
        },
      }),
    ).rejects.toThrow(`Project ${baseProject.id} not found after notification routing update`);

    queries.projects.getById.mockReturnValueOnce(baseProject).mockReturnValueOnce(null as never);
    await expect(
      handlers.get('project:set-model-overrides')?.(undefined, {
        projectId: baseProject.id,
        overrides: {},
      }),
    ).rejects.toThrow(`Project ${baseProject.id} not found after model override update`);

    queries.projects.getById.mockReturnValueOnce(baseProject).mockReturnValueOnce(null as never);
    expect(() =>
      handlers.get('project:set-notify-github-user')?.(undefined, {
        projectId: baseProject.id,
        handle: 'vincent',
      }),
    ).toThrow(`Project ${baseProject.id} not found after notify github user update`);
  });

  it('rejects missing project records across project, git, cleanup, and setup handlers', async () => {
    const queries = {
      projects: {
        getById: vi.fn(() => null),
        updateDefaultBranch: vi.fn(),
        updateGitRemote: vi.fn(),
        updateGithubProjectUrl: vi.fn(),
        updateNotificationRouting: vi.fn(),
        updateModelOverrides: vi.fn(),
        updateNotifyGithubUser: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ cleanupCriteria: {}, worktreeRoot: null })),
      },
      threads: {
        list: vi.fn(() => []),
      },
    };

    registerProjectHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: { listActive: vi.fn(() => []) } as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
      emitter: {} as never,
      notificationService: {} as never,
    });

    await expect(
      handlers.get('project:get-setup')?.(undefined, { projectId: baseProject.id }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('project:save-setup')?.(undefined, {
        projectId: baseProject.id,
        contract: { version: 1, setupCommands: [], verifyCommands: [] },
      }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('git:status')?.(undefined, { projectId: baseProject.id }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('git:commit')?.(undefined, { projectId: baseProject.id, message: 'commit' }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('git:push')?.(undefined, { projectId: baseProject.id }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('thread-panel:get-data')?.(undefined, { projectId: baseProject.id }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('git:list-branches')?.(undefined, { projectId: baseProject.id, fetch: true }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('git:visualizer-data')?.(undefined, { projectId: baseProject.id }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('git:worktree-diff')?.(undefined, {
        projectId: baseProject.id,
        worktreePath: '/tmp/worktree',
      }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('git:auto-commit')?.(undefined, {
        projectId: baseProject.id,
        worktreePath: '/tmp/worktree',
      }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('git:cleanup-analyze')?.(undefined, { projectId: baseProject.id }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('git:cleanup-apply')?.(undefined, { projectId: baseProject.id, itemIds: [] }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('project:set-default-branch')?.(undefined, {
        projectId: baseProject.id,
        branch: 'main',
      }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('project:refresh-git-remote')?.(undefined, { projectId: baseProject.id }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('project:set-github-project-url')?.(undefined, {
        projectId: baseProject.id,
        url: null,
      }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('project:set-notification-routing')?.(undefined, {
        projectId: baseProject.id,
        routing: {
          discordRouting: 'inherit',
          discordWebhookUrlOverride: null,
          telegramRouting: 'inherit',
          telegramChatIdOverride: null,
        },
      }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    await expect(
      handlers.get('project:set-model-overrides')?.(undefined, {
        projectId: baseProject.id,
        overrides: {},
      }),
    ).rejects.toThrow(`Project ${baseProject.id} not found`);
    expect(() =>
      handlers.get('project:set-notify-github-user')?.(undefined, {
        projectId: baseProject.id,
        handle: null,
      }),
    ).toThrow(`Project ${baseProject.id} not found`);
  });

  it('rejects checkpoint restore when checkpoint, worktree, or active pipeline guards fail', async () => {
    const checkpoint = {
      id: 'checkpoint-1',
      threadId: 'thread-1',
      commitSha: 'abc123',
    };
    const queries = {
      checkpoints: {
        getById: vi
          .fn()
          .mockReturnValueOnce(null)
          .mockReturnValueOnce({ ...checkpoint, threadId: 'other-thread' })
          .mockReturnValue(checkpoint),
      },
      threads: {
        getById: vi
          .fn()
          .mockReturnValueOnce({ id: 'thread-1', worktreePath: null })
          .mockReturnValue({ id: 'thread-1', worktreePath: '/tmp/worktree' }),
        updateStatus: vi.fn(),
      },
      githubIssues: {
        getByThreadId: vi.fn(() => null),
      },
    };
    const pipeline = {
      listActive: vi.fn(() => [{ threadId: 'thread-1' }]),
    };

    registerProjectHandlers({
      ipcMain,
      mainWindow: mainWindow as never,
      queries: queries as never,
      pipeline: pipeline as never,
      chatNotificationService: {} as never,
      processManager: {} as never,
      emitter: {} as never,
      notificationService: {} as never,
    });

    const restore = handlers.get('checkpoint:restore');
    if (!restore) throw new Error('checkpoint:restore handler not registered');

    await expect(
      restore(undefined, { threadId: 'thread-1', checkpointId: 'checkpoint-1' }),
    ).rejects.toThrow('Checkpoint not found');
    await expect(
      restore(undefined, { threadId: 'thread-1', checkpointId: 'checkpoint-1' }),
    ).rejects.toThrow('Checkpoint not found');
    await expect(
      restore(undefined, { threadId: 'thread-1', checkpointId: 'checkpoint-1' }),
    ).rejects.toThrow('Thread has no active worktree to restore');
    await expect(
      restore(undefined, { threadId: 'thread-1', checkpointId: 'checkpoint-1' }),
    ).rejects.toThrow('Stop the active pipeline before restoring a checkpoint');
    expect(execMock).not.toHaveBeenCalled();
  });

  it('rejects missing threads before marking a thread done', () => {
    const queries = {
      threads: {
        getById: vi.fn(() => null),
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

    expect(() => handlers.get('thread:mark-done')?.(undefined, { threadId: 'thread-1' })).toThrow(
      'Thread thread-1 not found',
    );
    expect(queries.threads.markDone).not.toHaveBeenCalled();
  });

  it('stores partial GitHub project status mappings and tolerates validation failures', async () => {
    let project: Project = {
      ...baseProject,
      githubProjectUrl: null,
      githubStatusMapping: null,
    };
    const partialMapping = { fieldId: 'field-only' };
    const queries = {
      projects: {
        getById: vi.fn(() => project),
        updateGithubProjectUrl: vi.fn((_projectId: string, url: string | null) => {
          project = { ...project, githubProjectUrl: url };
        }),
        setGithubStatusMapping: vi.fn((_projectId: string, mapping: unknown) => {
          project = { ...project, githubStatusMapping: mapping as never };
        }),
        clearGithubStatusMapping: vi.fn(() => {
          project = { ...project, githubStatusMapping: null };
        }),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor' })),
      },
    };
    validateProjectStatusFieldMock
      .mockResolvedValueOnce({
        ok: false,
        reason: 'missing Done',
        availableOptions: ['Todo'],
        mapping: partialMapping,
      })
      .mockResolvedValueOnce({
        ok: false,
        reason: 'missing field',
        availableOptions: [],
        mapping: null,
      })
      .mockRejectedValueOnce(new Error('gh failed'));

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

    const setGithubProjectUrl = handlers.get('project:set-github-project-url');
    if (!setGithubProjectUrl) {
      throw new Error('project:set-github-project-url handler not registered');
    }

    await setGithubProjectUrl(undefined, {
      projectId: baseProject.id,
      url: 'https://github.com/orgs/shipshitdev/projects/1',
    });
    expect(queries.projects.setGithubStatusMapping).toHaveBeenCalledWith(
      baseProject.id,
      partialMapping,
    );

    await setGithubProjectUrl(undefined, {
      projectId: baseProject.id,
      url: 'https://github.com/orgs/shipshitdev/projects/2',
    });
    expect(queries.projects.clearGithubStatusMapping).toHaveBeenCalledTimes(1);

    await expect(
      setGithubProjectUrl(undefined, {
        projectId: baseProject.id,
        url: 'https://github.com/orgs/shipshitdev/projects/3',
      }),
    ).resolves.toMatchObject({
      githubProjectUrl: 'https://github.com/orgs/shipshitdev/projects/3',
    });
  });

  it('serves project mutation and git command handlers', async () => {
    let project: Project = { ...baseProject, gitRemote: 'https://github.com/acme/old.git' };
    const savedSetup = { status: 'ready', path: project.path };
    const inspectedSetup = { status: 'ready', path: project.path, source: 'inspect' };
    const modelOverrides = {
      plannerModelOverride: 'claude',
      reviewerModelOverride: null,
      executorModelOverride: 'codex',
      verifierModelOverride: null,
      plannerModelIdOverride: 'claude-opus-4-1',
      reviewerModelIdOverride: null,
      executorModelIdOverride: null,
      verifierModelIdOverride: null,
      plannerReasoningEffortOverride: 'high',
      reviewerReasoningEffortOverride: null,
      executorReasoningEffortOverride: null,
      verifierReasoningEffortOverride: null,
      revisionCountOverride: 2,
      requireApprovalOverride: true,
      pipelineSpeedProfileOverride: 'careful',
      prdQualityGate: 'warn',
    };
    const routing = {
      discordRouting: 'override',
      discordWebhookUrlOverride: 'https://discord.test/webhook',
      telegramRouting: 'disabled',
      telegramChatIdOverride: null,
    };
    const queries = {
      projects: {
        getById: vi.fn(() => project),
        updateDefaultBranch: vi.fn((_projectId: string, branch: string) => {
          project = { ...project, defaultBranch: branch };
        }),
        updateGitRemote: vi.fn((_projectId: string, remote: string | null) => {
          project = { ...project, gitRemote: remote };
        }),
        updateGithubProjectUrl: vi.fn((_projectId: string, url: string | null) => {
          project = { ...project, githubProjectUrl: url };
        }),
        clearGithubStatusMapping: vi.fn(),
        updateNotificationRouting: vi.fn((_projectId: string, nextRouting: typeof routing) => {
          project = { ...project, ...nextRouting } as Project;
        }),
        updateModelOverrides: vi.fn((_projectId: string, nextOverrides: typeof modelOverrides) => {
          project = { ...project, ...nextOverrides } as unknown as Project;
        }),
        updateNotifyGithubUser: vi.fn((_projectId: string, handle: string | null) => {
          project = { ...project, notifyGithubUser: handle };
        }),
      },
      settings: {
        get: vi.fn(() => ({ projectOpenTarget: 'cursor' })),
      },
    };
    writeProjectSetupMock.mockReturnValue(savedSetup);
    inspectProjectSetupMock.mockReturnValue(inspectedSetup as never);
    gitGetRemoteUrlMock.mockResolvedValueOnce('https://github.com/acme/new.git');

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

    await expect(
      handlers.get('project:save-setup')?.(undefined, {
        projectId: project.id,
        contract: { commands: { test: 'bun test' } },
      }),
    ).resolves.toBe(inspectedSetup);
    expect(writeProjectSetupMock).toHaveBeenCalledWith(project.path, {
      commands: { test: 'bun test' },
    });

    await expect(
      handlers.get('git:status')?.(undefined, { projectId: project.id }),
    ).resolves.toMatchObject({ branch: 'main' });
    await expect(
      handlers.get('git:commit')?.(undefined, { projectId: project.id, message: 'checkpoint' }),
    ).resolves.toEqual({ hash: 'abc123' });
    await expect(handlers.get('git:push')?.(undefined, { projectId: project.id })).resolves.toEqual(
      { pushed: true },
    );
    await expect(
      handlers.get('git:list-branches')?.(undefined, { projectId: project.id, fetch: true }),
    ).resolves.toEqual(['main', 'develop']);
    expect(gitFetchMock).toHaveBeenCalledTimes(1);

    await expect(
      handlers.get('project:set-default-branch')?.(undefined, {
        projectId: project.id,
        branch: 'develop',
      }),
    ).resolves.toMatchObject({ defaultBranch: 'develop' });
    expect(queries.projects.updateDefaultBranch).toHaveBeenCalledWith(project.id, 'develop');

    await expect(
      handlers.get('project:refresh-git-remote')?.(undefined, { projectId: project.id }),
    ).resolves.toMatchObject({
      remote: 'https://github.com/acme/new.git',
      changed: true,
    });
    expect(queries.projects.updateGitRemote).toHaveBeenCalledWith(
      project.id,
      'https://github.com/acme/new.git',
    );

    await expect(
      handlers.get('project:set-github-project-url')?.(undefined, {
        projectId: project.id,
        url: null,
      }),
    ).resolves.toMatchObject({ githubProjectUrl: null });
    expect(queries.projects.clearGithubStatusMapping).toHaveBeenCalledWith(project.id);

    await expect(
      handlers.get('project:set-notification-routing')?.(undefined, {
        projectId: project.id,
        routing,
      }),
    ).resolves.toMatchObject(routing);
    expect(queries.projects.updateNotificationRouting).toHaveBeenCalledWith(project.id, routing);

    await expect(
      handlers.get('project:set-model-overrides')?.(undefined, {
        projectId: project.id,
        overrides: modelOverrides,
      }),
    ).resolves.toMatchObject(modelOverrides);
    expect(queries.projects.updateModelOverrides).toHaveBeenCalledWith(project.id, modelOverrides);

    expect(
      handlers.get('project:set-notify-github-user')?.(undefined, {
        projectId: project.id,
        handle: 'vincent',
      }),
    ).toMatchObject({ notifyGithubUser: 'vincent' });
    expect(queries.projects.updateNotifyGithubUser).toHaveBeenCalledWith(project.id, 'vincent');
  });

  it('covers project handler fallback branches for setup, dialogs, openers, removal, and worktree diffs', async () => {
    const worktreePath = '/tmp/worktrees/project-1/untracked';
    const branchOnlyThread = {
      id: 'thread-branch-only',
      title: 'Branch matched thread',
      status: 'completed',
      worktreeBranch: 'shipcode/branch-only',
      worktreePath: null,
      githubIssueNumber: 91,
    };
    const queries = {
      projects: {
        getById: vi.fn(() => baseProject),
        hasLiveWork: vi.fn(() => false),
        removeIfIdle: vi.fn(() => true),
        archiveIfIdle: vi.fn(() => true),
      },
      settings: {
        get: vi.fn(() => ({
          projectOpenTarget: 'cursor',
          terminalOpenTarget: 'terminal',
          worktreeRoot: '/tmp/worktrees',
        })),
      },
      threads: {
        list: vi.fn(() => [
          { id: 'thread-empty', worktreePath: null, worktreeBranch: null },
          branchOnlyThread,
        ]),
      },
      githubIssues: {
        getByThreadId: vi.fn(() => null),
      },
    };
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    worktreeListMock.mockResolvedValue([{ path: worktreePath, branch: 'shipcode/branch-only' }]);
    gitGetDiffAgainstHeadMock.mockResolvedValueOnce('');
    writeProjectSetupMock.mockReturnValueOnce({ status: 'ready', path: baseProject.path });
    inspectProjectSetupMock.mockReturnValueOnce(null as never);
    vi.mocked(checkDesktopApps).mockResolvedValue({
      ...makeDesktopApps(),
      cursor: { key: 'cursor', label: 'Cursor', available: false, path: null, error: null },
      finder: { key: 'finder', label: 'Finder', available: false, path: null, error: null },
      terminal: { key: 'terminal', label: 'Terminal', available: false, path: null, error: null },
      ghostty: { key: 'ghostty', label: 'Ghostty', available: false, path: null, error: null },
      vscode: {
        key: 'vscode',
        label: 'Visual Studio Code',
        available: false,
        path: null,
        error: null,
      },
      t3code: { key: 't3code', label: 'T3 Code', available: false, path: null, error: null },
    } as never);
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: [],
    } as never);

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

    await expect(
      handlers.get('project:save-setup')?.(undefined, {
        projectId: baseProject.id,
        contract: { version: 1, setupCommands: [], verifyCommands: [] },
      }),
    ).resolves.toEqual({ status: 'ready', path: baseProject.path });

    await expect(handlers.get('dialog:open-directory')?.()).resolves.toBeNull();

    await withDarwin(async () => {
      await expect(
        handlers.get('project:open-path')?.(undefined, {
          projectId: baseProject.id,
          target: 'cursor',
        }),
      ).rejects.toThrow('Cursor is not available');
    });

    await expect(
      handlers.get('git:visualizer-data')?.(undefined, { projectId: baseProject.id }),
    ).resolves.toMatchObject({
      worktrees: [
        expect.objectContaining({ kind: 'main', threadId: null, issueNumber: null }),
        expect.objectContaining({
          kind: 'shipcode',
          threadId: 'thread-branch-only',
          issueNumber: 91,
          title: 'Branch matched thread',
        }),
      ],
    });
    worktreeListMock.mockResolvedValueOnce([
      { path: worktreePath, branch: 'shipcode/branch-only' },
    ]);
    await expect(
      handlers.get('git:worktree-diff')?.(undefined, {
        projectId: baseProject.id,
        worktreePath,
      }),
    ).resolves.toEqual([]);

    queries.projects.getById.mockReturnValueOnce(null as never);
    await expect(
      handlers.get('project:remove')?.(undefined, { projectId: baseProject.id }),
    ).resolves.toBeUndefined();
    expect(queries.projects.removeIfIdle).toHaveBeenLastCalledWith(baseProject.id, {
      ignoreAttentionOnly: false,
    });

    queries.projects.getById.mockReturnValueOnce(null as never);
    await expect(
      handlers.get('project:archive')?.(undefined, { projectId: baseProject.id }),
    ).resolves.toBeUndefined();
    expect(queries.projects.archiveIfIdle).toHaveBeenLastCalledWith(baseProject.id, {
      ignoreAttentionOnly: false,
    });

    existsSpy.mockRestore();
  });

  it('serves simple project, thread, plan, settings, health, and shell IPC handlers', async () => {
    const visibleProject = { ...baseProject, id: 'project-visible', path: '/tmp/visible' };
    const archivedProject = { ...baseProject, id: 'project-archived', path: '/tmp/archived' };
    const thread = { id: 'thread-1', projectId: baseProject.id, status: 'idle' };
    const plan = { id: 'plan-1', threadId: 'thread-1', status: 'approved' };
    const review = { id: 'review-1', planId: 'plan-1' };
    const diff = { id: 'diff-1', threadId: 'thread-1' };
    const checkpoint = { id: 'checkpoint-1', threadId: 'thread-1' };
    const settings: Partial<AppSettings> = { projectOpenTarget: 'cursor', telemetryEnabled: false };
    const queries = {
      projects: {
        list: vi.fn(() => [baseProject]),
        listVisible: vi.fn(() => [visibleProject]),
        listArchived: vi.fn(() => [archivedProject]),
        getById: vi.fn(() => baseProject),
        pin: vi.fn(),
        unarchive: vi.fn(),
        updateName: vi.fn(),
      },
      threads: {
        list: vi.fn(() => [thread]),
        create: vi.fn((_projectId: string, prompt: string, title: string) => ({
          id: 'thread-created',
          prompt,
          title,
        })),
        getById: vi.fn(() => thread),
        markDone: vi.fn(),
      },
      checkpoints: {
        list: vi.fn(() => [checkpoint]),
      },
      plans: {
        getLatest: vi.fn(() => plan),
        getById: vi.fn(() => plan),
        list: vi.fn(() => [plan]),
        listByIssue: vi.fn(() => [plan]),
        getLatestStatusByThreadIds: vi.fn(() => new Map([[thread.id, 'approved']])),
        updateStructured: vi.fn(),
      },
      reviews: {
        getByPlanId: vi.fn(() => review),
        listByPlanIds: vi.fn(() => [review]),
      },
      diffs: {
        list: vi.fn(() => [diff]),
      },
      settings: {
        get: vi.fn(() => settings),
        set: vi.fn(),
      },
    };
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.mocked(detectProjectSetup).mockReturnValue({
      status: 'ready',
      path: '/tmp/visible',
    } as never);
    vi.mocked(checkSystemHealthWithAuth).mockResolvedValue({ ok: true } as never);
    vi.mocked(checkCliProviderUsage).mockResolvedValue({ providers: [] } as never);
    vi.mocked(checkIntegrationStatus).mockResolvedValue({ github: { ok: true } } as never);
    vi.mocked(validateOpenRouterModel).mockResolvedValue({ ok: true } as never);
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/selected'],
    } as never);

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

    expect(handlers.get('project:list')?.()).toEqual([
      expect.objectContaining({ id: baseProject.id, pathExists: true }),
    ]);
    expect(handlers.get('project:list-visible')?.()).toEqual([
      expect.objectContaining({ id: 'project-visible', pathExists: true }),
    ]);
    expect(handlers.get('project:list-archived')?.()).toEqual([
      expect.objectContaining({ id: 'project-archived', pathExists: true }),
    ]);
    await expect(
      handlers.get('project:detect-setup')?.(undefined, { path: '/tmp/visible' }),
    ).resolves.toEqual({ status: 'ready', path: '/tmp/visible' });
    await expect(handlers.get('project:detect-setup')?.(undefined, {})).rejects.toThrow(
      'Project path not found for setup detection',
    );
    await expect(
      handlers.get('project:get-setup')?.(undefined, { projectId: baseProject.id }),
    ).resolves.toEqual({ status: 'ready', path: '/tmp/visible' });

    handlers.get('project:pin')?.(undefined, { projectId: baseProject.id, pinned: true });
    handlers.get('project:unarchive')?.(undefined, { projectId: baseProject.id });
    expect(queries.projects.pin).toHaveBeenCalledWith(baseProject.id, true);
    expect(queries.projects.unarchive).toHaveBeenCalledWith(baseProject.id);
    await expect(
      handlers.get('project:set-name')?.(undefined, {
        projectId: baseProject.id,
        name: '  Renamed project  ',
      }),
    ).resolves.toMatchObject({ id: baseProject.id });
    expect(queries.projects.updateName).toHaveBeenCalledWith(baseProject.id, 'Renamed project');
    await expect(
      handlers.get('project:set-name')?.(undefined, { projectId: baseProject.id, name: '   ' }),
    ).rejects.toThrow('Project name is required');

    expect(handlers.get('thread:list')?.(undefined, { projectId: baseProject.id })).toEqual([
      thread,
    ]);
    await expect(
      handlers.get('thread-panel:get-data')?.(undefined, { projectId: baseProject.id }),
    ).resolves.toMatchObject({
      project: expect.objectContaining({ id: baseProject.id }),
      threads: [thread],
      latestPlanStatusByThreadId: { [thread.id]: 'approved' },
      branches: ['main', 'develop'],
    });
    expect(
      handlers.get('thread:create')?.(undefined, {
        projectId: baseProject.id,
        prompt: 'x'.repeat(70),
      }),
    ).toEqual({ id: 'thread-created', prompt: 'x'.repeat(70), title: `${'x'.repeat(60)}...` });
    expect(handlers.get('thread:get')?.(undefined, { threadId: 'thread-1' })).toEqual(thread);
    handlers.get('thread:mark-done')?.(undefined, { threadId: 'thread-1' });
    expect(queries.threads.markDone).toHaveBeenCalledWith('thread-1');
    queries.threads.getById.mockReturnValueOnce({ ...thread, status: 'executing' });
    expect(() => handlers.get('thread:mark-done')?.(undefined, { threadId: 'thread-1' })).toThrow(
      'Cannot close thread while in executing phase',
    );
    expect(handlers.get('checkpoint:list')?.(undefined, { threadId: 'thread-1' })).toEqual([
      checkpoint,
    ]);
    expect(handlers.get('plan:get')?.(undefined, { threadId: 'thread-1' })).toEqual(plan);
    expect(handlers.get('plan:get-by-id')?.(undefined, { planId: 'plan-1' })).toEqual(plan);
    expect(handlers.get('plan:list')?.(undefined, { threadId: 'thread-1' })).toEqual([plan]);
    expect(
      handlers.get('plan:list-for-issue')?.(undefined, {
        projectId: baseProject.id,
        issueNumber: 1,
      }),
    ).toEqual([plan]);
    handlers.get('plan:update')?.(undefined, {
      planId: 'plan-1',
      structured: { objective: 'Ship' },
    });
    expect(queries.plans.updateStructured).toHaveBeenCalledWith('plan-1', { objective: 'Ship' });
    expect(handlers.get('review:get')?.(undefined, { planId: 'plan-1' })).toEqual(review);
    expect(handlers.get('review:list-by-plans')?.(undefined, { planIds: ['plan-1'] })).toEqual([
      review,
    ]);
    expect(handlers.get('diff:list')?.(undefined, { threadId: 'thread-1' })).toEqual([diff]);
    expect(handlers.get('settings:get')?.()).toEqual(settings);
    configureMainTelemetryMock.mockRejectedValueOnce(new Error('telemetry failed'));
    handlers.get('settings:set')?.(undefined, { telemetryEnabled: true });
    await Promise.resolve();
    expect(queries.settings.set).toHaveBeenCalledWith({ telemetryEnabled: true });
    expect(handlers.get('telemetry:get-status')?.()).toEqual(expect.any(Object));

    await expect(handlers.get('health:check')?.(undefined, { force: true })).resolves.toEqual({
      ok: true,
    });
    await expect(
      handlers.get('provider-usage:check')?.(undefined, { force: true }),
    ).resolves.toEqual({ providers: [] });
    await expect(handlers.get('integrations:check')?.(undefined, { force: true })).resolves.toEqual(
      { github: { ok: true } },
    );
    await expect(
      handlers.get('integrations:validate-openrouter-model')?.(undefined, {
        modelId: 'openrouter/auto',
      }),
    ).resolves.toEqual({ ok: true });
    await expect(handlers.get('dialog:open-directory')?.()).resolves.toBe('/tmp/selected');
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: true,
      filePaths: [],
    } as never);
    await expect(handlers.get('dialog:open-directory')?.()).resolves.toBeNull();

    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue('/home/vincent');
    settings.addProjectStartsIn = '~/work';
    expect(handlers.get('fs:resolve-start-dir')?.()).toEqual({
      resolvedPath: path.join('/home/vincent', 'work'),
    });
    settings.addProjectStartsIn = 'relative/path';
    expect(handlers.get('fs:resolve-start-dir')?.()).toEqual({ resolvedPath: '/home/vincent' });
    existsSpy.mockReturnValueOnce(false);
    settings.addProjectStartsIn = '/missing/path';
    expect(handlers.get('fs:resolve-start-dir')?.()).toEqual({ resolvedPath: '/home/vincent' });
    homeSpy.mockRestore();

    const readdirSpy = vi.spyOn(fsp, 'readdir');
    readdirSpy.mockResolvedValueOnce([
      { name: 'zeta', isDirectory: () => true },
      { name: '.hidden', isDirectory: () => true },
      { name: 'alpha.txt', isDirectory: () => false },
      { name: 'alpha', isDirectory: () => true },
    ] as never);
    await expect(
      handlers.get('fs:list-directories')?.(undefined, { dirPath: '/tmp/root' }),
    ).resolves.toEqual({
      entries: [
        { name: 'alpha', absolutePath: path.join('/tmp/root', 'alpha') },
        { name: 'zeta', absolutePath: path.join('/tmp/root', 'zeta') },
      ],
      error: null,
    });
    readdirSpy.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(
      handlers.get('fs:list-directories')?.(undefined, { dirPath: '/tmp/missing' }),
    ).resolves.toEqual({ entries: [], error: 'not-found' });
    readdirSpy.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
    await expect(
      handlers.get('fs:list-directories')?.(undefined, { dirPath: '/tmp/denied' }),
    ).resolves.toEqual({ entries: [], error: 'permission-denied' });
    readdirSpy.mockRestore();

    await handlers.get('shell:open-external')?.(undefined, {
      url: 'https://github.com/shipshitdev/shipcode',
    });
    await handlers.get('shell:open-external')?.(undefined, { url: 'javascript:alert(1)' });
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
    expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/shipshitdev/shipcode');

    existsSpy.mockRestore();
  });
});
