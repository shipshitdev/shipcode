import { useQuery } from '@tanstack/react-query'
import type { Project } from '@shipcode/shared'
import { Settings, X } from '@shipcode/ui'
import { useAppStore } from '../stores/app-store'

export function Titlebar() {
	const { settingsVisible, toggleSettings, activeProjectId } = useAppStore()

	const { data: projects = [] } = useQuery<Project[]>({
		queryKey: ['projects'],
		queryFn: () => window.shipcode.invoke('project:list'),
	})

	const activeProject = activeProjectId
		? projects.find((p) => p.id === activeProjectId) ?? null
		: null

	return (
		<div className="relative flex h-[var(--spacing-titlebar)] shrink-0 items-center justify-between border-b border-border bg-bg-primary pl-[84px] pr-2 app-region-drag">
			<div className="flex min-w-0 items-center gap-2 text-xs">
				{activeProject ? (
					<>
						<span className="text-text-muted">ShipCode</span>
						<span className="text-text-muted">/</span>
						<span className="truncate text-text-primary">{activeProject.name}</span>
					</>
				) : (
					<span className="font-semibold tracking-tight text-text-primary">ShipCode</span>
				)}
			</div>
			<button
				type="button"
				className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border bg-bg-elevated text-text-secondary app-region-no-drag hover:bg-bg-hover hover:text-text-primary"
				onClick={toggleSettings}
				title="Toggle Settings"
			>
				{settingsVisible ? <X size={14} /> : <Settings size={14} />}
			</button>
		</div>
	)
}
