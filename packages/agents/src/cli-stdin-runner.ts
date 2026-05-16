import { spawn } from 'node:child_process';
import type { GeneratorCli } from '@shipcode/shared';
import { extractCliFailureMessage, formatCliSpawnFailure } from './cli-error';

const SAFE_CLI_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
]);

function filteredCliEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && SAFE_CLI_ENV_KEYS.has(key)) env[key] = value;
  }
  return env;
}

export function runCliWithStdin(options: {
  cli: GeneratorCli;
  args: string[];
  input: string;
  cwd: string;
  timeoutMs: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(options.cli, options.args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: filteredCliEnv(),
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const label = options.cli === 'claude' ? 'Claude CLI' : 'Codex CLI';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`${label} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(formatCliSpawnFailure(label, err.message)));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const tidy = extractCliFailureMessage(stdout, stderr);
      reject(new Error(`${label} exited ${code}: ${tidy}`));
    });

    writeStdin(proc.stdin, options.input).catch((err: unknown) => {
      proc.kill?.('SIGTERM');
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

async function writeStdin(stdin: NodeJS.WritableStream, input: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const canObserveBackpressure =
      typeof stdin.once === 'function' &&
      typeof stdin.off === 'function' &&
      typeof stdin.on === 'function';
    if (!canObserveBackpressure) {
      stdin.write(input);
      stdin.end();
      resolve();
      return;
    }

    let ended = false;
    const onError = (err: Error) => {
      cleanup();
      if (ended && 'code' in err && err.code === 'EPIPE') {
        resolve();
        return;
      }
      reject(err);
    };
    const cleanup = () => {
      stdin.off('error', onError);
      stdin.off('drain', onDrain);
    };
    const onDrain = () => {
      ended = true;
      stdin.end(() => {
        cleanup();
        resolve();
      });
    };

    stdin.once('error', onError);
    if (stdin.write(input) !== false) {
      ended = true;
      stdin.end(() => {
        cleanup();
        resolve();
      });
      return;
    }
    stdin.once('drain', onDrain);
  });
}
