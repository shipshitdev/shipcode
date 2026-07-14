import type { ManagedProcess, ProcessManager } from '../process-manager';

export interface ManagedProcessResult {
  rawOutput: string;
  exitCode: number;
}

export interface AwaitManagedProcessOptions {
  processManager: ProcessManager;
  process: Pick<ManagedProcess, 'id'>;
  signal: AbortSignal;
  onOutput?: (data: string) => void;
  onExit?: (exitCode: number) => void;
}

/**
 * Wait for one managed process while accumulating its output and honoring aborts.
 * The post-listener abort check closes the race between a caller's pre-spawn
 * check and listener registration.
 */
export function awaitManagedProcess(
  options: AwaitManagedProcessOptions,
): Promise<ManagedProcessResult> {
  return new Promise<ManagedProcessResult>((resolve) => {
    let rawOutput = '';
    let settled = false;
    let abortTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      options.processManager.removeListener('output', outputHandler);
      options.processManager.removeListener('exit', exitHandler);
      options.signal.removeEventListener('abort', abortHandler);
      if (abortTimer) clearTimeout(abortTimer);
    };

    const settle = (result: ManagedProcessResult) => {
      /* v8 ignore next -- listeners are removed during cleanup; guard handles event races */
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const outputHandler = (processId: string, data: string) => {
      if (processId !== options.process.id) return;
      rawOutput += data;
      options.onOutput?.(data);
    };

    const exitHandler = (processId: string, exitCode: number) => {
      if (processId !== options.process.id) return;
      options.onExit?.(exitCode);
      settle({ rawOutput, exitCode });
    };

    const abortHandler = () => {
      try {
        options.processManager.kill(options.process.id);
      } catch {
        // The exit event still owns settlement when the process is already gone.
      }
      if (settled) return;
      abortTimer = setTimeout(() => {
        settle({ rawOutput, exitCode: 130 });
      }, 2000);
    };

    options.processManager.on('output', outputHandler);
    options.processManager.on('exit', exitHandler);
    options.signal.addEventListener('abort', abortHandler, { once: true });
    if (options.signal.aborted) abortHandler();
  });
}
