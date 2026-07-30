import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIpcHandlers } from './ipc';

const mocks = vi.hoisted(() => {
  const projectSideEffect = vi.fn();
  const pipelineSideEffect = vi.fn();
  const githubSideEffect = vi.fn();
  const registerProjectHandlers = vi.fn((deps: { ipcMain: IpcMain }) => {
    deps.ipcMain.handle('test:ok', async () => 'ok');
    deps.ipcMain.handle('test:error', async () => {
      throw new Error('boom');
    });
    deps.ipcMain.handle('project:mutate', (_event, args) => projectSideEffect(args));
  });

  return {
    captureIpcFailure: vi.fn(),
    logEvent: vi.fn(),
    logger: {
      info: vi.fn(),
    },
    transitionThreadPhase: vi.fn(),
    projectSideEffect,
    pipelineSideEffect,
    githubSideEffect,
    registerProjectHandlers,
    registerGitHubHandlers: vi.fn((deps: { ipcMain: IpcMain }) => {
      deps.ipcMain.handle('github:mutate', (_event, args) => githubSideEffect(args));
    }),
    registerIssueGraphHandlers: vi.fn(),
    registerPipelineHandlers: vi.fn((deps: { ipcMain: IpcMain }) => {
      deps.ipcMain.handle('pipeline:mutate', (_event, args) => pipelineSideEffect(args));
    }),
    registerQuickTaskHandlers: vi.fn(),
    registerSkillsHandlers: vi.fn(),
    registerSupportHandlers: vi.fn(),
    registerInstantHandlers: vi.fn(),
    registerIssueChatHandlers: vi.fn(),
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
vi.mock('./ipc/register-issue-chat-handlers', () => ({
  registerIssueChatHandlers: mocks.registerIssueChatHandlers,
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

  const ghSync = { getProject: vi.fn(), syncToGithub: vi.fn() };

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
      { id: 'notification-credentials' } as never,
      { id: 7 } as never,
      { id: 8 } as never,
      { id: 9 } as never,
      () => {},
      ghSync as never,
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
      ghSync,
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
    expect(mocks.registerIssueChatHandlers).toHaveBeenCalledTimes(1);
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

  it('does not emit success IPC logs for fast handlers and captures string failures', async () => {
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
    // Fast successes are intentionally not persisted to events.log.
    expect(mocks.logEvent).not.toHaveBeenCalledWith(
      'ipc:handle',
      expect.objectContaining({ channel: 'test:fast', ok: true }),
    );
    expect(mocks.logger.info).not.toHaveBeenCalledWith('[ipc] test:fast completed in 50ms');

    dateSpy.mockReturnValueOnce(4_000).mockReturnValueOnce(4_005);
    await expect(handled.get('test:string-error')?.({})).rejects.toThrow('string boom');
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

  it('validates project, pipeline, and GitHub input before handler side effects', async () => {
    register();

    await expect(handled.get('project:mutate')?.({}, 'project-1')).rejects.toThrow(
      'Invalid IPC input for project:mutate: expected a plain argument object',
    );
    await expect(handled.get('pipeline:mutate')?.({}, ['thread-1'])).rejects.toThrow(
      'Invalid IPC input for pipeline:mutate: expected a plain argument object',
    );
    await expect(
      handled.get('github:mutate')?.({}, { body: 'x'.repeat(512 * 1024 + 1) }),
    ).rejects.toThrow('Invalid IPC input for github:mutate: args.body exceeds 524288 bytes');

    expect(mocks.projectSideEffect).not.toHaveBeenCalled();
    expect(mocks.pipelineSideEffect).not.toHaveBeenCalled();
    expect(mocks.githubSideEffect).not.toHaveBeenCalled();

    const valid = { projectId: 'project-1', issueNumber: 478 };
    await expect(handled.get('project:mutate')?.({}, valid)).resolves.toBeUndefined();
    await expect(handled.get('pipeline:mutate')?.({}, valid)).resolves.toBeUndefined();
    await expect(handled.get('github:mutate')?.({}, valid)).resolves.toBeUndefined();
    expect(mocks.projectSideEffect).toHaveBeenCalledWith(valid);
    expect(mocks.pipelineSideEffect).toHaveBeenCalledWith(valid);
    expect(mocks.githubSideEffect).toHaveBeenCalledWith(valid);
  });

  it('logs full IPC failures but exposes only a clamped first line', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fullError = new Error(`${'x'.repeat(400)}\nprivate stack detail`);
    mocks.registerProjectHandlers.mockImplementationOnce((deps: { ipcMain: IpcMain }) => {
      deps.ipcMain.handle('test:private-error', async () => {
        throw fullError;
      });
    });
    register();

    await expect(handled.get('test:private-error')?.({})).rejects.toThrow(`${'x'.repeat(279)}…`);
    expect(consoleError).toHaveBeenCalledWith('[ipc] test:private-error failed', fullError);
    expect(mocks.logEvent).toHaveBeenCalledWith(
      'ipc:handle',
      expect.objectContaining({ error: `${'x'.repeat(279)}…` }),
    );
    expect(mocks.captureIpcFailure).toHaveBeenCalledWith(fullError, expect.any(Object));
    consoleError.mockRestore();
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
