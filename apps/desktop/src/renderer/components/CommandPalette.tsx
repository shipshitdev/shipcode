import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../stores/app-store'
import {
	CommandDialog,
	CommandInput,
	CommandList,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandShortcut,
} from '@shipcode/ui'

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
	} = useAppStore()

	const close = () => toggleCommandPalette()

	const runAction = (fn: () => void | Promise<void>) => {
		close()
		fn()
	}

	return (
		<CommandDialog
			open={commandPaletteOpen}
			onOpenChange={toggleCommandPalette}
		>
			<CommandInput placeholder="Type a command..." />
			<CommandList>
				<CommandEmpty>No commands found.</CommandEmpty>

				<CommandGroup heading="GitHub">
					{activeProjectId && (
						<>
							<CommandItem
								onSelect={() => runAction(() => openCreateIssueModal())}
							>
								<span className="flex-1">New PRD...</span>
							</CommandItem>
							<CommandItem
								onSelect={() => runAction(async () => {
									await window.shipcode.invoke('github:refresh-issues', { projectId: activeProjectId })
									queryClient.invalidateQueries({ queryKey: ['github-issues'] })
								})}
							>
								<span className="flex-1">Refresh Issues</span>
							</CommandItem>
						</>
					)}
				</CommandGroup>

				{activeThreadId && (
					<CommandGroup heading="Pipeline">
						{pipelinePhase === 'idle' && (
							<CommandItem
								onSelect={() => runAction(() =>
									window.shipcode.invoke('pipeline:start', { threadId: activeThreadId })
								)}
							>
								<span className="flex-1">Start Pipeline</span>
								<CommandShortcut>Cmd+Enter</CommandShortcut>
							</CommandItem>
						)}
						{pipelinePhase === 'awaiting_approval' && (
							<>
								<CommandItem
									onSelect={() => runAction(() =>
										window.shipcode.invoke('pipeline:approve', { threadId: activeThreadId })
									)}
								>
									<span className="flex-1">Approve Plan</span>
								</CommandItem>
								<CommandItem
									onSelect={() => runAction(() =>
										window.shipcode.invoke('pipeline:reject', { threadId: activeThreadId, feedback: '' })
									)}
								>
									<span className="flex-1">Reject Plan</span>
								</CommandItem>
							</>
						)}
						<CommandItem
							onSelect={() => runAction(() =>
								window.shipcode.invoke('pipeline:cancel', { threadId: activeThreadId })
							)}
						>
							<span className="flex-1">Cancel Pipeline</span>
						</CommandItem>
					</CommandGroup>
				)}

				<CommandGroup heading="Navigation">
					<CommandItem
						onSelect={() => runAction(() => toggleTerminal())}
					>
						<span className="flex-1">Toggle Terminal</span>
						<CommandShortcut>Ctrl+`</CommandShortcut>
					</CommandItem>
					<CommandItem
						onSelect={() => runAction(() => toggleSettings())}
					>
						<span className="flex-1">Toggle Settings</span>
					</CommandItem>
				</CommandGroup>

				{activeProjectId && (
					<CommandGroup heading="Git">
						<CommandItem
							onSelect={() => runAction(() =>
								window.shipcode.invoke('git:commit', { projectId: activeProjectId, message: '' })
							)}
						>
							<span className="flex-1">Commit Changes</span>
							<CommandShortcut>Cmd+Shift+C</CommandShortcut>
						</CommandItem>
						<CommandItem
							onSelect={() => runAction(() =>
								window.shipcode.invoke('git:push', { projectId: activeProjectId })
							)}
						>
							<span className="flex-1">Push to Remote</span>
							<CommandShortcut>Cmd+Shift+P</CommandShortcut>
						</CommandItem>
					</CommandGroup>
				)}
			</CommandList>
		</CommandDialog>
	)
}
