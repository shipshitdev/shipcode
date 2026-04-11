import type { AppSettings, Project } from '@shipcode/shared';
import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityView } from './components/ActivityView';
import { CostsView } from './components/CostsView';
import { CommandPalette } from './components/CommandPalette';
import { CreateIssueModal } from './components/CreateIssueModal';
import { DashboardView } from './components/DashboardView';
import { HealthBanner } from './components/HealthBanner';
import { InboxView } from './components/InboxView';
import { IssueDetail } from './components/IssueDetail';
import { NotificationToaster } from './components/NotificationToaster';
import { OnboardingWizard } from './components/onboarding/OnboardingWizard';
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
  } = useAppStore();

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke('settings:get'),
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
            window.shipcode.invoke('github:refresh-issues', { projectId: newProjectId }).catch(() => {});
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
  const showDashboard = viewMode === 'dashboard' || !activeProjectId;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Titlebar />
      <HealthBanner />
      <div className="flex flex-1 overflow-hidden">
        {settingsVisible ? <SettingsSidebar /> : <ProjectSidebar />}
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
                ) : showDashboard ? (
                  <DashboardView />
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
            <div className="w-[420px] shrink-0 border-l border-border overflow-hidden">
              <IssueDetail expanded={false} />
            </div>
          )}
        </div>
      </div>
      <CommandPalette />
      <CreateIssueModal />
      <NotificationToaster />
    </div>
  );
}
