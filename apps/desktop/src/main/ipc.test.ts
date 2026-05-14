import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIpcHandlers } from './ipc';

const mocks = vi.hoisted(() => {
  const registerProjectHandlers = vi.fn((deps: { ipcMain: IpcMain }) => {
    deps.ipcMain.handle('test:ok', async () => 'ok');
    deps.ipcMain.handle('test:error', async () => {
      throw new Error('boom');
    });
  });

  return {
    captureIpcFailure: vi.fn(),
    logEvent: vi.fn(),
    logger: {
      info: vi.fn(),
    },
    transitionThreadPhase: vi.fn(),
    registerProjectHandlers,
    registerGitHubHandlers: vi.fn(),
    registerIssueGraphHandlers: vi.fn(),
    registerPipelineHandlers: vi.fn(),
    registerQuickTaskHandlers: vi.fn(),
    registerSkillsHandlers: vi.fn(),
    registerSupportHandlers: vi.fn(),
    registerInstantHandlers: vi.fn(),
    registerIssueTerminalHandlers: vi.fn(),
    registerPullRequestHandlers: vi.fn(),
    registerAgentConversationHandlers: vi.fn(),
    registerFeatureQaHandlers: vi.fn(),
    registerAutomationHandlers: vi.fn(),
    registerDeveloperHandlers: vi.fn(),
  };
});

vi.mock('./telemetry', () => ({
  captureIpcFailure: mocks.captureIpcFailure,
}));

vi.mock('./logger.service', () => ({
  default: mocks.logger,
  logEvent: mocks.logEvent,
}));

vi.mock('./ipc/helpers', () => ({
  transitionThreadPhase: mocks.transitionThreadPhase,
}));

vi.mock('./ipc/register-project-handlers', () => ({
  registerProjectHandlers: mocks.registerProjectHandlers,
}));
vi.mock('./ipc/register-github-handlers', () => ({
  registerGitHubHandlers: mocks.registerGitHubHandlers,
}));
vi.mock('./ipc/register-issue-graph-handlers', () => ({
  registerIssueGraphHandlers: mocks.registerIssueGraphHandlers,
}));
vi.mock('./ipc/register-pipeline-handlers', () => ({
  registerPipelineHandlers: mocks.registerPipelineHandlers,
}));
vi.mock('./ipc/register-quick-task-handlers', () => ({
  registerQuickTaskHandlers: mocks.registerQuickTaskHandlers,
}));
vi.mock('./ipc/register-skills-handlers', () => ({
  registerSkillsHandlers: mocks.registerSkillsHandlers,
}));
vi.mock('./ipc/register-support-handlers', () => ({
  registerSupportHandlers: mocks.registerSupportHandlers,
}));
vi.mock('./ipc/register-instant-handlers', () => ({
  registerInstantHandlers: mocks.registerInstantHandlers,
}));
vi.mock('./ipc/register-issue-terminal-handlers', () => ({
  registerIssueTerminalHandlers: mocks.registerIssueTerminalHandlers,
}));
vi.mock('./ipc/register-pr-handlers', () => ({
  registerPullRequestHandlers: mocks.registerPullRequestHandlers,
}));
vi.mock('./ipc/register-agent-conversation-handlers', () => ({
  registerAgentConversationHandlers: mocks.registerAgentConversationHandlers,
}));
vi.mock('./ipc/register-feature-qa-handlers', () => ({
  registerFeatureQaHandlers: mocks.registerFeatureQaHandlers,
}));
vi.mock('./ipc/register-automation-handlers', () => ({
  registerAutomationHandlers: mocks.registerAutomationHandlers,
}));
vi.mock('./ipc/register-developer-handlers', () => ({
  registerDeveloperHandlers: mocks.registerDeveloperHandlers,
}));

