import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../stores/app-store'
import { KanbanBoard } from '@shipcode/ui'
import type { GitHubIssueCacheRecord, IssuePipelineStatus, Project } from '@shipcode/shared'

export function ThreadPanel() {
	const queryClient = useQueryClient()
	const { activeProjectId, selectIssue, openCreateIssueModal, activeIssue } = useAppStore()

	const { data: issues = [], refetch: refetchIssues } = useQuery<GitHubIssueCacheRecord[]>({
		queryKey: ['github-issues', activeProjectId],
		queryFn: () => window.shipcode.invoke('github:refresh-issues', { projectId: activeProjectId }),
		enabled: !!activeProjectId,
		staleTime: 30_000,
	})

	// The per-project base branch drives the Kanban toolbar Select. Read via
	// the narrow `project:get` channel rather than scanning the full list.
	const { data: project } = useQuery<Project | null>({
		queryKey: ['project', activeProjectId],
		queryFn: () => window.shipcode.invoke('project:get', { projectId: activeProjectId! }),
		enabled: !!activeProjectId,
		staleTime: 30_000,
	})

	// Local git branches (normalized) — source for the toolbar dropdown.
	const { data: branches = [] } = useQuery<string[]>({
		queryKey: ['git-branches', activeProjectId],
		queryFn: () => window.shipcode.invoke('git:list-branches', { projectId: activeProjectId! }),
		enabled: !!activeProjectId,
		staleTime: 60_000,
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
		<div className="flex flex-1 min-w-0 flex-col bg-primary">
			<KanbanBoard
				issues={issues}
				onIssueClick={(issue) => selectIssue(issue)}
				selectedIssueNumber={activeIssue?.issueNumber}
				onRefresh={() => refetchIssues()}
				onNewIssue={() => openCreateIssueModal()}
				baseBranch={project?.defaultBranch}
				branches={branches}
				onBaseBranchChange={(branch) => {
					// Optimistic cache update so the toolbar reflects the new branch
					// on the same frame as the click, without waiting for IPC.
					queryClient.setQueryData<Project | null>(
						['project', activeProjectId],
						(prev) => (prev ? { ...prev, defaultBranch: branch } : prev),
					)
					window.shipcode
						.invoke('project:set-default-branch', {
							projectId: activeProjectId!,
							branch,
						})
						.catch((err) => {
							queryClient.invalidateQueries({ queryKey: ['project', activeProjectId] })
							console.error('[threadpanel] set-default-branch failed', err)
							window.alert(`Failed to set base branch: ${err?.message ?? err}`)
						})
				}}
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
				onRerun={(issue) => {
					setPipelineStatusOptimistic(issue.id, 'planning')
					window.shipcode.invoke('github:start-issue', {
						projectId: activeProjectId,
						issueNumber: issue.issueNumber,
					})
						.then(() => refetchIssues())
						.catch((err) => {
							refetchIssues()
							console.error('[threadpanel] rerun failed', { issueNumber: issue.issueNumber, err })
							window.alert(`Failed to re-run issue #${issue.issueNumber}: ${err?.message ?? err}`)
						})
				}}
			/>
		</div>
	)
}
