import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPtySpawn, mockChildSpawn, mockExecFile, mockExecFileAsync, mockExecFileSync } =
  vi.hoisted(() => {
    const mockExecFileAsync = vi.fn();
    const mockExecFile = Object.assign(vi.fn(), {
      [Symbol.for('nodejs.util.promisify.custom')]: mockExecFileAsync,
    });
    return {
      mockPtySpawn: vi.fn(),
      mockChildSpawn: vi.fn(),
      mockExecFile,
      mockExecFileAsync,
      mockExecFileSync: vi.fn(() => ''),
    };
  });

vi.mock('node-pty', () => ({ spawn: mockPtySpawn }));
vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  execFileSync: mockExecFileSync,
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
  unref: ReturnType<typeof vi.fn>;
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
  child.unref = vi.fn();
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
    mockExecFileSync.mockReset();
    mockExecFileSync.mockReturnValue('');
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

  it('reports non-Error pty spawn failures without crashing', async () => {
    mockPtySpawn.mockImplementationOnce(() => {
      throw 'spawn denied';
    });
    const output: string[] = [];
    manager.on('output', (_id: string, chunk: string) => output.push(chunk));

    const failed = manager.spawn('claude', 'claude', [], '/tmp');

    expect(failed.exitCode).toBe(127);
    await flushMicrotasks();
    expect(output.join('')).toContain('spawn denied');
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

  it('sanitizes extra environment and resolves agent commands through trusted shells', () => {
    const previousShell = process.env.SHELL;
    process.env.SHELL = '/bin/zsh';
    mockExecFileSync.mockImplementation((_file?: unknown, args?: unknown) => {
      if (Array.isArray(args) && args[1] === 'command -v codex') return '/usr/local/bin/codex\n';
      return 'PATH=/usr/bin\nSECRET_TOKEN=hidden\n';
    });
    const child = createMockChild();
    mockChildSpawn.mockReturnValueOnce(child);

    try {
      manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', '', undefined, {
        extraEnv: {
          SAFE_EXTRA: '1',
          'BAD=KEY': '2',
          BAD_NULL: 'bad\0value',
        },
      });

      expect(mockChildSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/codex',
        ['exec', '-'],
        expect.objectContaining({
          env: expect.objectContaining({
            FORCE_COLOR: '1',
          }),
        }),
      );
      const env = mockChildSpawn.mock.calls[0][2].env as Record<string, string>;
      expect(env.SECRET_TOKEN).toBeUndefined();
      expect(env['BAD=KEY']).toBeUndefined();
      expect(env.BAD_NULL).toBeUndefined();
    } finally {
      if (previousShell === undefined) {
        delete process.env.SHELL;
      } else {
        process.env.SHELL = previousShell;
      }
    }
  });

  it('falls back to command name when command resolution returns multiple lines', () => {
    const previousShell = process.env.SHELL;
    process.env.SHELL = '/bin/zsh';
    mockExecFileSync.mockImplementation((_file?: unknown, args?: unknown) => {
      if (Array.isArray(args) && args[1] === 'command -v codex') return '/one\n/two\n';
      return 'PATH=/usr/bin\n';
    });
    const child = createMockChild();
    mockChildSpawn.mockReturnValueOnce(child);

    try {
      manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', '');

      expect(mockChildSpawn).toHaveBeenCalledWith('codex', ['exec', '-'], expect.any(Object));
    } finally {
      if (previousShell === undefined) {
        delete process.env.SHELL;
      } else {
        process.env.SHELL = previousShell;
      }
    }
  });

  it('uses process env directly for untrusted shells and filters unsafe keys', () => {
    const previousShell = process.env.SHELL;
    const previousSecret = process.env.SECRET_TOKEN;
    const previousPath = process.env.PATH;

    mockChildSpawn.mockImplementationOnce(() => {
      throw new Error('reset env cache');
    });
    manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', '');

    process.env.SHELL = '/tmp/not-a-shell';
    process.env.PATH = '/usr/bin';
    process.env.SECRET_TOKEN = 'hidden';
    const child = createMockChild();
    mockChildSpawn.mockReturnValueOnce(child);

    try {
      manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', '', undefined, {
        extraEnv: { OK_EXTRA: '1', '': 'bad' },
      });

      expect(mockChildSpawn).toHaveBeenLastCalledWith(
        'codex',
        ['exec', '-'],
        expect.objectContaining({
          env: expect.objectContaining({ PATH: '/usr/bin', FORCE_COLOR: '1' }),
        }),
      );
      const env = mockChildSpawn.mock.lastCall?.[2].env as Record<string, string>;
      expect(env.SECRET_TOKEN).toBeUndefined();
      expect(env['']).toBeUndefined();
      expect(mockExecFileSync).not.toHaveBeenLastCalledWith(
        '/tmp/not-a-shell',
        expect.anything(),
        expect.anything(),
      );
    } finally {
      if (previousShell === undefined) {
        delete process.env.SHELL;
      } else {
        process.env.SHELL = previousShell;
      }
      if (previousSecret === undefined) {
        delete process.env.SECRET_TOKEN;
      } else {
        process.env.SECRET_TOKEN = previousSecret;
      }
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
    }
  });

  it('falls back to process env when trusted shell env hydration fails', () => {
    const previousShell = process.env.SHELL;
    const previousPath = process.env.PATH;

    mockChildSpawn.mockImplementationOnce(() => {
      throw new Error('reset env cache');
    });
    manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', '');

    process.env.SHELL = '/bin/zsh';
    process.env.PATH = '/fallback/bin';
    mockExecFileSync.mockImplementation(() => {
      throw new Error('shell failed');
    });
    const child = createMockChild();
    mockChildSpawn.mockReturnValueOnce(child);

    try {
      manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', '');

      expect(mockChildSpawn).toHaveBeenLastCalledWith(
        'codex',
        ['exec', '-'],
        expect.objectContaining({ env: expect.objectContaining({ PATH: '/fallback/bin' }) }),
      );
    } finally {
      if (previousShell === undefined) {
        delete process.env.SHELL;
      } else {
        process.env.SHELL = previousShell;
      }
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
    }
  });

  it('falls back to command name when trusted shell command resolution throws', () => {
    const previousShell = process.env.SHELL;
    process.env.SHELL = '/bin/zsh';

    mockChildSpawn.mockImplementationOnce(() => {
      throw new Error('reset env cache');
    });
    manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', '');
    mockChildSpawn.mockReset();

    mockExecFileSync.mockImplementation((_file?: unknown, args?: unknown) => {
      if (Array.isArray(args) && args[1] === 'command -v codex') {
        throw new Error('resolution failed');
      }
      return 'PATH=/usr/bin\nIGNORED_LINE\nHOME=/mock/home\n';
    });
    const child = createMockChild();
    mockChildSpawn.mockReturnValueOnce(child);

    try {
      manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', '');

      expect(mockChildSpawn).toHaveBeenCalledWith(
        'codex',
        ['exec', '-'],
        expect.objectContaining({
          env: expect.objectContaining({ PATH: '/usr/bin', HOME: '/mock/home' }),
        }),
      );
    } finally {
      if (previousShell === undefined) {
        delete process.env.SHELL;
      } else {
        process.env.SHELL = previousShell;
      }
    }
  });

  it('rejects non-allowlisted commands before spawning', () => {
    expect(() => manager.spawn('claude', 'node', ['script.js'], '/tmp')).toThrow(
      'Command is not allowlisted',
    );
    expect(() =>
      manager.spawnWithStdin('claude', 'python', ['script.py'], '/tmp', 'PROMPT'),
    ).toThrow('Command is not allowlisted');
    expect(mockPtySpawn).not.toHaveBeenCalled();
    expect(mockChildSpawn).not.toHaveBeenCalled();
  });

  it('writes and resizes running pty processes', () => {
    const pty = createMockPty();
    mockPtySpawn.mockReturnValueOnce(pty);
    const proc = manager.spawn('claude', 'claude', [], '/tmp');

    manager.write(proc.id, 'hello');
    manager.resize(proc.id, 80, 24);

    expect(pty.write).toHaveBeenCalledWith('hello');
    expect(pty.resize).toHaveBeenCalledWith(80, 24);
  });

  it('ignores kill and resize requests for missing or exited processes', () => {
    const pty = createMockPty();
    mockPtySpawn.mockReturnValueOnce(pty);
    const proc = manager.spawn('claude', 'claude', [], '/tmp');
    proc.state = 'exited';

    manager.kill('missing');
    manager.kill(proc.id);
    manager.resize('missing', 80, 24);
    manager.resize(proc.id, 80, 24);

    expect(pty.kill).not.toHaveBeenCalled();
    expect(pty.resize).not.toHaveBeenCalled();
  });

  it('writes to running piped child stdin when writable', () => {
    const child = createMockChild();
    mockChildSpawn.mockReturnValueOnce(child);
    const proc = manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', '');

    manager.write(proc.id, 'next');

    expect(child.stdin.write).toHaveBeenCalledWith('next');
  });

  it('ignores writes for exited and non-writable child processes', () => {
    const child = createMockChild();
    child.stdin.writable = false;
    mockChildSpawn.mockReturnValueOnce(child);
    const proc = manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', '');
    child.stdin.write.mockClear();

    manager.write(proc.id, 'next');
    expect(child.stdin.write).not.toHaveBeenCalled();

    child.stdin.writable = true;
    proc.state = 'exited';
    manager.write(proc.id, 'after-exit');
    expect(child.stdin.write).not.toHaveBeenCalled();
  });

  it('emits and cleans up failed piped spawns', async () => {
    mockChildSpawn.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    const output: string[] = [];
    const exits: number[] = [];
    manager.on('output', (_id: string, chunk: string) => output.push(chunk));
    manager.on('exit', (_id: string, code: number) => exits.push(code));

    const failed = manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', 'PROMPT');

    expect(failed.state).toBe('exited');
    expect(failed.stdinMode).toBe('pipe');
    await flushMicrotasks();
    expect(output.join('')).toContain('Failed to spawn codex');
    expect(exits).toEqual([127]);
    expect(manager.get(failed.id)).toBeUndefined();
  });

  it('reports non-Error piped spawn failures without crashing', async () => {
    mockChildSpawn.mockImplementationOnce(() => {
      throw 'spawn denied';
    });
    const output: string[] = [];
    manager.on('output', (_id: string, chunk: string) => output.push(chunk));

    const failed = manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', 'PROMPT');

    expect(failed.state).toBe('exited');
    expect(failed.exitCode).toBe(127);
    await flushMicrotasks();
    expect(output.join('')).toContain('spawn denied');
    expect(manager.get(failed.id)).toBeUndefined();
  });

  it('handles child process errors once even if close follows', async () => {
    const child = createMockChild();
    mockChildSpawn.mockReturnValueOnce(child);
    const exits: number[] = [];
    const output: string[] = [];
    manager.on('exit', (_id: string, code: number) => exits.push(code));
    manager.on('output', (_id: string, chunk: string) => output.push(chunk));

    const proc = manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', '');
    child.__error(new Error('first line\nsecond line'));
    child.__close(0);

    expect(proc.exitCode).toBe(127);
    expect(exits).toEqual([127]);
    expect(output.join('')).toContain('first line');
    expect(output.join('')).not.toContain('second line');
    await flushMicrotasks();
    expect(manager.get(proc.id)).toBeUndefined();
  });

  it('finalizes piped children with default exit codes for null close codes', () => {
    const cleanChild = createMockChild();
    mockChildSpawn.mockReturnValueOnce(cleanChild);
    const clean = manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', '');
    cleanChild.__close(null, null);
    expect(clean.exitCode).toBe(0);

    const signaledChild = createMockChild();
    mockChildSpawn.mockReturnValueOnce(signaledChild);
    const signaled = manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', '');
    signaledChild.__close(null, 'SIGTERM');
    expect(signaled.exitCode).toBe(130);
  });

  it('ignores stdin errors on piped children', () => {
    const child = createMockChild();
    mockChildSpawn.mockReturnValueOnce(child);
    const proc = manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', '');

    expect(() => child.stdin.emit('error', new Error('EPIPE'))).not.toThrow();
    expect(proc.state).toBe('running');
  });

  it('kills the child when writing stdin throws during spawn', () => {
    const child = createMockChild();
    child.stdin.write.mockImplementationOnce(() => {
      throw new Error('EPIPE');
    });
    mockChildSpawn.mockReturnValueOnce(child);
    const output: string[] = [];
    manager.on('output', (_id: string, chunk: string) => output.push(chunk));

    const proc = manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', 'PROMPT');

    expect(output.join('')).toContain('Error writing prompt to codex');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(proc.state).toBe('running');
  });

  it('formats non-Error stdin write failures during spawn', () => {
    const child = createMockChild();
    child.stdin.write.mockImplementationOnce(() => {
      throw 'EPIPE string';
    });
    mockChildSpawn.mockReturnValueOnce(child);
    const output: string[] = [];
    manager.on('output', (_id: string, chunk: string) => output.push(chunk));

    manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', 'PROMPT');

    expect(output.join('')).toContain('EPIPE string');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('kills piped processes through the same registry API', () => {
    const child = createMockChild();
    mockChildSpawn.mockReturnValueOnce(child);
    const proc = manager.spawnWithStdin('codex', 'codex', ['exec', '-'], '/tmp', 'PROMPT');

    manager.kill(proc.id);

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(proc.state).toBe('exited');
  });

  it('falls back to child.kill when detached process-group kill fails', () => {
    const child = createMockChild();
    child.pid = 4321;
    mockChildSpawn.mockReturnValueOnce(child);
    const killSpy = vi.spyOn(process, 'kill').mockImplementationOnce(() => {
      throw new Error('missing group');
    });
    try {
      const proc = manager.spawnWithStdin(
        'shell',
        '/bin/zsh',
        ['-lc', 'sleep 10'],
        '/tmp',
        '',
        undefined,
        {
          detached: true,
        },
      );

      expect(child.unref).toHaveBeenCalled();
      manager.kill(proc.id, 'SIGKILL');

      expect(killSpy).toHaveBeenCalledWith(-4321, 'SIGKILL');
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      killSpy.mockRestore();
    }
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

  it('sorts resource usage by highest CPU first', async () => {
    const low = createMockChild();
    low.pid = 700;
    const high = createMockChild();
    high.pid = 800;
    mockChildSpawn.mockReturnValueOnce(low).mockReturnValueOnce(high);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: ['700 1 1.0 100', '800 1 9.0 200'].join('\n'),
      stderr: '',
    });

    const lowProc = manager.spawnWithStdin('shell', '/bin/zsh', ['-lc', 'low'], '/tmp', '');
    const highProc = manager.spawnWithStdin('shell', '/bin/zsh', ['-lc', 'high'], '/tmp', '');
    const usage = await manager.listResourceUsage();

    expect(usage.map((entry) => entry.processId)).toEqual([highProc.id, lowProc.id]);
  });

  it('reports zero resource usage for pty processes without pid and when ps fails', async () => {
    const pty = createMockPty();
    delete (pty as { pid?: number }).pid;
    mockPtySpawn.mockReturnValueOnce(pty);
    mockExecFileAsync.mockRejectedValueOnce(new Error('ps failed'));

    const proc = manager.spawn('claude', 'claude', [], '/tmp');
    const usage = await manager.listResourceUsage();

    expect(usage).toEqual([
      expect.objectContaining({
        processId: proc.id,
        pid: null,
        childPids: [],
        cpuPercent: 0,
        memoryBytes: 0,
      }),
    ]);
  });

  it('reports zero resource usage for non-finite pty pids', async () => {
    const pty = createMockPty();
    (pty as { pid?: number }).pid = Number.NaN;
    mockPtySpawn.mockReturnValueOnce(pty);
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const proc = manager.spawn('claude', 'claude', [], '/tmp');
    const usage = await manager.listResourceUsage();

    expect(usage).toEqual([
      expect.objectContaining({
        processId: proc.id,
        pid: null,
        childPids: [],
        cpuPercent: 0,
        memoryBytes: 0,
      }),
    ]);
  });

  it('reports resource usage for pty processes with finite pids', async () => {
    const pty = createMockPty();
    pty.pid = 900;
    mockPtySpawn.mockReturnValueOnce(pty);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: ['900 1 2.5 100', '901 900 3.5 200'].join('\n'),
      stderr: '',
    });

    const proc = manager.spawn('claude', 'claude', [], '/tmp');
    const usage = await manager.listResourceUsage();

    expect(usage).toEqual([
      expect.objectContaining({
        processId: proc.id,
        pid: 900,
        childPids: [901],
        cpuPercent: 6,
        memoryBytes: 300 * 1024,
      }),
    ]);
  });

  it('ignores malformed ps rows and reports zero totals when the root row is missing', async () => {
    const child = createMockChild();
    child.pid = 500;
    mockChildSpawn.mockReturnValueOnce(child);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: ['', 'not numbers here', '501 500 4.5 100', 'bad 501 1 1'].join('\n'),
      stderr: '',
    });

    const proc = manager.spawnWithStdin('shell', '/bin/zsh', ['-lc', 'bun test'], '/tmp', '');
    const usage = await manager.listResourceUsage();

    expect(usage).toEqual([
      expect.objectContaining({
        processId: proc.id,
        pid: 500,
        childPids: [501],
        cpuPercent: 4.5,
        memoryBytes: 100 * 1024,
      }),
    ]);
  });

  it('returns no resource usage when no processes are active', async () => {
    await expect(manager.listResourceUsage()).resolves.toEqual([]);
    expect(mockExecFileAsync).not.toHaveBeenCalled();
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

  it('killAll kills every registered process', () => {
    const ptyA = createMockPty();
    const ptyB = createMockPty();
    mockPtySpawn.mockReturnValueOnce(ptyA).mockReturnValueOnce(ptyB);
    manager.spawn('claude', 'claude', [], '/tmp');
    manager.spawn('codex', 'codex', [], '/tmp');

    manager.killAll();

    expect(ptyA.kill).toHaveBeenCalled();
    expect(ptyB.kill).toHaveBeenCalled();
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

  it('killStalled skips exited processes that are still registered', () => {
    const pty = createMockPty();
    mockPtySpawn.mockReturnValueOnce(pty);
    const proc = manager.spawn('claude', 'claude', [], '/tmp');
    proc.state = 'exited';
    proc.lastEventAt = Date.now() - 60_000;

    expect(manager.killStalled(30_000)).toEqual([]);
    expect(pty.kill).not.toHaveBeenCalled();
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

  it('cleanup removes only exited processes', () => {
    const runningPty = createMockPty();
    const exitedPty = createMockPty();
    mockPtySpawn.mockReturnValueOnce(runningPty).mockReturnValueOnce(exitedPty);
    const running = manager.spawn('claude', 'claude', [], '/tmp');
    const exited = manager.spawn('codex', 'codex', [], '/tmp');
    exited.state = 'exited';

    manager.cleanup(running.id);
    manager.cleanup(exited.id);
    manager.cleanup('missing');

    expect(manager.get(running.id)).toBeDefined();
    expect(manager.get(exited.id)).toBeUndefined();
  });
});
