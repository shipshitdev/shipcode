import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AppSettings } from '@shipcode/shared'
import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared'
import { useAppStore } from './stores/app-store'
import { Titlebar } from './components/Titlebar'
import { ProjectSidebar } from './components/ProjectSidebar'
import { DashboardView } from './components/DashboardView'
import { ThreadPanel } from './components/ThreadPanel'
import { IssueDetail } from './components/IssueDetail'
import { SettingsPanel } from './components/SettingsPanel'
import { SettingsSidebar } from './components/SettingsSidebar'
import { ActivityView } from './components/ActivityView'
import { InboxView } from './components/InboxView'
import { TerminalDrawer } from './components/TerminalDrawer'
import { HealthBanner } from './components/HealthBanner'
import { OnboardingWizard } from './components/onboarding/OnboardingWizard'
import { CommandPalette } from './components/CommandPalette'
import { CreateIssueModal } from './components/CreateIssueModal'
import { NotificationToaster } from './components/NotificationToaster'
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard'
import { useIpc } from './hooks/useIpc'

export function App() {
	useGlobalKeyboard()
	useIpc()
	const queryClient = useQueryClient()
	const { terminalVisible, settingsVisible, activeProjectId, viewMode, activeIssue } = useAppStore()

	const { data: settings } = useQuery<AppSettings>({
		queryKey: ['settings'],
		queryFn: () => window.shipcode.invoke('settings:get'),
	})

	if (settings && (settings.onboardingVersion ?? 0) < CURRENT_ONBOARDING_VERSION) {
		return (
			<OnboardingWizard
				onComplete={() => {
					queryClient.invalidateQueries({ queryKey: ['settings'] })
					queryClient.invalidateQueries({ queryKey: ['health'] })
				}}
			/>
		)
	}

	if (!settings) return null

	const showDashboard = viewMode === 'dashboard' || !activeProjectId

	return (
		<div className="flex h-screen flex-col overflow-hidden">
			<Titlebar />
			<HealthBanner />
			<div className="flex flex-1 overflow-hidden">
				{settingsVisible ? <SettingsSidebar /> : <ProjectSidebar />}
				<div className="flex flex-1 overflow-hidden">
					{settingsVisible ? (
						<SettingsPanel />
					) : viewMode === 'activity' ? (
						<ActivityView />
					) : viewMode === 'inbox' ? (
						<InboxView />
					) : showDashboard ? (
						<DashboardView />
					) : (
						<ThreadPanel />
					)}
					{activeIssue && (
						<div className="w-[420px] shrink-0 border-l border-border overflow-hidden">
							<IssueDetail />
						</div>
					)}
				</div>
			</div>
			{terminalVisible && <TerminalDrawer />}
			<CommandPalette />
			<CreateIssueModal />
			<NotificationToaster />
		</div>
	)
}
