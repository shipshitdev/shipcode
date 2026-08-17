// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
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
        resolvedModelId="qwen/qwen3.6-plus"
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
          modelId: 'qwen/qwen3.6-plus',
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
    // This used to assert the "does not expose OpenRouter reasoning controls" notice, which only
    // ever rendered for the no-reasoning model set — whose sole member (`qwen/qwen3-coder:free`)
    // OpenRouter delisted, taking the set and its message with it. What this row is actually
    // asserting is that an inexact effort resolution surfaces its notice, so it now rides the
    // surviving generic branch: `medium` is offered but may be remapped upstream.
    expect(screen.getByText(/may remap unsupported effort levels/i)).toBeInTheDocument();
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

  it('normalizes legacy claude efforts without exposing xhigh in the UI', () => {
    render(
      <PhaseModelRow
        label="Verifier"
        htmlFor="verifier-model"
        modelValue="claude"
        openrouterModelValue={null}
        resolvedModelId="claude-sonnet-4-6"
        reasoningEffortValue="xhigh"
        validProviders={['claude', 'codex']}
        onModelChange={vi.fn()}
        onOpenrouterModelChange={vi.fn()}
        onReasoningEffortChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('OpenRouter model')).not.toBeInTheDocument();
    expect(screen.getByText('Thinking budget')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.queryByText('xhigh')).not.toBeInTheDocument();
  });

  it('renders Gemini as a CLI provider with standard reasoning controls', () => {
    render(
      <PhaseModelRow
        label="Planner"
        htmlFor="planner-model"
        modelValue="gemini"
        openrouterModelValue={null}
        resolvedModelId="gemini-2.5-pro"
        reasoningEffortValue="medium"
        validProviders={['claude', 'codex', 'gemini', 'openrouter']}
        onModelChange={vi.fn()}
        onOpenrouterModelChange={vi.fn()}
        onReasoningEffortChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('Reasoning effort')).toBeInTheDocument();
    expect(screen.queryByText('Custom OpenRouter slug')).not.toBeInTheDocument();
  });
});
