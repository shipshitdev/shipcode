// @vitest-environment jsdom

import type { AppSettings } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PipelineSettingsSection } from './PipelineSettingsSection';

vi.mock('@shipshitdev/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipshitdev/ui')>();
  const selectValues = [
    'claude',
    'codex',
    'openrouter',
    'gemini',
    '__default__',
    'gpt-5.4-mini',
    'openrouter/auto',
    'none',
    'low',
    'medium',
    'high',
    'smart_fast',
    'thorough',
    '0',
    '3',
  ];

  return {
    ...actual,
    DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
      <button type="button" onClick={onSelect}>
        {children}
      </button>
    ),
    DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    SelectItem: ({ children }: { children: ReactNode; value: string }) => <div>{children}</div>,
    SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectValue: () => <span />,
  };
});

vi.mock('./PhaseModelRow', () => ({
  PhaseModelRow: ({
    label,
    onModelChange,
    onOpenrouterModelChange,
    onReasoningEffortChange,
  }: {
    label: string;
    onModelChange: (value: string) => void;
    onOpenrouterModelChange: (value: string | null) => void;
    onReasoningEffortChange: (value: AppSettings['plannerReasoningEffort']) => void;
  }) => (
    <div>
      <span>{label}</span>
      <button type="button" onClick={() => onModelChange('openrouter')}>
        {label} provider
      </button>
      <button type="button" onClick={() => onOpenrouterModelChange('openrouter/custom')}>
        {label} router model
      </button>
      <button type="button" onClick={() => onOpenrouterModelChange(null)}>
        {label} clear router model
      </button>
      <button type="button" onClick={() => onReasoningEffortChange('high')}>
        {label} effort
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
});

function renderSection(settings: AppSettings = DEFAULT_SETTINGS) {
  const onUpdate = vi.fn();
  render(
    <PipelineSettingsSection
      settings={settings}
      integrationStatus={undefined}
      onUpdate={onUpdate}
    />,
  );
  return onUpdate;
}

function openModelsTab() {
  const modelsTab = screen.getByRole('tab', { name: 'Models' });
  fireEvent.mouseDown(modelsTab, { button: 0 });
  fireEvent.click(modelsTab);
}

describe('PipelineSettingsSection callback coverage', () => {
  it('routes runtime select and bounded numeric changes', () => {
    const onUpdate = renderSection();

    fireEvent.click(screen.getAllByTestId('select-smart_fast-thorough')[0]);
    fireEvent.change(screen.getByLabelText('Max concurrent CPU tasks'), {
      target: { value: '49' },
    });
    fireEvent.change(screen.getByLabelText('CPU throttle threshold'), {
      target: { value: '101' },
    });

    expect(onUpdate).toHaveBeenCalledWith({ pipelineSpeedProfile: 'thorough' });
    expect(onUpdate).not.toHaveBeenCalledWith({ maxConcurrentCpuTasks: 49 });
    expect(onUpdate).not.toHaveBeenCalledWith({ cpuThrottleThresholdPercent: 101 });
  });

  it('routes format, triage, preset, and phase model callbacks', () => {
    const onUpdate = renderSection({
      ...DEFAULT_SETTINGS,
      prdRewriteCli: 'claude',
      prdRewriteClaudeModel: 'claude-custom',
      triageModel: 'claude',
      triageModelId: 'triage-custom',
    });

    openModelsTab();

    fireEvent.click(screen.getByRole('button', { name: /Hybrid/ }));
    fireEvent.click(screen.getAllByTestId('select-claude-codex')[0]);
    fireEvent.click(screen.getAllByTestId('select-claude-custom-__default__')[0]);
    fireEvent.click(screen.getAllByTestId('select-claude-openrouter')[0]);
    fireEvent.click(screen.getAllByTestId('select-triage-custom-__default__')[0]);
    fireEvent.change(screen.getByLabelText('Auto-apply threshold'), {
      target: { value: '0.9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Planner model provider' }));
    fireEvent.click(screen.getByRole('button', { name: 'Planner model router model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Planner model clear router model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Planner model effort' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reviewer model provider' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reviewer model router model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reviewer model clear router model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reviewer model effort' }));
    fireEvent.click(screen.getByRole('button', { name: 'Executor model provider' }));
    fireEvent.click(screen.getByRole('button', { name: 'Executor model router model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Executor model clear router model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Executor model effort' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verifier model provider' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verifier model router model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verifier model clear router model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verifier model effort' }));

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ executorModel: 'claude' }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ prdRewriteCli: 'codex' }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ prdRewriteClaudeModel: null }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ prdRewriteCli: 'openrouter' }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ triageModelId: null }));
    expect(onUpdate).toHaveBeenCalledWith({ triageAutoApplyThreshold: 0.9 });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ plannerModel: 'openrouter' }));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ openrouterPlannerModel: null }),
    );
    expect(onUpdate).toHaveBeenCalledWith({ plannerReasoningEffort: 'high' });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ reviewerModel: 'openrouter' }));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ openrouterReviewerModel: null }),
    );
    expect(onUpdate).toHaveBeenCalledWith({ reviewerReasoningEffort: 'high' });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ executorModel: 'openrouter' }));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ openrouterExecutorModel: null }),
    );
    expect(onUpdate).toHaveBeenCalledWith({ executorReasoningEffort: 'high' });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ verifierModel: 'openrouter' }));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ openrouterVerifierModel: null }),
    );
    expect(onUpdate).toHaveBeenCalledWith({ verifierReasoningEffort: 'high' });
  });

  it('routes OpenRouter defaults, Codex format model, and blank testing fields', () => {
    const onUpdate = renderSection({
      ...DEFAULT_SETTINGS,
      prdRewriteCli: 'codex',
      prdRewriteCodexModel: 'gpt-5.4-mini',
      openrouterDefaultPaidModel: 'openrouter/auto',
      openrouterDefaultFreeModel: 'openrouter/auto',
      openrouterExplicitFallback: 'openrouter/auto',
    });

    openModelsTab();

    fireEvent.click(screen.getAllByTestId('select-gpt-5.4-mini-__default__')[0]);
    fireEvent.click(screen.getAllByTestId('select-openrouter/auto-gpt-5.4-mini')[0]);
    fireEvent.click(screen.getAllByTestId('select-openrouter/auto-gpt-5.4-mini')[1]);
    fireEvent.click(screen.getAllByTestId('select-openrouter/auto-gpt-5.4-mini')[2]);

    const testingTab = screen.getByRole('tab', { name: 'Testing' });
    fireEvent.mouseDown(testingTab, { button: 0 });
    fireEvent.click(testingTab);
    fireEvent.blur(screen.getByPlaceholderText('e.g. bun run test'), {
      target: { value: '   ' },
    });
    fireEvent.blur(
      screen.getByPlaceholderText(
        'e.g. Tests use Vitest, colocated as *.test.ts, use vi.mock() for mocking.',
      ),
      { target: { value: '  keep mocks small  ' } },
    );

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ prdRewriteCodexModel: null }));
    expect(onUpdate).toHaveBeenCalledWith({ openrouterDefaultPaidModel: 'gpt-5.4-mini' });
    expect(onUpdate).toHaveBeenCalledWith({ openrouterDefaultFreeModel: 'gpt-5.4-mini' });
    expect(onUpdate).toHaveBeenCalledWith({ openrouterExplicitFallback: 'gpt-5.4-mini' });
    expect(onUpdate).toHaveBeenCalledWith({ testCommand: null });
    expect(onUpdate).toHaveBeenCalledWith({ testingContext: 'keep mocks small' });
  });

  it('routes duplicated select callbacks for revisions, reasoning, providers, and thresholds', () => {
    const onUpdate = renderSection({
      ...DEFAULT_SETTINGS,
      plannerModel: 'openrouter',
      reviewerModel: 'openrouter',
      executorModel: 'openrouter',
      verifierModel: 'openrouter',
      prdRewriteCli: 'codex',
      triageModel: 'openrouter',
      revisionCount: 1,
      plannerReasoningEffort: 'medium',
      reviewerReasoningEffort: 'medium',
      executorReasoningEffort: 'medium',
      verifierReasoningEffort: 'medium',
      prdRewriteReasoningEffort: 'medium',
      triageReasoningEffort: 'medium',
    });

    fireEvent.click(screen.getByTestId('select-1-3'));

    openModelsTab();

    for (const control of screen.getAllByTestId('select-codex-claude')) {
      fireEvent.click(control);
    }
    for (const control of screen.getAllByTestId('select-openrouter-claude')) {
      fireEvent.click(control);
    }
    for (const control of screen.getAllByTestId('select-medium-high')) {
      fireEvent.click(control);
    }
    fireEvent.change(screen.getByLabelText('Auto-apply threshold'), {
      target: { value: '-0.1' },
    });
    fireEvent.change(screen.getByLabelText('Auto-apply threshold'), {
      target: { value: '1.2' },
    });

    expect(onUpdate).toHaveBeenCalledWith({ revisionCount: 3 });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ prdRewriteCli: 'claude' }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ triageModel: 'claude' }));
    expect(onUpdate).toHaveBeenCalledWith({ prdRewriteReasoningEffort: 'high' });
    expect(onUpdate).toHaveBeenCalledWith({ triageReasoningEffort: 'high' });
    expect(onUpdate).not.toHaveBeenCalledWith({ triageAutoApplyThreshold: -0.1 });
    expect(onUpdate).not.toHaveBeenCalledWith({ triageAutoApplyThreshold: 1.2 });
  });
});
