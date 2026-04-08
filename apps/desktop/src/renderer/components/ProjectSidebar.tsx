import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { cn } from '@shipcode/ui'
import { useAppStore } from '../stores/app-store'
import type { Project } from '@shipcode/shared'

export function ProjectSidebar() {
	const { activeProjectId, selectProject, sidebarCollapsed, toggleSidebar } = useAppStore()
	const queryClient = useQueryClient()

	const { data: projects = [] } = useQuery<Project[]>({
		queryKey: ['projects'],
		queryFn: () => window.shipcode.invoke('project:list'),
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
			<aside className="flex w-12 min-w-12 items-start justify-center border-r border-border bg-bg-secondary pt-[var(--titlebar-height)] app-region-drag">
				<button
					type="button"
					className="cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-text-secondary app-region-no-drag hover:text-text-primary"
					onClick={toggleSidebar}
				>
					▶
				</button>
			</aside>
		)
	}

	return (
		<aside className="flex w-[220px] min-w-[220px] flex-col border-r border-border bg-bg-secondary app-region-drag">
			<div className="flex items-center justify-between px-4 py-3 pt-[calc(var(--spacing-titlebar)+4px)] app-region-drag">
				<h1 className="text-sm font-bold tracking-tight text-text-primary">ShipCode</h1>
				<button
					type="button"
					className="cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-text-secondary app-region-no-drag hover:text-text-primary"
					onClick={toggleSidebar}
				>
					◀
				</button>
			</div>

			<div className="flex-1 overflow-y-auto px-2 py-1">
				{projects.map((project) => (
					<button
						type="button"
						key={project.id}
						className={cn(
							'flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius)] border-none bg-transparent px-3 py-2 text-left text-[13px] text-text-secondary app-region-no-drag hover:bg-bg-hover hover:text-text-primary',
							activeProjectId === project.id && 'bg-bg-tertiary text-text-primary',
						)}
						onClick={() => selectProject(project.id)}
					>
						<span>📁</span>
						<span>{project.name}</span>
					</button>
				))}
			</div>

			<button
				type="button"
				className="m-2 cursor-pointer rounded-[var(--radius)] border border-dashed border-border bg-transparent px-3 py-2 text-xs text-text-secondary app-region-no-drag hover:border-accent hover:text-accent"
				onClick={() => addProject.mutate()}
			>
				+ Add Repository
			</button>
		</aside>
	)
}
