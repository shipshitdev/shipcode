import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import { InheritValueDisplay } from './model-provider-options';
import {
  formatModelInheritanceLabel,
  formatProviderSelectionLabel,
  getModelOptions,
  PROVIDER_DISPLAY,
} from './model-provider-options-data';

describe('model-provider-options', () => {
  it('formats provider and model labels from capability and static catalogs', () => {
    const integrationStatus = {
      modelCapabilities: {
        claude: {
          provider: 'claude',
          source: 'catalog',
          checkedAt: '2026-05-09T00:00:00.000Z',
          error: null,
          models: [
            {
              value: 'claude-custom',
              label: 'Claude Custom',
              description: null,
              defaultReasoningEffort: 'high',
              supportedReasoningEfforts: ['low', 'medium', 'high'],
            },
          ],
        },
      },
    };

    expect(PROVIDER_DISPLAY).toMatchObject({
      claude: 'Anthropic',
      codex: 'OpenAI',
      gemini: 'Google',
      openrouter: 'OpenRouter',
    });
    expect(getModelOptions('claude', integrationStatus as never)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'claude-custom', label: 'Claude Custom' }),
        expect.objectContaining({ value: 'opus', label: 'Opus (latest)' }),
      ]),
    );
    expect(getModelOptions('openrouter')).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: expect.any(String) })]),
    );
    expect(
      formatProviderSelectionLabel('claude', 'claude-custom', integrationStatus as never),
    ).toBe('Anthropic / Claude Custom');
    expect(
      formatProviderSelectionLabel('claude', 'unknown-model', integrationStatus as never),
    ).toBe('Anthropic / unknown-model');
    expect(formatProviderSelectionLabel('codex', null)).toBe('OpenAI / OpenAI default');
  });

  it('formats inherited model labels and renders inherited value details', () => {
    expect(formatModelInheritanceLabel('claude', null, [])).toBe('Default model');
    expect(formatModelInheritanceLabel('openrouter', 'openai/gpt-5-codex', [])).toBe('GPT-5 Codex');
    expect(
      formatModelInheritanceLabel('openrouter', 'custom/model', [
        { value: 'custom/model', label: 'Custom Model' },
      ]),
    ).toBe('Custom Model');
    expect(formatModelInheritanceLabel('openrouter', 'missing/model', [])).toBe('missing/model');

    const rendered = InheritValueDisplay({ detail: 'Anthropic default' });

    expect(isValidElement(rendered)).toBe(true);
    expect(rendered.props.children[2].props.children).toBe('Anthropic default');
  });
});
