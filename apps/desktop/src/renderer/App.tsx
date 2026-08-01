import type { Project } from '@shipcode/shared';
import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared';
import { StartupProgress, type StartupProgressStep, TooltipProvider } from '@shipcode/ui';
import { Button, Skeleton } from '@shipshitdev/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { AssistantPanel } from './components/AssistantPanel';
import { AutomationRunDetail } from './components/AutomationRunDetail';
import { CommandPalette } from './components/CommandPalette';
import { GenericToaster } from './components/GenericToaster';
import { HealthBanner } from './components/HealthBanner';
import { IssueDetail } from './components/IssueDetail';
import { NotificationToaster } from './components/NotificationToaster';
import { OverviewView } from './components/OverviewView';
import { ProjectMissingView } from './components/ProjectMissingView';
import { ProjectPathBanner } from './components/ProjectPathBanner';
import { ProjectSidebar } from './components/ProjectSidebar';
import { SettingsPanel } from './components/SettingsPanel';
import { SettingsSidebar } from './components/SettingsSidebar';
import { TelemetryConsentDialog } from './components/TelemetryConsentDialog';
import { TerminalDrawer } from './components/TerminalDrawer';
import { Titlebar } from './components/Titlebar';
import { UpdateBanner } from './components/UpdateBanner';
import { ProjectView } from './features/project/project-view';
import { useAppSettings } from './hooks/useAppSettings';
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard';
import { useIpc } from './hooks/useIpc';
import { useTelemetryStatus } from './hooks/useTelemetryStatus';
import { STABLE_APP_STATE_STALE_TIME } from './query-stale-times';
import { useAppStore } from './stores/app-store';
import { useIssueCacheProjection } from './stores/issue-cache-projection';
import { syncRendererTelemetry } from './telemetry';

const VIEW_LOADING_CARD_KEYS = ['view-card-1', 'view-card-2', 'view-card-3'];

