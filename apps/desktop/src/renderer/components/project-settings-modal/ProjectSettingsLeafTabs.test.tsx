// @vitest-environment jsdom

import type { ContextFileInfo, Project } from '@shipcode/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSettingsContextTab } from './ProjectSettingsContextTab';
import { ProjectSettingsGeneralTab } from './ProjectSettingsGeneralTab';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
    pathExists: false,
    gitRemote: 'git@github.com:shipshitdev/shipcode.git',
    githubProjectUrl: 'https://github.com/orgs/shipshitdev/projects/1',
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

describe('project settings leaf tabs', () => {
  it('renders context file status and generator states', () => {
    const setContextGeneratorCli = vi.fn();
    const onGenerateContext = vi.fn();
    const contextFiles: ContextFileInfo[] = [
      { name: 'GOAL.md', exists: true, size: 1200 },
      { name: 'TECH-STACK.md', exists: true, size: 900 },
      { name: 'ARCHITECTURE.md', exists: false },
      { name: 'CONSTRAINTS.md', exists: false },
    ];

    render(
      <ProjectSettingsContextTab
        contextFiles={contextFiles}
        contextGeneratorCli="claude"
        setContextGeneratorCli={setContextGeneratorCli}
        contextGenerating={false}
        contextCliUnavailableReason={null}
        contextError="Generator failed"
        cliOptions={[
          { value: 'claude', label: 'Claude CLI', disabledReason: null },
          { value: 'codex', label: 'Codex CLI', disabledReason: 'Not installed' },
        ]}
        onGenerateContext={onGenerateContext}
      />,
    );

    expect(screen.getByText('Context Files')).toBeInTheDocument();
    expect(screen.getByText('GOAL.md')).toBeInTheDocument();
    expect(screen.getByText('1.2 KB')).toBeInTheDocument();
    expect(screen.getByText('900 B')).toBeInTheDocument();
    expect(screen.getByText('Generator failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Generate Context' }));
    expect(onGenerateContext).toHaveBeenCalledTimes(1);

    cleanup();

    render(
      <ProjectSettingsContextTab
        contextFiles={contextFiles}
        contextGeneratorCli="codex"
        setContextGeneratorCli={setContextGeneratorCli}
        contextGenerating={true}
        contextCliUnavailableReason="Codex unavailable"
        contextError={null}
        cliOptions={[
          { value: 'claude', label: 'Claude CLI', disabledReason: null },
          { value: 'codex', label: 'Codex CLI', disabledReason: 'Not installed' },
        ]}
        onGenerateContext={onGenerateContext}
      />,
    );

    expect(screen.getByRole('button', { name: 'Generating...' })).toBeDisabled();
  });

  it('renders general project state and forwards input and button actions', () => {
    const setUrlInput = vi.fn();
    const setTouched = vi.fn();
    const onRelink = vi.fn();
    const onSync = vi.fn();

    render(
      <ProjectSettingsGeneralTab
        project={makeProject()}
        urlInput="https://github.com/orgs/shipshitdev/projects/1"
        setUrlInput={setUrlInput}
        setTouched={setTouched}
        showInlineError={true}
        validationOk={false}
        validationReason="Not a valid project URL"
        relinkPending={false}
        relinkError="Folder lookup failed"
        onRelink={onRelink}
        canSync={true}
        syncPending={false}
        syncResult={{
          attached: 2,
          alreadyPresent: 1,
          failed: 1,
          errors: ['Issue #19 failed'],
        }}
        syncError="Sync partially failed"
        hasSavedUrl={true}
        inputMatchesSaved={true}
        onSync={onSync}
      />,
    );

    expect(screen.getByText(/This path is missing\./)).toBeInTheDocument();
    expect(screen.getByText('Folder lookup failed')).toBeInTheDocument();
    expect(screen.getByText('Not a valid project URL')).toBeInTheDocument();
    expect(screen.getByText(/Attached 2, already present 1, failed 1/)).toBeInTheDocument();
    expect(screen.getByText(/Issue #19 failed/)).toBeInTheDocument();
    expect(screen.getByText('Sync partially failed')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('GitHub Projects board URL'), {
      target: { value: 'https://github.com/orgs/shipshitdev/projects/2' },
    });
    fireEvent.blur(screen.getByLabelText('GitHub Projects board URL'));

    fireEvent.click(screen.getByRole('button', { name: 'Change folder...' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sync existing issues to board' }));

    expect(setUrlInput).toHaveBeenCalledWith('https://github.com/orgs/shipshitdev/projects/2');
    expect(setTouched).toHaveBeenCalledWith(true);
    expect(onRelink).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenCalledTimes(1);
  });
});
