import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../stores/app-store'
import { KanbanBoard } from '@shipcode/ui'
import type { GitHubIssueCacheRecord, IssuePipelineStatus } from '@shipcode/shared'

export function ThreadPanel() {
	const queryClient = useQueryClient()
	const { activeProjectId, selectIssue, openCreateIssueModal } = useAppStore()

	const { data: issues = [], refetch: refetchIssues } = useQuery<GitHubIssueCacheRecord[]>({
		queryKey: ['github-issues', activeProjectId],
		queryFn: () => window.shipcode.invoke('github:refresh-issues', { projectId: activeProjectId }),
		enabled: !!activeProjectId,
		staleTime: 30_000,
	})

	// Optimistically flip a single issue's pipelineStatus in the local cache so
	// the card jumps to its new column instantly on drop, instead of waiting
	// for the round-trip to the main process. On error we force a refetch to
	// reconcile with the real state.
	const queryKey = ['github-issues', activeProjectId] as const
	const setPipelineStatusOptimistic = (id: string, status: IssuePipelineStatus) => {
		queryClient.setQueryData<GitHubIssueCacheRecord[]>(queryKey, (prev) =>
			prev ? prev.map(i => i.id === id ? { ...i, pipelineStatus: status } : i) : prev
		)
	}

	return (
		<div className="flex flex-1 min-w-0 flex-col bg-bg-primary">
			<KanbanBoard
				issues={issues}
				onIssueClick={(issue) => selectIssue(issue)}
				onRefresh={() => refetchIssues()}
				onNewIssue={() => openCreateIssueModal()}
				onStartPipeline={(issue) => {
					setPipelineStatusOptimistic(issue.id, 'planning')
					window.shipcode.invoke('github:start-issue', {
						projectId: activeProjectId,
						issueNumber: issue.issueNumber,
					})
						.then(() => refetchIssues())
						.catch((err) => {
							refetchIssues()
							console.error('[threadpanel] start-issue failed', { issueNumber: issue.issueNumber, err })
							window.alert(`Failed to start issue #${issue.issueNumber}: ${err?.message ?? err}`)
						})
				}}
				onRetry={(issue) => {
					setPipelineStatusOptimistic(issue.id, 'todo')
					window.shipcode.invoke('github:retry-issue', {
						projectId: activeProjectId,
						issueNumber: issue.issueNumber,
					})
						.then(() => refetchIssues())
						.catch((err) => {
							refetchIssues()
							console.error('[threadpanel] retry-issue failed', { issueNumber: issue.issueNumber, err })
							window.alert(`Failed to retry issue #${issue.issueNumber}: ${err?.message ?? err}`)
						})
				}}
			/>
		</div>
	)
}
