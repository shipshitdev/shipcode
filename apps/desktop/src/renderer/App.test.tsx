// @vitest-environment jsdom

import { type AppSettings, DEFAULT_SETTINGS } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { useAppStore } from './stores/app-store';

vi.mock('./components/ActivityView', () => ({
  ActivityView: () => <div>ActivityView</div>,
}));
vi.mock('./components/CommandPalette', () => ({
  CommandPalette: () => <div>CommandPalette</div>,
}));
vi.mock('./components/CostsView', () => ({
  CostsView: () => <div>CostsView</div>,
}));
vi.mock('./components/CreateIssueModal', () => ({
  CreateIssueModal: () => <div>CreateIssueModal</div>,
}));
vi.mock('./components/HealthBanner', () => ({
  HealthBanner: () => <div>HealthBanner</div>,
}));
vi.mock('./components/InboxView', () => ({
  InboxView: () => <div>InboxView</div>,
}));
vi.mock('./components/InstantFixModal', () => ({
  InstantFixModal: () => <div>InstantFixModal</div>,
}));
vi.mock('./components/IssueDetail', () => ({
  IssueDetail: ({ expanded }: { expanded: boolean }) => (
    <div>{expanded ? 'IssueDetailExpanded' : 'IssueDetailPanel'}</div>
  ),
}));
vi.mock('./components/NotificationToaster', () => ({
  NotificationToaster: () => <div>NotificationToaster</div>,
}));
vi.mock('./components/OverviewView', () => ({
  OverviewView: () => <div>OverviewView</div>,
}));
vi.mock('./components/onboarding/OnboardingWizard', () => ({
  OnboardingWizard: () => <div>OnboardingWizard</div>,
}));
vi.mock('./components/ProjectMissingView', () => ({
  ProjectMissingView: ({ project }: { project: { path: string } }) => (
    <div>ProjectMissingView:{project.path}</div>
  ),
}));
vi.mock('./components/ProjectPathBanner', () => ({
  ProjectPathBanner: ({ project }: { project: { path: string } | null }) => (
    <div>ProjectPathBanner:{project?.path ?? 'none'}</div>
  ),
}));
vi.mock('./components/ProjectSettingsModal', () => ({
  ProjectSettingsModal: () => <div>ProjectSettingsModal</div>,
}));
vi.mock('./components/ProjectSetupModal', () => ({
  ProjectSetupModal: () => <div>ProjectSetupModal</div>,
}));
vi.mock('./components/ProjectSidebar', () => ({
  ProjectSidebar: () => <div>ProjectSidebar</div>,
}));
vi.mock('./components/SettingsPanel', () => ({
  SettingsPanel: () => <div>SettingsPanel</div>,
}));
vi.mock('./components/SettingsSidebar', () => ({
  SettingsSidebar: () => <div>SettingsSidebar</div>,
}));
vi.mock('./components/SkillsView', () => ({
  SkillsView: () => <div>SkillsView</div>,
}));
vi.mock('./components/TerminalDrawer', () => ({
  TerminalDrawer: () => <div>TerminalDrawer</div>,
}));
vi.mock('./components/ProjectView', () => ({
  ProjectView: () => <div>ProjectView</div>,
}));
vi.mock('./components/ThreadPanel', () => ({
  ThreadPanel: () => <div>ThreadPanel</div>,
}));
vi.mock('./components/Titlebar', () => ({
  Titlebar: () => <div>Titlebar</div>,
}));
vi.mock('./hooks/useGlobalKeyboard', () => ({
  useGlobalKeyboard: vi.fn(),
}));
vi.mock('./hooks/useIpc', () => ({
  useIpc: vi.fn(),
}));

const baseSettings: AppSettings = {
  ...DEFAULT_SETTINGS,
  theme: 'dark',
  fontStyle: 'dm-sans',
  fontSize: 14,
  onboardingVersion: 1,
  notificationSoundEnabled: false,
};

