// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSettingsContextTab } from './ProjectSettingsContextTab';

vi.mock('@shipshitdev/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipshitdev/ui')>();

  return {
    ...actual,
    Select: ({
      children,
      disabled,
      onValueChange,
      value,
    }: {
      children: ReactNode;
      disabled?: boolean;
      onValueChange: (value: string) => void;
      value: string;
    }) => (
      <div data-disabled={disabled ? 'true' : 'false'} data-select-value={value}>
        {children}
        <button type="button" disabled={disabled} onClick={() => onValueChange('codex')}>
          select codex
        </button>
      </div>
    ),
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children: ReactNode; value: string; disabled?: boolean }) => (
      <div>{children}</div>
    ),
    SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectValue: () => <span />,
  };
});

afterEach(() => {
  cleanup();
});

describe('ProjectSettingsContextTab callbacks', () => {
  it('forwards generator CLI changes', () => {
    const setContextGeneratorCli = vi.fn();

    render(
      <ProjectSettingsContextTab
        contextFiles={undefined}
        contextGeneratorCli="claude"
        setContextGeneratorCli={setContextGeneratorCli}
        contextGenerating={false}
        contextCliUnavailableReason={null}
        contextError={null}
        cliOptions={[
          { value: 'claude', label: 'Claude CLI', disabledReason: null },
          { value: 'codex', label: 'Codex CLI', disabledReason: null },
        ]}
        onGenerateContext={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'select codex' }));

    expect(setContextGeneratorCli).toHaveBeenCalledWith('codex');
  });
});
