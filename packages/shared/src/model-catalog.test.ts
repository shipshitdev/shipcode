import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MODEL_OPTIONS,
  CODEX_FALLBACK_MODEL_OPTIONS,
  getKnownModelLabel,
  OPENROUTER_MODEL_IDS,
  PINNED_MODEL_DEFAULTS,
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

  it('normalizes friendly labels for provider aliases and upstream slugs', () => {
    expect(getKnownModelLabel('claude')).toBe('Sonnet 4.6');
    expect(getKnownModelLabel('codex')).toBe('GPT-5.5');
    expect(getKnownModelLabel(OPENROUTER_MODEL_IDS.autoPaid)).toBe('Auto (paid)');
    expect(getKnownModelLabel('anthropic/claude-opus-4-6')).toBe('Claude Opus 4.6');
  });
});
