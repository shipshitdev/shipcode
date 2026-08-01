import type { GeneratorCli } from '@shipcode/shared';
import { classifyPoolExhaustion, markPoolExhausted } from './agent-sdk-pool-state';
import { extractCliFailureMessage, formatCliSpawnFailure } from './cli-error';
import { MAX_COLLECTED_OUTPUT_CHARS, runWithStdin } from './spawn-with-stdin';

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

function filteredCliEnvFor(allowlist?: readonly string[]): Record<string, string> {
  const base = filteredCliEnv();
  if (!allowlist) return base;
  const allowed = new Set(allowlist);
  return Object.fromEntries(Object.entries(base).filter(([key]) => allowed.has(key)));
}

export function runCliWithStdin(options: {
  cli: GeneratorCli;
  args: string[];
  input: string;
  cwd: string;
  timeoutMs: number;
  envKeyAllowlist?: readonly string[];
}): Promise<string> {
  const label = options.cli === 'claude' ? 'Claude CLI' : 'Codex CLI';

  return runWithStdin({
    command: options.cli,
    args: options.args,
    input: options.input,
    cwd: options.cwd,
    env: filteredCliEnvFor(options.envKeyAllowlist),
    timeoutMs: options.timeoutMs,
    formatSpawnError: (err) => new Error(formatCliSpawnFailure(label, err.message)),
    formatTimeoutError: (timeoutMs) => new Error(`${label} timed out after ${timeoutMs}ms`),
    // Callers parse a JSON envelope out of stdout, so a truncated success would
    // only resurface as a confusing parse error further downstream.
    formatTruncatedOutputError: () =>
      new Error(`${label} produced more than ${MAX_COLLECTED_OUTPUT_CHARS} characters of output`),
    formatExitError: ({ code, stdout, stderr, stdinError, truncated }) => {
      const detail = [
        extractCliFailureMessage(stdout, stderr),
        stdinError ? `stdin write failed: ${stdinError.message}` : null,
        truncated ? 'output truncated' : null,
      ]
        .filter(Boolean)
        .join('; ');
      // These one-shot generators run `claude -p`, so they draw from the
      // rationed Agent-SDK credit pool. Flag exhaustion so the UI alerts and
      // the pipeline falls back to interactive; the one-shot itself still fails.
      if (options.cli === 'claude' && classifyPoolExhaustion(stdout, stderr, code ?? 1)) {
        markPoolExhausted('Claude Agent-SDK credit pool exhausted');
        return new Error(
          `${label} exited ${code}: Agent-SDK credit pool exhausted. ${detail}`.trim(),
        );
      }
      return new Error(`${label} exited ${code}: ${detail}`);
    },
  });
}
