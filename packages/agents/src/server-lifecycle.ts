import type { RuntimeQaServerConfig } from '@shipcode/shared';
import type { ProcessManager } from './process-manager';

export interface RunningServer {
  processId: string;
  baseUrl: string;
  previewUrl?: string;
  port: number;
  crashed: boolean;
  onExit?: (exitId: string, exitCode: number) => void;
}

function substitutePort(urlStr: string, port: number): string {
  const parsed = new URL(urlStr);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Runtime QA readiness URL must use http or https');
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new Error('Runtime QA readiness URL must target localhost, 127.0.0.1, or ::1');
  }
  parsed.port = String(port);
  return parsed.toString().replace(/\/$/, '');
}

function configuredPort(urlStr: string): number | null {
  const parsed = new URL(urlStr);
  const port = Number(parsed.port);
  return Number.isInteger(port) && port > 0 ? port : null;
}

function parsePackageCommand(command: string): { command: string; args: string[] } {
  if (/[;&|`$<>\\\n\r]/.test(command)) {
    throw new Error('Runtime QA server command contains unsupported shell syntax');
  }
  const parts = command.trim().split(/\s+/).filter(Boolean);
  const bin = parts[0];
  if (!['bun', 'pnpm', 'npm', 'yarn', 'deno'].includes(bin)) {
    throw new Error('Runtime QA server command must start with bun, pnpm, npm, yarn, or deno');
  }
  return { command: bin, args: parts.slice(1) };
}

async function pollHttp(url: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let delay = 100;
  const maxDelay = 2000;

  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('Readiness poll aborted');
    try {
      const res = await fetch(url, { signal, method: 'GET', redirect: 'manual' });
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, maxDelay);
  }
  throw new Error(`Server readiness timeout after ${Math.round(timeoutMs / 1000)}s: ${url}`);
}

export class ServerLifecycleManager {
  constructor(
    private processManager: ProcessManager,
    private emitLog: (msg: string) => void,
  ) {}

  async start(
    config: RuntimeQaServerConfig,
    cwd: string,
    signal: AbortSignal,
    threadId: string,
    options: { previewUrl?: string } = {},
  ): Promise<RunningServer> {
    const port = configuredPort(config.readinessUrl);
    if (port === null) {
      throw new Error('Runtime QA readiness URL must include an explicit port');
    }
    const readinessUrl = substitutePort(config.readinessUrl, port);

    this.emitLog(`[runtime-qa] Starting server on port ${port}: ${config.command}\r\n`);

    const parsedCommand = parsePackageCommand(config.command);
    const managed = this.processManager.spawnWithStdin(
      'shell',
      parsedCommand.command,
      parsedCommand.args,
      cwd,
      '',
      threadId,
      {
        detached: true,
        extraEnv: { [config.portEnvVar]: String(port) },
      },
    );

    const server: RunningServer = {
      processId: managed.id,
      baseUrl: `http://localhost:${port}`,
      previewUrl: options.previewUrl,
      port,
      crashed: false,
      onExit: () => {},
    };

    server.onExit = (exitId: string) => {
      if (exitId !== managed.id) return;
      server.crashed = true;
      if (server.onExit) this.processManager.off('exit', server.onExit);
    };
    this.processManager.on('exit', server.onExit);

    try {
      await pollHttp(readinessUrl, config.startupTimeoutMs, signal);
      this.emitLog(`[runtime-qa] Server ready at ${server.baseUrl}\r\n`);
    } catch (err) {
      await this.stop(server);
      throw err;
    }

    return server;
  }

  async stop(server: RunningServer): Promise<void> {
    try {
      if (server.onExit) this.processManager.off('exit', server.onExit);
      this.processManager.kill(server.processId);
    } catch {
      // Already dead
    }

    await new Promise<void>((resolve) => {
      const proc = this.processManager.get(server.processId);
      if (!proc || proc.state === 'exited') {
        resolve();
        return;
      }
      const onExit = (exitId: string) => {
        if (exitId === server.processId) {
          clearTimeout(timeout);
          this.processManager.off('exit', onExit);
          resolve();
        }
      };
      const timeout = setTimeout(() => {
        this.processManager.off('exit', onExit);
        resolve();
      }, 5000);
      this.processManager.on('exit', onExit);
    });

    this.emitLog(`[runtime-qa] Server stopped (port ${server.port})\r\n`);
  }
}
