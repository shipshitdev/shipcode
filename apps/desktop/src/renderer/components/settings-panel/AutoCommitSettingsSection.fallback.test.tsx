// @vitest-environment jsdom

import { DEFAULT_SETTINGS } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../model-provider-options-data', () => ({
  PROVIDER_DISPLAY: {
    claude: 'Anthropic',
    codex: 'OpenAI',
    gemini: 'Google',
    openrouter: 'OpenRouter',
  },
  getModelOptions: () => [],
}));

vi.mock('@shipcode/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipcode/ui')>();

  return {
    ...actual,
    SettingsSelectRow: ({
      label,
      options,
      onValueChange,
      value,
    }: {
      label: string;
      options: readonly { value: string; label: string }[];
      onValueChange: (value: string) => void;
      value: string;
    }) => (
      <div data-select-value={value}>
        <span>{label}</span>
        {options.map((option) => (
          <div key={option.value}>{option.label}</div>
        ))}
        <button
          type="button"
          data-testid={`select-${value}-claude`}
          onClick={() => onValueChange('claude')}
        >
          select claude
        </button>
      </div>
    ),
  };
});

import { AutoCommitSettingsSection } from './AutoCommitSettingsSection';

afterEach(() => {
  cleanup();
});

describe('AutoCommitSettingsSection provider fallback coverage', () => {
  it('falls back to the provider id when no model options are available', () => {
    const onUpdate = vi.fn();

    render(
      <AutoCommitSettingsSection
        settings={{ ...DEFAULT_SETTINGS, autoCommitProvider: 'codex' }}
        integrationStatus={undefined}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getAllByTestId('select-codex-claude')[0]);

    expect(onUpdate).toHaveBeenCalledWith({
      autoCommitProvider: 'claude',
      autoCommitModel: 'claude',
    });
  });
});
