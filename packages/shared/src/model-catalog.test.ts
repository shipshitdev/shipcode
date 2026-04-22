import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MODEL_OPTIONS,
  CODEX_MODEL_OPTIONS,
  getKnownModelLabel,
  getKnownModelOptions,
  OPENROUTER_MODEL_IDS,
  OPENROUTER_MODEL_OPTIONS,
  PINNED_MODEL_DEFAULTS,
} from './model-catalog';

describe('model-catalog', () => {
  it('keeps pinned defaults explicit and stable', () => {
    expect(PINNED_MODEL_DEFAULTS).toEqual({
      claude: {
        phase: 'claude-sonnet-4-6',
        prdRewrite: 'claude-sonnet-4-6',
      },
      codex: {
        phase: 'gpt-5.4',
        prdRewrite: 'gpt-5.4-mini',
      },
      openrouter: {
        paid: 'openrouter/auto',
        free: 'openrouter/free',
        explicitFallback: 'qwen/qwen3.6-plus',
      },
    });
  });

  it('returns curated provider options from the shared registry', () => {
    expect(getKnownModelOptions('claude')).toEqual(CLAUDE_MODEL_OPTIONS);
    expect(getKnownModelOptions('codex')).toEqual(CODEX_MODEL_OPTIONS);
    expect(getKnownModelOptions('openrouter')).toEqual(OPENROUTER_MODEL_OPTIONS);
  });

  it('normalizes friendly labels for provider aliases and upstream slugs', () => {
    expect(getKnownModelLabel('claude')).toBe('Sonnet 4.6');
    expect(getKnownModelLabel('codex')).toBe('GPT-5.4');
    expect(getKnownModelLabel(OPENROUTER_MODEL_IDS.autoPaid)).toBe('Auto (paid)');
    expect(getKnownModelLabel('anthropic/claude-opus-4-6')).toBe('Claude Opus 4.6');
  });
});
