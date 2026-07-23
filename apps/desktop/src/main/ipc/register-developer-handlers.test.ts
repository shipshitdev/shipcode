import { checkSystemHealthWithAuth } from '@shipcode/agents';
import type { IpcMain } from 'electron';
import { app, shell } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDeveloperHandlers } from './register-developer-handlers';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('@shipcode/agents', () => ({
  checkSystemHealthWithAuth: vi.fn(async () => ({
    claude: { version: 'claude-version' },
    codex: { version: 'codex-version' },
    git: { version: 'git-version' },
    gh: { version: 'gh-version' },
  })),
}));

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.1.0'),
    getPath: vi.fn(() => '/fallback-logs'),
  },
  shell: {
    openPath: vi.fn(async () => ''),
  },
}));

vi.mock('../logger.service', () => ({
  default: {
    warn: vi.fn(),
    transports: {
      file: {
        level: 'info',
      },
    },
  },
  getEventLogPath: vi.fn(() => '/logs/events.jsonl'),
  getLogDirectoryPath: vi.fn(() => '/logs'),
}));

function makeDeps(isDestroyed = false) {
  const resourceMonitor = {
    getSnapshot: vi.fn(async () => ({ cpuPercent: 12, tasks: [] })),
  };
  const processManager = {
    kill: vi.fn(),
  };
  return {
    ipcMain: {
      handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
        handlers.set(channel, listener);
      }),
    } as unknown as IpcMain,
    mainWindow: {
      isDestroyed: vi.fn(() => isDestroyed),
      webContents: {
        openDevTools: vi.fn(),
      },
    },
    processManager,
    resourceMonitor,
  };
}

describe('registerDeveloperHandlers', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  it('returns developer info and proxies update service handlers', async () => {
    const updateService = {
      getStatus: vi.fn(() => ({ hasUpdate: false })),
      checkNow: vi.fn(async () => ({ hasUpdate: true })),
    };
    registerDeveloperHandlers(makeDeps() as never, updateService as never);

    expect(handlers.get('app:get-platform')?.()).toBe(process.platform);

    await expect(handlers.get('developer:get-info')?.()).resolves.toMatchObject({
      appVersion: '0.1.0',
      logDirectoryPath: '/logs',
      eventLogPath: '/logs/events.jsonl',
      cliVersions: {
        claude: 'claude-version',
        codex: 'codex-version',
        git: 'git-version',
        gh: 'gh-version',
      },
    });
    expect(checkSystemHealthWithAuth).toHaveBeenCalled();
    expect(handlers.get('update:get-status')?.()).toEqual({ hasUpdate: false });
    await expect(handlers.get('update:check-now')?.()).resolves.toEqual({ hasUpdate: true });
  });

  it('opens devtools only when the main window is alive', () => {
    const liveDeps = makeDeps(false);
    registerDeveloperHandlers(liveDeps as never, {} as never);
    handlers.get('developer:open-devtools')?.();
    expect(liveDeps.mainWindow.webContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' });

    handlers.clear();
    const destroyedDeps = makeDeps(true);
    registerDeveloperHandlers(destroyedDeps as never, {} as never);
    handlers.get('developer:open-devtools')?.();
    expect(destroyedDeps.mainWindow.webContents.openDevTools).not.toHaveBeenCalled();
  });

  it('opens the log directory with fallback and updates log level', async () => {
    vi.mocked(shell.openPath).mockResolvedValueOnce('primary failed').mockResolvedValueOnce('');
    registerDeveloperHandlers(makeDeps() as never, {} as never);

    await handlers.get('developer:open-log-directory')?.();

    expect(shell.openPath).toHaveBeenNthCalledWith(1, '/logs');
    expect(shell.openPath).toHaveBeenNthCalledWith(2, '/fallback-logs');
    expect(app.getPath).toHaveBeenCalledWith('logs');

    handlers.get('developer:set-log-level')?.(undefined, { level: 'debug' });
    const log = await import('../logger.service');
    expect(log.default.transports.file.level).toBe('debug');
  });

  it('opens the log directory without fallback when the primary path succeeds', async () => {
    vi.mocked(shell.openPath).mockResolvedValueOnce('');
    registerDeveloperHandlers(makeDeps() as never, {} as never);

    await handlers.get('developer:open-log-directory')?.();

    expect(shell.openPath).toHaveBeenCalledTimes(1);
    expect(shell.openPath).toHaveBeenCalledWith('/logs');
    expect(app.getPath).not.toHaveBeenCalled();
  });

  it('throws when both primary and fallback log directory opens fail', async () => {
    vi.mocked(shell.openPath)
      .mockResolvedValueOnce('primary failed')
      .mockResolvedValueOnce('fallback failed');
    registerDeveloperHandlers(makeDeps() as never, {} as never);

    await expect(handlers.get('developer:open-log-directory')?.()).rejects.toThrow(
      'fallback failed',
    );
  });

  it('returns process resource usage and kills managed processes', async () => {
    const deps = makeDeps();
    registerDeveloperHandlers(deps as never, {} as never);

    await expect(handlers.get('process:list-resource-usage')?.()).resolves.toMatchObject({
      cpuPercent: 12,
      tasks: [],
    });

    handlers.get('process:kill')?.(undefined, { processId: 'proc-1' });
    expect(deps.processManager.kill).toHaveBeenCalledWith('proc-1');
  });

  it('returns zeroed process resource usage when no resource monitor is registered', async () => {
    const deps = makeDeps();
    deps.resourceMonitor = undefined as never;
    registerDeveloperHandlers(deps as never, {} as never);

    expect(handlers.get('process:list-resource-usage')?.()).toMatchObject({
      cpuPercent: 0,
      highCpu: false,
      tasks: [],
    });
  });
});
