import type { PhaseCliProvider } from './types/agents';

export interface KnownModelOption<T extends string = string> {
  value: T;
  label: string;
}

export const CLAUDE_MODEL_IDS = {
  sonnet46: 'claude-sonnet-4-6',
  opus46: 'claude-opus-4-6',
  opus47: 'claude-opus-4-7',
  opus48: 'claude-opus-4-8',
  fable5: 'claude-fable-5',
  haiku45: 'claude-haiku-4-5-20251001',
} as const;

export type ClaudeModelId = (typeof CLAUDE_MODEL_IDS)[keyof typeof CLAUDE_MODEL_IDS];

export const CODEX_FALLBACK_MODEL_IDS = {
  gpt56Sol: 'gpt-5.6-sol',
  gpt56Terra: 'gpt-5.6-terra',
  gpt56Luna: 'gpt-5.6-luna',
  gpt55: 'gpt-5.5',
  gpt54: 'gpt-5.4',
  gpt54Mini: 'gpt-5.4-mini',
} as const;

export type CodexFallbackModelId =
  (typeof CODEX_FALLBACK_MODEL_IDS)[keyof typeof CODEX_FALLBACK_MODEL_IDS];

export const GEMINI_FALLBACK_MODEL_IDS = {
  pro: 'gemini-2.5-pro',
  flash: 'gemini-2.5-flash',
} as const;

export type GeminiFallbackModelId =
  (typeof GEMINI_FALLBACK_MODEL_IDS)[keyof typeof GEMINI_FALLBACK_MODEL_IDS];

// Cursor routes to an underlying model; ShipCode exposes only `auto` and lets
// Cursor pick. Kept as a single-entry catalog to mirror the other providers.
export const CURSOR_FALLBACK_MODEL_IDS = {
  auto: 'auto',
} as const;

export type CursorFallbackModelId =
  (typeof CURSOR_FALLBACK_MODEL_IDS)[keyof typeof CURSOR_FALLBACK_MODEL_IDS];

// Grok Build (xAI's terminal agent) selects its model via `--model`. Grok 4.5
// is the CLI's default; these are conservative fallbacks for the picker.
export const GROK_FALLBACK_MODEL_IDS = {
  grok45: 'grok-4.5',
} as const;

export type GrokFallbackModelId =
  (typeof GROK_FALLBACK_MODEL_IDS)[keyof typeof GROK_FALLBACK_MODEL_IDS];

export const OPENROUTER_MODEL_IDS = {
  autoPaid: 'openrouter/auto',
  autoFree: 'openrouter/free',
  claudeSonnet46: 'anthropic/claude-sonnet-4.6',
  claudeOpus46: 'anthropic/claude-opus-4.6',
  claudeOpus48: 'anthropic/claude-opus-4.8',
  qwen36Plus: 'qwen/qwen3.6-plus',
  qwen3CoderFree: 'qwen/qwen3-coder:free',
} as const;

export type OpenRouterModelId = (typeof OPENROUTER_MODEL_IDS)[keyof typeof OPENROUTER_MODEL_IDS];

export const CLAUDE_MODEL_OPTIONS = [
  { value: CLAUDE_MODEL_IDS.sonnet46, label: 'Sonnet 4.6' },
  { value: CLAUDE_MODEL_IDS.opus46, label: 'Opus 4.6' },
  { value: CLAUDE_MODEL_IDS.opus47, label: 'Opus 4.7' },
  { value: CLAUDE_MODEL_IDS.opus48, label: 'Opus 4.8' },
  { value: CLAUDE_MODEL_IDS.fable5, label: 'Fable 5' },
  { value: CLAUDE_MODEL_IDS.haiku45, label: 'Haiku 4.5' },
] as const satisfies readonly KnownModelOption<ClaudeModelId>[];

// Codex publishes the real model catalog via `codex debug models`. These are
// conservative fallbacks only, used when an old CLI cannot report capabilities.
export const CODEX_FALLBACK_MODEL_OPTIONS = [
  { value: CODEX_FALLBACK_MODEL_IDS.gpt56Sol, label: 'GPT-5.6 Sol' },
  { value: CODEX_FALLBACK_MODEL_IDS.gpt56Terra, label: 'GPT-5.6 Terra' },
  { value: CODEX_FALLBACK_MODEL_IDS.gpt56Luna, label: 'GPT-5.6 Luna' },
  { value: CODEX_FALLBACK_MODEL_IDS.gpt55, label: 'GPT-5.5' },
  { value: CODEX_FALLBACK_MODEL_IDS.gpt54, label: 'GPT-5.4' },
  { value: CODEX_FALLBACK_MODEL_IDS.gpt54Mini, label: 'GPT-5.4 Mini' },
] as const satisfies readonly KnownModelOption<CodexFallbackModelId>[];

