import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MODEL_OPTIONS,
  CODEX_FALLBACK_MODEL_OPTIONS,
  GEMINI_FALLBACK_MODEL_OPTIONS,
  getKnownModelLabel,
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

  it('exposes Opus 4.8 as a selectable Claude and OpenRouter option', () => {
    expect(CLAUDE_MODEL_OPTIONS.map((option) => option.value)).toContain('claude-opus-4-8');
    expect(OPENROUTER_MODEL_OPTIONS.map((option) => option.value)).toContain(
      'anthropic/claude-opus-4.8',
    );
    expect(getKnownModelLabel('claude-opus-4-8')).toBe('Opus 4.8');
    expect(getKnownModelLabel('anthropic/claude-opus-4.8')).toBe('Claude Opus 4.8');
    expect(getKnownModelLabel('anthropic/claude-opus-4-8')).toBe('Claude Opus 4.8');
  });

  describe('resolveModelAlias', () => {
    it('resolves bare family shorthands to the pinned generation', () => {
      expect(resolveModelAlias('opus')).toBe('claude-opus-4-8');
      expect(resolveModelAlias('sonnet')).toBe('claude-sonnet-4-6');
      expect(resolveModelAlias('haiku')).toBe('claude-haiku-4-5-20251001');
      expect(resolveModelAlias('5.5')).toBe('gpt-5.5');
      expect(resolveModelAlias('5.4-mini')).toBe('gpt-5.4-mini');
    });

    it('is case-insensitive and trims whitespace', () => {
      expect(resolveModelAlias('  OPUS  ')).toBe('claude-opus-4-8');
    });

    it('passes already-canonical ids through unchanged', () => {
      expect(resolveModelAlias('claude-opus-4-8')).toBe('claude-opus-4-8');
      expect(resolveModelAlias('openrouter/auto')).toBe('openrouter/auto');
    });

    it('returns null for nullish or blank input', () => {
      expect(resolveModelAlias(null)).toBeNull();
      expect(resolveModelAlias(undefined)).toBeNull();
      expect(resolveModelAlias('   ')).toBeNull();
    });
  });
});
