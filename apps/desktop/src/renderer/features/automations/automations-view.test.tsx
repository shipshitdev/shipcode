// @vitest-environment jsdom

import type { Automation, Project } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationsView } from './automations-view';

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    projectId: 'project-1',
    name: 'Daily smoke',
    prompt: 'List 3 files',
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
      <AutomationsView />
    </QueryClientProvider>,
  );
}

describe('AutomationsView', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    window.shipcode = {
      invoke: invokeMock as never,
      on: vi.fn(() => () => {}) as never,
    } as never;
  });

  afterEach(() => {
    cleanup();
    invokeMock.mockReset();
  });

  it('renders the empty state when there are no automations', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:list-all') return [];
      if (channel === 'project:list-visible') return [];
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText(/No automations yet\./)).toBeInTheDocument();
    expect(screen.getAllByText(/New automation/).length).toBeGreaterThan(0);
  });

  it('renders a card for each automation with project name and status', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'automations:list-all') {
        return [makeAutomation({ name: 'Smoke', lastStatus: 'completed' })];
      }
      if (channel === 'project:list-visible') return [makeProject()];
      return null;
    });

    renderWithProviders();

    await waitFor(() => expect(screen.getByText('Smoke')).toBeInTheDocument());
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText(/My Repo/)).toBeInTheDocument();
  });
});
