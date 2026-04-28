// @vitest-environment jsdom

import type { GitHubIssueCacheRecord, Project } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchivedSettingsSection } from './ArchivedSettingsSection';
import { GithubSettingsSection } from './GithubSettingsSection';
import { NotificationsSettingsSection } from './NotificationsSettingsSection';
import { ShortcutsSection } from './ShortcutsSection';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
    pathExists: true,
    gitRemote: null,
    githubRepoId: null,
    githubRepoFullName: null,
    starterIssueNumber: null,
    starterIssueCreatedAt: null,
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
    revisionCountOverride: null,
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    hidden: false,
    notifyGithubUser: null,
    archived: true,
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    ...overrides,
  };
}

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 19,
    title: 'Fix the board',
    body: null,
    labels: [],
    assignee: null,
    state: 'closed',
    pipelineStatus: 'done',
    threadId: null,
    claimedAt: null,
    claimedBy: null,
    lastPhaseUpdate: null,
    lastStatusLabel: null,
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
    revisionCountOverride: null,
    linkedPrNumber: null,
    linkedPrUrl: null,
    linkedPrIsDraft: false,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: '2026-04-16T00:00:00.000Z',
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    isQuickMode: false,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('settings leaf sections', () => {
  it('renders the keyboard shortcuts reference grouped by category', () => {
    render(<ShortcutsSection />);

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Command Palette')).toBeInTheDocument();
    expect(screen.getByText('Toggle Terminal')).toBeInTheDocument();
  });

  it('updates GitHub settings values through the provided callback', () => {
    const onUpdate = vi.fn();

    render(<GithubSettingsSection settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Polling enabled' }));
    fireEvent.change(screen.getByLabelText('Poll interval (ms)'), {
      target: { value: '45000' },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-pickup issues' }));

    expect(onUpdate).toHaveBeenCalledWith({ githubPollingEnabled: true });
    expect(onUpdate).toHaveBeenCalledWith({ githubPollingIntervalMs: 45000 });
    expect(onUpdate).toHaveBeenCalledWith({ autoPickupEnabled: true });
  });

  it('updates notification toggles and disables children when notifications are off', () => {
    const onUpdate = vi.fn();

    render(
      <NotificationsSettingsSection
        settings={{ ...DEFAULT_SETTINGS, notificationsEnabled: false }}
        onUpdate={onUpdate}
      />,
    );

    expect(screen.getByRole('switch', { name: 'OS notifications' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Pipeline completed' })).toBeDisabled();

    cleanup();

    render(<NotificationsSettingsSection settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Enable notifications' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Play sound' }));
    fireEvent.click(screen.getByRole('switch', { name: 'CI blocked' }));

    expect(onUpdate).toHaveBeenCalledWith({ notificationsEnabled: false });
    expect(onUpdate).toHaveBeenCalledWith({ notificationSoundEnabled: false });
    expect(onUpdate).toHaveBeenCalledWith({
      notificationEvents: { ...DEFAULT_SETTINGS.notificationEvents, ciBlocked: false },
    });
  });

  it('renders archived projects and issues and forwards restore actions', async () => {
    const onUnarchiveProject = vi.fn();
    const onUnarchiveIssue = vi.fn();

    render(
      <ArchivedSettingsSection
        archivedProjects={[makeProject({ id: 'project-2', name: 'Archive Me' })]}
        archivedIssues={[makeIssue({ id: 'issue-2', issueNumber: 42, title: 'Restore issue' })]}
        unarchiveProjectPending={false}
        unarchiveIssuePending={false}
        onUnarchiveProject={onUnarchiveProject}
        onUnarchiveIssue={onUnarchiveIssue}
      />,
    );

    expect(screen.getByText('Archive Me')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onUnarchiveProject).toHaveBeenCalledWith('project-2');

    const issuesTab = screen.getByRole('tab', { name: 'Issues' });
    fireEvent.click(issuesTab);
    fireEvent.keyDown(issuesTab, { key: 'Enter' });

    await waitFor(() => {
      expect(issuesTab).toHaveAttribute('aria-selected', 'true');
    });

    expect(screen.getByText('#42 Restore issue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onUnarchiveIssue).toHaveBeenCalledWith('issue-2');
  });
});
