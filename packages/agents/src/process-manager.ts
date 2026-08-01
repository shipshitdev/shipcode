import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { execFile, execFileSync, spawn as spawnChild } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';
import type { AgentState, AgentType } from '@shipcode/shared';
import { assertWorkspaceSafe } from '@shipcode/shared/worktree-path';
import { nanoid } from 'nanoid';
import * as pty from 'node-pty';

export type ProcessManagerAgentCommand =
  | Extract<AgentType, 'claude' | 'codex' | 'gemini' | 'grok' | 'gh'>
  // Cursor's binary is `cursor-agent`, not `cursor`, so the allowlisted command
  // string diverges from its AgentType tag (unlike the other CLIs).
  | 'cursor-agent';
export type ProcessManagerShellCommand = (typeof TRUSTED_SHELL_COMMANDS)[number];
export type ProcessManagerPackageCommand = (typeof TRUSTED_PACKAGE_COMMANDS)[number];
export type ProcessManagerCommand =
  | ProcessManagerAgentCommand
  | ProcessManagerShellCommand
  | ProcessManagerPackageCommand;

const ALLOWED_AGENT_COMMANDS = new Set<ProcessManagerAgentCommand>([
  'claude',
  'codex',
  'gemini',
  'grok',
  'cursor-agent',
  'gh',
]);
const TRUSTED_SHELL_COMMANDS = [
  '/bin/bash',
  '/bin/zsh',
  '/bin/sh',
  '/usr/bin/bash',
  '/usr/bin/zsh',
  '/usr/local/bin/bash',
  '/usr/local/bin/zsh',
  '/opt/homebrew/bin/bash',
  '/opt/homebrew/bin/zsh',
] as const;
const TRUSTED_PACKAGE_COMMANDS = ['bun', 'pnpm', 'npm', 'yarn', 'deno'] as const;
const TRUSTED_SHELLS = new Set<string>(TRUSTED_SHELL_COMMANDS);
const TRUSTED_PACKAGES = new Set<string>(TRUSTED_PACKAGE_COMMANDS);

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
  'CURSOR_API_KEY',
]);

function filterEnv(env: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, val] of Object.entries(env)) {
    if (SAFE_ENV_KEYS.has(key)) filtered[key] = val;
  }
  return filtered;
}

/**
 * Absolute path of the OS-sandbox binary (`srt`) resolved at runtime. Spawning
 * the sandbox wrapper requires an allowlist escape, but we narrow it to the one
 * exact resolved path — never the bare string "srt" — so this is not a general
 * allowlist widening. Populated by resolveSrt() in sandbox/srt.ts.
 */
let allowedSandboxBinary: string | null = null;

export function registerSandboxBinary(absolutePath: string): void {
  // Write-once: only the first resolved sandbox binary is ever allowlisted.
  // resolveSrt() caches, so this is effectively set a single time per process.
  if (allowedSandboxBinary !== null) return;
  allowedSandboxBinary = absolutePath;
}

function isAllowedSandboxBinary(command: string): boolean {
  return allowedSandboxBinary !== null && command === allowedSandboxBinary;
}

function isTrustedShell(command: string): command is ProcessManagerShellCommand {
  return TRUSTED_SHELLS.has(command);
}

function isAllowlistedAgentCommand(command: string): command is ProcessManagerAgentCommand {
  return ALLOWED_AGENT_COMMANDS.has(command as ProcessManagerAgentCommand);
}

function isTrustedPackageCommand(command: string): command is ProcessManagerPackageCommand {
  return TRUSTED_PACKAGES.has(command as ProcessManagerPackageCommand);
}

function assertProcessManagerCommand(command: string): asserts command is ProcessManagerCommand {
  if (
    isTrustedShell(command) ||
    isAllowlistedAgentCommand(command) ||
    isTrustedPackageCommand(command) ||
    isAllowedSandboxBinary(command)
  )
    return;
  throw new Error(`Command is not allowlisted for ProcessManager: ${command}`);
}

