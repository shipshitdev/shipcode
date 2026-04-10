import type { AppSettings } from '@shipcode/shared'
import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ActivityView } from './components/ActivityView'
import { CommandPalette } from './components/CommandPalette'
import { CreateIssueModal } from './components/CreateIssueModal'
import { DashboardView } from './components/DashboardView'
import { HealthBanner } from './components/HealthBanner'
import { InboxView } from './components/InboxView'
import { IssueDetail } from './components/IssueDetail'
import { NotificationToaster } from './components/NotificationToaster'
import { OnboardingWizard } from './components/onboarding/OnboardingWizard'
import { ProjectSidebar } from './components/ProjectSidebar'
import { SettingsPanel } from './components/SettingsPanel'
import { SettingsSidebar } from './components/SettingsSidebar'
import { TerminalDrawer } from './components/TerminalDrawer'
import { ThreadPanel } from './components/ThreadPanel'
import { Titlebar } from './components/Titlebar'
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard'
import { useIpc } from './hooks/useIpc'
import { useAppStore } from './stores/app-store'

export function App() {
	useGlobalKeyboard()
	useIpc()
	const queryClient = useQueryClient()
	const { terminalVisible, settingsVisible, activeProjectId, viewMode, activeIssue, issueDetailExpanded } = useAppStore()

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

	if (!settings) {
		return (
			<div className="flex h-screen w-screen items-center justify-center bg-primary" style={{ animation: 'fadeIn 0.2s ease-out' }}>
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
		)
	}
	const showDashboard = viewMode === 'dashboard' || !activeProjectId

	return (
		<div className="flex h-screen flex-col overflow-hidden">
			<Titlebar />
			<HealthBanner />
			<div className="flex flex-1 overflow-hidden">
				{settingsVisible ? <SettingsSidebar /> : <ProjectSidebar />}
				<div className="flex flex-1 overflow-hidden">
					{/* Main content — hidden (not unmounted) when issue detail is expanded */}
					<div className={activeIssue && issueDetailExpanded ? 'hidden' : 'flex flex-1 overflow-hidden'}>
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
					</div>
					{/* Issue detail — flex-1 when expanded (full-page), fixed 420px when panel */}
					{activeIssue && (
						<div className={issueDetailExpanded
							? 'flex-1 overflow-hidden'
							: 'w-[420px] shrink-0 border-l border-border overflow-hidden'
						}>
							<IssueDetail expanded={issueDetailExpanded} />
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
