import { type AddressInfo, createServer } from 'node:net';
import type { RuntimeQaServerConfig } from '@shipcode/shared';
import type { ProcessManager } from './process-manager';

export interface RunningServer {
  processId: string;
  baseUrl: string;
  port: number;
  crashed: boolean;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });
}

function substitutePort(urlStr: string, port: number): string {
  const parsed = new URL(urlStr);
  parsed.port = String(port);
  return parsed.toString().replace(/\/$/, '');
}

async function pollHttp(url: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let delay = 100;
  const maxDelay = 2000;

  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('Readiness poll aborted');
    try {
      const res = await fetch(url, { signal, method: 'GET' });
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
  ): Promise<RunningServer> {
    const port = await findFreePort();
    const readinessUrl = substitutePort(config.readinessUrl, port);

    this.emitLog(`[runtime-qa] Starting server on port ${port}: ${config.command}\r\n`);

    const shell = process.env.SHELL ?? '/bin/zsh';
    const managed = this.processManager.spawnWithStdin(
      'shell',
      shell,
      ['-lc', config.command],
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
      port,
      crashed: false,
    };

    const onExit = (_exitId: string, _exitCode: number) => {
      server.crashed = true;
    };
    this.processManager.on('exit', (exitId: string, exitCode: number) => {
      if (exitId === managed.id) onExit(exitId, exitCode);
    });

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
      const timeout = setTimeout(() => resolve(), 5000);
      this.processManager.once('exit', (exitId: string) => {
        if (exitId === server.processId) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    this.emitLog(`[runtime-qa] Server stopped (port ${server.port})\r\n`);
  }
}
