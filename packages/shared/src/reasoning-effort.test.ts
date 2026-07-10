import { describe, expect, it } from 'vitest';
import {
  formatProviderReasoningEffort,
  getSupportedReasoningEfforts,
  normalizeReasoningModelId,
  resolveProviderReasoningEffort,
} from './reasoning-effort';

describe('reasoning-effort', () => {
  it('returns conservative Claude capabilities and Codex GPT-5.5/5.4 capabilities', () => {
    expect(getSupportedReasoningEfforts('claude', 'claude-sonnet-4-6')).toEqual([
      'none',
      'medium',
      'high',
    ]);
    expect(getSupportedReasoningEfforts('codex', 'gpt-5.5')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(getSupportedReasoningEfforts('gemini', 'gemini-2.5-pro')).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  it('normalizes legacy OpenRouter Claude 4.6 slugs', () => {
    expect(normalizeReasoningModelId('openrouter', null)).toBeNull();
    expect(normalizeReasoningModelId('openrouter', '   ')).toBeNull();
    expect(normalizeReasoningModelId('codex', ' gpt-5.5 ')).toBe('gpt-5.5');
    expect(normalizeReasoningModelId('openrouter', 'anthropic/claude-sonnet-4-6')).toBe(
      'anthropic/claude-sonnet-4.6',
    );
    expect(normalizeReasoningModelId('openrouter', 'anthropic/claude-opus-4-6')).toBe(
      'anthropic/claude-opus-4.6',
    );
  });

  it('maps unsupported Claude CLI efforts to exact ShipCode modes', () => {
    expect(resolveProviderReasoningEffort('claude', 'minimal', 'claude-sonnet-4-6')).toMatchObject({
      effective: 'none',
      exact: false,
    });
    expect(resolveProviderReasoningEffort('claude', 'low', 'claude-sonnet-4-6')).toMatchObject({
      effective: 'none',
      exact: false,
    });
    expect(resolveProviderReasoningEffort('claude', 'xhigh', 'claude-opus-4-6')).toMatchObject({
      effective: 'high',
      exact: false,
    });
  });

  it('never offers none for Fable 5, whose thinking cannot be disabled', () => {
    expect(getSupportedReasoningEfforts('claude', 'claude-fable-5')).toEqual(['medium', 'high']);
    expect(getSupportedReasoningEfforts('claude', ' claude-fable-5 ')).toEqual(['medium', 'high']);
  });

  it('maps unsupported Fable 5 efforts to the nearest thinking budget', () => {
    for (const configured of ['none', 'minimal', 'low'] as const) {
      expect(resolveProviderReasoningEffort('claude', configured, 'claude-fable-5')).toEqual({
        configured,
        effective: 'medium',
        exact: false,
        message:
          'Fable 5 always uses adaptive thinking; ShipCode supports Medium and High thinking budgets for it. Using Medium.',
      });
    }
    expect(resolveProviderReasoningEffort('claude', 'xhigh', 'claude-fable-5')).toEqual({
      configured: 'xhigh',
      effective: 'high',
      exact: false,
      message:
        'Fable 5 always uses adaptive thinking; ShipCode supports Medium and High thinking budgets for it. Using High.',
    });
    expect(resolveProviderReasoningEffort('claude', 'medium', 'claude-fable-5')).toEqual({
      configured: 'medium',
      effective: 'medium',
      exact: true,
      message: null,
    });
    expect(resolveProviderReasoningEffort('claude', 'high', 'claude-fable-5')).toEqual({
      configured: 'high',
      effective: 'high',
      exact: true,
      message: null,
    });
    // Other Claude models keep the legacy none/medium/high behavior.
    expect(resolveProviderReasoningEffort('claude', 'none', 'claude-opus-4-8')).toEqual({
      configured: 'none',
      effective: 'none',
      exact: true,
      message: null,
    });
  });

  it('offers only none for Grok, which exposes no reasoning-effort control', () => {
    expect(getSupportedReasoningEfforts('grok', 'grok-4.5')).toEqual(['none']);
    expect(resolveProviderReasoningEffort('grok', 'none', 'grok-4.5')).toEqual({
      configured: 'none',
      effective: 'none',
      exact: true,
      message: null,
    });
    expect(resolveProviderReasoningEffort('grok', 'high', 'grok-4.5')).toMatchObject({
      effective: 'none',
      exact: false,
      message:
        'Grok selects reasoning automatically per model; ShipCode does not send a reasoning effort.',
    });
  });

  it('keeps supported Codex efforts exact across GPT-5.6 tiers', () => {
    for (const modelId of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      expect(getSupportedReasoningEfforts('codex', modelId)).toEqual([
        'low',
        'medium',
        'high',
        'xhigh',
      ]);
      expect(resolveProviderReasoningEffort('codex', 'xhigh', modelId)).toEqual({
        configured: 'xhigh',
        effective: 'xhigh',
        exact: true,
        message: null,
      });
      expect(resolveProviderReasoningEffort('codex', 'none', modelId)).toMatchObject({
        effective: 'low',
        exact: false,
      });
    }
  });

  it('keeps supported Codex efforts exact across GPT-5.5 and GPT-5.4 models', () => {
    expect(resolveProviderReasoningEffort('codex', 'xhigh', 'gpt-5.5')).toEqual({
      configured: 'xhigh',
      effective: 'xhigh',
      exact: true,
      message: null,
    });
    expect(resolveProviderReasoningEffort('codex', 'xhigh', 'gpt-5.4-mini')).toEqual({
      configured: 'xhigh',
      effective: 'xhigh',
      exact: true,
      message: null,
    });
  });

  it('maps legacy disabled Codex efforts to low', () => {
    expect(resolveProviderReasoningEffort('codex', 'minimal')).toMatchObject({
      effective: 'low',
      exact: false,
    });
    expect(resolveProviderReasoningEffort('codex', 'minimal', 'gpt-5.4')).toMatchObject({
      effective: 'low',
      exact: false,
    });
    expect(resolveProviderReasoningEffort('codex', 'none', 'gpt-5.5')).toMatchObject({
      effective: 'low',
      exact: false,
    });
  });

  it('treats routed OpenRouter models as approximate for non-none efforts', () => {
    expect(getSupportedReasoningEfforts('openrouter', 'openrouter/auto')).toEqual([
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(resolveProviderReasoningEffort('openrouter', 'high', 'openrouter/auto')).toMatchObject({
      effective: 'high',
      exact: false,
    });
    expect(
      resolveProviderReasoningEffort('openrouter', 'medium', 'qwen/qwen3.6-plus').message,
    ).toBe(
      'qwen/qwen3.6-plus accepts reasoning via OpenRouter, but OpenRouter may remap unsupported effort levels to the nearest supported level.',
    );
    expect(resolveProviderReasoningEffort('openrouter', 'medium').message).toBe(
      'This OpenRouter selection may remap the requested effort to the nearest supported level for the final model.',
    );
    expect(resolveProviderReasoningEffort('openrouter', 'none', 'qwen/qwen3.6-plus')).toEqual({
      configured: 'none',
      effective: 'none',
      exact: true,
      message: null,
    });
  });

  it('reduces OpenRouter Claude 4.6 models to none or adaptive-default', () => {
    expect(getSupportedReasoningEfforts('openrouter', 'anthropic/claude-sonnet-4-6')).toEqual([
      'none',
      'high',
    ]);
    expect(
      resolveProviderReasoningEffort('openrouter', 'low', 'anthropic/claude-sonnet-4-6'),
    ).toMatchObject({
      effective: 'high',
      exact: false,
    });
    expect(
      resolveProviderReasoningEffort('openrouter', 'none', 'anthropic/claude-sonnet-4-6'),
    ).toEqual({
      configured: 'none',
      effective: 'none',
      exact: true,
      message: null,
    });
    expect(formatProviderReasoningEffort('openrouter', 'xhigh', 'anthropic/claude-opus-4-6')).toBe(
      'high',
    );
  });

  it('treats OpenRouter Claude Opus 4.8 as adaptive like the 4.6 models', () => {
    expect(normalizeReasoningModelId('openrouter', 'anthropic/claude-opus-4-8')).toBe(
      'anthropic/claude-opus-4.8',
    );
    expect(getSupportedReasoningEfforts('openrouter', 'anthropic/claude-opus-4.8')).toEqual([
      'none',
      'high',
    ]);
    expect(formatProviderReasoningEffort('openrouter', 'xhigh', 'anthropic/claude-opus-4-8')).toBe(
      'high',
    );
  });

  it('disables reasoning entirely for OpenRouter models without reasoning support', () => {
    expect(getSupportedReasoningEfforts('openrouter', 'qwen/qwen3-coder:free')).toEqual(['none']);
    expect(resolveProviderReasoningEffort('openrouter', 'none', 'qwen/qwen3-coder:free')).toEqual({
      configured: 'none',
      effective: 'none',
      exact: true,
      message: null,
    });
    expect(
      resolveProviderReasoningEffort('openrouter', 'medium', 'qwen/qwen3-coder:free'),
    ).toMatchObject({
      effective: 'none',
      exact: false,
    });
  });

  it('maps Gemini unsupported efforts to supported reasoning levels', () => {
    expect(resolveProviderReasoningEffort('gemini', 'none')).toMatchObject({
      effective: 'low',
      exact: false,
    });
    expect(resolveProviderReasoningEffort('gemini', 'minimal', 'gemini-2.5-flash')).toMatchObject({
      effective: 'low',
      exact: false,
    });
    expect(resolveProviderReasoningEffort('gemini', 'xhigh', 'gemini-2.5-pro')).toMatchObject({
      effective: 'high',
      exact: false,
    });
    expect(resolveProviderReasoningEffort('gemini', 'medium', 'gemini-2.5-pro')).toEqual({
      configured: 'medium',
      effective: 'medium',
      exact: true,
      message: null,
    });
    expect(resolveProviderReasoningEffort('gemini', 'xhigh')).toMatchObject({
      effective: 'high',
      exact: false,
      message: 'Gemini supports Low, Medium, and High reasoning effort. Using High.',
    });
  });
});
