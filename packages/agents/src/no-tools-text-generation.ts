import type { ReasoningEffort } from '@shipcode/shared';
import { runCliWithStdin } from './cli-stdin-runner';
import { mapReasoningEffortToClaudeThinkingTokens } from './providers/reasoning';

const CLAUDE_TEXT_ENV_KEYS = [
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
] as const;

const MODEL_ID_PATTERN = /^[a-zA-Z0-9._:/@-]+$/;

export interface NoToolsTextGenerationOptions {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  maxTurns: number;
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort;
}

/** Run a one-shot Claude text generation with tools disabled and the prompt on stdin. */
export function runNoToolsTextGeneration(options: NoToolsTextGenerationOptions): Promise<string> {
  if (
    options.modelId &&
    (options.modelId.startsWith('-') || !MODEL_ID_PATTERN.test(options.modelId))
  ) {
    throw new Error(`Invalid model ID: ${options.modelId}`);
  }

  const thinkingTokens = mapReasoningEffortToClaudeThinkingTokens(
    options.reasoningEffort,
    options.modelId,
  );
  const args = [
    '-p',
    ...(options.modelId ? ['--model', options.modelId] : []),
    '--output-format',
    'json',
    '--max-turns',
    String(options.maxTurns),
    ...(thinkingTokens === null ? [] : ['--max-thinking-tokens', String(thinkingTokens)]),
    '--allowedTools',
    '',
  ];

  return runCliWithStdin({
    cli: 'claude',
    args,
    input: options.prompt,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    envKeyAllowlist: CLAUDE_TEXT_ENV_KEYS,
  });
}
