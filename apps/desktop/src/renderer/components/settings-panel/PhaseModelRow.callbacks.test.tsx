// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhaseModelRow } from './PhaseModelRow';

vi.mock('@shipshitdev/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipshitdev/ui')>();
  const selectValues = [
    'claude',
    'codex',
    'gemini',
    'openrouter',
    '__default__',
    'qwen/qwen3-coder:free',
    'high',
  ];

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
        {selectValues.map((next) => (
          <button
            key={next}
            type="button"
            data-testid={`select-${value}-${next}`}
            onClick={() => onValueChange(next)}
          >
            select {next}
          </button>
        ))}
      </div>
    ),
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children: ReactNode; disabled?: boolean; value: string }) => (
      <div>{children}</div>
    ),
    SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectValue: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  };
});

afterEach(() => {
  cleanup();
});

describe('PhaseModelRow callback coverage', () => {
  it('forwards provider, OpenRouter model, and reasoning select changes', () => {
    const onModelChange = vi.fn();
    const onOpenrouterModelChange = vi.fn();
    const onReasoningEffortChange = vi.fn();

    render(
      <PhaseModelRow
        label="Executor"
        htmlFor="executor-model"
        modelValue="openrouter"
        openrouterModelValue="qwen/qwen3-coder:free"
        resolvedModelId="qwen/qwen3-coder:free"
        reasoningEffortValue="medium"
        validProviders={['claude', 'codex', 'gemini', 'openrouter']}
        onModelChange={onModelChange}
        onOpenrouterModelChange={onOpenrouterModelChange}
        onReasoningEffortChange={onReasoningEffortChange}
        disabledProviders={{ gemini: 'missing', openrouter: 'offline' }}
        modelCheck={{
          key: 'executor',
          label: 'Executor model',
          modelId: 'qwen/qwen3-coder:free',
          status: 'valid',
          message: 'Model is available',
        }}
      />,
    );

    expect(screen.getByText('Google (missing)')).toBeInTheDocument();
    expect(screen.getByText('OpenRouter (offline)')).toBeInTheDocument();
    expect(screen.getByText('Model is available')).toBeInTheDocument();

    fireEvent.click(screen.getAllByTestId('select-openrouter-codex')[0]);
    expect(onModelChange).toHaveBeenCalledWith('codex');

    fireEvent.click(screen.getByTestId('select-qwen/qwen3-coder:free-__default__'));
    expect(onOpenrouterModelChange).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByTestId('select-qwen/qwen3-coder:free-qwen/qwen3-coder:free'));
    expect(onOpenrouterModelChange).toHaveBeenCalledWith('qwen/qwen3-coder:free');

    fireEvent.click(screen.getByTestId('select-none-high'));
    expect(onReasoningEffortChange).toHaveBeenCalledWith('high');
  });

  it('leaves known or empty OpenRouter custom slugs unchanged on blur', () => {
    const onOpenrouterModelChange = vi.fn();

    render(
      <PhaseModelRow
        label="Planner"
        htmlFor="planner-model"
        modelValue="openrouter"
        openrouterModelValue="qwen/qwen3-coder:free"
        resolvedModelId="qwen/qwen3-coder:free"
        reasoningEffortValue="medium"
        validProviders={['openrouter']}
        onModelChange={vi.fn()}
        onOpenrouterModelChange={onOpenrouterModelChange}
        onReasoningEffortChange={vi.fn()}
      />,
    );

    const customInput = screen.getByPlaceholderText(
      'e.g. anthropic/claude-sonnet-4.6',
    ) as HTMLInputElement;
    expect(customInput).toHaveValue('');

    fireEvent.blur(customInput);
    fireEvent.change(customInput, { target: { value: '   ' } });
    fireEvent.blur(customInput);

    expect(onOpenrouterModelChange).not.toHaveBeenCalled();
  });
});
