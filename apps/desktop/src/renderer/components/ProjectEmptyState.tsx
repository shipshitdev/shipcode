import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Project } from '@shipcode/shared'
import { Folder, Plus } from '@shipcode/ui'
import { useAppStore } from '../stores/app-store'

export function ProjectEmptyState() {
	const { selectProject } = useAppStore()
	const queryClient = useQueryClient()

	const { data: projects = [] } = useQuery<Project[]>({
		queryKey: ['projects'],
		queryFn: () => window.shipcode.invoke('project:list'),
	})

	const recent = [...projects]
		.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
		.slice(0, 6)

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

	return (
		<div className="flex flex-1 items-center justify-center overflow-auto bg-bg-primary px-8">
			<div className="w-full max-w-xl">
				<div className="mb-8 text-center">
					<h2 className="mb-2 text-lg font-semibold text-text-primary">Select a project to get started</h2>
					<p className="text-sm text-text-secondary">Pick a recent repository or add a new one.</p>
				</div>

				{recent.length > 0 && (
					<div className="mb-6">
						<div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
							Recent
						</div>
						<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
							{recent.map((project) => (
								<button
									key={project.id}
									type="button"
									onClick={() => selectProject(project.id)}
									className="group flex items-center gap-3 rounded-xl border border-border bg-bg-elevated px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-bg-hover"
								>
									<Folder size={16} className="shrink-0 text-text-muted group-hover:text-text-primary" />
									<div className="min-w-0 flex-1">
										<div className="truncate text-[13px] font-medium text-text-primary">
											{project.name}
										</div>
										<div className="truncate text-[11px] text-text-muted">
											{project.path}
										</div>
									</div>
								</button>
							))}
						</div>
					</div>
				)}

				<button
					type="button"
					onClick={() => addProject.mutate()}
					className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-transparent px-4 py-3 text-[13px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
				>
					<Plus size={14} />
					Add a repository
				</button>
			</div>
		</div>
	)
}
