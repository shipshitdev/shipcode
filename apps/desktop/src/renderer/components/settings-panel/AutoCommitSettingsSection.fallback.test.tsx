// @vitest-environment jsdom

import { DEFAULT_SETTINGS } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
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

vi.mock('@shipshitdev/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipshitdev/ui')>();

  return {
    ...actual,
    Select: ({
      children,
      onValueChange,
      value,
    }: {
      children: ReactNode;
      onValueChange: (value: string) => void;
      value: string;
    }) => (
      <div data-select-value={value}>
        {children}
        <button
          type="button"
          data-testid={`select-${value}-claude`}
          onClick={() => onValueChange('claude')}
        >
          select claude
        </button>
      </div>
    ),
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children: ReactNode; value: string }) => <div>{children}</div>,
    SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectValue: () => <span />,
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
