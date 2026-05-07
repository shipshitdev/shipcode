// @vitest-environment jsdom

import type { Automation, Project } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { AutomationDetail } from './automation-detail';

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    projectId: 'project-1',
    name: 'Daily smoke',
    prompt:
      '# Automation: Daily smoke\n\n## Goal\nRun the smoke test.\n\n## Verification\n- `bun test` passes',
    cronExpr: '0 9 * * *',
    enabled: true,
    executorProvider: null,
    executorModelId: null,
    executorReasoningEffort: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastStatus: null,
    nextRunAt: null,
    runCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'My Repo',
    path: '/tmp/proj',
    gitRemote: null,
    githubProjectUrl: null,
    githubStatusMapping: null,
    defaultBranch: 'main',
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
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Project;
}

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AutomationDetail />
    </QueryClientProvider>,
  );
}

describe('AutomationDetail', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    window.shipcode = {
      invoke: invokeMock as never,
      on: vi.fn(() => () => {}) as never,
    } as never;

    useAppStore.setState({
      activeAutomationDetailId: 'auto-1',
      activeAutomationThreadId: null,
      activeIssue: null,
      activeThreadId: null,
      viewMode: 'automations',
    });
  });

  afterEach(() => {
    cleanup();
    invokeMock.mockReset();
    useAppStore.setState({ activeAutomationDetailId: null });
  });

  it('renders formatted automation prompts in the main detail column', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:get') return makeAutomation();
      if (channel === 'project:get') return makeProject();
      if (channel === 'automations:run-history') return [];
      return null;
    });

    renderWithProviders();

    await waitFor(() => expect(screen.getByText('Daily smoke')).toBeInTheDocument());

    expect(screen.getByRole('heading', { name: 'Automation: Daily smoke' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Goal' })).toBeInTheDocument();
    expect(screen.getByText('Run the smoke test.')).toBeInTheDocument();
    expect(screen.getByText('All Runs (0)')).toBeInTheDocument();
  });
});