function mergeSafeEnv(
  baseEnv: Record<string, string>,
  extraEnv?: Record<string, string>,
  envKeyAllowlist?: ReadonlySet<string>,
): Record<string, string> {
  const base = filterEnv(baseEnv);
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(base)) {
    if (!envKeyAllowlist || envKeyAllowlist.has(key)) env[key] = val;
  }
  env.FORCE_COLOR = '1';
  for (const [key, val] of Object.entries(extraEnv ?? {})) {
    if (!key || key.includes('=') || key.includes('\0') || val.includes('\0')) continue;
    if (envKeyAllowlist && !envKeyAllowlist.has(key) && key !== 'FORCE_COLOR') continue;
    if (SAFE_ENV_KEYS.has(key) || key === 'FORCE_COLOR') continue;
    if (!/^(PORT|[A-Z_][A-Z0-9_]*_PORT)$/.test(key)) continue;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — strip C0 control chars from env values to prevent header injection
    env[key] = val.replace(/[\n\r\x00-\x1f]/g, '');
  }
  return env;
}

function assertWorkspacePolicy(cwd: string, options: ManagedProcessSpawnOptions): void {
  if (options.workspaceRoot === undefined) return;
  if (!options.projectPath) {
    throw new Error('projectPath is required when workspaceRoot enforcement is enabled');
  }
  assertWorkspaceSafe({
    workspacePath: cwd,
    workspaceRoot: options.workspaceRoot,
    projectPath: options.projectPath,
  });
}

