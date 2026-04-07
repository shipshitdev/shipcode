import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../stores/app-store'
import { ThreadList, KanbanBoard } from '@crosscode/ui'
import type { Thread } from '@crosscode/shared'

export function ThreadPanel() {
	const { activeProjectId, activeThreadId, selectThread, kanbanView, githubIssues, toggleKanbanView } = useAppStore()
	const queryClient = useQueryClient()
	const [newPrompt, setNewPrompt] = useState('')
	const [showInput, setShowInput] = useState(false)

	const { data: threads = [] } = useQuery<Thread[]>({
		queryKey: ['threads', activeProjectId],
		queryFn: () => window.crosscode.invoke('thread:list', { projectId: activeProjectId }),
		enabled: !!activeProjectId,
	})

	const createThread = useMutation({
		mutationFn: (prompt: string) =>
			window.crosscode.invoke<Thread>('thread:create', {
				projectId: activeProjectId,
				prompt,
				useWorktree: true,
			}),
		onSuccess: (thread) => {
			queryClient.invalidateQueries({ queryKey: ['threads', activeProjectId] })
			selectThread(thread.id)
			setNewPrompt('')
			setShowInput(false)
		},
	})

	if (!activeProjectId) {
		return (
			<div className="thread-panel thread-panel--empty">
				<p>Select a project to get started</p>
			</div>
		)
	}

	return (
		<div className="thread-panel">
			<div className="thread-panel__view-toggle">
				<button
					type="button"
					className={!kanbanView ? 'active' : ''}
					onClick={() => kanbanView && toggleKanbanView()}
				>
					Threads
				</button>
				<button
					type="button"
					className={kanbanView ? 'active' : ''}
					onClick={() => !kanbanView && toggleKanbanView()}
				>
					Issues
				</button>
			</div>

			{kanbanView ? (
				<KanbanBoard
					issues={githubIssues}
					onIssueClick={() => {/* TODO: select thread linked to issue */}}
					onRefresh={() => window.crosscode.invoke('github:refresh-issues', { projectId: activeProjectId })}
				/>
			) : (
			<ThreadList
				threads={threads}
				activeThreadId={activeThreadId}
				onThreadSelect={selectThread}
				onNewThread={() => setShowInput(true)}
			/>
			)}

			{showInput && (
				<div className="thread-panel__new-input">
					<textarea
						className="thread-panel__textarea"
						placeholder="Describe the feature or task..."
						value={newPrompt}
						onChange={(e) => setNewPrompt(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && e.metaKey && newPrompt.trim()) {
								createThread.mutate(newPrompt.trim())
							}
							if (e.key === 'Escape') {
								setShowInput(false)
								setNewPrompt('')
							}
						}}
						autoFocus
					/>
					<div className="thread-panel__actions">
						<button
							type="button"
							className="btn btn--primary"
							onClick={() => newPrompt.trim() && createThread.mutate(newPrompt.trim())}
							disabled={!newPrompt.trim() || createThread.isPending}
						>
							{createThread.isPending ? 'Creating...' : 'Create Thread (⌘↩)'}
						</button>
						<button
							type="button"
							className="btn btn--ghost"
							onClick={() => { setShowInput(false); setNewPrompt('') }}
						>
							Cancel
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
