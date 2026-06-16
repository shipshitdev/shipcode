import { describe, expect, it } from 'vitest';
import { executorModelPlaceholder, executorModelSuggestions } from './executor-model-options';

describe('executorModelSuggestions', () => {
  it('returns the OpenRouter catalog (incl. openrouter/auto) for openrouter', () => {
    const values = executorModelSuggestions('openrouter').map((o) => o.value);
    expect(values).toContain('openrouter/auto');
    expect(values.length).toBeGreaterThan(1);
  });

  it('returns Claude model ids for claude', () => {
    const values = executorModelSuggestions('claude').map((o) => o.value);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
  });

  it('returns codex fallback ids for codex', () => {
    expect(executorModelSuggestions('codex').length).toBeGreaterThan(0);
  });

  it('returns no suggestions for inherit', () => {
    expect(executorModelSuggestions('inherit')).toEqual([]);
  });
});

describe('executorModelPlaceholder', () => {
  it('hints openrouter/auto for openrouter', () => {
    expect(executorModelPlaceholder('openrouter')).toContain('openrouter/auto');
  });

  it('differs per provider and gives an inherit hint', () => {
    expect(executorModelPlaceholder('claude')).not.toBe(executorModelPlaceholder('codex'));
    expect(executorModelPlaceholder('inherit').toLowerCase()).toContain('inherit');
  });
});
