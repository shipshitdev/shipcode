import type { AppSettings, DashboardStats, Project } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { ProjectSidebar } from './ProjectSidebar';

function makeProject(id: string, name: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    gitRemote: null,
    githubProjectUrl: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    ...overrides,
  };
}

function makeStats(
  overrides: Partial<DashboardStats> = {},
  omitKeys: Array<keyof DashboardStats> = [],
): DashboardStats {
  const stats: Partial<DashboardStats> = {
    agentsRunning: 0,
    runningByPhase: {},
    agentsRunningByProject: {},
    pendingApprovalsByProject: {},
    tasksInProgress: 0,
    tasksOpen: 0,
    tasksBlocked: 0,
    pendingApprovals: 0,
    staleApprovals: 0,
    shippedLast7d: 0,
    failedLast7d: 0,
    ...overrides,
  };

  for (const key of omitKeys) {
    delete stats[key];
  }

  return stats as DashboardStats;
}

function renderSidebar({
  projects = [makeProject('project-1', 'Project One')],
  stats = makeStats(),
}: {
  projects?: Project[];
  stats?: DashboardStats;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();
  invokeMock.mockImplementation(async (channel) => {
    if (channel === 'project:list-visible') return projects;
    if (channel === 'settings:get') return { projectSortOrder: 'recent' } as AppSettings;
    if (channel === 'dashboard:get-stats') return stats;
    if (channel === 'notification:list') return [];
    return null;
  });

  window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
  window.shipcode.on = vi.fn(() => () => {}) as unknown as typeof window.shipcode.on;

  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectSidebar />
    </QueryClientProvider>,
  );
}

describe('ProjectSidebar', () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      activeProjectId: null,
      viewMode: 'overview',
      settingsVisible: false,
      sidebarCollapsed: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders an approval badge for projects with pending approvals', async () => {
    renderSidebar({
      projects: [makeProject('project-1', 'Project One')],
      stats: makeStats({
        agentsRunningByProject: { 'project-1': 2 },
        pendingApprovalsByProject: { 'project-1': 1 },
      }),
    });

    const row = await screen.findByText('Project One');
    const button = row.closest('button');
    expect(button).not.toBeNull();
    expect(within(button as HTMLButtonElement).getByText('1 approval')).toBeInTheDocument();
    expect(within(button as HTMLButtonElement).getByText('2 live')).toBeInTheDocument();
  });

  it('hides the approval badge when the count is zero', async () => {
    renderSidebar({
      projects: [makeProject('project-1', 'Project One')],
      stats: makeStats({
        agentsRunningByProject: { 'project-1': 1 },
        pendingApprovalsByProject: { 'project-1': 0 },
      }),
    });

    await screen.findByText('Project One');
    expect(screen.queryByText('1 approval')).not.toBeInTheDocument();
    expect(screen.getByText('1 live')).toBeInTheDocument();
  });

  it('does not crash when agentsRunningByProject is missing', async () => {
    renderSidebar({
      projects: [makeProject('project-1', 'Project One')],
      stats: makeStats(
        {
          pendingApprovalsByProject: { 'project-1': 2 },
        },
        ['agentsRunningByProject'],
      ),
    });

    await screen.findByText('Project One');
    expect(screen.getByText('2 approvals')).toBeInTheDocument();
    expect(screen.queryByText(/live/)).not.toBeInTheDocument();
  });

  it('does not crash when pendingApprovalsByProject is missing', async () => {
    renderSidebar({
      projects: [makeProject('project-1', 'Project One')],
      stats: makeStats(
        {
          agentsRunningByProject: { 'project-1': 3 },
        },
        ['pendingApprovalsByProject'],
      ),
    });

    await screen.findByText('Project One');
    expect(screen.getByText('3 live')).toBeInTheDocument();
    expect(screen.queryByText(/approval/)).not.toBeInTheDocument();
  });

  it('does not crash when both per-project maps are missing', async () => {
    renderSidebar({
      projects: [makeProject('project-1', 'Project One')],
      stats: makeStats({}, ['agentsRunningByProject', 'pendingApprovalsByProject']),
    });

    await screen.findByText('Project One');
    expect(screen.queryByText(/approval/)).not.toBeInTheDocument();
    expect(screen.queryByText(/live/)).not.toBeInTheDocument();
  });

  it('renders approval and live badges together with approval first', async () => {
    renderSidebar({
      projects: [makeProject('project-1', 'Project One')],
      stats: makeStats({
        agentsRunningByProject: { 'project-1': 4 },
        pendingApprovalsByProject: { 'project-1': 2 },
      }),
    });

    const row = await screen.findByText('Project One');
    const button = row.closest('button');
    expect(button).not.toBeNull();

    const badgeTexts = within(button as HTMLButtonElement)
      .getAllByText(/approval|live/)
      .map((node) => node.textContent);

    expect(badgeTexts).toEqual(['2 approvals', '4 live']);
  });
});
