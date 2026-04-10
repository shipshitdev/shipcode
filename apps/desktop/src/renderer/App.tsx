import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AppSettings } from '@shipcode/shared'
import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared'
import { useAppStore } from './stores/app-store'
import { Titlebar } from './components/Titlebar'
import { ProjectSidebar } from './components/ProjectSidebar'
import { ProjectEmptyState } from './components/ProjectEmptyState'
import { ThreadPanel } from './components/ThreadPanel'
import { IssueDetail } from './components/IssueDetail'
import { SettingsPanel } from './components/SettingsPanel'
import { TerminalDrawer } from './components/TerminalDrawer'
import { HealthBanner } from './components/HealthBanner'
import { OnboardingWizard } from './components/onboarding/OnboardingWizard'
import { CommandPalette } from './components/CommandPalette'
import { CreateIssueModal } from './components/CreateIssueModal'
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard'
import { useIpc } from './hooks/useIpc'

export function App() {
	useGlobalKeyboard()
	useIpc()
	const queryClient = useQueryClient()
	const { terminalVisible, settingsVisible, activeIssue, activeProjectId } = useAppStore()

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

	return (
		<div className="flex h-screen flex-col overflow-hidden">
			<Titlebar />
			<HealthBanner />
			<div className="flex flex-1 overflow-hidden">
				<ProjectSidebar />
				{!activeProjectId ? (
					<ProjectEmptyState />
				) : settingsVisible ? (
					<SettingsPanel />
				) : (
					<>
						<ThreadPanel />
						{activeIssue && <IssueDetail />}
					</>
				)}
			</div>
			{terminalVisible && <TerminalDrawer />}
			<CommandPalette />
			<CreateIssueModal />
		</div>
	)
}
