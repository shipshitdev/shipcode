import { spawn } from 'node:child_process';
import type { GeneratorCli } from '@shipcode/shared';
import { extractCliFailureMessage, formatCliSpawnFailure } from './cli-error';
import { shellExecEnv } from './health-check';

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
      env: shellExecEnv(),
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

    proc.stdin.write(options.input);
    proc.stdin.end();
  });
}
