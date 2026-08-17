import type { ExecutorModel, PhaseCliProvider } from './types/agents';

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

export const CLAUDE_ROLLING_MODEL_ALIASES = {
  opus: 'opus',
  sonnet: 'sonnet',
  haiku: 'haiku',
  fable: 'fable',
} as const;

export type ClaudeRollingModelAlias =
  (typeof CLAUDE_ROLLING_MODEL_ALIASES)[keyof typeof CLAUDE_ROLLING_MODEL_ALIASES];
export type ClaudeModelSelection = ClaudeModelId | ClaudeRollingModelAlias;

export const CLAUDE_ROLLING_MODEL_OPTIONS = [
  { value: CLAUDE_ROLLING_MODEL_ALIASES.opus, label: 'Opus (latest)' },
  { value: CLAUDE_ROLLING_MODEL_ALIASES.sonnet, label: 'Sonnet (latest)' },
  { value: CLAUDE_ROLLING_MODEL_ALIASES.haiku, label: 'Haiku (latest)' },
  { value: CLAUDE_ROLLING_MODEL_ALIASES.fable, label: 'Fable (latest)' },
] as const satisfies readonly KnownModelOption<ClaudeRollingModelAlias>[];

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

// Every slug here must appear verbatim in `GET https://openrouter.ai/api/v1/models`.
// OpenRouter uses dot-separated versions (`claude-opus-4.8`), unlike the dash-separated
// Anthropic CLI IDs, and it does not alias one spelling to the other — a wrong spelling
// is a hard 404 mid-run. `checkOpenRouterHealth` in packages/agents/src/health-check.ts
// scans the live catalog for the configured slug and reports `model_deprecated`, so a
// guessed entry surfaces as a broken preset rather than a caught mistake. Verify against
// the live list before adding, and never transcribe an ID from memory.
//
// The rule covers this table and OPENROUTER_MODEL_OPTIONS, which are *offers* — a slug here
// is one ShipCode invites a user to run. It deliberately does not cover KNOWN_MODEL_LABELS,
// whose extra keys are display-only tolerance for ids a user may already have saved or may
// paste by hand; see the comment there.
//
// Every entry below was re-verified against the live catalog on 2026-08-17 (414 models).
// `qwen/qwen3-coder:free` was removed in that pass: OpenRouter no longer serves it.
export const OPENROUTER_MODEL_IDS = {
  autoPaid: 'openrouter/auto',
  autoFree: 'openrouter/free',
  claudeSonnet46: 'anthropic/claude-sonnet-4.6',
  claudeOpus46: 'anthropic/claude-opus-4.6',
  claudeOpus48: 'anthropic/claude-opus-4.8',
  claudeFable5: 'anthropic/claude-fable-5',
  gpt56Sol: 'openai/gpt-5.6-sol',
  gpt56Terra: 'openai/gpt-5.6-terra',
  gpt56Luna: 'openai/gpt-5.6-luna',
  qwen36Plus: 'qwen/qwen3.6-plus',
} as const;

export type OpenRouterModelId = (typeof OPENROUTER_MODEL_IDS)[keyof typeof OPENROUTER_MODEL_IDS];

