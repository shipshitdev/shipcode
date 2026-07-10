import { describe, expect, it } from 'vitest';
import {
  formatProviderModelDisplay,
  formatResolvedModelDisplay,
  inferProviderFromModel,
  modelDisplay,
  providerDisplay,
} from './model-display';

describe('modelDisplay', () => {
  it('returns friendly labels for known model keys', () => {
    expect(modelDisplay('claude')).toBe('Sonnet 4.6');
    expect(modelDisplay('codex')).toBe('GPT-5.5');
    expect(modelDisplay('claude-opus-4-6')).toBe('Opus 4.6');
    expect(modelDisplay('claude-fable-5')).toBe('Fable 5');
    expect(modelDisplay('gpt-5.6-sol')).toBe('GPT-5.6 Sol');
    expect(modelDisplay('gpt-5.6-terra')).toBe('GPT-5.6 Terra');
    expect(modelDisplay('gpt-5.6-luna')).toBe('GPT-5.6 Luna');
  });

  it('falls back to the raw model id for unknown entries', () => {
    expect(modelDisplay('custom/model')).toBe('custom/model');
  });
});

describe('inferProviderFromModel', () => {
  it('detects providers from aliases and model ids', () => {
    expect(inferProviderFromModel('claude')).toBe('claude');
    expect(inferProviderFromModel(undefined, '<synthetic>', '  ', 'claude-opus-4-6')).toBe(
      'claude',
    );
    expect(inferProviderFromModel('claude-fable-5')).toBe('claude');
    expect(inferProviderFromModel('gpt-5.4')).toBe('codex');
    expect(inferProviderFromModel('gpt-5.6-sol')).toBe('codex');
    expect(inferProviderFromModel('codex')).toBe('codex');
    expect(inferProviderFromModel('gemini')).toBe('gemini');
    expect(inferProviderFromModel('gemini-2.5-pro')).toBe('gemini');
    expect(inferProviderFromModel('openrouter')).toBe('openrouter');
    expect(inferProviderFromModel('openrouter/free')).toBe('openrouter');
    expect(inferProviderFromModel('anthropic/claude-sonnet-4.6')).toBe('openrouter');
    expect(inferProviderFromModel('local-model')).toBeNull();
  });
});

describe('formatProviderModelDisplay', () => {
  it('returns provider labels', () => {
    expect(providerDisplay('gemini')).toBe('Gemini');
  });

  it('includes both provider and model when useful', () => {
    expect(formatProviderModelDisplay('claude', 'claude')).toBe('Claude / Sonnet 4.6');
    expect(formatProviderModelDisplay('codex', 'gpt-5.4')).toBe('Codex / GPT-5.4');
    expect(formatProviderModelDisplay('openrouter', null)).toBe('OpenRouter');
    expect(formatProviderModelDisplay('gemini', 'gemini-2.5-pro')).toBe('Gemini 2.5 Pro');
  });
});

describe('formatResolvedModelDisplay', () => {
  it('prefers the requested codex model over the codex provider alias', () => {
    expect(formatResolvedModelDisplay('gpt-5.4', 'codex')).toBe('Codex / GPT-5.4');
  });

  it('uses the resolved model when the requested value is only a provider alias', () => {
    expect(formatResolvedModelDisplay('codex', 'gpt-5.4-mini')).toBe('Codex / GPT-5.4 Mini');
    expect(formatResolvedModelDisplay('custom/requested', 'custom/resolved')).toBe(
      'OpenRouter / custom/resolved',
    );
  });

  it('falls back to the resolved provider alias default when no specific model matches the provider', () => {
    expect(formatResolvedModelDisplay('custom/requested', 'codex')).toBe('Codex / GPT-5.5');
  });

  it('uses the requested provider alias when the resolved value is absent', () => {
    expect(formatResolvedModelDisplay('codex', null)).toBe('Codex / GPT-5.5');
  });

  it('prefers the resolved upstream model for openrouter', () => {
    expect(formatResolvedModelDisplay('openrouter/auto', 'anthropic/claude-sonnet-4.6')).toBe(
      'OpenRouter / Claude Sonnet 4.6',
    );
    expect(formatResolvedModelDisplay('openrouter/free', null)).toBe('OpenRouter / Auto (free)');
  });

  it('falls back to sanitized model labels without an inferred provider', () => {
    expect(formatResolvedModelDisplay('custom-model', null)).toBe('custom-model');
    expect(formatResolvedModelDisplay('  ', 'custom-resolved')).toBe('custom-resolved');
    expect(formatResolvedModelDisplay(null, '<synthetic>')).toBeNull();
  });
});
