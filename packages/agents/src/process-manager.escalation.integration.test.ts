import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

// node-pty is a native Electron module; this suite only exercises the piped
// child path, so the pty binding is stubbed rather than loaded.
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('@shipcode/shared/worktree-path', () => ({ assertWorkspaceSafe: vi.fn() }));

import { ProcessManager } from './process-manager';

/**
 * A shell that installs a no-op TERM trap and then busy-waits. It survives the
 * polite signal and can only be removed with SIGKILL — the exact process shape
 * that used to be orphaned forever, because `kill()` marked it `exited` the
 * instant the signal was written.
 */
const SIGTERM_IGNORING_SCRIPT = 'trap "" TERM; while :; do sleep 0.05; done';

/** Short enough to keep the suite fast, long enough to observe the SIGTERM gap. */
const GRACE_MS = 300;

function isAlive(pid: number): boolean {
  try {
    // Signal 0 probes for existence without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve with the signal the OS actually used to reap the child. The manager
 * collapses every signal death to exit code 130, so the raw `close` payload is
 * the only place SIGTERM and SIGKILL are still distinguishable. The manager
 * registered its own `close` handler at spawn time, so by the time this one
 * runs the managed state has already settled.
 */
function waitForChildClose(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('child never exited')), 15_000);
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

describe('ProcessManager SIGKILL escalation (real child)', () => {
  const managers: ProcessManager[] = [];

  afterEach(async () => {
    for (const manager of managers.splice(0)) {
      await manager.killAllAndWait(1_000).catch(() => {});
      manager.removeAllListeners();
    }
  });

  it('SIGKILLs a child that ignores SIGTERM and settles the state on real exit', async () => {
    const manager = new ProcessManager();
    managers.push(manager);

    const proc = manager.spawnWithStdin(
      'shell',
      '/bin/sh',
      ['-c', SIGTERM_IGNORING_SCRIPT],
      process.cwd(),
      '',
      undefined,
      { detached: true },
    );
    const child = proc.child;
    if (!child?.pid) throw new Error('child never got a pid');
    const pid = child.pid;

    const closed = waitForChildClose(child);

    // Give the trap time to install before signalling it.
    await new Promise((resolve) => setTimeout(resolve, 250));
    manager.kill(proc.id, undefined, { escalateAfterMs: GRACE_MS });

    // The polite signal lands but is ignored: still alive, and — critically —
    // still visible as a live process rather than prematurely `exited`.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(isAlive(pid)).toBe(true);
    expect(proc.state).toBe('terminating');
    expect(manager.get(proc.id)?.state).toBe('terminating');

    const { signal } = await closed;
    // The polite TERM was trapped, so only the escalation could have reaped it.
    expect(signal).toBe('SIGKILL');
    expect(proc.state).toBe('exited');
    expect(isAlive(pid)).toBe(false);
  }, 20_000);

  it('leaves a cooperative child alone once it exits within the grace period', async () => {
    const manager = new ProcessManager();
    managers.push(manager);

    const proc = manager.spawnWithStdin(
      'shell',
      '/bin/sh',
      ['-c', 'while :; do sleep 0.05; done'],
      process.cwd(),
      '',
      undefined,
      { detached: true },
    );
    const child = proc.child;
    if (!child?.pid) throw new Error('child never got a pid');

    const closed = waitForChildClose(child);

    manager.kill(proc.id, undefined, { escalateAfterMs: GRACE_MS });
    const { signal } = await closed;

    expect(proc.state).toBe('exited');
    // The polite signal did the job; the escalation must not have fired.
    expect(signal).toBe('SIGTERM');
    // biome-ignore lint/complexity/useLiteralKeys: private timer map inspection is intentional.
    expect(manager['escalationTimers'].size).toBe(0);
  }, 20_000);
});
