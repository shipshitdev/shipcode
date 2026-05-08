import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPtySpawn, mockChildSpawn, mockExecFile, mockExecFileAsync } = vi.hoisted(() => {
  const mockExecFileAsync = vi.fn();
  const mockExecFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: mockExecFileAsync,
  });
  return {
    mockPtySpawn: vi.fn(),
    mockChildSpawn: vi.fn(),
    mockExecFile,
    mockExecFileAsync,
  };
});

vi.mock('node-pty', () => ({ spawn: mockPtySpawn }));
vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  execFileSync: vi.fn(() => ''),
  spawn: mockChildSpawn,
}));

import { ProcessManager } from './process-manager';

interface MockPty {
  pid: number;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: ({ exitCode }: { exitCode: number }) => void) => void;
  kill: (signal?: string) => void;
  write: () => void;
  resize: () => void;
  __exit: (code: number) => void;
}

function createMockPty(): MockPty {
  let exitCb: ((arg: { exitCode: number }) => void) | null = null;
  return {
    pid: 101,
    onData: vi.fn(),
    onExit: (cb) => {
      exitCb = cb;
    },
    kill: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    __exit: (code: number) => exitCb?.({ exitCode: code }),
  };
}

interface MockChild extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    writable: boolean;
  };
  kill: ReturnType<typeof vi.fn>;
  __stdout: (data: string) => void;
  __stderr: (data: string) => void;
  __close: (code: number | null, signal?: NodeJS.Signals | null) => void;
  __error: (err: Error) => void;
}

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.pid = 201;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(),
    writable: true,
  });
  child.kill = vi.fn();
  child.__stdout = (data) => child.stdout.emit('data', data);
  child.__stderr = (data) => child.stderr.emit('data', data);
  child.__close = (code, signal = null) => child.emit('close', code, signal);
  child.__error = (err) => child.emit('error', err);
  return child;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

