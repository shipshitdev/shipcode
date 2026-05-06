import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedProcess, ProcessManager } from './process-manager';

const { mockCreateServer } = vi.hoisted(() => ({
  mockCreateServer: vi.fn(),
}));

vi.mock('node:net', () => ({
  createServer: mockCreateServer,
}));

import { ServerLifecycleManager, type RunningServer } from './server-lifecycle';

function createMockProcessManager(): ProcessManager & EventEmitter {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    spawnWithStdin: vi.fn(),
    kill: vi.fn(),
    get: vi.fn(),
    spawn: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    cleanup: vi.fn(),
    gracefulShutdown: vi.fn(),
    killStalled: vi.fn(),
  }) as unknown as ProcessManager & EventEmitter;
}

function mockFreePort(port: number): void {
  const fakeSrv = {
    listen: vi.fn((_p: number, cb: () => void) => {
      cb();
      return fakeSrv;
    }),
    address: vi.fn(() => ({ port })),
    close: vi.fn((cb: (err?: Error) => void) => cb()),
    on: vi.fn(),
  };
  mockCreateServer.mockReturnValue(fakeSrv);
}

describe('ServerLifecycleManager', () => {
  let pm: ReturnType<typeof createMockProcessManager>;
  let manager: ServerLifecycleManager;
  let emitLog: (msg: string) => void;
  let abortController: AbortController;

  const config = {
    command: 'bun run dev',
    readinessUrl: 'http://localhost:3000/api/health',
    startupTimeoutMs: 5000,
    portEnvVar: 'PORT',
  };

  beforeEach(() => {
    pm = createMockProcessManager();
    emitLog = vi.fn() as unknown as (msg: string) => void;
    manager = new ServerLifecycleManager(pm, emitLog);
    abortController = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allocates free port and substitutes in readiness URL', async () => {
    mockFreePort(54321);

    const managed = { id: 'proc-1', state: 'running' } as ManagedProcess;
    vi.mocked(pm.spawnWithStdin).mockReturnValue(managed);

    const server = await manager.start(config, '/project', abortController.signal, 't1');

    expect(server.port).toBe(54321);
    expect(server.baseUrl).toBe('http://localhost:54321');

    expect(pm.spawnWithStdin).toHaveBeenCalledWith(
      'shell',
      expect.any(String),
      ['-lc', 'bun run dev'],
      '/project',
      '',
      't1',
      { detached: true, extraEnv: { PORT: '54321' } },
    );
  });

  it('polls readiness URL until server responds OK', async () => {
    mockFreePort(9999);

    const managed = { id: 'proc-1', state: 'running' } as ManagedProcess;
    vi.mocked(pm.spawnWithStdin).mockReturnValue(managed);

    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) return Promise.reject(new Error('ECONNREFUSED'));
        return Promise.resolve({ ok: true });
      }),
    );

    const server = await manager.start(config, '/project', abortController.signal, 't1');
    expect(server.processId).toBe('proc-1');
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it('stops server and kills via ProcessManager on readiness timeout', async () => {
    mockFreePort(8888);

    const managed = { id: 'proc-timeout', state: 'running' } as ManagedProcess;
    vi.mocked(pm.spawnWithStdin).mockReturnValue(managed);
    vi.mocked(pm.get).mockReturnValue({ ...managed, state: 'exited' } as ManagedProcess);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );

    await expect(
      manager.start(
        { ...config, startupTimeoutMs: 300 },
        '/project',
        abortController.signal,
        't1',
      ),
    ).rejects.toThrow(/readiness timeout/i);

    expect(pm.kill).toHaveBeenCalledWith('proc-timeout');
  });

  it('detects server crash via exit event', async () => {
    mockFreePort(7777);

    const managed = { id: 'proc-crash', state: 'running' } as ManagedProcess;
    vi.mocked(pm.spawnWithStdin).mockReturnValue(managed);

    const server = await manager.start(config, '/project', abortController.signal, 't1');
    expect(server.crashed).toBe(false);

    pm.emit('exit', 'proc-crash', 1);
    expect(server.crashed).toBe(true);
  });

  it('aborts readiness poll when signal aborted', async () => {
    mockFreePort(6666);

    const managed = { id: 'proc-abort', state: 'running' } as ManagedProcess;
    vi.mocked(pm.spawnWithStdin).mockReturnValue(managed);
    vi.mocked(pm.get).mockReturnValue({ ...managed, state: 'exited' } as ManagedProcess);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        abortController.abort();
        throw new Error('aborted');
      }),
    );

    await expect(
      manager.start(config, '/project', abortController.signal, 't1'),
    ).rejects.toThrow();

    expect(pm.kill).toHaveBeenCalledWith('proc-abort');
  });

  describe('stop', () => {
    it('kills process and waits for exit', async () => {
      const server: RunningServer = {
        processId: 'proc-stop',
        baseUrl: 'http://localhost:5555',
        port: 5555,
        crashed: false,
      };

      vi.mocked(pm.get).mockReturnValue({ state: 'exited' } as ManagedProcess);

      await manager.stop(server);
      expect(pm.kill).toHaveBeenCalledWith('proc-stop');
    });

    it('resolves even if process already dead', async () => {
      const server: RunningServer = {
        processId: 'proc-dead',
        baseUrl: 'http://localhost:4444',
        port: 4444,
        crashed: false,
      };

      vi.mocked(pm.kill).mockImplementation(() => {
        throw new Error('No such process');
      });
      vi.mocked(pm.get).mockReturnValue(undefined);

      await expect(manager.stop(server)).resolves.toBeUndefined();
    });

    it('logs shutdown message', async () => {
      const server: RunningServer = {
        processId: 'proc-log',
        baseUrl: 'http://localhost:3333',
        port: 3333,
        crashed: false,
      };

      vi.mocked(pm.get).mockReturnValue({ state: 'exited' } as ManagedProcess);
      await manager.stop(server);
      expect(emitLog).toHaveBeenCalledWith(expect.stringContaining('Server stopped'));
    });
  });

  it('passes custom portEnvVar to spawn', async () => {
    mockFreePort(12345);

    const managed = { id: 'proc-env', state: 'running' } as ManagedProcess;
    vi.mocked(pm.spawnWithStdin).mockReturnValue(managed);

    await manager.start(
      { ...config, portEnvVar: 'APP_PORT' },
      '/project',
      abortController.signal,
      't1',
    );

    expect(pm.spawnWithStdin).toHaveBeenCalledWith(
      'shell',
      expect.any(String),
      expect.any(Array),
      '/project',
      '',
      't1',
      expect.objectContaining({ extraEnv: { APP_PORT: '12345' } }),
    );
  });
});
