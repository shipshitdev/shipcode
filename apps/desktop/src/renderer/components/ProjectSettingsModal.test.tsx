import {
  type ContextFileInfo,
  DEFAULT_SETTINGS,
  type IntegrationStatus,
  type Project,
} from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { ProjectSettingsModal } from './ProjectSettingsModal';

vi.mock('electron-log/renderer', () => ({
  default: {
    error: vi.fn(),
  },
}));

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectSettingsModal />
    </QueryClientProvider>,
  );
}

describe('ProjectSettingsModal', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  const project: Project = {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
    pathExists: true,
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
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    createdAt: '2026-04-13T00:00:00.000Z',
    updatedAt: '2026-04-13T00:00:00.000Z',
  };

  const integrations: IntegrationStatus = {
    system: {
      claude: {
        available: true,
        version: 'claude 1.0.0',
        path: '/usr/local/bin/claude',
        error: null,
        authenticated: true,
      },
      codex: {
        available: true,
        version: 'codex 0.1.0',
        path: '/usr/local/bin/codex',
        error: null,
        authenticated: true,
      },
      git: {
        available: true,
        version: 'git version 2.43.0',
        path: '/usr/bin/git',
        error: null,
        authenticated: false,
      },
      gh: {
        available: true,
        version: 'gh version 2.40.1',
        path: '/usr/local/bin/gh',
        error: null,
        authenticated: false,
      },
    },
    ghAuth: {
      installed: true,
      authenticated: true,
      username: 'decod3r',
      version: '2.40.1',
      error: null,
      hasProjectScope: true,
    },
    openrouter: {
      enabled: true,
      keyPresent: true,
      authStatus: 'valid',
      message: null,
      label: 'shipcode-dev',
      modelChecks: [
        {
          key: 'planner',
          label: 'Planner model',
          modelId: 'openrouter/auto',
          status: 'valid',
          message: null,
        },
        {
          key: 'reviewer',
          label: 'Reviewer model',
          modelId: 'openrouter/auto',
          status: 'valid',
          message: null,
        },
        {
          key: 'executor',
          label: 'Executor model',
          modelId: 'openrouter/auto',
          status: 'valid',
          message: null,
        },
        {
          key: 'verifier',
          label: 'Verifier model',
          modelId: 'openrouter/auto',
          status: 'valid',
          message: null,
        },
      ],
    },
  };

  const contextFiles: ContextFileInfo[] = [
    { name: 'GOAL.md', exists: true, size: 512 },
    { name: 'TECH-STACK.md', exists: true, size: 256 },
    { name: 'ARCHITECTURE.md', exists: false },
    { name: 'CONSTRAINTS.md', exists: false },
  ];

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;

    useAppStore.setState({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: project.id,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the modal shell and general tab content', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'project:get') return project;
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'integrations:check') return integrations;
      if (channel === 'context:list') return contextFiles;
      return null;
    });

    renderWithProviders();

    expect(await screen.findByText('Project Settings')).toBeInTheDocument();
    expect(await screen.findByText('Repository folder')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Context' })).toBeInTheDocument();
    expect(screen.getByDisplayValue(project.githubProjectUrl ?? '')).toBeInTheDocument();
  });
});
