import type { AppSettings, Project, TelemetryStatus } from '@shipcode/shared';
import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared';
import { TooltipProvider } from '@shipcode/ui';
import { Button, Skeleton } from '@shipshitdev/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { AutomationRunDetail } from './components/AutomationRunDetail';
import { CommandPalette } from './components/CommandPalette';
import { HealthBanner } from './components/HealthBanner';
import { IssueDetail } from './components/IssueDetail';
import { NotificationToaster } from './components/NotificationToaster';
import { OverviewView } from './components/OverviewView';
import { ProjectMissingView } from './components/ProjectMissingView';
import { ProjectPathBanner } from './components/ProjectPathBanner';
import { ProjectSidebar } from './components/ProjectSidebar';
import { ProjectView } from './components/ProjectView';
import { SettingsPanel } from './components/SettingsPanel';
import { SettingsSidebar } from './components/SettingsSidebar';
import { TelemetryConsentDialog } from './components/TelemetryConsentDialog';
import { TerminalDrawer } from './components/TerminalDrawer';
import { Titlebar } from './components/Titlebar';
import { UpdateBanner } from './components/UpdateBanner';
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard';
import { useIpc } from './hooks/useIpc';
import { STABLE_APP_STATE_STALE_TIME } from './query-stale-times';
import { useAppStore } from './stores/app-store';
import { syncRendererTelemetry } from './telemetry';

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
      <div className="flex-1 space-y-4 px-6 py-6">
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
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
  useIpc();
  const queryClient = useQueryClient();
  const terminalVisible = useAppStore((state) => state.terminalVisible);
  const terminalMaximized = useAppStore((state) => state.terminalMaximized);
  const settingsVisible = useAppStore((state) => state.settingsVisible);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const viewMode = useAppStore((state) => state.viewMode);
  const hasActiveIssue = useAppStore((state) => state.activeIssue !== null);
  const hasActiveAutomationThread = useAppStore((state) => state.activeAutomationThreadId !== null);
  const hasActiveAutomationDetail = useAppStore((state) => state.activeAutomationDetailId !== null);

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke('settings:get'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const { data: telemetryStatus } = useQuery<TelemetryStatus>({
    queryKey: ['telemetry-status'],
    queryFn: () => window.shipcode.invoke('telemetry:get-status'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
    // No enabled guard — fire in parallel with settings:get.
    // Consumers (syncRendererTelemetry, TelemetryConsentDialog) already guard on deps being present.
  });

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
            <Skeleton className="h-[440px] w-full max-w-md rounded-2xl" />
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
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
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
                <p className="max-w-sm text-sm text-muted">
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
                className="h-10 w-10 rounded-full"
                style={{
                  border: '1.5px solid rgba(244,244,245,0.08)',
                  borderTopColor: 'rgba(244,244,245,0.6)',
                  animation: 'spin 0.9s linear infinite',
                }}
              />
              <span className="text-xs font-medium tracking-[0.25em] text-muted uppercase">
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
  const hideMainContentForTerminal = terminalVisible && terminalMaximized;

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
            !hasActiveIssue && !hasActiveAutomationThread && <ProjectSidebar />
          )}
          {/* Center column — main view above, terminal below. */}
          <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            {!hideMainContentForTerminal && (
              <Suspense fallback={<ViewLoadingFallback />}>
                <div className="flex flex-1 overflow-hidden min-h-0 bg-primary">
                  {hasActiveIssue ? (
                    <IssueDetail />
                  ) : hasActiveAutomationThread ? (
                    <AutomationRunDetail />
                  ) : hasActiveAutomationDetail ? (
                    <AutomationDetail />
                  ) : settingsVisible ? (
                    <SettingsPanel />
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
            {terminalVisible && <TerminalDrawer />}
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
      </div>
    </TooltipProvider>
  );
}
