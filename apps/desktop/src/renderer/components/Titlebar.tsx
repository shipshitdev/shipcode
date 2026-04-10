import { useQuery } from '@tanstack/react-query'
import type { DashboardStats, Project } from '@shipcode/shared'
import { Settings, X, PanelLeftOpen } from '@shipcode/ui'
import { useAppStore } from '../stores/app-store'

export function Titlebar() {
	const { settingsVisible, toggleSettings, openDashboard, activeProjectId, sidebarCollapsed, toggleSidebar } = useAppStore()

	const { data: projects = [] } = useQuery<Project[]>({
		queryKey: ['projects'],
		queryFn: () => window.shipcode.invoke('project:list'),
	})

	const { data: stats } = useQuery<DashboardStats>({
		queryKey: ['dashboard', 'stats'],
		queryFn: () => window.shipcode.invoke<DashboardStats>('dashboard:get-stats'),
		refetchInterval: 5000,
	})

	const activeProject = activeProjectId
		? projects.find((p) => p.id === activeProjectId) ?? null
		: null

	const liveCount = stats?.agentsRunning ?? 0

	return (
		<div className="relative flex h-[var(--spacing-titlebar)] shrink-0 items-center justify-between border-b border-border bg-primary pl-[84px] pr-2 app-region-drag">
			<div className="flex min-w-0 items-center gap-2 text-xs">
				{sidebarCollapsed && (
					<button
						type="button"
						className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-secondary app-region-no-drag hover:bg-hover hover:text-primary focus:outline-none"
						onClick={toggleSidebar}
						title="Show sidebar"
					>
						<PanelLeftOpen size={14} />
					</button>
				)}
				{activeProject ? (
					<>
						<span className="text-muted">ShipCode</span>
						<span className="text-muted">/</span>
						<span className="truncate text-primary">{activeProject.name}</span>
					</>
				) : (
					<span className="font-semibold tracking-tight text-primary">ShipCode</span>
				)}
			</div>
			<div className="flex items-center gap-2">
				{liveCount > 0 && (
					<button
						type="button"
						onClick={() => openDashboard()}
						className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2 text-[11px] font-medium text-accent app-region-no-drag hover:bg-accent/20"
						title="Open Mission Control"
					>
						<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
						{liveCount} running
					</button>
				)}
				<button
					type="button"
					className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-secondary app-region-no-drag hover:bg-elevated hover:text-primary transition-colors"
					onClick={toggleSettings}
					title="Toggle Settings"
				>
					{settingsVisible ? <X size={14} /> : <Settings size={14} />}
				</button>
			</div>
		</div>
	)
}
