import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { contextBridgeMock, ipcRendererMock } = vi.hoisted(() => ({
  contextBridgeMock: {
    exposeInMainWorld: vi.fn(),
  },
  ipcRendererMock: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  contextBridge: contextBridgeMock,
  ipcRenderer: ipcRendererMock,
}));

function exposedApi() {
  const call = contextBridgeMock.exposeInMainWorld.mock.calls.at(-1);
  if (!call) throw new Error('shipcode api was not exposed');
  return call[1] as {
    invoke: (channel: string, args?: unknown) => Promise<unknown>;
    on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  };
}

async function importPreload(nodeEnv = 'development') {
  vi.resetModules();
  process.env.NODE_ENV = nodeEnv;
  await import('./index');
  return exposedApi();
}

describe('preload bridge', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined);
    vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined);
    vi.spyOn(console, 'table').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('exposes invoke and on through the Electron context bridge', async () => {
    const api = await importPreload();
    const callback = vi.fn();
    let capturedHandler!: (event: unknown, ...args: unknown[]) => void;
    ipcRendererMock.on.mockImplementationOnce(
      (_channel: string, handler: typeof capturedHandler) => {
        capturedHandler = handler;
      },
    );

    const off = api.on('pipeline:phase', callback);
    capturedHandler({}, 'thread-1', 'planning');
    off();

    expect(contextBridgeMock.exposeInMainWorld).toHaveBeenCalledWith('shipcode', {
      invoke: expect.any(Function),
      on: expect.any(Function),
    });
    expect(ipcRendererMock.on).toHaveBeenCalledWith('pipeline:phase', expect.any(Function));
    expect(callback).toHaveBeenCalledWith('thread-1', 'planning');
    expect(ipcRendererMock.removeListener).toHaveBeenCalledWith(
      'pipeline:phase',
      expect.any(Function),
    );
  });

  it('records successful, slow, and failed IPC diagnostics in development', async () => {
    const nowSpy = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(175)
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(225);
    ipcRendererMock.invoke
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('boom'));
    const api = await importPreload();

    await expect(
      api.invoke('project:list', { projectId: 'project-1', extra: true }),
    ).resolves.toEqual({ ok: true });
    await expect(api.invoke('project:get', ['project-1'])).rejects.toThrow('boom');
    ipcRendererMock.invoke.mockResolvedValueOnce('primitive-ok');
    await expect(api.invoke('settings:set', 'worktreeRoot')).resolves.toBe('primitive-ok');

    expect(ipcRendererMock.send).toHaveBeenCalledWith(
      'diagnostics:renderer-ipc',
      expect.objectContaining({
        channel: 'project:list',
        ok: true,
        elapsedMs: 165,
        argType: 'object',
        keys: ['projectId', 'extra'],
      }),
    );
    expect(console.debug).toHaveBeenCalledWith('[shipcode][ipc] project:list 165.0ms', {
      projectId: 'project-1',
      extra: true,
    });
    expect(ipcRendererMock.send).toHaveBeenCalledWith(
      'diagnostics:renderer-ipc',
      expect.objectContaining({
        channel: 'project:get',
        ok: false,
        elapsedMs: 25,
        error: 'boom',
        argType: 'array',
        size: 1,
      }),
    );
    expect(ipcRendererMock.send).toHaveBeenCalledWith(
      'diagnostics:renderer-ipc',
      expect.objectContaining({
        channel: 'settings:set',
        ok: true,
        argType: 'string',
      }),
    );
    expect(console.warn).toHaveBeenCalledWith(
      '[shipcode][ipc] project:get failed after 25.0ms',
      expect.any(Error),
    );

    vi.advanceTimersByTime(5000);
    expect(console.groupCollapsed).toHaveBeenCalledWith('[shipcode][ipc] top channels');
    expect(console.table).toHaveBeenCalledWith([
      expect.objectContaining({ channel: 'project:list', count: 1, errors: 0 }),
      expect.objectContaining({ channel: 'project:get', count: 1, errors: 1 }),
      expect.objectContaining({ channel: 'settings:set', count: 1, errors: 0 }),
    ]);
    nowSpy.mockRestore();
  });

  it('does not emit diagnostics in production', async () => {
    ipcRendererMock.invoke.mockResolvedValueOnce('ok');
    const api = await importPreload('production');

    await expect(api.invoke('settings:get')).resolves.toBe('ok');
    vi.advanceTimersByTime(5000);

    expect(ipcRendererMock.send).not.toHaveBeenCalled();
    expect(console.groupCollapsed).not.toHaveBeenCalled();
  });
});