export const GEMINI_FALLBACK_MODEL_OPTIONS = [
  { value: GEMINI_FALLBACK_MODEL_IDS.pro, label: 'Gemini 2.5 Pro' },
  { value: GEMINI_FALLBACK_MODEL_IDS.flash, label: 'Gemini 2.5 Flash' },
] as const satisfies readonly KnownModelOption<GeminiFallbackModelId>[];

export const CURSOR_FALLBACK_MODEL_OPTIONS = [
  { value: CURSOR_FALLBACK_MODEL_IDS.auto, label: 'Auto' },
] as const satisfies readonly KnownModelOption<CursorFallbackModelId>[];

export const GROK_FALLBACK_MODEL_OPTIONS = [
  { value: GROK_FALLBACK_MODEL_IDS.grok45, label: 'Grok 4.5' },
] as const satisfies readonly KnownModelOption<GrokFallbackModelId>[];

export const OPENROUTER_MODEL_OPTIONS = [
  { value: OPENROUTER_MODEL_IDS.autoPaid, label: 'Auto (paid)' },
  { value: OPENROUTER_MODEL_IDS.autoFree, label: 'Auto (free)' },
  { value: OPENROUTER_MODEL_IDS.claudeSonnet46, label: 'Claude Sonnet 4.6' },
  { value: OPENROUTER_MODEL_IDS.claudeOpus48, label: 'Claude Opus 4.8' },
  { value: OPENROUTER_MODEL_IDS.qwen36Plus, label: 'Qwen 3.6 Plus' },
  { value: OPENROUTER_MODEL_IDS.qwen3CoderFree, label: 'Qwen 3 Coder Free' },
] as const satisfies readonly KnownModelOption<OpenRouterModelId>[];

// Human-readable CLI names surfaced in availability / reasoning-effort warnings.
// Keyed by PhaseCliProvider so adding a provider is a compile error until a
// label is supplied here rather than a silently-wrong fallback elsewhere.
export const CLI_PROVIDER_LABELS: Record<PhaseCliProvider, string> = {
  claude: 'Claude CLI',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  cursor: 'Cursor CLI',
  grok: 'Grok CLI',
};

// Conservative model presets used when a CLI cannot report its own catalog.
// Keyed by PhaseCliProvider for the same exhaustiveness guarantee as the labels.
export const CLI_PROVIDER_FALLBACK_OPTIONS: Record<PhaseCliProvider, readonly KnownModelOption[]> =
  {
    claude: CLAUDE_MODEL_OPTIONS,
    codex: CODEX_FALLBACK_MODEL_OPTIONS,
    gemini: GEMINI_FALLBACK_MODEL_OPTIONS,
    cursor: CURSOR_FALLBACK_MODEL_OPTIONS,
    grok: GROK_FALLBACK_MODEL_OPTIONS,
  };

export type CuratedModelId =
  | (typeof CLAUDE_MODEL_OPTIONS)[number]['value']
  | (typeof CODEX_FALLBACK_MODEL_OPTIONS)[number]['value']
  | (typeof GEMINI_FALLBACK_MODEL_OPTIONS)[number]['value']
  | (typeof CURSOR_FALLBACK_MODEL_OPTIONS)[number]['value']
  | (typeof GROK_FALLBACK_MODEL_OPTIONS)[number]['value']
  | (typeof OPENROUTER_MODEL_OPTIONS)[number]['value'];

const CURATED_MODEL_LABELS = Object.fromEntries(
  [
    ...CLAUDE_MODEL_OPTIONS,
    ...CODEX_FALLBACK_MODEL_OPTIONS,
    ...GEMINI_FALLBACK_MODEL_OPTIONS,
    ...CURSOR_FALLBACK_MODEL_OPTIONS,
    ...GROK_FALLBACK_MODEL_OPTIONS,
    ...OPENROUTER_MODEL_OPTIONS,
  ].map((option) => [option.value, option.label]),
) as Record<CuratedModelId, string>;

