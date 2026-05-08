import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { execFileSync, spawn as spawnChild } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { AgentState, AgentType } from '@shipcode/shared';
import { assertWorkspaceSafe } from '@shipcode/shared/worktree-path';
import { nanoid } from 'nanoid';
import * as pty from 'node-pty';

type AllowlistedAgentCommand = Extract<AgentType, 'claude' | 'codex' | 'gemini' | 'gh'>;

const ALLOWED_AGENT_COMMANDS = new Set<AllowlistedAgentCommand>([
  'claude',
  'codex',
  'gemini',
  'gh',
]);
const TRUSTED_SHELLS = new Set([
  '/bin/bash',
  '/bin/zsh',
  '/bin/sh',
  '/usr/bin/bash',
  '/usr/bin/zsh',
  '/usr/local/bin/bash',
  '/usr/local/bin/zsh',
  '/opt/homebrew/bin/bash',
  '/opt/homebrew/bin/zsh',
]);

const SAFE_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'XDG_RUNTIME_DIR',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
]);

function filterEnv(env: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, val] of Object.entries(env)) {
    if (SAFE_ENV_KEYS.has(key)) filtered[key] = val;
  }
  return filtered;
}

function getShellEnv(): Record<string, string> {
  try {
    const shell = process.env.SHELL ?? '/bin/zsh';
    if (!TRUSTED_SHELLS.has(shell)) return process.env as Record<string, string>;
    const output = execFileSync(shell, ['-ilc', 'env'], { encoding: 'utf-8', timeout: 5000 });
    const env: Record<string, string> = {};
    for (const line of output.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        env[line.slice(0, idx)] = line.slice(idx + 1);
      }
    }
    return env;
  } catch {
    return process.env as Record<string, string>;
  }
}

