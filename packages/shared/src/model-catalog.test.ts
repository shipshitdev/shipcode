import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MODEL_OPTIONS,
  CLAUDE_ROLLING_MODEL_ALIASES,
  CODEX_FALLBACK_MODEL_OPTIONS,
  GEMINI_FALLBACK_MODEL_OPTIONS,
  getKnownModelLabel,
  GROK_FALLBACK_MODEL_OPTIONS,
  OPENROUTER_MODEL_IDS,
  OPENROUTER_MODEL_OPTIONS,
  PINNED_MODEL_DEFAULTS,
  resolveModelAlias,
} from './model-catalog';

describe('model-catalog', () => {
  it('keeps pinned defaults explicit and stable', () => {
    expect(PINNED_MODEL_DEFAULTS).toEqual({
      claude: {
        phase: 'claude-sonnet-4-6',
        prdRewrite: 'claude-sonnet-4-6',
        triage: 'claude-haiku-4-5-20251001',
      },
      codex: {
        phase: 'gpt-5.5',
        prdRewrite: 'gpt-5.4-mini',
        triage: 'gpt-5.4-mini',
      },
      gemini: {
        phase: 'gemini-2.5-pro',
      },
      cursor: {
        phase: 'auto',
      },
      grok: {
        phase: 'grok-4.5',
      },
      openrouter: {
        paid: 'openrouter/auto',
        free: 'openrouter/free',
        explicitFallback: 'qwen/qwen3.6-plus',
      },
    });
  });

  it('keeps Claude curated options and Codex fallback options separate', () => {
    expect(CLAUDE_MODEL_OPTIONS.map((option) => option.value)).toContain('claude-sonnet-4-6');
    expect(CODEX_FALLBACK_MODEL_OPTIONS.map((option) => option.value)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
    ]);
  });

  it('exposes Gemini fallback options and labels', () => {
    expect(GEMINI_FALLBACK_MODEL_OPTIONS.map((option) => option.value)).toEqual([
      'gemini-2.5-pro',
      'gemini-2.5-flash',
    ]);
    expect(getKnownModelLabel('gemini')).toBe('Gemini 2.5 Pro');
    expect(getKnownModelLabel('gemini-2.5-flash')).toBe('Gemini 2.5 Flash');
  });

  it('normalizes friendly labels for provider aliases and upstream slugs', () => {
    expect(getKnownModelLabel('claude')).toBe('Sonnet 4.6');
    expect(getKnownModelLabel('codex')).toBe('GPT-5.5');
    expect(getKnownModelLabel(OPENROUTER_MODEL_IDS.autoPaid)).toBe('Auto (paid)');
    expect(getKnownModelLabel('anthropic/claude-opus-4-6')).toBe('Claude Opus 4.6');
  });

  it('returns null for missing or unknown model ids', () => {
    expect(getKnownModelLabel(null)).toBeNull();
    expect(getKnownModelLabel(undefined)).toBeNull();
    expect(getKnownModelLabel('')).toBeNull();
    expect(getKnownModelLabel('provider/not-curated')).toBeNull();
  });

  it('exposes rolling Claude aliases alongside pinned Claude and OpenRouter options', () => {
    expect(CLAUDE_MODEL_OPTIONS).toContainEqual({ value: 'opus', label: 'Opus (latest)' });
    expect(getKnownModelLabel('opus')).toBe('Opus (latest)');
    expect(CLAUDE_MODEL_OPTIONS.map((option) => option.value)).toContain('claude-opus-4-8');
    expect(OPENROUTER_MODEL_OPTIONS.map((option) => option.value)).toContain(
      'anthropic/claude-opus-4.8',
    );
    expect(getKnownModelLabel('claude-opus-4-8')).toBe('Opus 4.8');
    expect(getKnownModelLabel('anthropic/claude-opus-4.8')).toBe('Claude Opus 4.8');
    expect(getKnownModelLabel('anthropic/claude-opus-4-8')).toBe('Claude Opus 4.8');
  });

  it('exposes Fable 5 as a selectable Claude option', () => {
    expect(CLAUDE_MODEL_OPTIONS.map((option) => option.value)).toContain('claude-fable-5');
    expect(getKnownModelLabel('claude-fable-5')).toBe('Fable 5');
  });

  it('exposes the GPT-5.6 family as selectable Codex fallback options', () => {
    expect(getKnownModelLabel('gpt-5.6-sol')).toBe('GPT-5.6 Sol');
    expect(getKnownModelLabel('gpt-5.6-terra')).toBe('GPT-5.6 Terra');
    expect(getKnownModelLabel('gpt-5.6-luna')).toBe('GPT-5.6 Luna');
  });

  it('exposes Grok 4.5 as a selectable Grok fallback option', () => {
    expect(GROK_FALLBACK_MODEL_OPTIONS.map((option) => option.value)).toEqual(['grok-4.5']);
    expect(getKnownModelLabel('grok-4.5')).toBe('Grok 4.5');
  });

  describe('resolveModelAlias', () => {
    it('preserves normalized rolling family aliases only for Claude CLI', () => {
      for (const alias of Object.values(CLAUDE_ROLLING_MODEL_ALIASES)) {
        expect(resolveModelAlias('claude', `  ${alias.toUpperCase()}  `)).toBe(alias);
      }
    });

    it('resolves versioned Claude shorthands to concrete model IDs', () => {
      expect(resolveModelAlias('claude', 'opus-4.8')).toBe('claude-opus-4-8');
      expect(resolveModelAlias('claude', 'sonnet-4.6')).toBe('claude-sonnet-4-6');
      expect(resolveModelAlias('claude', 'haiku-4.5')).toBe('claude-haiku-4-5-20251001');
      expect(resolveModelAlias('claude', 'fable-5')).toBe('claude-fable-5');
      expect(resolveModelAlias('claude', 'fable5')).toBe('claude-fable-5');
    });

    it('keeps Codex family shorthand canonicalization unchanged', () => {
      expect(resolveModelAlias('codex', '5.5')).toBe('gpt-5.5');
      expect(resolveModelAlias('codex', '5.4-mini')).toBe('gpt-5.4-mini');
      // Bare 5.6 routes to Sol, the flagship tier, matching upstream behavior.
      expect(resolveModelAlias('codex', '5.6')).toBe('gpt-5.6-sol');
      expect(resolveModelAlias('codex', 'gpt-5.6')).toBe('gpt-5.6-sol');
      expect(resolveModelAlias('codex', 'sol')).toBe('gpt-5.6-sol');
      expect(resolveModelAlias('codex', '5.6-sol')).toBe('gpt-5.6-sol');
      expect(resolveModelAlias('codex', 'terra')).toBe('gpt-5.6-terra');
      expect(resolveModelAlias('codex', '5.6-terra')).toBe('gpt-5.6-terra');
      expect(resolveModelAlias('codex', 'luna')).toBe('gpt-5.6-luna');
      expect(resolveModelAlias('codex', '5.6-luna')).toBe('gpt-5.6-luna');
    });

    it('resolves Grok shorthands', () => {
      expect(resolveModelAlias('grok', 'grok')).toBe('grok-4.5');
      expect(resolveModelAlias('grok', 'grok-4.5')).toBe('grok-4.5');
      expect(resolveModelAlias('grok', 'grok4.5')).toBe('grok-4.5');
      expect(resolveModelAlias('grok', 'GROK')).toBe('grok-4.5');
    });

    it('rejects rolling Claude aliases for OpenRouter and other providers', () => {
      expect(() => resolveModelAlias('openrouter', 'opus')).toThrow(
        'opus is a rolling Claude CLI alias',
      );
      expect(() => resolveModelAlias('codex', 'sonnet')).toThrow(
        'sonnet is a rolling Claude CLI alias',
      );
    });

    it('passes already-canonical ids through unchanged', () => {
      expect(resolveModelAlias('claude', 'claude-opus-4-8')).toBe('claude-opus-4-8');
      expect(resolveModelAlias('openrouter', 'openrouter/auto')).toBe('openrouter/auto');
    });

    it('returns null for nullish or blank input', () => {
      expect(resolveModelAlias('claude', null)).toBeNull();
      expect(resolveModelAlias('claude', undefined)).toBeNull();
      expect(resolveModelAlias('claude', '   ')).toBeNull();
    });
  });
});
