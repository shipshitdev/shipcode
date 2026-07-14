import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessManager } from '../process-manager';
import { awaitManagedProcess } from './managed-process';

function createProcessManager(): EventEmitter & Pick<ProcessManager, 'kill'> {
  const processManager = new EventEmitter() as EventEmitter & Pick<ProcessManager, 'kill'>;
  processManager.kill = vi.fn();
  return processManager;
}

describe('awaitManagedProcess', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('settles a signal aborted before listener registration instead of hanging', async () => {
    const processManager = createProcessManager();
    const controller = new AbortController();
    controller.abort();

    const promise = awaitManagedProcess({
      processManager: processManager as ProcessManager,
      process: { id: 'proc-1' },
      signal: controller.signal,
    });

    expect(processManager.kill).toHaveBeenCalledWith('proc-1');
    processManager.emit('exit', 'proc-1', 130);
    await expect(promise).resolves.toEqual({ rawOutput: '', exitCode: 130 });
    expect(processManager.listenerCount('output')).toBe(0);
    expect(processManager.listenerCount('exit')).toBe(0);
  });

  it('collects only matching output and kills on a mid-flight abort', async () => {
    const processManager = createProcessManager();
    const controller = new AbortController();
    const onOutput = vi.fn();
    const onExit = vi.fn();
    const promise = awaitManagedProcess({
      processManager: processManager as ProcessManager,
      process: { id: 'proc-1' },
      signal: controller.signal,
      onOutput,
      onExit,
    });

    processManager.emit('output', 'other', 'ignored');
    processManager.emit('output', 'proc-1', 'kept');
    controller.abort();
    processManager.emit('exit', 'proc-1', 130);

    await expect(promise).resolves.toEqual({ rawOutput: 'kept', exitCode: 130 });
    expect(onOutput).toHaveBeenCalledWith('kept');
    expect(onExit).toHaveBeenCalledWith(130);
    expect(processManager.kill).toHaveBeenCalledWith('proc-1');
  });

  it('force-settles when an aborted process never emits exit', async () => {
    vi.useFakeTimers();
    const processManager = createProcessManager();
    vi.mocked(processManager.kill).mockImplementationOnce(() => {
      throw new Error('already gone');
    });
    const controller = new AbortController();
    const onExit = vi.fn();
    const promise = awaitManagedProcess({
      processManager: processManager as ProcessManager,
      process: { id: 'proc-1' },
      signal: controller.signal,
      onExit,
    });

    controller.abort();
    await vi.advanceTimersByTimeAsync(2000);

    await expect(promise).resolves.toEqual({ rawOutput: '', exitCode: 130 });
    // The abort-fallback path must notify onExit just like the exit handler does,
    // so consumers of the shared helper observe the terminal exit in every case.
    expect(onExit).toHaveBeenCalledWith(130);
  });
});
