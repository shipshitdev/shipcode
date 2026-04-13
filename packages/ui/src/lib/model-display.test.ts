import { describe, expect, it } from 'vitest';
import { modelDisplay } from './model-display';

describe('modelDisplay', () => {
  it('returns friendly labels for known model keys', () => {
    expect(modelDisplay('claude')).toBe('sonnet 4.6');
    expect(modelDisplay('codex')).toBe('gpt 5.4');
    expect(modelDisplay('claude-opus-4-6')).toBe('opus 4.6');
  });

  it('falls back to the raw model id for unknown entries', () => {
    expect(modelDisplay('openrouter/auto')).toBe('openrouter/auto');
  });
});
