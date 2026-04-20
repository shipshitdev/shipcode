import { describe, expect, it } from 'vitest';
import {
  formatProviderModelDisplay,
  formatResolvedModelDisplay,
  inferProviderFromModel,
  modelDisplay,
} from './model-display';

describe('modelDisplay', () => {
  it('returns friendly labels for known model keys', () => {
    expect(modelDisplay('claude')).toBe('Sonnet 4.6');
    expect(modelDisplay('codex')).toBe('GPT-5.4');
    expect(modelDisplay('claude-opus-4-6')).toBe('Opus 4.6');
  });

  it('falls back to the raw model id for unknown entries', () => {
    expect(modelDisplay('custom/model')).toBe('custom/model');
  });
});

describe('inferProviderFromModel', () => {
  it('detects providers from aliases and model ids', () => {
    expect(inferProviderFromModel('claude')).toBe('claude');
    expect(inferProviderFromModel('gpt-5.4')).toBe('codex');
    expect(inferProviderFromModel('anthropic/claude-sonnet-4.6')).toBe('openrouter');
  });
});

describe('formatProviderModelDisplay', () => {
  it('includes both provider and model when useful', () => {
    expect(formatProviderModelDisplay('claude', 'claude')).toBe('Claude / Sonnet 4.6');
    expect(formatProviderModelDisplay('codex', 'gpt-5.4')).toBe('Codex / GPT-5.4');
  });
});

describe('formatResolvedModelDisplay', () => {
  it('prefers the requested codex model over the codex provider alias', () => {
    expect(formatResolvedModelDisplay('gpt-5.4', 'codex')).toBe('Codex / GPT-5.4');
  });

  it('prefers the resolved upstream model for openrouter', () => {
    expect(formatResolvedModelDisplay('openrouter/auto', 'anthropic/claude-sonnet-4.6')).toBe(
      'OpenRouter / Claude Sonnet 4.6',
    );
  });
});