function resolveCommand(command: string): string {
  if (TRUSTED_SHELLS.has(command)) return command;
  if (!ALLOWED_AGENT_COMMANDS.has(command as AllowlistedAgentCommand)) {
    throw new Error(`Command is not allowlisted for ProcessManager: ${command}`);
  }
  const shell = process.env.SHELL;
  if (!shell || !TRUSTED_SHELLS.has(shell)) return command;
  try {
    const resolved = execFileSync(shell, ['-ilc', `command -v ${command}`], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (resolved.startsWith('/') && !resolved.includes('\n')) return resolved;
    return command;
  } catch {
    return command;
  }
}

let cachedEnv: Record<string, string> | null = null;

export type ManagedProcessOutputMode = 'normalized' | 'raw';

export interface ManagedProcessSpawnOptions {
  outputMode?: ManagedProcessOutputMode;
  /**
   * When provided, the spawn site asserts `cwd` is a safe agent workspace
   * (absolute, basename matches `[A-Za-z0-9._-]+`, lives under the configured
   * workspaceRoot). Defense-in-depth — see `assertWorkspaceSafe`. Pipeline
   * worktree spawns opt in; instant terminals at the project root do not.
   * `null` matches the AppSettings default; `''` means project-local mode.
   */
  workspaceRoot?: string | null;
  /**
   * Spawn in a new process group so `kill(-pid)` terminates the entire
   * child tree (server + its children). Used by ServerLifecycleManager.
   */
  detached?: boolean;
  /** Extra env vars merged on top of the filtered shell env. */
  extraEnv?: Record<string, string>;
}

export interface ManagedProcess {
  id: string;
  type: AgentType;
  state: AgentState;
  pty: pty.IPty | null;
  child?: ChildProcessWithoutNullStreams;
  cwd: string;
  exitCode: number | null;
  threadId?: string;
  outputMode: ManagedProcessOutputMode;
  stdinMode: 'tty' | 'pipe';
  /** Process was spawned with `detached: true` — kill via process group. */
  detached?: boolean;
  /**
   * Wall-clock time (ms since epoch) of the last lifecycle event observed
   * for this process — set on spawn and refreshed on every output chunk.
   * `killStalled` reads this to decide whether the process has gone silent.
   */
  lastEventAt: number;
}

export class ProcessManager extends EventEmitter {
  private processes: Map<string, ManagedProcess> = new Map();

  spawn(
    type: AgentType,
    command: string,
    args: string[],
    cwd: string,
    threadId?: string,
    options: ManagedProcessSpawnOptions = {},
  ): ManagedProcess {
    const id = nanoid();
    const outputMode = options.outputMode ?? 'normalized';

    // Defense in depth: when the caller declares a workspaceRoot policy,
    // assert the cwd before pty.spawn. A mismatch here means the pipeline
    // is about to run an agent in the wrong directory — fail loud, never
    // continue.
    if (options.workspaceRoot !== undefined) {
      assertWorkspaceSafe({ workspacePath: cwd, workspaceRoot: options.workspaceRoot });
    }

    if (!cachedEnv) {
      cachedEnv = getShellEnv();
    }

    const resolvedCommand = resolveCommand(command);

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(resolvedCommand, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd,
        env: { ...filterEnv(cachedEnv), FORCE_COLOR: '1' },
      });
    } catch (err) {
      // Spawn failed (e.g. binary not found, alias instead of real path).
      // Drop the env cache so the next spawn re-hydrates PATH from a fresh login shell.
      cachedEnv = null;
      const errorMsg = `Failed to spawn ${command} (resolved: ${resolvedCommand}): ${err instanceof Error ? err.message : err}`;
      const managed: ManagedProcess = {
        id,
        type,
        state: 'exited',
        pty: null,
        cwd,
        exitCode: 127,
        threadId,
        outputMode,
        stdinMode: 'tty',
        lastEventAt: Date.now(),
      };
      this.processes.set(id, managed);

      // Defer events so callers can attach listeners first, then drop the
      // entry so the registry does not pin failed-spawn records forever.
      queueMicrotask(() => {
        this.emit('output', id, `\x1b[31mError: ${errorMsg}\x1b[0m\r\n`);
        this.emit('stateChange', id, type, 'exited');
        this.emit('exit', id, 127);
        this.processes.delete(id);
      });

      return managed;
    }

    const managed: ManagedProcess = {
      id,
      type,
      state: 'starting',
      pty: ptyProcess,
      threadId,
      cwd,
      exitCode: null,
      outputMode,
      stdinMode: 'tty',
      lastEventAt: Date.now(),
    };

    this.processes.set(id, managed);
    this.updateState(id, 'running');

    ptyProcess.onData((data: string) => {
      managed.lastEventAt = Date.now();
      this.emit('output', id, data);
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      managed.exitCode = exitCode;
      this.updateState(id, 'exited');
      this.emit('exit', id, exitCode);
      // Drop after synchronous listeners observe the terminal state.
      // Anyone holding a reference to `managed` keeps it; we just stop
      // pinning it in the registry. Long autonomous loops would otherwise
      // accumulate one entry per phase forever.
      queueMicrotask(() => this.processes.delete(id));
    });

    return managed;
  }

  /**
   * Spawn an allowlisted CLI with stdin piped from `input`. This is the
   * non-PTY subprocess surface for one-shot agent runs that must pass large
   * prompts via stdin instead of argv.
   */
  spawnWithStdin(
    type: AgentType,
    command: string,
    args: string[],
    cwd: string,
    input: string,
    threadId?: string,
    options: ManagedProcessSpawnOptions = {},
  ): ManagedProcess {
    const id = nanoid();
    const outputMode = options.outputMode ?? 'normalized';

    if (options.workspaceRoot !== undefined) {
      assertWorkspaceSafe({ workspacePath: cwd, workspaceRoot: options.workspaceRoot });
    }

    if (!cachedEnv) {
      cachedEnv = getShellEnv();
    }

    const resolvedCommand = resolveCommand(command);
    let child: ChildProcessWithoutNullStreams;

    const detached = options.detached ?? false;
    const env = { ...filterEnv(cachedEnv), FORCE_COLOR: '1', ...options.extraEnv };

    try {
      child = spawnChild(resolvedCommand, args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached,
      });
      if (detached) child.unref();
    } catch (err) {
      cachedEnv = null;
      const errorMsg = `Failed to spawn ${command} (resolved: ${resolvedCommand}): ${err instanceof Error ? err.message : err}`;
      const managed: ManagedProcess = {
        id,
        type,
        state: 'exited',
        pty: null,
        cwd,
        exitCode: 127,
        threadId,
        outputMode,
        stdinMode: 'pipe',
        lastEventAt: Date.now(),
      };
      this.processes.set(id, managed);

      queueMicrotask(() => {
        this.emit('output', id, `\x1b[31mError: ${errorMsg}\x1b[0m\r\n`);
        this.emit('stateChange', id, type, 'exited');
        this.emit('exit', id, 127);
        this.processes.delete(id);
      });

      return managed;
    }

    const managed: ManagedProcess = {
      id,
      type,
      state: 'starting',
      pty: null,
      child,
      threadId,
      cwd,
      exitCode: null,
      outputMode,
      stdinMode: 'pipe',
      detached,
      lastEventAt: Date.now(),
    };

    this.processes.set(id, managed);
    this.updateState(id, 'running');

    const emitOutput = (data: Buffer | string) => {
      managed.lastEventAt = Date.now();
      this.emit('output', id, String(data));
    };

    let finalized = false;
    const finalize = (exitCode: number) => {
      if (finalized) return;
      finalized = true;
      managed.exitCode = exitCode;
      this.updateState(id, 'exited');
      this.emit('exit', id, exitCode);
      queueMicrotask(() => this.processes.delete(id));
    };

    child.stdout.on('data', emitOutput);
    child.stderr.on('data', emitOutput);
    child.on('error', (err) => {
      cachedEnv = null;
      emitOutput(`\x1b[31mError: ${err.message.split('\n')[0]}\x1b[0m\r\n`);
      finalize(127);
    });
    child.on('close', (code, signal) => {
      finalize(code ?? (signal ? 130 : 0));
    });

    child.stdin.on('error', () => {
      // EPIPE is expected when a CLI exits before consuming all stdin.
      // The close/error handlers above own the final lifecycle event.
    });

    try {
      child.stdin.write(input);
      child.stdin.end();
    } catch (err) {
      emitOutput(
        `\x1b[31mError writing prompt to ${command}: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`,
      );
      this.killManagedProcess(managed);
    }

    return managed;
  }

  kill(processId: string): void {
    const process = this.processes.get(processId);
    if (process && process.state !== 'exited') {
      this.killManagedProcess(process);
      this.updateState(processId, 'exited');
    }
  }

  write(processId: string, data: string): void {
    const process = this.processes.get(processId);
    if (process && process.state === 'running') {
      if (process.pty) {
        process.pty.write(data);
      } else if (process.child?.stdin.writable) {
        process.child.stdin.write(data);
      }
    }
  }

  resize(processId: string, cols: number, rows: number): void {
    const process = this.processes.get(processId);
    if (process?.pty && process.state !== 'exited') {
      process.pty.resize(cols, rows);
    }
  }

  get(processId: string): ManagedProcess | undefined {
    return this.processes.get(processId);
  }

  listActive(): ManagedProcess[] {
    return Array.from(this.processes.values()).filter(
      (p) => p.state === 'running' || p.state === 'starting',
    );
  }

  killAll(): void {
    for (const [id] of this.processes) {
      this.kill(id);
    }
  }

  /**
   * Kill every active process and wait for each pty to actually exit. Sends
   * SIGHUP first; escalates to SIGKILL after `graceMs` for any holdouts.
   * Resolves once all ptys have emitted `exit` (or after a final 1s
   * post-SIGKILL cap). Use during app shutdown so claude/codex children
   * don't outlive the Electron main process.
   */
  async killAllAndWait(graceMs = 5000): Promise<void> {
    const pending = Array.from(this.processes.values()).filter((p) => p.state !== 'exited');
    if (pending.length === 0) return;

    const waitForExit = (id: string): Promise<void> =>
      new Promise<void>((resolve) => {
        const proc = this.processes.get(id);
        if (!proc || proc.state === 'exited') {
          resolve();
          return;
        }
        const handler = (exitedId: string) => {
          if (exitedId === id) {
            this.off('exit', handler);
            resolve();
          }
        };
        this.on('exit', handler);
      });

    const exitPromises = pending.map((p) => waitForExit(p.id));

    for (const proc of pending) {
      try {
        this.killManagedProcess(proc);
      } catch {
        // ignore — process may already be dead
      }
    }

    const timeoutSentinel = Symbol('timeout');
    const timeout = new Promise<typeof timeoutSentinel>((resolve) =>
      setTimeout(() => resolve(timeoutSentinel), graceMs),
    );

    const result = await Promise.race([Promise.all(exitPromises), timeout]);

    if (result === timeoutSentinel) {
      for (const proc of pending) {
        const cur = this.processes.get(proc.id);
        if (cur && cur.state !== 'exited') {
          try {
            this.killManagedProcess(proc, 'SIGKILL');
          } catch {
            // ignore
          }
        }
      }
      await Promise.race([
        Promise.all(exitPromises),
        new Promise<void>((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
  }

  /**
   * Kill any active process whose output streams have been silent for at least
   * `stallTimeoutMs`. Returns the IDs of processes that were killed so the
   * caller (typically the pipeline watchdog) can transition the matching
   * threads to a failed state with a "stalled" reason.
   *
   * Pass 0 to disable — a no-op that returns an empty array. SIGHUP first;
   * `cleanup()` / exit handler will drop the entry from the registry
   * once the process actually dies. Idempotent: a stalled process whose
   * process is already exited is skipped.
   */
  killStalled(stallTimeoutMs: number): string[] {
    if (!Number.isFinite(stallTimeoutMs) || stallTimeoutMs <= 0) return [];
    const now = Date.now();
    const killed: string[] = [];
    for (const proc of this.processes.values()) {
      if (proc.state === 'exited') continue;
      const idleMs = now - proc.lastEventAt;
      if (idleMs < stallTimeoutMs) continue;
      this.emit(
        'output',
        proc.id,
        `\r\n[shipcode] No output for ${Math.round(idleMs / 1000)}s; killing stalled ${proc.type} process.\r\n`,
      );
      try {
        this.killManagedProcess(proc);
      } catch {
        // process may already be dead — exit handler will fire either way.
      }
      killed.push(proc.id);
    }
    return killed;
  }

  cleanup(processId: string): void {
    const process = this.processes.get(processId);
    if (process && process.state === 'exited') {
      this.processes.delete(processId);
    }
  }

  private updateState(processId: string, state: AgentState): void {
    const process = this.processes.get(processId);
    if (process) {
      process.state = state;
      this.emit('stateChange', processId, process.type, state);
    }
  }

  private killManagedProcess(proc: ManagedProcess, signal?: string): void {
    if (proc.pty) {
      if (signal) proc.pty.kill(signal);
      else proc.pty.kill();
      return;
    }
    const sig = (signal ?? 'SIGTERM') as NodeJS.Signals;
    if (proc.detached && proc.child?.pid) {
      try {
        process.kill(-proc.child.pid, sig);
      } catch {
        proc.child.kill(sig);
      }
      return;
    }
    proc.child?.kill(sig);
  }
}
