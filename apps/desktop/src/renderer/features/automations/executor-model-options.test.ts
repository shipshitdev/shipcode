import { describe, expect, it } from 'vitest';
import {
  executorModelPlaceholder,
  executorModelSuggestions,
  executorReasoningOptions,
} from './executor-model-options';

describe('executorModelSuggestions', () => {
  it('returns the OpenRouter catalog (incl. openrouter/auto) for openrouter', () => {
    const values = executorModelSuggestions('openrouter').map((o) => o.value);
    expect(values).toContain('openrouter/auto');
    expect(values.length).toBeGreaterThan(1);
  });

  it('returns Claude model ids for claude', () => {
    const suggestions = executorModelSuggestions('claude');
    const values = suggestions.map((o) => o.value);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
    expect(suggestions).toContainEqual({ value: 'opus', label: 'Opus (latest)' });
  });

  it('returns codex fallback ids for codex', () => {
    expect(executorModelSuggestions('codex').length).toBeGreaterThan(0);
  });

  it('returns no suggestions for inherit', () => {
    expect(executorModelSuggestions('inherit')).toEqual([]);
  });
});

describe('executorReasoningOptions', () => {
  const values = (provider: Parameters<typeof executorReasoningOptions>[0], modelId: string) =>
    executorReasoningOptions(provider, modelId).map((option) => option.value);

  it('keeps the full effort list when the provider is inherited', () => {
    expect(values('inherit', '')).toEqual([
      'inherit',
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('narrows Claude to its supported thinking budgets', () => {
    expect(values('claude', '')).toEqual(['inherit', 'none', 'medium', 'high']);
    expect(values('claude', 'claude-opus-4-8')).toEqual(['inherit', 'none', 'medium', 'high']);
  });

  it('never offers none for Fable 5, resolving shorthand aliases too', () => {
    expect(values('claude', 'claude-fable-5')).toEqual(['inherit', 'medium', 'high']);
    expect(values('claude', 'fable')).toEqual(['inherit', 'medium', 'high']);
  });

  it('offers the codex effort ladder for the GPT-5.6 family', () => {
    expect(values('codex', 'gpt-5.6-sol')).toEqual(['inherit', 'low', 'medium', 'high', 'xhigh']);
    expect(values('codex', 'sol')).toEqual(['inherit', 'low', 'medium', 'high', 'xhigh']);
    expect(values('codex', '')).toEqual(['inherit', 'low', 'medium', 'high', 'xhigh']);
  });

  it('respects OpenRouter per-model reasoning support', () => {
    expect(values('openrouter', 'qwen/qwen3-coder:free')).toEqual(['inherit', 'none']);
    expect(values('openrouter', 'anthropic/claude-opus-4.8')).toEqual(['inherit', 'none', 'high']);
  });

  it('keeps the form renderable for an incompatible free-form model id', () => {
    expect(values('openrouter', 'opus')).toEqual([
      'inherit',
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
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
