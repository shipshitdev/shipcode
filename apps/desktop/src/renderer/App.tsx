import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AppSettings } from '@shipcode/shared'
import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared'
import { useAppStore } from './stores/app-store'
import { ProjectSidebar } from './components/ProjectSidebar'
import { ThreadPanel } from './components/ThreadPanel'
import { ActiveThread } from './components/ActiveThread'
import { IssueDetail } from './components/IssueDetail'
import { SettingsPanel } from './components/SettingsPanel'
import { TerminalDrawer } from './components/TerminalDrawer'
import { HealthBanner } from './components/HealthBanner'
import { OnboardingWizard } from './components/onboarding/OnboardingWizard'

export function App() {
	const queryClient = useQueryClient()
	const { terminalVisible, settingsVisible, kanbanView, activeIssue, toggleSettings } = useAppStore()

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
		<div className="app">
			<HealthBanner />
			<div className="app__layout">
				<ProjectSidebar />
				<ThreadPanel />
				{kanbanView && activeIssue && <IssueDetail />}
				{!kanbanView && (settingsVisible ? <SettingsPanel /> : <ActiveThread />)}
			</div>
			<button
				type="button"
				className="app__settings-toggle"
				onClick={toggleSettings}
				title="Toggle Settings"
			>
				{settingsVisible ? '✕' : '⚙'}
			</button>
			{terminalVisible && <TerminalDrawer />}
		</div>
	)
}
