import type { AppSettings, Project } from '@shipcode/shared';
import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { ActivityView } from './components/ActivityView';
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
import { SettingsPanel } from './components/SettingsPanel';
import { SettingsSidebar } from './components/SettingsSidebar';
import { SkillsView } from './components/SkillsView';
import { TerminalDrawer } from './components/TerminalDrawer';
import { ThreadPanel } from './components/ThreadPanel';
import { Titlebar } from './components/Titlebar';
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard';
import { useIpc } from './hooks/useIpc';
import { useAppStore } from './stores/app-store';

type ProjectWithPathState = Project & { pathExists?: boolean };

const ISSUE_DETAIL_MIN_WIDTH = 380;
const ISSUE_DETAIL_MAX_WIDTH = 760;

export function App() {
  useGlobalKeyboard();
  useIpc();
  const queryClient = useQueryClient();
  const {
    terminalVisible,
    settingsVisible,
    activeProjectId,
    viewMode,
    activeIssue,
    issueDetailExpanded,
    issueDetailCollapsed,
    issueDetailWidth,
    setIssueDetailWidth,
  } = useAppStore();
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
  });

  const { data: activeProject } = useQuery<ProjectWithPathState | null>({
    queryKey: ['project', activeProjectId],
    queryFn: () => window.shipcode.invoke('project:get', { projectId: activeProjectId! }),
    enabled: !!activeProjectId,
  });

  if (settings && (settings.onboardingVersion ?? 0) < CURRENT_ONBOARDING_VERSION) {
    return (
      <OnboardingWizard
        onComplete={async (newProjectId?: string) => {
          queryClient.invalidateQueries({ queryKey: ['settings'] });
          queryClient.invalidateQueries({ queryKey: ['health'] });
          if (newProjectId) {
            queryClient.invalidateQueries({ queryKey: ['projects-visible'] });
            useAppStore.getState().selectProject(newProjectId);
            window.shipcode
              .invoke('github:refresh-issues', { projectId: newProjectId })
              .catch(() => {});
          } else {
            const projects = await queryClient.fetchQuery<Project[]>({
              queryKey: ['projects-visible'],
              queryFn: () => window.shipcode.invoke('project:list-visible'),
            });
            if (projects && projects.length > 0) {
              useAppStore.getState().selectProject(projects[0].id);
            }
          }
        }}
      />
    );
  }

  if (!settings) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center bg-primary"
        style={{ animation: 'fadeIn 0.2s ease-out' }}
      >
        <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
        <div className="flex flex-col items-center gap-6">
          <div
            className="h-10 w-10 rounded-full"
            style={{
              border: '1.5px solid rgba(244,244,245,0.08)',
              borderTopColor: 'rgba(244,244,245,0.6)',
              animation: 'spin 0.9s linear infinite',
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          <span className="text-xs font-medium tracking-[0.25em] text-muted uppercase">
            ShipCode
          </span>
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
  const hideSidebarForReader = !!activeIssue && issueDetailExpanded && !settingsVisible;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Titlebar />
      <HealthBanner />
      <ProjectPathBanner project={activeProject ?? null} />
      <div className="flex flex-1 overflow-hidden">
        {!hideSidebarForReader && (settingsVisible ? <SettingsSidebar /> : <ProjectSidebar />)}
        {/* Content: left column (views + terminal) | right panel (issue detail, full-height) */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left column — main views stacked above terminal */}
          <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            <div className="flex flex-1 overflow-hidden min-h-0">
              {/* Main view — hidden when issue detail is expanded full-screen */}
              <div
                className={
                  activeIssue && issueDetailExpanded ? 'hidden' : 'flex flex-1 overflow-hidden'
                }
              >
                {settingsVisible ? (
                  <SettingsPanel />
                ) : viewMode === 'activity' ? (
                  <ActivityView />
                ) : viewMode === 'costs' ? (
                  <CostsView />
                ) : viewMode === 'skills' ? (
                  <SkillsView />
                ) : viewMode === 'inbox' ? (
                  <InboxView />
                ) : showOverview ? (
                  <OverviewView />
                ) : showMissingProject && activeProject ? (
                  <ProjectMissingView project={activeProject} />
                ) : (
                  <ThreadPanel />
                )}
              </div>
              {/* Expanded issue detail takes over the left column entirely */}
              {activeIssue && issueDetailExpanded && (
                <div className="flex-1 overflow-hidden">
                  <IssueDetail expanded={true} />
                </div>
              )}
            </div>
            {terminalVisible && <TerminalDrawer />}
          </div>
          {/* Right panel — full height, spans over the terminal */}
          {activeIssue && !issueDetailExpanded && !issueDetailCollapsed && (
            <div
              className="relative shrink-0 border-l border-border overflow-hidden"
              style={{
                width: issueDetailWidth,
                minWidth: ISSUE_DETAIL_MIN_WIDTH,
                maxWidth: ISSUE_DETAIL_MAX_WIDTH,
              }}
            >
              <div
                className="absolute inset-y-0 left-0 z-10 w-1 -translate-x-1/2 cursor-col-resize transition-colors hover:bg-accent/20 active:bg-accent/30"
                onMouseDown={handleIssueDetailResizeMouseDown}
              />
              <IssueDetail expanded={false} />
            </div>
          )}
        </div>
      </div>
      <CommandPalette />
      <CreateIssueModal />
      <ProjectSettingsModal />
      <NotificationToaster />
    </div>
  );
}
