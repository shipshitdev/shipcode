// @vitest-environment jsdom

import type { Project } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { CreateAutomationModal } from './create-automation-modal';

vi.mock('electron-log/renderer', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

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
      <CreateAutomationModal />
    </QueryClientProvider>,
  );
}

describe('CreateAutomationModal', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    window.shipcode = {
      invoke: invokeMock as never,
      on: vi.fn(() => () => {}) as never,
    } as never;

    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'project:list-visible') return [makeProject()];
      if (channel === 'automations:create') {
        return {
          id: 'auto-new',
          projectId: 'project-1',
          name: 'Smoke',
          prompt: 'do thing',
          cronExpr: '0 * * * *',
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
        };
      }
      return null;
    });

    act(() => {
      useAppStore.setState({
        createAutomationModalOpen: true,
        editingAutomationId: null,
        activeProjectId: 'project-1',
      });
    });
  });

  afterEach(() => {
    cleanup();
    invokeMock.mockReset();
    act(() => {
      useAppStore.setState({
        createAutomationModalOpen: false,
        editingAutomationId: null,
      });
    });
  });

  it('renders the new-automation form when open', async () => {
    renderWithProviders();

    expect(await screen.findByText(/New automation/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Daily smoke test/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/What should this run do\?/)).toBeInTheDocument();
  });

  it('disables submit while name and prompt are empty', async () => {
    renderWithProviders();

    const create = await screen.findByRole('button', { name: /Create/ });
    expect(create).toBeDisabled();
  });

  it('submits a new automation with the expected payload', async () => {
    renderWithProviders();

    // Wait for projects fetch + useEffect reset cycle to settle.
    await screen.findByText('My Repo');

    const nameInput = screen.getByPlaceholderText(/Daily smoke test/);
    const promptInput = screen.getByPlaceholderText(/What should this run do\?/);

    fireEvent.change(nameInput, { target: { value: 'Smoke' } });
    fireEvent.change(promptInput, { target: { value: 'do thing' } });

    const create = screen.getByRole('button', { name: /Create/ });
    await waitFor(() => expect(create).not.toBeDisabled());

    fireEvent.click(create);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'automations:create',
        expect.objectContaining({
          projectId: 'project-1',
          name: 'Smoke',
          prompt: 'do thing',
          cronExpr: '0 * * * *',
          enabled: true,
          executorProvider: null,
          executorModelId: null,
          executorReasoningEffort: null,
        }),
      );
    });
  });
});
