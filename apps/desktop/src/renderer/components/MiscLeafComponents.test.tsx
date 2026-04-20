// @vitest-environment jsdom

import type { Project } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_OVERRIDES } from './project-settings-modal/shared';
import { GeneralSettingsSection } from './settings-panel/GeneralSettingsSection';
import { TerminalDrawerEmptyState } from './terminal-drawer/TerminalDrawerEmptyState';

vi.mock('./project-settings-modal/ProjectPhaseSettingsRow', () => ({
  ProjectPhaseSettingsRow: ({ phase, label }: { phase: string; label: string }) => (
    <div data-testid={`phase-row-${phase}`}>{label}</div>
  ),
}));

import { ProjectSettingsModelsTab } from './project-settings-modal/ProjectSettingsModelsTab';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
    pathExists: true,
    gitRemote: null,
    githubProjectUrl: null,
    plannerModelOverride: null,
    reviewerModelOverride: null,
    executorModelOverride: null,
    verifierModelOverride: null,
    plannerModelIdOverride: null,
    reviewerModelIdOverride: null,
    executorModelIdOverride: null,
    verifierModelIdOverride: null,
    plannerReasoningEffortOverride: null,
    reviewerReasoningEffortOverride: null,
    executorReasoningEffortOverride: null,
    verifierReasoningEffortOverride: null,
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('misc leaf components', () => {
  it('renders the terminal drawer empty state copy', () => {
    render(<TerminalDrawerEmptyState />);

    expect(screen.getByText('No issue selected for this project')).toBeInTheDocument();
    expect(
      screen.getByText(/Console output will appear when you select or start an issue/i),
    ).toBeInTheDocument();
  });

  it('updates worktree settings and re-runs setup from the general settings section', () => {
    const onUpdate = vi.fn();
    const onUpdateWorktreeRoot = vi.fn();

    render(
      <GeneralSettingsSection
        settings={DEFAULT_SETTINGS}
        worktreeRootError="Relative paths are rejected."
        onUpdate={onUpdate}
        onUpdateWorktreeRoot={onUpdateWorktreeRoot}
      />,
    );

    const worktreeRootInput = screen.getByPlaceholderText(
      '~/.shipcode/worktrees',
    ) as HTMLInputElement;
    fireEvent.change(worktreeRootInput, { target: { value: '~/custom-worktrees' } });
    fireEvent.blur(worktreeRootInput);

    const branchFormatInput = screen.getByPlaceholderText(
      DEFAULT_SETTINGS.worktreeBranchFormat,
    ) as HTMLInputElement;
    fireEvent.change(branchFormatInput, { target: { value: 'ship/custom-{id}' } });
    fireEvent.blur(branchFormatInput);

    fireEvent.click(screen.getByRole('button', { name: 'Re-run Setup' }));

    expect(onUpdateWorktreeRoot).toHaveBeenCalledWith('~/custom-worktrees');
    expect(onUpdate).toHaveBeenCalledWith({ worktreeBranchFormat: 'ship/custom-{id}' });
    expect(onUpdate).toHaveBeenCalledWith({ onboardingVersion: 0 });
    expect(screen.getByText('Relative paths are rejected.')).toBeInTheDocument();
  });

  it('renders all phase rows inside the project models tab wrapper', () => {
    render(
      <ProjectSettingsModelsTab
        settings={DEFAULT_SETTINGS}
        projectDraft={makeProject()}
        overrides={EMPTY_OVERRIDES}
        setOverrides={vi.fn()}
        integrationStatus={undefined}
        modelValidation={{}}
        setModelValidation={vi.fn()}
      />,
    );

    expect(screen.getByText(/Project overrides shadow the global defaults/i)).toBeInTheDocument();
    expect(screen.getByTestId('phase-row-planner')).toHaveTextContent('Planner');
    expect(screen.getByTestId('phase-row-reviewer')).toHaveTextContent('Reviewer');
    expect(screen.getByTestId('phase-row-executor')).toHaveTextContent('Executor');
    expect(screen.getByTestId('phase-row-verifier')).toHaveTextContent('Verifier');
  });
});
