import type { ExecutorModel } from './types';

export interface KnownModelOption<T extends string = string> {
  value: T;
  label: string;
}

export const CLAUDE_MODEL_IDS = {
  sonnet46: 'claude-sonnet-4-6',
  opus46: 'claude-opus-4-6',
  haiku45: 'claude-haiku-4-5-20251001',
} as const;

export type ClaudeModelId = (typeof CLAUDE_MODEL_IDS)[keyof typeof CLAUDE_MODEL_IDS];

export const CODEX_MODEL_IDS = {
  gpt54: 'gpt-5.4',
  gpt54Mini: 'gpt-5.4-mini',
} as const;

export type CodexModelId = (typeof CODEX_MODEL_IDS)[keyof typeof CODEX_MODEL_IDS];

export const OPENROUTER_MODEL_IDS = {
  autoPaid: 'openrouter/auto',
  autoFree: 'openrouter/free',
  claudeSonnet46: 'anthropic/claude-sonnet-4.6',
  claudeOpus46: 'anthropic/claude-opus-4.6',
  qwen36Plus: 'qwen/qwen3.6-plus',
  qwen3CoderFree: 'qwen/qwen3-coder:free',
} as const;

export type OpenRouterModelId = (typeof OPENROUTER_MODEL_IDS)[keyof typeof OPENROUTER_MODEL_IDS];

// New model versions are intentionally opt-in. Add them here first, then
// explicitly promote them into PINNED_MODEL_DEFAULTS after real evaluation.
export const CLAUDE_MODEL_OPTIONS = [
  { value: CLAUDE_MODEL_IDS.sonnet46, label: 'Sonnet 4.6' },
  { value: CLAUDE_MODEL_IDS.opus46, label: 'Opus 4.6' },
  { value: CLAUDE_MODEL_IDS.haiku45, label: 'Haiku 4.5' },
] as const satisfies readonly KnownModelOption<ClaudeModelId>[];

export const CODEX_MODEL_OPTIONS = [
  { value: CODEX_MODEL_IDS.gpt54, label: 'GPT-5.4' },
  { value: CODEX_MODEL_IDS.gpt54Mini, label: 'GPT-5.4 Mini' },
] as const satisfies readonly KnownModelOption<CodexModelId>[];

export const OPENROUTER_MODEL_OPTIONS = [
  { value: OPENROUTER_MODEL_IDS.autoPaid, label: 'Auto (paid)' },
  { value: OPENROUTER_MODEL_IDS.autoFree, label: 'Auto (free)' },
  { value: OPENROUTER_MODEL_IDS.claudeSonnet46, label: 'Claude Sonnet 4.6' },
  { value: OPENROUTER_MODEL_IDS.qwen36Plus, label: 'Qwen 3.6 Plus' },
  { value: OPENROUTER_MODEL_IDS.qwen3CoderFree, label: 'Qwen 3 Coder Free' },
] as const satisfies readonly KnownModelOption<OpenRouterModelId>[];

export const KNOWN_MODEL_OPTIONS_BY_PROVIDER = {
  claude: CLAUDE_MODEL_OPTIONS,
  codex: CODEX_MODEL_OPTIONS,
  openrouter: OPENROUTER_MODEL_OPTIONS,
} as const satisfies Record<ExecutorModel, readonly KnownModelOption[]>;

export type CuratedModelId =
  | (typeof CLAUDE_MODEL_OPTIONS)[number]['value']
  | (typeof CODEX_MODEL_OPTIONS)[number]['value']
  | (typeof OPENROUTER_MODEL_OPTIONS)[number]['value'];

const CURATED_MODEL_LABELS = Object.fromEntries(
  [...CLAUDE_MODEL_OPTIONS, ...CODEX_MODEL_OPTIONS, ...OPENROUTER_MODEL_OPTIONS].map((option) => [
    option.value,
    option.label,
  ]),
) as Record<CuratedModelId, string>;

export const PINNED_MODEL_DEFAULTS = {
  claude: {
    phase: CLAUDE_MODEL_IDS.sonnet46,
    prdRewrite: CLAUDE_MODEL_IDS.sonnet46,
  },
  codex: {
    phase: CODEX_MODEL_IDS.gpt54,
    prdRewrite: CODEX_MODEL_IDS.gpt54Mini,
  },
  openrouter: {
    paid: OPENROUTER_MODEL_IDS.autoPaid,
    free: OPENROUTER_MODEL_IDS.autoFree,
    explicitFallback: OPENROUTER_MODEL_IDS.qwen36Plus,
  },
} as const;

export const KNOWN_MODEL_LABELS: Record<string, string> = {
  claude: CURATED_MODEL_LABELS[PINNED_MODEL_DEFAULTS.claude.phase],
  codex: CURATED_MODEL_LABELS[PINNED_MODEL_DEFAULTS.codex.phase],
  openrouter: 'OpenRouter',
  ...CURATED_MODEL_LABELS,
  'anthropic/claude-sonnet-4-6': CURATED_MODEL_LABELS[OPENROUTER_MODEL_IDS.claudeSonnet46],
  [OPENROUTER_MODEL_IDS.claudeOpus46]: 'Claude Opus 4.6',
  'anthropic/claude-opus-4-6': 'Claude Opus 4.6',
  'openai/gpt-5-codex': 'GPT-5 Codex',
};

export function getKnownModelOptions(
  provider: ExecutorModel,
): ReadonlyArray<KnownModelOption<CuratedModelId>> {
  return KNOWN_MODEL_OPTIONS_BY_PROVIDER[provider];
}

export function getKnownModelLabel(modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  return KNOWN_MODEL_LABELS[modelId] ?? null;
}