export const PINNED_MODEL_DEFAULTS = {
  claude: {
    phase: CLAUDE_MODEL_IDS.sonnet46,
    prdRewrite: CLAUDE_MODEL_IDS.sonnet46,
    triage: CLAUDE_MODEL_IDS.haiku45,
  },
  codex: {
    phase: CODEX_FALLBACK_MODEL_IDS.gpt55,
    prdRewrite: CODEX_FALLBACK_MODEL_IDS.gpt54Mini,
    triage: CODEX_FALLBACK_MODEL_IDS.gpt54Mini,
  },
  gemini: {
    phase: GEMINI_FALLBACK_MODEL_IDS.pro,
  },
  cursor: {
    phase: CURSOR_FALLBACK_MODEL_IDS.auto,
  },
  grok: {
    phase: GROK_FALLBACK_MODEL_IDS.grok45,
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
  gemini: CURATED_MODEL_LABELS[PINNED_MODEL_DEFAULTS.gemini.phase],
  cursor: CURATED_MODEL_LABELS[PINNED_MODEL_DEFAULTS.cursor.phase],
  grok: CURATED_MODEL_LABELS[PINNED_MODEL_DEFAULTS.grok.phase],
  openrouter: 'OpenRouter',
  ...CURATED_MODEL_LABELS,
  'anthropic/claude-sonnet-4-6': CURATED_MODEL_LABELS[OPENROUTER_MODEL_IDS.claudeSonnet46],
  [OPENROUTER_MODEL_IDS.claudeOpus46]: 'Claude Opus 4.6',
  'anthropic/claude-opus-4-6': 'Claude Opus 4.6',
  'anthropic/claude-opus-4-8': 'Claude Opus 4.8',
  'openai/gpt-5-codex': 'GPT-5 Codex',
};

export function getKnownModelLabel(modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  return KNOWN_MODEL_LABELS[modelId] ?? null;
}

// Human-friendly shorthands a user can type in a model field instead of an
// exact id. Normalized at the input boundary so everything downstream sees a
// canonical id. Keys are matched case-insensitively. Bare family names
// (`opus`/`sonnet`/`haiku`) resolve to the current pinned generation.
export const MODEL_SLUG_ALIASES: Record<string, string> = {
  opus: CLAUDE_MODEL_IDS.opus48,
  'opus-4.8': CLAUDE_MODEL_IDS.opus48,
  'opus4.8': CLAUDE_MODEL_IDS.opus48,
  'opus-4.7': CLAUDE_MODEL_IDS.opus47,
  'opus-4.6': CLAUDE_MODEL_IDS.opus46,
  sonnet: CLAUDE_MODEL_IDS.sonnet46,
  'sonnet-4.6': CLAUDE_MODEL_IDS.sonnet46,
  fable: CLAUDE_MODEL_IDS.fable5,
  'fable-5': CLAUDE_MODEL_IDS.fable5,
  fable5: CLAUDE_MODEL_IDS.fable5,
  haiku: CLAUDE_MODEL_IDS.haiku45,
  'haiku-4.5': CLAUDE_MODEL_IDS.haiku45,
  grok: GROK_FALLBACK_MODEL_IDS.grok45,
  'grok-4.5': GROK_FALLBACK_MODEL_IDS.grok45,
  'grok4.5': GROK_FALLBACK_MODEL_IDS.grok45,
  // Bare 5.6 routes to Sol (the flagship tier) upstream.
  '5.6': CODEX_FALLBACK_MODEL_IDS.gpt56Sol,
  'gpt-5.6': CODEX_FALLBACK_MODEL_IDS.gpt56Sol,
  '5.6-sol': CODEX_FALLBACK_MODEL_IDS.gpt56Sol,
  sol: CODEX_FALLBACK_MODEL_IDS.gpt56Sol,
  '5.6-terra': CODEX_FALLBACK_MODEL_IDS.gpt56Terra,
  terra: CODEX_FALLBACK_MODEL_IDS.gpt56Terra,
  '5.6-luna': CODEX_FALLBACK_MODEL_IDS.gpt56Luna,
  luna: CODEX_FALLBACK_MODEL_IDS.gpt56Luna,
  '5.5': CODEX_FALLBACK_MODEL_IDS.gpt55,
  '5.4': CODEX_FALLBACK_MODEL_IDS.gpt54,
  '5.4-mini': CODEX_FALLBACK_MODEL_IDS.gpt54Mini,
  mini: CODEX_FALLBACK_MODEL_IDS.gpt54Mini,
};

/**
 * Resolve a user-typed model shorthand to its canonical id. Unknown values
 * (including already-canonical ids) are trimmed and returned unchanged.
 * Returns null only for nullish/blank input.
 */
export function resolveModelAlias(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return MODEL_SLUG_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}
