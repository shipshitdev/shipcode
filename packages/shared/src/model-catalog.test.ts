import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MODEL_OPTIONS,
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
        phase: 'claude-fable-5',
        prdRewrite: 'claude-sonnet-4-6',
        triage: 'claude-haiku-4-5-20251001',
      },
      codex: {
        phase: 'gpt-5.6-sol',
        prdRewrite: 'gpt-5.6-luna',
        triage: 'gpt-5.6-luna',
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
    expect(getKnownModelLabel('claude')).toBe('Fable 5');
    expect(getKnownModelLabel('codex')).toBe('GPT-5.6 Sol');
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
    it('resolves bare family shorthands to the pinned generation', () => {
      expect(resolveModelAlias('opus')).toBe('claude-opus-4-8');
      expect(resolveModelAlias('sonnet')).toBe('claude-sonnet-4-6');
      expect(resolveModelAlias('haiku')).toBe('claude-haiku-4-5-20251001');
      expect(resolveModelAlias('5.5')).toBe('gpt-5.5');
      expect(resolveModelAlias('5.4-mini')).toBe('gpt-5.4-mini');
    });

    it('resolves Fable 5 and GPT-5.6 family shorthands', () => {
      expect(resolveModelAlias('fable')).toBe('claude-fable-5');
      expect(resolveModelAlias('fable-5')).toBe('claude-fable-5');
      expect(resolveModelAlias('fable5')).toBe('claude-fable-5');
      // Bare 5.6 routes to Sol, the flagship tier, matching upstream behavior.
      expect(resolveModelAlias('5.6')).toBe('gpt-5.6-sol');
      expect(resolveModelAlias('gpt-5.6')).toBe('gpt-5.6-sol');
      expect(resolveModelAlias('sol')).toBe('gpt-5.6-sol');
      expect(resolveModelAlias('5.6-sol')).toBe('gpt-5.6-sol');
      expect(resolveModelAlias('terra')).toBe('gpt-5.6-terra');
      expect(resolveModelAlias('5.6-terra')).toBe('gpt-5.6-terra');
      expect(resolveModelAlias('luna')).toBe('gpt-5.6-luna');
      expect(resolveModelAlias('5.6-luna')).toBe('gpt-5.6-luna');
    });

    it('resolves Grok shorthands', () => {
      expect(resolveModelAlias('grok')).toBe('grok-4.5');
      expect(resolveModelAlias('grok-4.5')).toBe('grok-4.5');
      expect(resolveModelAlias('grok4.5')).toBe('grok-4.5');
      expect(resolveModelAlias('GROK')).toBe('grok-4.5');
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
