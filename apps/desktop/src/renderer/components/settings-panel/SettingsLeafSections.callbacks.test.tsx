// @vitest-environment jsdom

import { DEFAULT_SETTINGS, PINNED_MODEL_DEFAULTS } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoCommitSettingsSection } from './AutoCommitSettingsSection';
import { GithubSettingsSection } from './GithubSettingsSection';

vi.mock('@shipcode/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipcode/ui')>();
  const selectValues = ['claude', 'codex', 'openrouter', '__default__', 'single', 'split'];

  return {
    ...actual,
    SettingsSelectRow: ({
      label,
      description,
      options,
      onValueChange,
      value,
    }: {
      label: string;
      description?: string;
      options: readonly { value: string; label: string }[];
      onValueChange: (value: string) => void;
      value: string;
    }) => (
      <div data-select-value={value}>
        <span>{label}</span>
        {description ? <span>{description}</span> : null}
        {options.map((option) => (
          <div key={option.value}>{option.label}</div>
        ))}
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
  };
});

afterEach(() => {
  cleanup();
});

describe('settings leaf section callback coverage', () => {
  it('updates GitHub auto-run values, rejects invalid numbers, and removes priorities', () => {
    const onUpdate = vi.fn();
    const settings = {
      ...DEFAULT_SETTINGS,
      autoRunPriorities: ['p0', 'p2'] as Array<'p0' | 'p1' | 'p2' | 'p3'>,
    };

    render(<GithubSettingsSection settings={settings} onUpdate={onUpdate} />);

    expect(screen.getByText('Only P0, P2 issues will be included.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Poll interval (ms)'), {
      target: { value: 'not-a-number' },
    });
    fireEvent.change(screen.getByLabelText('Max tasks per run (0 = all)'), {
      target: { value: '-1' },
    });
    fireEvent.change(screen.getByLabelText('Max tasks per run (0 = all)'), {
      target: { value: '6' },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'P0 — Critical' }));
    fireEvent.click(screen.getByRole('switch', { name: 'P1 — High' }));

    expect(onUpdate).not.toHaveBeenCalledWith({ githubPollingIntervalMs: Number.NaN });
    expect(onUpdate).not.toHaveBeenCalledWith({ autoRunMaxTasks: -1 });
    expect(onUpdate).toHaveBeenCalledWith({ autoRunMaxTasks: 6 });
    expect(onUpdate).toHaveBeenCalledWith({ autoRunPriorities: ['p2'] });
    expect(onUpdate).toHaveBeenCalledWith({ autoRunPriorities: ['p0', 'p2', 'p1'] });
  });

  it('updates auto-commit provider, model, mode, and all cleanup criteria', () => {
    const onUpdate = vi.fn();
    const settings = {
      ...DEFAULT_SETTINGS,
      autoCommitProvider: 'codex' as const,
      autoCommitModel: 'custom-model',
      autoCommitMode: 'split' as const,
      cleanupCriteria: {
        worktreeMergedPr: false,
        worktreeClosedPr: false,
        localBranchMerged: false,
        localBranchNoRemote: false,
        remoteBranchMerged: false,
        worktreeNoPrCleanTree: false,
      },
    };

    render(
      <AutoCommitSettingsSection
        settings={settings}
        integrationStatus={undefined}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getAllByTestId('select-codex-claude')[0]);
    fireEvent.click(screen.getAllByTestId('select-codex-codex')[0]);
    fireEvent.click(screen.getAllByTestId('select-codex-openrouter')[0]);
    fireEvent.click(screen.getAllByTestId('select-custom-model-__default__')[0]);
    fireEvent.blur(screen.getByLabelText('Custom model'), { target: { value: '   ' } });
    fireEvent.click(screen.getAllByTestId('select-split-single')[0]);
    fireEvent.click(screen.getByRole('switch', { name: 'Worktrees with merged PR' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Worktrees with closed PR' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Local branches already merged' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Local branches with no remote' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Remote branches already merged' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Worktrees without PR (clean)' }));

    expect(onUpdate).toHaveBeenCalledWith({
      autoCommitProvider: 'claude',
      autoCommitModel: PINNED_MODEL_DEFAULTS.claude.phase,
    });
    expect(onUpdate).toHaveBeenCalledWith({
      autoCommitProvider: 'codex',
      autoCommitModel: PINNED_MODEL_DEFAULTS.codex.phase,
    });
    expect(onUpdate).toHaveBeenCalledWith({
      autoCommitProvider: 'openrouter',
      autoCommitModel: PINNED_MODEL_DEFAULTS.openrouter.paid,
    });
    expect(onUpdate).toHaveBeenCalledWith({ autoCommitModel: 'codex' });
    expect(onUpdate).toHaveBeenCalledWith({ autoCommitMode: 'single' });
    expect(onUpdate).toHaveBeenCalledWith({
      cleanupCriteria: { ...settings.cleanupCriteria, worktreeMergedPr: true },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      cleanupCriteria: { ...settings.cleanupCriteria, worktreeClosedPr: true },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      cleanupCriteria: { ...settings.cleanupCriteria, localBranchMerged: true },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      cleanupCriteria: { ...settings.cleanupCriteria, localBranchNoRemote: true },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      cleanupCriteria: { ...settings.cleanupCriteria, remoteBranchMerged: true },
    });
    expect(onUpdate).toHaveBeenCalledWith({
      cleanupCriteria: { ...settings.cleanupCriteria, worktreeNoPrCleanTree: true },
    });
  });

  it('renders provider default and OpenRouter model presentation branches', () => {
    const onUpdate = vi.fn();

    render(
      <AutoCommitSettingsSection
        settings={{
          ...DEFAULT_SETTINGS,
          autoCommitProvider: 'codex',
          autoCommitModel: 'codex',
        }}
        integrationStatus={undefined}
        onUpdate={onUpdate}
      />,
    );

    expect(screen.getByText('OpenAI default')).toBeInTheDocument();
    expect(screen.getByLabelText('Custom model')).toHaveValue('');

    fireEvent.click(screen.getByTestId('select-__default__-__default__'));
    fireEvent.click(screen.getByTestId('select-__default__-openrouter'));
    expect(onUpdate).toHaveBeenCalledWith({ autoCommitModel: 'codex' });
    expect(onUpdate).toHaveBeenCalledWith({ autoCommitModel: 'openrouter' });

    cleanup();
    render(
      <AutoCommitSettingsSection
        settings={{
          ...DEFAULT_SETTINGS,
          autoCommitProvider: 'openrouter',
          autoCommitModel: 'openrouter/auto',
        }}
        integrationStatus={undefined}
        onUpdate={onUpdate}
      />,
    );

    expect(screen.getByPlaceholderText('anthropic/claude-sonnet-4.6')).toBeInTheDocument();
  });
});
