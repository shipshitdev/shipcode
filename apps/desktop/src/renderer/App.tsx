import { useAppStore } from './stores/app-store'
import { useIpc } from './hooks/useIpc'
import { ProjectSidebar } from './components/ProjectSidebar'
import { ThreadPanel } from './components/ThreadPanel'
import { ActiveThread } from './components/ActiveThread'
import { SettingsPanel } from './components/SettingsPanel'
import { TerminalDrawer } from './components/TerminalDrawer'
import { HealthBanner } from './components/HealthBanner'

export function App() {
	const { terminalVisible, settingsVisible, kanbanView, toggleSettings } = useAppStore()

	return (
		<div className="app">
			<HealthBanner />
			<div className="app__layout">
				<ProjectSidebar />
				<ThreadPanel />
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
