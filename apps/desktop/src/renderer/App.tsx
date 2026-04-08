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
import { CommandPalette } from './components/CommandPalette'
import { CreateIssueModal } from './components/CreateIssueModal'
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard'
import { useIpc } from './hooks/useIpc'

export function App() {
	useGlobalKeyboard()
	useIpc()
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
		<div className="flex h-screen flex-col overflow-hidden">
			<HealthBanner />
			<div className="flex flex-1 overflow-hidden">
				<ProjectSidebar />
				<ThreadPanel />
				{kanbanView && activeIssue && <IssueDetail />}
				{!kanbanView && (settingsVisible ? <SettingsPanel /> : <ActiveThread />)}
			</div>
			<button
				type="button"
				className="fixed top-[calc(var(--titlebar-height)+8px)] right-3 z-100 flex h-7 w-7 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-border bg-bg-tertiary text-sm text-text-secondary app-region-no-drag hover:bg-bg-hover hover:text-text-primary"
				onClick={toggleSettings}
				title="Toggle Settings"
			>
				{settingsVisible ? '✕' : '⚙'}
			</button>
			{terminalVisible && <TerminalDrawer />}
			<CommandPalette />
			<CreateIssueModal />
		</div>
	)
}
