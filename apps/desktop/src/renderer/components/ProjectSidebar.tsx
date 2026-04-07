import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
			<aside className="sidebar sidebar--collapsed">
				<button type="button" className="sidebar__toggle" onClick={toggleSidebar}>
					▶
				</button>
			</aside>
		)
	}

	return (
		<aside className="sidebar">
			<div className="sidebar__header">
				<h1 className="sidebar__title">ShipCode</h1>
				<button type="button" className="sidebar__toggle" onClick={toggleSidebar}>
					◀
				</button>
			</div>

			<div className="sidebar__projects">
				{projects.map((project) => (
					<button
						type="button"
						key={project.id}
						className={`sidebar__project ${activeProjectId === project.id ? 'sidebar__project--active' : ''}`}
						onClick={() => selectProject(project.id)}
					>
						<span className="sidebar__project-icon">📁</span>
						<span className="sidebar__project-name">{project.name}</span>
					</button>
				))}
			</div>

			<button
				type="button"
				className="sidebar__add-project"
				onClick={() => addProject.mutate()}
			>
				+ Add Repository
			</button>
		</aside>
	)
}
