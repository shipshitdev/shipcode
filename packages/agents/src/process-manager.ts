import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { AgentState, AgentType } from '@shipcode/shared';
import { nanoid } from 'nanoid';
import * as pty from 'node-pty';

const ALLOWED_COMMANDS = new Set(['claude', 'codex', 'gh']);
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
  if (!ALLOWED_COMMANDS.has(command)) return command;
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

export interface ManagedProcess {
  id: string;
  type: AgentType;
  state: AgentState;
  pty: pty.IPty;
  cwd: string;
  exitCode: number | null;
  threadId?: string;
}

export class ProcessManager extends EventEmitter {
  private processes: Map<string, ManagedProcess> = new Map();

  spawn(
    type: AgentType,
    command: string,
    args: string[],
    cwd: string,
    threadId?: string,
  ): ManagedProcess {
    const id = nanoid();

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
      // Emit error as output + synthetic exit so pipeline handles it gracefully.
      const errorMsg = `Failed to spawn ${command} (resolved: ${resolvedCommand}): ${err instanceof Error ? err.message : err}`;
      const managed: ManagedProcess = {
        id,
        type,
        state: 'exited',
        pty: null as unknown as pty.IPty,
        cwd,
        exitCode: 127,
        threadId,
      };
      this.processes.set(id, managed);

      // Defer events so callers can attach listeners first
      queueMicrotask(() => {
        this.emit('output', id, `\x1b[31mError: ${errorMsg}\x1b[0m\r\n`);
        this.emit('stateChange', id, type, 'exited');
        this.emit('exit', id, 127);
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
    };

    this.processes.set(id, managed);
    this.updateState(id, 'running');

    ptyProcess.onData((data: string) => {
      this.emit('output', id, data);
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      managed.exitCode = exitCode;
      this.updateState(id, 'exited');
      this.emit('exit', id, exitCode);
    });

    return managed;
  }

  kill(processId: string): void {
    const process = this.processes.get(processId);
    if (process && process.state !== 'exited') {
      process.pty.kill();
      this.updateState(processId, 'exited');
    }
  }

  write(processId: string, data: string): void {
    const process = this.processes.get(processId);
    if (process && process.state === 'running') {
      process.pty.write(data);
    }
  }

  resize(processId: string, cols: number, rows: number): void {
    const process = this.processes.get(processId);
    if (process && process.state !== 'exited') {
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
}