function renderApp() {
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
      <App />
    </QueryClientProvider>,
  );
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.shipcode = {
      invoke: vi.fn(async (channel: string, args?: { projectId?: string }) => {
        if (channel === 'settings:get') {
          return baseSettings;
        }
        if (channel === 'project:get') {
          return {
            id: args?.projectId ?? 'project-1',
            path: '/tmp/project',
            pathExists: true,
          };
        }
        return null;
      }),
      on: vi.fn(() => () => {}),
    };
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: true,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    useAppStore.setState({
      activeProjectId: null,
      activeThreadId: null,
      activeIssue: null,
      viewMode: 'overview',
      sidebarCollapsed: false,
      terminalVisible: false,
      terminalMaximized: false,
      settingsVisible: false,
      settingsSection: 'general',
      issueDetailExpanded: false,
      issueDetailCollapsed: false,
      issueDetailWidth: 480,
      currentPlan: null,
      currentReview: null,
      pipelinePhase: 'idle',
      systemHealth: null,
      currentVerification: null,
      githubIssues: [],
      agentOutputs: {},
      processToThread: {},
      terminalEvents: [],
      terminalThreadId: null,
      terminalEventsByThread: {},
      lastActivityByThread: {},
      notifications: [],
      commandPaletteOpen: false,
      createIssueModalOpen: false,
      editingPrd: null,
      projectSettingsModalOpen: false,
      projectSettingsModalProjectId: null,
      projectSettingsModalInitialTab: null,
      currentModels: {},
      canonicalTerminalStream: {},
    });
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-font-style');
    document.documentElement.removeAttribute('data-font-size');
  });

  it('shows onboarding when setup is incomplete', async () => {
    window.shipcode.invoke = vi.fn(async (channel: string) => {
      if (channel === 'settings:get') {
        return { ...baseSettings, onboardingVersion: 0 };
      }
      return null;
    });

    renderApp();

    expect(await screen.findByText('OnboardingWizard')).toBeInTheDocument();
  });

  it('renders the skills view for an active project and applies theme tokens', async () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      viewMode: 'skills',
    });

    renderApp();

    expect(await screen.findByText('ProjectSidebar')).toBeInTheDocument();
    expect(screen.getByText('SkillsView')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.documentElement.dataset.fontStyle).toBe('dm-sans');
      expect(document.documentElement.dataset.fontSize).toBe('14');
    });
  });

  it('renders the missing project state when the active path is gone', async () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      viewMode: 'project',
    });
    window.shipcode.invoke = vi.fn(async (channel: string) => {
      if (channel === 'settings:get') {
        return baseSettings;
      }
      if (channel === 'project:get') {
        return {
          id: 'project-1',
          path: '/tmp/missing-project',
          pathExists: false,
        };
      }
      return null;
    });

    renderApp();

    expect(await screen.findByText('ProjectMissingView:/tmp/missing-project')).toBeInTheDocument();
  });

  it('renders issue detail as an overlay without unmounting the main project view', async () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      viewMode: 'project',
      activeIssue: {
        id: 'issue-1',
        projectId: 'project-1',
        issueNumber: 18,
        title: 'Overlay issue',
        pipelineStatus: 'failed',
        threadId: 'thread-1',
      } as never,
      activeThreadId: 'thread-1',
      issueDetailExpanded: false,
      issueDetailCollapsed: false,
      issueDetailWidth: 480,
    });

    const view = renderApp();

    expect(await screen.findByText('ProjectView')).toBeInTheDocument();
    const issueDetailPanel = within(view.container).getByText('IssueDetailPanel');
    const overlayPanel = view.container.querySelector('[data-slot="overlay-panel"]');

    expect(overlayPanel).not.toBeNull();
    expect(overlayPanel).toContainElement(issueDetailPanel);
    expect(overlayPanel).toHaveClass('pointer-events-auto', 'relative', 'overflow-hidden');
    expect(overlayPanel).toHaveStyle({ width: '480px' });
  });
});