describe('registerIpcHandlers', () => {
  const handled = new Map<string, (...args: unknown[]) => unknown>();
  const listeners = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handled.set(channel, listener);
    }),
    on: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      listeners.set(channel, listener);
    }),
  } as unknown as IpcMain;

  const queries = {
    threads: {
      getOrphaned: vi.fn(() => [{ id: 'thread-1', lastError: 'interrupted' }]),
    },
  };

  beforeEach(() => {
    handled.clear();
    listeners.clear();
    vi.clearAllMocks();
  });

  function register() {
    registerIpcHandlers(
      ipcMain,
      { id: 1 } as never,
      queries as never,
      { id: 2 } as never,
      { id: 3 } as never,
      { id: 4 } as never,
      { id: 5 } as never,
      { id: 6 } as never,
      { id: 7 } as never,
      { id: 8 } as never,
      { id: 9 } as never,
    );
  }

  it('resets orphaned threads and registers every handler group', () => {
    register();

    expect(mocks.transitionThreadPhase).toHaveBeenCalledWith(
      { id: 1 },
      queries,
      { id: 4 },
      {
        threadId: 'thread-1',
        phase: 'failed',
        errorMessage: 'interrupted',
      },
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      '[startup] reset orphaned thread thread-1 → failed',
    );
    expect(mocks.registerProjectHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerGitHubHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerIssueGraphHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerPipelineHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerQuickTaskHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerSkillsHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerSupportHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerInstantHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerIssueTerminalHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerPullRequestHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerAgentConversationHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerFeatureQaHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerAutomationHandlers).toHaveBeenCalledWith(expect.any(Object), { id: 8 });
    expect(mocks.registerDeveloperHandlers).toHaveBeenCalledWith(expect.any(Object), { id: 7 });
  });

  it('wraps IPC handlers with timing logs and telemetry on failure', async () => {
    const dateSpy = vi.spyOn(Date, 'now');
    dateSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(1_175);
    register();

    await expect(handled.get('test:ok')?.({})).resolves.toBe('ok');
    expect(mocks.logEvent).toHaveBeenCalledWith('ipc:handle', {
      channel: 'test:ok',
      ok: true,
      elapsedMs: 175,
    });
    expect(mocks.logger.info).toHaveBeenCalledWith('[ipc] test:ok completed in 175ms');

    dateSpy.mockReturnValueOnce(2_000).mockReturnValueOnce(2_012);
    await expect(handled.get('test:error')?.({})).rejects.toThrow('boom');
    expect(mocks.captureIpcFailure).toHaveBeenCalledWith(expect.any(Error), {
      channel: 'test:error',
      elapsedMs: 12,
    });
    expect(mocks.logEvent).toHaveBeenCalledWith('ipc:handle', {
      channel: 'test:error',
      ok: false,
      elapsedMs: 12,
      error: 'boom',
    });

    dateSpy.mockRestore();
  });

  it('does not emit slow IPC logs for fast handlers and captures string failures', async () => {
    mocks.registerProjectHandlers.mockImplementationOnce((deps: { ipcMain: IpcMain }) => {
      deps.ipcMain.handle('test:fast', async () => 'fast');
      deps.ipcMain.handle('test:string-error', async () => {
        throw 'string boom';
      });
    });
    const dateSpy = vi.spyOn(Date, 'now');
    dateSpy.mockReturnValueOnce(3_000).mockReturnValueOnce(3_050);
    register();

    await expect(handled.get('test:fast')?.({})).resolves.toBe('fast');
    expect(mocks.logEvent).toHaveBeenCalledWith('ipc:handle', {
      channel: 'test:fast',
      ok: true,
      elapsedMs: 50,
    });
    expect(mocks.logger.info).not.toHaveBeenCalledWith('[ipc] test:fast completed in 50ms');

    dateSpy.mockReturnValueOnce(4_000).mockReturnValueOnce(4_005);
    await expect(handled.get('test:string-error')?.({})).rejects.toBe('string boom');
    expect(mocks.captureIpcFailure).toHaveBeenCalledWith('string boom', {
      channel: 'test:string-error',
      elapsedMs: 5,
    });
    expect(mocks.logEvent).toHaveBeenCalledWith('ipc:handle', {
      channel: 'test:string-error',
      ok: false,
      elapsedMs: 5,
      error: 'string boom',
    });

    dateSpy.mockRestore();
  });

  it('logs object renderer diagnostics and ignores invalid payloads', () => {
    register();

    listeners.get('diagnostics:renderer-ipc')?.({}, null);
    listeners.get('diagnostics:renderer-ipc')?.({}, 'not an object');
    listeners.get('diagnostics:renderer-ipc')?.({}, { channel: 'projects:list', elapsedMs: 3 });

    expect(mocks.logEvent).toHaveBeenCalledTimes(1);
    expect(mocks.logEvent).toHaveBeenCalledWith('ipc:renderer', {
      channel: 'projects:list',
      elapsedMs: 3,
    });
  });
});