/** Skeleton shown while lazy view chunks load — matches PageHeader + content layout. */
function ViewLoadingFallback() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-primary">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="flex-1 space-y-4 p-6">
        <div className="grid grid-cols-3 gap-4">
          {VIEW_LOADING_CARD_KEYS.map((key) => (
            <Skeleton key={key} className="h-20 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
  );
}

function AppStartupProgress({
  bridgeReady,
  settingsReady,
  telemetryReady,
}: {
  bridgeReady: boolean;
  settingsReady: boolean;
  telemetryReady: boolean;
}) {
  const steps: StartupProgressStep[] = [
    {
      id: 'bridge',
      label: 'Connect desktop bridge',
      detail: bridgeReady ? 'Preload bridge is available.' : 'Waiting for Electron preload.',
      status: bridgeReady ? 'complete' : 'error',
    },
    {
      id: 'settings',
      label: 'Load settings',
      detail: settingsReady ? 'Preferences loaded.' : 'Reading local app settings.',
      status: settingsReady ? 'complete' : bridgeReady ? 'active' : 'pending',
    },
    {
      id: 'telemetry',
      label: 'Prepare error reporting',
      detail: telemetryReady ? 'Telemetry preference resolved.' : 'Checking local consent state.',
      status: telemetryReady ? 'complete' : settingsReady ? 'active' : 'pending',
    },
    {
      id: 'workspace',
      label: 'Restore workspace',
      detail: settingsReady ? 'Opening the last selected view.' : 'Waiting for settings.',
      status: settingsReady ? 'active' : 'pending',
    },
  ];

  return (
    <StartupProgress
      title="Starting ShipCode"
      subtitle={bridgeReady ? 'Loading your workspace.' : 'The desktop bridge is not ready.'}
      steps={steps}
    />
  );
}

// Code-split: heavy views loaded on demand.
const ActivityView = lazy(() =>
  import('./components/ActivityView').then((m) => ({ default: m.ActivityView })),
);
const AutomationsView = lazy(() =>
  import('./components/AutomationsView').then((m) => ({ default: m.AutomationsView })),
);
const CostsView = lazy(() =>
  import('./components/CostsView').then((m) => ({ default: m.CostsView })),
);
const InboxView = lazy(() =>
  import('./components/InboxView').then((m) => ({ default: m.InboxView })),
);
const SkillsView = lazy(() =>
  import('./components/SkillsView').then((m) => ({ default: m.SkillsView })),
);
const OnboardingWizard = lazy(() =>
  import('./components/onboarding/OnboardingWizard').then((m) => ({
    default: m.OnboardingWizard,
  })),
);
const CreateIssueModal = lazy(() =>
  import('./components/CreateIssueModal').then((m) => ({ default: m.CreateIssueModal })),
);
const ProjectSettingsModal = lazy(() =>
  import('./components/ProjectSettingsModal').then((m) => ({
    default: m.ProjectSettingsModal,
  })),
);
const CreateAutomationModal = lazy(() =>
  import('./features/automations/create-automation-modal').then((m) => ({
    default: m.CreateAutomationModal,
  })),
);
const AutomationDetail = lazy(() =>
  import('./features/automations/automation-detail').then((m) => ({
    default: m.AutomationDetail,
  })),
);
const AddProjectExplorer = lazy(() =>
  import('./components/AddProjectExplorer').then((m) => ({
    default: m.AddProjectExplorer,
  })),
);

export function App() {
  useGlobalKeyboard();
  // Must mount before useIpc so cache writes from the first IPC events project.
  useIssueCacheProjection();
  useIpc();
  const queryClient = useQueryClient();
  const terminalVisible = useAppStore((state) => state.terminalVisible);
  const terminalMaximized = useAppStore((state) => state.terminalMaximized);
  const settingsVisible = useAppStore((state) => state.settingsVisible);
  const assistantVisible = useAppStore((state) => state.assistantVisible);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const viewMode = useAppStore((state) => state.viewMode);
  const projectTab = useAppStore((state) => state.projectTab);
  const hasActiveIssue = useAppStore((state) => state.activeIssue !== null);
  const hasActiveAutomationThread = useAppStore((state) => state.activeAutomationThreadId !== null);
  const hasActiveAutomationDetail = useAppStore((state) => state.activeAutomationDetailId !== null);

  const { data: settings } = useAppSettings();
  // No enabled guard — fire in parallel with settings:get.
  // Consumers (syncRendererTelemetry, TelemetryConsentDialog) already guard on deps being present.
  const { data: telemetryStatus } = useTelemetryStatus();

  const { data: activeProject } = useQuery<Project | null>({
    queryKey: ['project', activeProjectId],
    queryFn: () => {
      if (!activeProjectId) {
        throw new Error('Missing active project id');
      }
      return window.shipcode.invoke('project:get', { projectId: activeProjectId });
    },
    enabled: !!activeProjectId,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  useEffect(() => {
    if (!settings) return;

    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolvedTheme =
        settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
      root.dataset.theme = resolvedTheme;
    };

    root.dataset.fontStyle = settings.fontStyle;
    root.dataset.fontSize = String(settings.fontSize);
    applyTheme();

    if (settings.theme !== 'system') return;

    const handleChange = () => applyTheme();
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [settings]);

  useEffect(() => {
    if (!telemetryStatus) return;
    void syncRendererTelemetry(telemetryStatus);
  }, [telemetryStatus]);

  if (settings && (settings.onboardingVersion ?? 0) < CURRENT_ONBOARDING_VERSION) {
    return (
      <Suspense
        fallback={
          <div className="flex h-screen w-screen items-center justify-center bg-primary">
            <Skeleton className="h-[440px] w-full max-w-md rounded-xl" />
          </div>
        }
      >
        <OnboardingWizard
          onComplete={async () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            queryClient.invalidateQueries({ queryKey: ['health'] });
            const projects = await queryClient.fetchQuery<Project[]>({
              queryKey: ['projects-visible'],
              queryFn: () => window.shipcode.invoke('project:list-visible'),
              staleTime: STABLE_APP_STATE_STALE_TIME,
            });
            if (projects && projects.length > 0) {
              useAppStore.getState().selectProject(projects[0].id);
            }
          }}
        />
      </Suspense>
    );
  }

  if (!settings) {
    const isBridgeMissing = !window.shipcode?.invoke;

    if (!isBridgeMissing) {
      return (
        <AppStartupProgress
          bridgeReady={!isBridgeMissing}
          settingsReady={!!settings}
          telemetryReady={!!telemetryStatus}
        />
      );
    }

    return (
      <div
        className="flex h-screen w-screen items-center justify-center bg-primary"
        style={{ animation: 'fadeIn 0.2s ease-out' }}
      >
        <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        <div className="flex flex-col items-center gap-6">
          {isBridgeMissing ? (
            <>
              <div className="flex size-14 items-center justify-center rounded-full bg-red-500/10">
                <svg
                  aria-hidden="true"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-red-500"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-lg font-semibold text-red-400">Preload bridge failed</h1>
                <p className="max-w-sm text-sm text-muted-foreground">
                  The Electron preload script didn't load. Try rebuilding with{' '}
                  <code className="rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-300">
                    bun run build:preload
                  </code>{' '}
                  then restart the app.
                </p>
              </div>
              <Button variant="destructive" onClick={() => window.location.reload()}>
                Reload App
              </Button>
            </>
          ) : (
            <>
              <div
                className="size-10 rounded-full"
                style={{
                  border: '1.5px solid rgba(244,244,245,0.08)',
                  borderTopColor: 'rgba(244,244,245,0.6)',
                  animation: 'spin 0.9s linear infinite',
                }}
              />
              <span className="text-xs font-medium tracking-[0.25em] text-muted-foreground uppercase">
                ShipCode
              </span>
            </>
          )}
        </div>
      </div>
    );
  }
  const showOverview = viewMode === 'overview' || !activeProjectId;
  const showMissingProject =
    !settingsVisible &&
    viewMode === 'project' &&
    !!activeProjectId &&
    activeProject?.pathExists === false;
  const isTerminalTab = viewMode === 'project' && projectTab === 'terminal';
  const hideMainContentForTerminal =
    terminalVisible && terminalMaximized && !isTerminalTab && !hasActiveIssue;

  // Build a key that changes when the active view changes, for crossfade animation
  const viewKey = settingsVisible
    ? 'settings'
    : hasActiveIssue
      ? 'issue-detail'
      : hasActiveAutomationThread
        ? 'automation-thread'
        : hasActiveAutomationDetail
          ? 'automation-detail'
          : viewMode;

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-screen flex-col overflow-hidden">
        <Titlebar />
        <UpdateBanner />
        <HealthBanner />
        <ProjectPathBanner project={activeProject ?? null} />
        <div className="flex flex-1 overflow-hidden">
          {settingsVisible ? (
            <SettingsSidebar />
          ) : (
            !hasActiveIssue &&
            !hasActiveAutomationThread &&
            !hasActiveAutomationDetail && <ProjectSidebar />
          )}
          {/* Center column — main view above, terminal dock below. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {!hideMainContentForTerminal && (
              <Suspense fallback={<ViewLoadingFallback />}>
                <div
                  key={viewKey}
                  className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-primary animate-view-enter"
                >
                  {settingsVisible ? (
                    <SettingsPanel />
                  ) : hasActiveIssue ? (
                    <IssueDetail />
                  ) : hasActiveAutomationThread ? (
                    <AutomationRunDetail />
                  ) : hasActiveAutomationDetail ? (
                    <AutomationDetail />
                  ) : viewMode === 'activity' ? (
                    <ActivityView />
                  ) : viewMode === 'costs' ? (
                    <CostsView />
                  ) : viewMode === 'skills' ? (
                    <SkillsView />
                  ) : viewMode === 'automations' ? (
                    <AutomationsView />
                  ) : viewMode === 'inbox' ? (
                    <InboxView />
                  ) : showOverview ? (
                    <OverviewView />
                  ) : showMissingProject && activeProject ? (
                    <ProjectMissingView project={activeProject} />
                  ) : (
                    <ProjectView />
                  )}
                </div>
              </Suspense>
            )}
            {terminalVisible && !isTerminalTab && !hasActiveIssue && <TerminalDrawer />}
          </div>
          <div
            className="assistant-panel-slot min-h-0 shrink-0 overflow-hidden"
            data-open={assistantVisible ? 'true' : undefined}
            aria-hidden={!assistantVisible}
          >
            {assistantVisible && <AssistantPanel />}
          </div>
        </div>
        <CommandPalette />
        <Suspense fallback={null}>
          <CreateIssueModal />
          <CreateAutomationModal />
          <ProjectSettingsModal />
          <AddProjectExplorer />
        </Suspense>
        <TelemetryConsentDialog
          open={
            settings.telemetryEnabled == null &&
            telemetryStatus?.dsnConfigured === true &&
            telemetryStatus.envDisabled === false
          }
        />
        <NotificationToaster />
        <GenericToaster />
      </div>
    </TooltipProvider>
  );
}
