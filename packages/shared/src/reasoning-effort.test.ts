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
  });

  it('normalizes legacy OpenRouter Claude 4.6 slugs', () => {
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
    expect(formatProviderReasoningEffort('openrouter', 'xhigh', 'anthropic/claude-opus-4-6')).toBe(
      'high',
    );
  });

  it('disables reasoning entirely for OpenRouter models without reasoning support', () => {
    expect(getSupportedReasoningEfforts('openrouter', 'qwen/qwen3-coder:free')).toEqual(['none']);
    expect(
      resolveProviderReasoningEffort('openrouter', 'medium', 'qwen/qwen3-coder:free'),
    ).toMatchObject({
      effective: 'none',
      exact: false,
    });
  });
});
