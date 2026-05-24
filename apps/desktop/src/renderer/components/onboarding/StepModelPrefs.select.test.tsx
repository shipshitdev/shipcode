// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepModelPrefs } from './StepModelPrefs';

vi.mock('@shipshitdev/ui', () => ({
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
    <div data-disabled={disabled ? 'true' : 'false'} data-value={value}>
      {children}
      <button type="button" disabled={disabled} onClick={() => onValueChange('codex')}>
        choose codex
      </button>
      <button type="button" disabled={disabled} onClick={() => onValueChange('claude')}>
        choose claude
      </button>
    </div>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode; value: string }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
}));

describe('StepModelPrefs select callbacks', () => {
  afterEach(() => {
    cleanup();
  });

  it('updates planner and reviewer selections with the paired current value', () => {
    const onChange = vi.fn();

    render(
      <StepModelPrefs
        plannerModel="claude"
        reviewerModel="codex"
        onChange={onChange}
        singleAgentMode={false}
      />,
    );

    const chooseCodexButtons = screen.getAllByRole('button', { name: 'choose codex' });
    const chooseClaudeButtons = screen.getAllByRole('button', { name: 'choose claude' });

    fireEvent.click(chooseCodexButtons[0]);
    fireEvent.click(chooseClaudeButtons[1]);

    expect(onChange).toHaveBeenNthCalledWith(1, 'codex', 'codex');
    expect(onChange).toHaveBeenNthCalledWith(2, 'claude', 'claude');
  });

  it('disables reviewer selection in single-agent mode', () => {
    const onChange = vi.fn();

    render(
      <StepModelPrefs
        plannerModel="claude"
        reviewerModel="codex"
        onChange={onChange}
        singleAgentMode
      />,
    );

    const chooseClaudeButtons = screen.getAllByRole('button', { name: 'choose claude' });
    expect(chooseClaudeButtons[1]).toBeDisabled();
  });
});
