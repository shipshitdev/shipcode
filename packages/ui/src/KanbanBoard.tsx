import type { GitHubIssueCacheRecord, IssuePipelineStatus } from '@crosscode/shared'

interface KanbanBoardProps {
	issues: GitHubIssueCacheRecord[]
	onIssueClick: (issue: GitHubIssueCacheRecord) => void
	onRefresh: () => void
}

const COLUMNS: { key: string; label: string; statuses: IssuePipelineStatus[] }[] = [
	{ key: 'queued', label: 'Queued', statuses: ['queued'] },
	{ key: 'planning', label: 'Planning', statuses: ['planning'] },
	{ key: 'reviewing', label: 'Reviewing', statuses: ['reviewing', 'revising'] },
	{ key: 'executing', label: 'Executing', statuses: ['executing'] },
	{ key: 'verifying', label: 'Verifying', statuses: ['verifying', 'shipping'] },
	{ key: 'completed', label: 'Completed', statuses: ['completed'] },
	{ key: 'failed', label: 'Failed', statuses: ['failed'] },
]

export function KanbanBoard({ issues, onIssueClick, onRefresh }: KanbanBoardProps) {
	return (
		<div className="kanban">
			<div className="kanban__header">
				<h3>GitHub Issues</h3>
				<button type="button" className="kanban__refresh" onClick={onRefresh}>Refresh</button>
			</div>
			<div className="kanban__columns">
				{COLUMNS.map(col => {
					const columnIssues = issues.filter(i => col.statuses.includes(i.pipelineStatus))
					return (
						<div key={col.key} className="kanban__column">
							<div className="kanban__column-header">
								<span>{col.label}</span>
								<span className="kanban__column-count">{columnIssues.length}</span>
							</div>
							<div className="kanban__column-body">
								{columnIssues.map(issue => (
									<div
										key={issue.id}
										className="kanban__card"
										onClick={() => onIssueClick(issue)}
									>
										<div className="kanban__card-number">#{issue.issueNumber}</div>
										<div className="kanban__card-title">{issue.title}</div>
										<div className="kanban__card-labels">
											{issue.labels.filter(l => l.startsWith('agent:')).map(l => (
												<span key={l} className="kanban__card-label">{l}</span>
											))}
											{issue.pipelineStatus !== col.statuses[0] && (
												<span className="kanban__card-substatus">{issue.pipelineStatus}</span>
											)}
										</div>
									</div>
								))}
							</div>
						</div>
					)
				})}
			</div>
		</div>
	)
}
