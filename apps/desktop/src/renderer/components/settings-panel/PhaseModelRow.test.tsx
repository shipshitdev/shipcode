// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhaseModelRow } from './PhaseModelRow';

afterEach(() => {
  cleanup();
});

describe('PhaseModelRow', () => {
  it('renders openrouter-specific controls and forwards custom slug changes', () => {
    const onModelChange = vi.fn();
    const onOpenrouterModelChange = vi.fn();
    const onReasoningEffortChange = vi.fn();

    render(
      <PhaseModelRow
        label="Executor"
        htmlFor="executor-model"
        modelValue="openrouter"
        openrouterModelValue="custom/provider-model"
        resolvedModelId="qwen/qwen3-coder:free"
        reasoningEffortValue="medium"
        validProviders={['claude', 'codex', 'openrouter']}
        onModelChange={onModelChange}
        onOpenrouterModelChange={onOpenrouterModelChange}
        onReasoningEffortChange={onReasoningEffortChange}
        disabledProviders={{ claude: 'missing', codex: 'offline' }}
        warningMessage="Project override is degraded"
        modelCheck={{
          key: 'executor',
          label: 'Executor model',
          modelId: 'qwen/qwen3-coder:free',
          status: 'invalid',
          message: 'Model validation failed',
        }}
      />,
    );

    expect(screen.getByText('OpenRouter model')).toBeInTheDocument();
    expect(screen.getByText('Custom OpenRouter slug')).toBeInTheDocument();
    expect(
      screen.getByDisplayValue('custom/provider-model') as HTMLInputElement,
    ).toBeInTheDocument();
    expect(screen.getByText(/does not expose OpenRouter reasoning controls/i)).toBeInTheDocument();
    expect(screen.getByText('Project override is degraded')).toBeInTheDocument();
    expect(screen.getByText('Model validation failed')).toBeInTheDocument();

    const customInput = screen.getByPlaceholderText(
      'e.g. anthropic/claude-sonnet-4.6',
    ) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: 'anthropic/claude-sonnet-4.6' } });
    fireEvent.blur(customInput);

    expect(onOpenrouterModelChange).toHaveBeenCalledWith('anthropic/claude-sonnet-4.6');
  });

  it('clears a custom openrouter slug when the field is emptied', () => {
    const onOpenrouterModelChange = vi.fn();

    render(
      <PhaseModelRow
        label="Planner"
        htmlFor="planner-model"
        modelValue="openrouter"
        openrouterModelValue="custom/provider-model"
        resolvedModelId="custom/provider-model"
        reasoningEffortValue="none"
        validProviders={['openrouter']}
        onModelChange={vi.fn()}
        onOpenrouterModelChange={onOpenrouterModelChange}
        onReasoningEffortChange={vi.fn()}
      />,
    );

    const customInput = screen.getByPlaceholderText(
      'e.g. anthropic/claude-sonnet-4.6',
    ) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: '' } });
    fireEvent.blur(customInput);

    expect(onOpenrouterModelChange).toHaveBeenCalledWith(null);
  });

  it('shows claude reasoning remap guidance without openrouter fields', () => {
    render(
      <PhaseModelRow
        label="Verifier"
        htmlFor="verifier-model"
        modelValue="claude"
        openrouterModelValue={null}
        resolvedModelId="claude-sonnet-4-6"
        reasoningEffortValue="low"
        validProviders={['claude', 'codex']}
        onModelChange={vi.fn()}
        onOpenrouterModelChange={vi.fn()}
        onReasoningEffortChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('OpenRouter model')).not.toBeInTheDocument();
    expect(screen.getByText(/Low maps to no thinking/i)).toBeInTheDocument();
    expect(screen.getByText('Thinking budget')).toBeInTheDocument();
  });
});
