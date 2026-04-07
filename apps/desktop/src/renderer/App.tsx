import { useAppStore } from './stores/app-store'
import { useIpc } from './hooks/useIpc'
import { ProjectSidebar } from './components/ProjectSidebar'
import { ThreadPanel } from './components/ThreadPanel'
import { ActiveThread } from './components/ActiveThread'
import { TerminalDrawer } from './components/TerminalDrawer'
import { HealthBanner } from './components/HealthBanner'

export function App() {
	const { terminalVisible } = useAppStore()

	return (
		<div className="app">
			<HealthBanner />
			<div className="app__layout">
				<ProjectSidebar />
				<ThreadPanel />
				<ActiveThread />
			</div>
			{terminalVisible && <TerminalDrawer />}
		</div>
	)
}
