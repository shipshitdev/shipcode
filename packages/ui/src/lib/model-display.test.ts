import { describe, expect, it } from 'vitest';
import { formatProviderModelDisplay, modelDisplay } from './model-display';

describe('modelDisplay', () => {
  it('returns friendly labels for known model keys', () => {
    expect(modelDisplay('claude')).toBe('Sonnet 4.6');
    expect(modelDisplay('codex')).toBe('GPT-5.5');
    expect(modelDisplay('claude-opus-4-6')).toBe('Opus 4.6');
  });

  it('falls back to the raw model id for unknown entries', () => {
    expect(modelDisplay('openrouter/auto')).toBe('Auto (paid)');
  });

  it('formats provider and model together for live UI surfaces', () => {
    expect(formatProviderModelDisplay('claude', 'claude')).toBe('Claude / Sonnet 4.6');
    expect(formatProviderModelDisplay('codex', 'gpt-5.4')).toBe('Codex / GPT-5.4');
  });
});