function getShellEnv(): Record<string, string> {
  try {
    /* v8 ignore next -- user shells are present in normal desktop sessions */
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
  assertProcessManagerCommand(command);
  if (isTrustedShell(command)) return command;
  // Already-absolute paths (e.g. the resolved srt binary) passed the allowlist
  // check and need no shell lookup — short-circuit to avoid a login-shell spawn
  // and unquoted interpolation of paths containing spaces.
  if (command.startsWith('/')) return command;
  const shell = process.env.SHELL;
  if (!shell || !isTrustedShell(shell)) return command;
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
let cachedEnvTimestamp = 0;
const CACHED_ENV_TTL_MS = 5 * 60 * 1000;
const execFileAsync = promisify(execFile);

export type ManagedProcessOutputMode = 'normalized' | 'raw';

export interface ManagedProcessSpawnOptions {
  outputMode?: ManagedProcessOutputMode;
  /**
   * Keep piped stdin writable after the initial prompt is written. Used by
   * long-running executor transports that can accept explicit steering input.
   */
  keepStdinOpen?: boolean;
  /**
   * When provided, the spawn site asserts `cwd` is a canonical linked worktree
   * registered to `projectPath`. Defense-in-depth — see `assertWorkspaceSafe`.
   * Pipeline worktree spawns opt in; instant terminals at the project root do not.
   * `null` matches the AppSettings default (~/.shipcode/worktrees).
   */
  workspaceRoot?: string | null;
  /** Exact repository root used to reject worktrees from foreign repositories. */
  projectPath?: string;
  /**
   * Spawn in a new process group so `kill(-pid)` terminates the entire
   * child tree (server + its children). Used by ServerLifecycleManager.
   */
  detached?: boolean;
  /** Extra env vars merged on top of the filtered shell env. */
  extraEnv?: Record<string, string>;
  /** Optional least-privilege env allowlist for tool-capable agent processes. */
  envKeyAllowlist?: readonly string[];
}

export interface ManagedProcess {
  id: string;
  type: AgentType;
  state: AgentState;
  pty: pty.IPty | null;
  child?: ChildProcessWithoutNullStreams;
  cwd: string;
  command: string;
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
  startedAt: number;
}

export interface ManagedProcessResourceUsage {
  processId: string;
  type: AgentType;
  state: AgentState;
  pid: number | null;
  childPids: number[];
  threadId: string | null;
  cwd: string;
  command: string;
  cpuPercent: number;
  memoryBytes: number;
  startedAt: number;
  lastEventAt: number;
}

interface PsRow {
  pid: number;
  ppid: number;
  cpuPercent: number;
  rssKb: number;
}

function managedPid(proc: ManagedProcess): number | null {
  if (proc.child?.pid) return proc.child.pid;
  const ptyPid = (proc.pty as { pid?: number } | null)?.pid;
  return typeof ptyPid === 'number' && Number.isFinite(ptyPid) ? ptyPid : null;
}

function parsePsRows(stdout: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [pidRaw, ppidRaw, cpuRaw, rssRaw] = trimmed.split(/\s+/, 4);
    const pid = Number(pidRaw);
    const ppid = Number(ppidRaw);
    const cpuPercent = Number(cpuRaw);
    const rssKb = Number(rssRaw);
    if (
      !Number.isFinite(pid) ||
      !Number.isFinite(ppid) ||
      !Number.isFinite(cpuPercent) ||
      !Number.isFinite(rssKb)
    ) {
      continue;
    }
    rows.push({ pid, ppid, cpuPercent, rssKb });
  }
  return rows;
}

function collectDescendantPids(rootPid: number, rows: PsRow[]): Set<number> {
  const childrenByParent = new Map<number, number[]>();
  for (const row of rows) {
    const children = childrenByParent.get(row.ppid) ?? [];
    children.push(row.pid);
    childrenByParent.set(row.ppid, children);
  }

  const descendants = new Set<number>();
  const pending = [...(childrenByParent.get(rootPid) ?? [])];
  while (pending.length > 0) {
    const pid = pending.pop() as number;
    /* v8 ignore next -- process trees should not cycle, but ps output can be stale */
    if (descendants.has(pid)) continue;
    descendants.add(pid);
    pending.push(...(childrenByParent.get(pid) ?? []));
  }
  return descendants;
}

interface PreparedProcessSpawn {
  id: string;
  outputMode: ManagedProcessOutputMode;
  resolvedCommand: string;
  env: Record<string, string>;
  startedAt: number;
}

function prepareSpawn(
  command: string,
  cwd: string,
  options: ManagedProcessSpawnOptions,
): PreparedProcessSpawn {
  assertWorkspacePolicy(cwd, options);

  if (!cachedEnv || Date.now() - cachedEnvTimestamp > CACHED_ENV_TTL_MS) {
    cachedEnv = getShellEnv();
    cachedEnvTimestamp = Date.now();
  }

  return {
    id: nanoid(),
    outputMode: options.outputMode ?? 'normalized',
    resolvedCommand: resolveCommand(command),
    env: mergeSafeEnv(
      cachedEnv,
      options.extraEnv,
      options.envKeyAllowlist ? new Set(options.envKeyAllowlist) : undefined,
    ),
    startedAt: Date.now(),
  };
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
    // Defense in depth: when the caller declares a workspace policy, assert
    // the cwd and Git worktree identity before spawning. A mismatch means the pipeline
    // is about to run an agent in the wrong directory — fail loud, never
    // continue.
    const { id, outputMode, resolvedCommand, env, startedAt } = prepareSpawn(command, cwd, options);

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(resolvedCommand, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd,
        env,
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
        command,
        exitCode: 127,
        threadId,
        outputMode,
        stdinMode: 'tty',
        lastEventAt: startedAt,
        startedAt,
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
      command,
      exitCode: null,
      outputMode,
      stdinMode: 'tty',
      lastEventAt: startedAt,
      startedAt,
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
   * Spawn an allowlisted CLI with stdin piped from `input`.
   *
   * Contract for CLI providers such as Gemini:
   * - validates `cwd` with the same `workspaceRoot` policy as `spawn`
   * - resolves only ProcessManager-allowlisted agent commands or trusted shells
   * - merges a filtered login-shell env with sanitized `extraEnv`
   * - tracks `stdinMode: 'pipe'`, streams stdout and stderr as output, emits
   *   one exit event, and drops completed processes from the registry
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
    const { id, outputMode, resolvedCommand, env, startedAt } = prepareSpawn(command, cwd, options);
    let child: ChildProcessWithoutNullStreams;

    const detached = options.detached ?? false;

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
        command,
        exitCode: 127,
        threadId,
        outputMode,
        stdinMode: 'pipe',
        lastEventAt: startedAt,
        startedAt,
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
      command,
      exitCode: null,
      outputMode,
      stdinMode: 'pipe',
      detached,
      lastEventAt: startedAt,
      startedAt,
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

    const shouldKeepStdinOpen = options.keepStdinOpen === true;
    const finishStdin = () => {
      if (!shouldKeepStdinOpen) child.stdin.end();
    };
    const handleStdinError = (err: Error) => {
      child.stdin.off('drain', finishStdin);
      emitOutput(`\x1b[31mError writing prompt to ${command}: ${err.message}\x1b[0m\r\n`);
      this.killManagedProcess(managed);
    };

    child.stdin.once('error', handleStdinError);
    try {
      if (child.stdin.write(input) !== false) {
        if (shouldKeepStdinOpen) {
          child.stdin.off('error', handleStdinError);
          return managed;
        }
        child.stdin.end();
      } else {
        child.stdin.once('drain', finishStdin);
      }
    } catch (err) {
      handleStdinError(err instanceof Error ? err : new Error(String(err)));
    }

    return managed;
  }

  kill(processId: string, signal?: string): void {
    const process = this.processes.get(processId);
    if (process && process.state !== 'exited') {
      this.killManagedProcess(process, signal);
      this.updateState(processId, 'exited');
    }
  }

  write(processId: string, data: string): boolean {
    const process = this.processes.get(processId);
    if (process && process.state === 'running') {
      if (process.pty) {
        process.pty.write(data);
        return true;
      } else if (process.child?.stdin.writable) {
        try {
          process.child.stdin.write(data);
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
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
      /* v8 ignore next -- starting is a transient state covered through spawn transitions */
      (p) => p.state === 'running' || p.state === 'starting',
    );
  }

  async listResourceUsage(): Promise<ManagedProcessResourceUsage[]> {
    const active = this.listActive();
    if (active.length === 0) return [];

    let psRows: PsRow[] = [];
    try {
      const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,pcpu=,rss='], {
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
      });
      psRows = parsePsRows(stdout);
    } catch {
      psRows = [];
    }

    const rowByPid = new Map(psRows.map((row) => [row.pid, row]));
    return active
      .map((proc) => {
        const pid = managedPid(proc);
        if (pid == null) {
          return {
            processId: proc.id,
            type: proc.type,
            state: proc.state,
            pid: null,
            childPids: [],
            threadId: proc.threadId ?? null,
            cwd: proc.cwd,
            command: proc.command,
            cpuPercent: 0,
            memoryBytes: 0,
            startedAt: proc.startedAt,
            lastEventAt: proc.lastEventAt,
          };
        }

        const descendantPids = collectDescendantPids(pid, psRows);
        const pids = [pid, ...descendantPids];
        const totals = pids.reduce(
          (acc, processPid) => {
            const row = rowByPid.get(processPid);
            if (!row) return acc;
            acc.cpuPercent += row.cpuPercent;
            acc.memoryBytes += row.rssKb * 1024;
            return acc;
          },
          { cpuPercent: 0, memoryBytes: 0 },
        );

        return {
          processId: proc.id,
          type: proc.type,
          state: proc.state,
          pid,
          childPids: [...descendantPids].sort((a, b) => a - b),
          threadId: proc.threadId ?? null,
          cwd: proc.cwd,
          command: proc.command,
          cpuPercent: Number(totals.cpuPercent.toFixed(1)),
          memoryBytes: totals.memoryBytes,
          startedAt: proc.startedAt,
          lastEventAt: proc.lastEventAt,
        };
      })
      .sort((a, b) => b.cpuPercent - a.cpuPercent);
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
        /* v8 ignore next -- pending IDs come from live process map immediately above */
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
        /* v8 ignore next -- timeout race leaves this as a defensive stale-map guard */
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
    /* v8 ignore next -- callers update IDs managed by this instance */
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
