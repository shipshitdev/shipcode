import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../stores/app-store'
import { ThreadList, KanbanBoard, Button, Textarea } from '@shipcode/ui'
import type { Thread, GitHubIssueCacheRecord } from '@shipcode/shared'

export function ThreadPanel() {
	const { activeProjectId, activeThreadId, selectThread, selectIssue, kanbanView, toggleKanbanView } = useAppStore()
	const queryClient = useQueryClient()
	const [newPrompt, setNewPrompt] = useState('')
	const [showInput, setShowInput] = useState(false)

	const { data: threads = [] } = useQuery<Thread[]>({
		queryKey: ['threads', activeProjectId],
		queryFn: () => window.shipcode.invoke('thread:list', { projectId: activeProjectId }),
		enabled: !!activeProjectId,
	})

	const { data: issues = [], refetch: refetchIssues } = useQuery<GitHubIssueCacheRecord[]>({
		queryKey: ['github-issues', activeProjectId],
		queryFn: () => window.shipcode.invoke('github:refresh-issues', { projectId: activeProjectId }),
		enabled: !!activeProjectId && kanbanView,
		staleTime: 30_000,
	})

	const createThread = useMutation({
		mutationFn: (prompt: string) =>
			window.shipcode.invoke<Thread>('thread:create', {
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
			<div className="flex w-[300px] min-w-[280px] items-center justify-center border-r border-border bg-bg-primary text-text-muted">
				<p>Select a project to get started</p>
			</div>
		)
	}

	return (
		<div className={`flex flex-col bg-bg-primary ${kanbanView ? 'flex-1 min-w-0' : 'w-[300px] min-w-[280px] border-r border-border'}`}>
			<div className="flex border-b border-border">
				<Button
					variant={!kanbanView ? 'secondary' : 'ghost'}
					size="sm"
					className="flex-1 rounded-none"
					onClick={() => kanbanView && toggleKanbanView()}
				>
					Threads
				</Button>
				<Button
					variant={kanbanView ? 'secondary' : 'ghost'}
					size="sm"
					className="flex-1 rounded-none"
					onClick={() => !kanbanView && toggleKanbanView()}
				>
					Issues
				</Button>
			</div>

			{kanbanView ? (
				<KanbanBoard
					issues={issues}
					onIssueClick={(issue) => selectIssue(issue)}
					onRefresh={() => refetchIssues()}
					onStartPipeline={(issue) => {
						window.shipcode.invoke('github:start-issue', {
							projectId: activeProjectId,
							issueNumber: issue.issueNumber,
						}).then(() => refetchIssues())
					}}
					onRetry={(issue) => {
						window.shipcode.invoke('github:retry-issue', {
							projectId: activeProjectId,
							issueNumber: issue.issueNumber,
						}).then(() => refetchIssues())
					}}
				/>
			) : (
			<ThreadList
				threads={threads}
				activeThreadId={activeThreadId}
				onThreadSelect={selectThread}
				onNewThread={() => setShowInput(true)}
			/>
			)}

			{!kanbanView && showInput && (
				<div className="border-t border-border p-3">
					<Textarea
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
					<div className="mt-2 flex gap-2">
						<Button
							onClick={() => newPrompt.trim() && createThread.mutate(newPrompt.trim())}
							disabled={!newPrompt.trim() || createThread.isPending}
						>
							{createThread.isPending ? 'Creating...' : 'Create Thread (⌘↩)'}
						</Button>
						<Button
							variant="ghost"
							onClick={() => { setShowInput(false); setNewPrompt('') }}
						>
							Cancel
						</Button>
					</div>
				</div>
			)}
		</div>
	)
}
