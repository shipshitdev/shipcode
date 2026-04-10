import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { cn, ChevronLeft, ChevronRight, Folder, Plus } from '@shipcode/ui'
import { useAppStore } from '../stores/app-store'
import type { DashboardStats, Project } from '@shipcode/shared'

export function ProjectSidebar() {
	const { activeProjectId, viewMode, selectProject, openDashboard, sidebarCollapsed, toggleSidebar } = useAppStore()
	const queryClient = useQueryClient()

	const { data: projects = [] } = useQuery<Project[]>({
		queryKey: ['projects'],
		queryFn: () => window.shipcode.invoke('project:list'),
	})

	const { data: stats } = useQuery<DashboardStats>({
		queryKey: ['dashboard', 'stats'],
		queryFn: () => window.shipcode.invoke<DashboardStats>('dashboard:get-stats'),
		refetchInterval: 5000,
	})

	const addProject = useMutation({
		mutationFn: async () => {
			const path = await window.shipcode.invoke<string | null>('dialog:open-directory')
			if (!path) return null
			return window.shipcode.invoke<Project>('project:add', { path })
		},
		onSuccess: (project) => {
			if (project) {
				queryClient.invalidateQueries({ queryKey: ['projects'] })
				selectProject(project.id)
			}
		},
	})

	if (sidebarCollapsed) {
		return (
			<aside className="flex w-12 min-w-12 items-start justify-center border-r border-border bg-bg-secondary pt-2">
				<button
					type="button"
					className="cursor-pointer rounded-md border-none bg-transparent p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary"
					onClick={toggleSidebar}
					title="Expand sidebar"
				>
					<ChevronRight size={14} />
				</button>
			</aside>
		)
	}

	const liveCount = stats?.agentsRunning ?? 0

	return (
		<aside className="flex w-[256px] min-w-[256px] flex-col border-r border-border bg-bg-secondary">
			<div className="flex items-center justify-between px-4 py-3">
				<h1 className="text-sm font-semibold tracking-tight text-text-primary">ShipCode</h1>
				<button
					type="button"
					className="cursor-pointer rounded-md border-none bg-transparent p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary"
					onClick={toggleSidebar}
					title="Collapse sidebar"
				>
					<ChevronLeft size={14} />
				</button>
			</div>

			<div className="px-2">
				<button
					type="button"
					className={cn(
						'flex w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-3 py-2 text-left text-[13px] text-text-secondary app-region-no-drag hover:bg-bg-hover hover:text-text-primary',
						viewMode === 'dashboard' && 'bg-bg-tertiary text-text-primary',
					)}
					onClick={() => openDashboard()}
				>
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-text-muted">
						<rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
						<rect x="9" y="1.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
						<rect x="1.5" y="9" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
						<rect x="9" y="9" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
					</svg>
					<span className="flex-1 truncate">Dashboard</span>
					{liveCount > 0 && (
						<span className="inline-flex items-center gap-1 rounded-full bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-medium text-accent">
							<span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
							{liveCount} live
						</span>
					)}
				</button>
			</div>

			<div className="mt-3 px-4 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
				Projects
			</div>

			<div className="flex-1 overflow-y-auto px-2 py-1">
				{projects.map((project) => (
					<button
						type="button"
						key={project.id}
						className={cn(
							'flex w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-3 py-2 text-left text-[13px] text-text-secondary app-region-no-drag hover:bg-bg-hover hover:text-text-primary',
							viewMode === 'project' && activeProjectId === project.id && 'bg-bg-tertiary text-text-primary',
						)}
						onClick={() => selectProject(project.id)}
					>
						<Folder size={14} className="shrink-0 text-text-muted" />
						<span className="truncate">{project.name}</span>
					</button>
				))}
			</div>

			<button
				type="button"
				className="m-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-transparent px-3 py-2 text-xs text-text-secondary app-region-no-drag hover:border-border-strong hover:text-text-primary"
				onClick={() => addProject.mutate()}
			>
				<Plus size={12} />
				Add Repository
			</button>
		</aside>
	)
}