export const CLAUDE_MODEL_OPTIONS = [
  ...CLAUDE_ROLLING_MODEL_OPTIONS,
  { value: CLAUDE_MODEL_IDS.sonnet46, label: 'Sonnet 4.6' },
  { value: CLAUDE_MODEL_IDS.opus46, label: 'Opus 4.6' },
  { value: CLAUDE_MODEL_IDS.opus47, label: 'Opus 4.7' },
  { value: CLAUDE_MODEL_IDS.opus48, label: 'Opus 4.8' },
  { value: CLAUDE_MODEL_IDS.fable5, label: 'Fable 5' },
  { value: CLAUDE_MODEL_IDS.haiku45, label: 'Haiku 4.5' },
] as const satisfies readonly KnownModelOption<ClaudeModelSelection>[];

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
  { value: OPENROUTER_MODEL_IDS.claudeFable5, label: 'Claude Fable 5' },
  { value: OPENROUTER_MODEL_IDS.gpt56Sol, label: 'GPT-5.6 Sol' },
  { value: OPENROUTER_MODEL_IDS.gpt56Terra, label: 'GPT-5.6 Terra' },
  { value: OPENROUTER_MODEL_IDS.gpt56Luna, label: 'GPT-5.6 Luna' },
  { value: OPENROUTER_MODEL_IDS.qwen36Plus, label: 'Qwen 3.6 Plus' },
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
    phase: CLAUDE_MODEL_IDS.fable5,
    prdRewrite: CLAUDE_MODEL_IDS.sonnet46,
    triage: CLAUDE_MODEL_IDS.haiku45,
  },
  codex: {
    phase: CODEX_FALLBACK_MODEL_IDS.gpt56Sol,
    prdRewrite: CODEX_FALLBACK_MODEL_IDS.gpt56Luna,
    triage: CODEX_FALLBACK_MODEL_IDS.gpt56Luna,
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
  // The dash-spelled `anthropic/...-4-6` / `-4-8` keys below are deliberate tolerance
  // aliases, not duplicates: OpenRouter serves the dotted spelling (which arrives via the
  // CURATED_MODEL_LABELS spread) while Anthropic's own CLI IDs are dash-separated, so users
  // paste both. Only slugs whose version segment contains a dot need a dash twin — hence
  // nothing here for `anthropic/claude-fable-5` (no dotted segment) or the
  // `openai/gpt-5.6-*` tiers (Codex publishes those dotted too, so the dotted form is what
  // users type).
  //
  // These keys are exempt from the live-catalog rule that governs OPENROUTER_MODEL_IDS, and
  // several of them are not served by OpenRouter at all (the dash spellings never were;
  // `openai/gpt-5-codex` was delisted). That is fine — a label is not an offer. Its only job
  // is to render a friendly name for an id a user already has saved or types by hand, and a
  // model going away is exactly when someone is most likely to be holding a stale id and
  // least served by seeing a raw slug. Removing a label breaks that reader without
  // un-breaking the model, so labels outlive their models on purpose.
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
// exact id. Keys are matched case-insensitively. Bare Claude family names are
// handled separately because they are rolling aliases only for Claude CLI.
//
// This table is intentionally single-namespace, so it resolves to CLI ids only: `fable-5`
// yields `claude-fable-5` and `sol` yields `gpt-5.6-sol` for every provider, including
// OpenRouter, where neither is a valid slug. OpenRouter selections must therefore be typed
// vendor-prefixed (`anthropic/claude-fable-5`, `openai/gpt-5.6-sol`) and are offered
// verbatim in OPENROUTER_MODEL_OPTIONS. Adding OpenRouter twins here would need a
// provider-scoped table — a bare `fable-5` cannot mean both ids at once.
export const MODEL_SLUG_ALIASES: Record<string, string> = {
  'opus-4.8': CLAUDE_MODEL_IDS.opus48,
  'opus4.8': CLAUDE_MODEL_IDS.opus48,
  'opus-4.7': CLAUDE_MODEL_IDS.opus47,
  'opus-4.6': CLAUDE_MODEL_IDS.opus46,
  'sonnet-4.6': CLAUDE_MODEL_IDS.sonnet46,
  'fable-5': CLAUDE_MODEL_IDS.fable5,
  fable5: CLAUDE_MODEL_IDS.fable5,
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

const CLAUDE_ROLLING_ALIAS_SET = new Set<string>(Object.values(CLAUDE_ROLLING_MODEL_ALIASES));

export function isClaudeRollingModelAlias(value: string | null | undefined): boolean {
  return value != null && CLAUDE_ROLLING_ALIAS_SET.has(value.trim().toLowerCase());
}

/**
 * Normalize a user-typed model value for its provider.
 *
 * Bare Claude family aliases remain rolling only for Claude CLI. Other
 * shorthands resolve to concrete IDs. A rolling Claude alias is rejected for
 * every other provider so it can never leak into an OpenRouter request.
 */
export function resolveModelAlias(
  provider: ExecutorModel,
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  if (CLAUDE_ROLLING_ALIAS_SET.has(normalized)) {
    if (provider === 'claude') return normalized;
    throw new Error(
      `${normalized} is a rolling Claude CLI alias and cannot be used with ${provider}. Choose a concrete ${provider} model ID.`,
    );
  }
  return MODEL_SLUG_ALIASES[normalized] ?? trimmed;
}
