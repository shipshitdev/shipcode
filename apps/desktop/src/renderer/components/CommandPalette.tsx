import { Command } from 'cmdk'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../stores/app-store'

export function CommandPalette() {
	const queryClient = useQueryClient()
	const {
		commandPaletteOpen,
		toggleCommandPalette,
		openCreateIssueModal,
		activeProjectId,
		activeThreadId,
		pipelinePhase,
		toggleTerminal,
		toggleSettings,
		toggleKanbanView,
		kanbanView,
	} = useAppStore()

	const close = () => toggleCommandPalette()

	const runAction = (fn: () => void | Promise<void>) => {
		close()
		fn()
	}

	return (
		<Command.Dialog
			open={commandPaletteOpen}
			onOpenChange={toggleCommandPalette}
			label="Command Palette"
			className="command-palette"
		>
			<Command.Input
				className="command-palette__input"
				placeholder="Type a command..."
			/>
			<Command.List className="command-palette__list">
				<Command.Empty className="command-palette__empty">
					No commands found.
				</Command.Empty>

				<Command.Group heading="GitHub" className="command-palette__group">
					{activeProjectId && (
						<>
							<Command.Item
								className="command-palette__item"
								onSelect={() => runAction(() => openCreateIssueModal())}
							>
								<span className="command-palette__item-label">Create Issue...</span>
							</Command.Item>
							<Command.Item
								className="command-palette__item"
								onSelect={() => runAction(async () => {
									await window.shipcode.invoke('github:refresh-issues', { projectId: activeProjectId })
									queryClient.invalidateQueries({ queryKey: ['github-issues'] })
								})}
							>
								<span className="command-palette__item-label">Refresh Issues</span>
							</Command.Item>
						</>
					)}
				</Command.Group>

				{activeThreadId && (
					<Command.Group heading="Pipeline" className="command-palette__group">
						{pipelinePhase === 'idle' && (
							<Command.Item
								className="command-palette__item"
								onSelect={() => runAction(() =>
									window.shipcode.invoke('pipeline:start', { threadId: activeThreadId })
								)}
							>
								<span className="command-palette__item-label">Start Pipeline</span>
								<kbd className="command-palette__kbd">⌘↩</kbd>
							</Command.Item>
						)}
						{pipelinePhase === 'awaiting_approval' && (
							<>
								<Command.Item
									className="command-palette__item"
									onSelect={() => runAction(() =>
										window.shipcode.invoke('pipeline:approve', { threadId: activeThreadId })
									)}
								>
									<span className="command-palette__item-label">Approve Plan</span>
								</Command.Item>
								<Command.Item
									className="command-palette__item"
									onSelect={() => runAction(() =>
										window.shipcode.invoke('pipeline:reject', { threadId: activeThreadId, feedback: '' })
									)}
								>
									<span className="command-palette__item-label">Reject Plan</span>
								</Command.Item>
							</>
						)}
						<Command.Item
							className="command-palette__item"
							onSelect={() => runAction(() =>
								window.shipcode.invoke('pipeline:cancel', { threadId: activeThreadId })
							)}
						>
							<span className="command-palette__item-label">Cancel Pipeline</span>
						</Command.Item>
					</Command.Group>
				)}

				<Command.Group heading="Navigation" className="command-palette__group">
					<Command.Item
						className="command-palette__item"
						onSelect={() => runAction(() => toggleTerminal())}
					>
						<span className="command-palette__item-label">Toggle Terminal</span>
						<kbd className="command-palette__kbd">Ctrl+`</kbd>
					</Command.Item>
					<Command.Item
						className="command-palette__item"
						onSelect={() => runAction(() => toggleSettings())}
					>
						<span className="command-palette__item-label">Toggle Settings</span>
					</Command.Item>
					<Command.Item
						className="command-palette__item"
						onSelect={() => runAction(() => toggleKanbanView())}
					>
						<span className="command-palette__item-label">
							Switch to {kanbanView ? 'List' : 'Kanban'} View
						</span>
					</Command.Item>
				</Command.Group>

				{activeProjectId && (
					<Command.Group heading="Git" className="command-palette__group">
						<Command.Item
							className="command-palette__item"
							onSelect={() => runAction(() =>
								window.shipcode.invoke('git:commit', { projectId: activeProjectId, message: '' })
							)}
						>
							<span className="command-palette__item-label">Commit Changes</span>
							<kbd className="command-palette__kbd">⌘⇧C</kbd>
						</Command.Item>
						<Command.Item
							className="command-palette__item"
							onSelect={() => runAction(() =>
								window.shipcode.invoke('git:push', { projectId: activeProjectId })
							)}
						>
							<span className="command-palette__item-label">Push to Remote</span>
							<kbd className="command-palette__kbd">⌘⇧P</kbd>
						</Command.Item>
					</Command.Group>
				)}
			</Command.List>
		</Command.Dialog>
	)
}