describe('ProcessManager registry hygiene', () => {
  let manager: ProcessManager;

  beforeEach(() => {
    manager = new ProcessManager();
    mockPtySpawn.mockReset();
    mockChildSpawn.mockReset();
    mockExecFile.mockReset();
    mockExecFileAsync.mockReset();
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mockExecFile.mockImplementation(
      (_file: string, _args: string[], _options: unknown, cb: unknown) => {
        if (typeof cb === 'function') cb(null, '', '');
      },
    );
  });

  afterEach(() => {
    manager.removeAllListeners();
  });

  it('drops exited processes from the registry after the exit event drains', async () => {
    const pty = createMockPty();
    mockPtySpawn.mockReturnValueOnce(pty);

    const proc = manager.spawn('claude', 'claude', [], '/tmp');
    expect(manager.get(proc.id)).toBeDefined();

    pty.__exit(0);
    expect(manager.get(proc.id)).toBeDefined();

    await flushMicrotasks();
    expect(manager.get(proc.id)).toBeUndefined();
    expect(manager.listActive()).toHaveLength(0);
  });

  it('does not leak across many spawn/exit cycles', async () => {
    for (let i = 0; i < 25; i++) {
      const pty = createMockPty();
      mockPtySpawn.mockReturnValueOnce(pty);
      const proc = manager.spawn('claude', 'claude', [], '/tmp');
      pty.__exit(0);
      // Synchronous handlers can still observe the entry; cleanup defers.
      expect(manager.get(proc.id)).toBeDefined();
    }
    await flushMicrotasks();
    expect(manager.listActive()).toHaveLength(0);
    // biome-ignore lint/complexity/useLiteralKeys: private registry inspection is intentional in this leak test.
    expect(manager['processes'].size).toBe(0);
  });

  it('drops failed-to-spawn processes from the registry', async () => {
    mockPtySpawn.mockImplementationOnce(() => {
      throw new Error('binary not found');
    });

    const failed = manager.spawn('claude', 'claude', [], '/tmp');
    expect(failed.state).toBe('exited');

    await flushMicrotasks();
    expect(manager.get(failed.id)).toBeUndefined();
  });

  it('pipes stdin for one-shot CLI processes and streams stdout/stderr', async () => {
    const child = createMockChild();
    mockChildSpawn.mockReturnValueOnce(child);
    const chunks: string[] = [];
    manager.on('output', (_id: string, data: string) => {
      chunks.push(data);
    });

    const proc = manager.spawnWithStdin('claude', 'claude', ['-p', '-'], '/tmp', 'PROMPT');

    expect(mockChildSpawn).toHaveBeenCalledWith(
      expect.any(String),
      ['-p', '-'],
      expect.objectContaining({ cwd: '/tmp', stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(child.stdin.write).toHaveBeenCalledWith('PROMPT');
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.__stdout('out');
    child.__stderr('err');
    child.__close(0);

    expect(chunks.join('')).toBe('outerr');
    expect(proc.exitCode).toBe(0);
    await flushMicrotasks();
    expect(manager.get(proc.id)).toBeUndefined();
  });

  it('kills piped processes through the same registry API', () => {
    const child = createMockChild();
    mockChildSpawn.mockReturnValueOnce(child);
    const proc = manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', 'PROMPT');

    manager.kill(proc.id);

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(proc.state).toBe('exited');
  });

  it('reports managed process CPU and memory including descendants', async () => {
    const child = createMockChild();
    child.pid = 300;
    mockChildSpawn.mockReturnValueOnce(child);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: ['300 1 12.5 1000', '301 300 20.0 2000', '302 301 7.5 500', '400 1 99.0 9999'].join(
        '\n',
      ),
      stderr: '',
    });

    const proc = manager.spawnWithStdin('shell', '/bin/zsh', ['-lc', 'bun test'], '/tmp', '');
    const usage = await manager.listResourceUsage();

    expect(usage).toEqual([
      expect.objectContaining({
        processId: proc.id,
        pid: 300,
        childPids: [301, 302],
        cpuPercent: 40,
        memoryBytes: 3_500 * 1024,
      }),
    ]);
  });

  it('killAllAndWait resolves only after every pty emits exit', async () => {
    const ptyA = createMockPty();
    const ptyB = createMockPty();
    mockPtySpawn.mockReturnValueOnce(ptyA).mockReturnValueOnce(ptyB);

    manager.spawn('claude', 'claude', [], '/tmp');
    manager.spawn('codex', 'codex', [], '/tmp');

    let resolved = false;
    const done = manager.killAllAndWait(5000).then(() => {
      resolved = true;
    });

    await flushMicrotasks();
    expect(resolved).toBe(false);
    expect(ptyA.kill).toHaveBeenCalled();
    expect(ptyB.kill).toHaveBeenCalled();

    ptyA.__exit(0);
    await flushMicrotasks();
    expect(resolved).toBe(false);

    ptyB.__exit(0);
    await done;
    expect(resolved).toBe(true);
    expect(manager.listActive()).toHaveLength(0);
  });

  it('killAllAndWait returns immediately when no processes are active', async () => {
    await expect(manager.killAllAndWait(5000)).resolves.toBeUndefined();
  });

  it('killAllAndWait escalates to SIGKILL after grace period', async () => {
    vi.useFakeTimers();
    try {
      const pty = createMockPty();
      mockPtySpawn.mockReturnValueOnce(pty);
      manager.spawn('claude', 'claude', [], '/tmp');

      const done = manager.killAllAndWait(50);
      // First kill: no signal arg = SIGHUP default
      expect(pty.kill).toHaveBeenCalledTimes(1);
      expect(pty.kill).toHaveBeenLastCalledWith();

      await vi.advanceTimersByTimeAsync(60);
      // Escalation to SIGKILL
      expect(pty.kill).toHaveBeenCalledTimes(2);
      expect(pty.kill).toHaveBeenLastCalledWith('SIGKILL');

      // Final 1s cap before resolve.
      pty.__exit(137);
      await done;
    } finally {
      vi.useRealTimers();
    }
  });

  it('asserts workspaceSafe when workspaceRoot opt is set', () => {
    const pty = createMockPty();
    mockPtySpawn.mockReturnValueOnce(pty);

    expect(() =>
      manager.spawn('claude', 'claude', [], '/etc/passwd', undefined, {
        workspaceRoot: '/tmp/wt',
      }),
    ).toThrow(/under workspaceRoot|basename/i);
    // pty.spawn must NOT have been invoked when assertion fails.
    expect(mockPtySpawn).not.toHaveBeenCalled();
  });

  it('skips workspaceSafe assertion when workspaceRoot opt is omitted', () => {
    const pty = createMockPty();
    mockPtySpawn.mockReturnValueOnce(pty);

    // Even with a sketchy cwd, no assertion runs without the opt.
    expect(() => manager.spawn('claude', 'claude', [], '/anywhere/at/all')).not.toThrow();
    expect(mockPtySpawn).toHaveBeenCalledTimes(1);
  });

  it('passes workspaceSafe assertion for a worktree under root', () => {
    const pty = createMockPty();
    mockPtySpawn.mockReturnValueOnce(pty);

    expect(() =>
      manager.spawn('claude', 'claude', [], '/tmp/wt/proj/t-01', undefined, {
        workspaceRoot: '/tmp/wt',
      }),
    ).not.toThrow();
    expect(mockPtySpawn).toHaveBeenCalledTimes(1);
  });

  it('killStalled returns empty array and is a no-op when threshold is 0', () => {
    const pty = createMockPty();
    mockPtySpawn.mockReturnValueOnce(pty);
    manager.spawn('claude', 'claude', [], '/tmp');
    expect(manager.killStalled(0)).toEqual([]);
    expect(pty.kill).not.toHaveBeenCalled();
  });

  it('killStalled returns empty array when threshold is negative or NaN', () => {
    const pty = createMockPty();
    mockPtySpawn.mockReturnValueOnce(pty);
    manager.spawn('claude', 'claude', [], '/tmp');
    expect(manager.killStalled(-1)).toEqual([]);
    expect(manager.killStalled(Number.NaN)).toEqual([]);
    expect(pty.kill).not.toHaveBeenCalled();
  });

  it('killStalled kills processes whose lastEventAt is older than threshold', () => {
    vi.useFakeTimers();
    try {
      const idlePty = createMockPty();
      mockPtySpawn.mockReturnValueOnce(idlePty);
      const idle = manager.spawn('claude', 'claude', [], '/tmp');

      // Advance well past the threshold without emitting any output.
      vi.advanceTimersByTime(60_000);

      const killed = manager.killStalled(30_000);
      expect(killed).toEqual([idle.id]);
      expect(idlePty.kill).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('killStalled spares processes that emitted output recently', () => {
    vi.useFakeTimers();
    try {
      const activePty = createMockPty();
      const dataCbHolder: { cb: ((d: string) => void) | null } = { cb: null };
      activePty.onData = (cb: (d: string) => void) => {
        dataCbHolder.cb = cb;
      };
      mockPtySpawn.mockReturnValueOnce(activePty);
      manager.spawn('claude', 'claude', [], '/tmp');

      vi.advanceTimersByTime(45_000);
      // Refresh lastEventAt by emitting a chunk just before the check.
      dataCbHolder.cb?.('chunk');

      const killed = manager.killStalled(30_000);
      expect(killed).toEqual([]);
      expect(activePty.kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('killStalled skips already-exited processes', async () => {
    const pty = createMockPty();
    mockPtySpawn.mockReturnValueOnce(pty);
    manager.spawn('claude', 'claude', [], '/tmp');
    pty.__exit(0);
    await flushMicrotasks();
    expect(manager.killStalled(0.001)).toEqual([]);
  });

  it('exposes exited state synchronously to exit listeners before cleanup', () => {
    const pty = createMockPty();
    mockPtySpawn.mockReturnValueOnce(pty);

    manager.spawn('claude', 'claude', [], '/tmp');

    let observedDuringEvent: ReturnType<typeof manager.get> | undefined;
    manager.once('exit', (id: string) => {
      observedDuringEvent = manager.get(id);
    });

    pty.__exit(7);
    expect(observedDuringEvent).toBeDefined();
    expect(observedDuringEvent?.exitCode).toBe(7);
    expect(observedDuringEvent?.state).toBe('exited');
  });
});
