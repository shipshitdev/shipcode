import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { cn, ChevronLeft, ChevronRight, Folder, Plus } from '@shipcode/ui'
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

	return (
		<aside className="flex w-[256px] min-w-[256px] flex-col border-r border-border bg-bg-secondary">
			<div className="flex items-center justify-between px-4 py-3">
				<h1 className="text-sm font-semibold tracking-tight text-text-primary">Projects</h1>
				<button
					type="button"
					className="cursor-pointer rounded-md border-none bg-transparent p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary"
					onClick={toggleSidebar}
					title="Collapse sidebar"
				>
					<ChevronLeft size={14} />
				</button>
			</div>

			<div className="flex-1 overflow-y-auto px-2 py-1">
				{projects.map((project) => (
					<button
						type="button"
						key={project.id}
						className={cn(
							'flex w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-3 py-2 text-left text-[13px] text-text-secondary app-region-no-drag hover:bg-bg-hover hover:text-text-primary',
							activeProjectId === project.id && 'bg-bg-tertiary text-text-primary',
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
