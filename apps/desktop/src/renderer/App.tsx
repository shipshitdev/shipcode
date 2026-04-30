import type { AppSettings, Project, TelemetryStatus } from '@shipcode/shared';
import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared';
import { Button } from '@shipshitdev/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { ActivityView } from './components/ActivityView';
import { AutomationRunDetail } from './components/AutomationRunDetail';
import { AutomationsView } from './components/AutomationsView';
import { CommandPalette } from './components/CommandPalette';
import { CostsView } from './components/CostsView';
import { CreateIssueModal } from './components/CreateIssueModal';
import { HealthBanner } from './components/HealthBanner';
import { InboxView } from './components/InboxView';
import { IssueDetail } from './components/IssueDetail';
import { NotificationToaster } from './components/NotificationToaster';
import { OverviewView } from './components/OverviewView';
import { OnboardingWizard } from './components/onboarding/OnboardingWizard';
import { ProjectMissingView } from './components/ProjectMissingView';
import { ProjectPathBanner } from './components/ProjectPathBanner';
import { ProjectSettingsModal } from './components/ProjectSettingsModal';
import { ProjectSidebar } from './components/ProjectSidebar';
import { ProjectView } from './components/ProjectView';
import { SettingsPanel } from './components/SettingsPanel';
import { SettingsSidebar } from './components/SettingsSidebar';
import { SkillsView } from './components/SkillsView';
import { TelemetryConsentDialog } from './components/TelemetryConsentDialog';
import { TerminalDrawer } from './components/TerminalDrawer';
import { Titlebar } from './components/Titlebar';
import { UpdateBanner } from './components/UpdateBanner';
import { CreateAutomationModal } from './features/automations/create-automation-modal';
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard';
import { useIpc } from './hooks/useIpc';
import { STABLE_APP_STATE_STALE_TIME } from './query-stale-times';
import { useAppStore } from './stores/app-store';
import { syncRendererTelemetry } from './telemetry';

const ISSUE_DETAIL_MIN_WIDTH = 380;
const ISSUE_DETAIL_MAX_WIDTH = 760;

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
  const issueDetailExpanded = useAppStore((state) => state.issueDetailExpanded);
  const issueDetailCollapsed = useAppStore((state) => state.issueDetailCollapsed);
  const issueDetailWidth = useAppStore((state) => state.issueDetailWidth);
  const setIssueDetailWidth = useAppStore((state) => state.setIssueDetailWidth);
  const issueDetailDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleIssueDetailResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      issueDetailDragRef.current = { startX: e.clientX, startWidth: issueDetailWidth };
      const onMove = (event: MouseEvent) => {
        if (!issueDetailDragRef.current) return;
        const delta = event.clientX - issueDetailDragRef.current.startX;
        const nextWidth = Math.min(
          ISSUE_DETAIL_MAX_WIDTH,
          Math.max(ISSUE_DETAIL_MIN_WIDTH, issueDetailDragRef.current.startWidth - delta),
        );
        setIssueDetailWidth(nextWidth);
      };
      const onUp = () => {
        issueDetailDragRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [issueDetailWidth, setIssueDetailWidth],
  );

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke('settings:get'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const { data: telemetryStatus } = useQuery<TelemetryStatus>({
    queryKey: ['telemetry-status'],
    queryFn: () => window.shipcode.invoke('telemetry:get-status'),
    enabled: !!settings,
    staleTime: STABLE_APP_STATE_STALE_TIME,
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
  const hideSidebarForReader =
    (hasActiveIssue || hasActiveAutomationThread) && issueDetailExpanded && !settingsVisible;
  const hideMainContentForTerminal = terminalVisible && terminalMaximized;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Titlebar />
      <UpdateBanner />
      <HealthBanner />
      <ProjectPathBanner project={activeProject ?? null} />
      <div className="flex flex-1 overflow-hidden">
        {!hideSidebarForReader && (settingsVisible ? <SettingsSidebar /> : <ProjectSidebar />)}
        {/* Center column — main view above, terminal below. Right detail
            panel is a sibling (not nested), so the terminal sits BETWEEN
            the sidebar and the detail panel (Cursor-style) and resizes as
            either flank opens or closes. */}
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
          {!hideMainContentForTerminal && (
            <div className="flex flex-1 overflow-hidden min-h-0 bg-primary">
              {hasActiveIssue && issueDetailExpanded ? (
                <IssueDetail expanded={true} />
              ) : hasActiveAutomationThread && issueDetailExpanded ? (
                <AutomationRunDetail expanded={true} />
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
          )}
          {terminalVisible && <TerminalDrawer />}
        </div>
        {/* Right detail panel — full row height, flanks both the upper
            view and the terminal. Hidden when expanded (it takes over the
            center column instead) or when collapsed. */}
        {(hasActiveIssue || hasActiveAutomationThread) &&
          !issueDetailExpanded &&
          !issueDetailCollapsed && (
            <div
              data-slot="overlay-panel"
              className="pointer-events-auto relative flex h-full flex-shrink-0 flex-col overflow-hidden border-l border-border bg-primary shadow-[-16px_0_40px_rgba(0,0,0,0.35)]"
              style={{
                width: issueDetailWidth,
                minWidth: ISSUE_DETAIL_MIN_WIDTH,
                maxWidth: ISSUE_DETAIL_MAX_WIDTH,
              }}
            >
              <button
                type="button"
                aria-label="Resize issue detail panel"
                className="absolute inset-y-0 left-0 z-10 w-1 -translate-x-1/2 cursor-col-resize transition-colors hover:bg-accent/20 active:bg-accent/30"
                onMouseDown={handleIssueDetailResizeMouseDown}
              />
              {hasActiveIssue ? (
                <IssueDetail expanded={false} />
              ) : (
                <AutomationRunDetail expanded={false} />
              )}
            </div>
          )}
      </div>
      <CommandPalette />
      <CreateIssueModal />
      <CreateAutomationModal />
      <ProjectSettingsModal />
      <TelemetryConsentDialog
        open={
          settings.telemetryEnabled == null &&
          telemetryStatus?.dsnConfigured === true &&
          telemetryStatus.envDisabled === false
        }
      />
      <NotificationToaster />
    </div>
  );
}
