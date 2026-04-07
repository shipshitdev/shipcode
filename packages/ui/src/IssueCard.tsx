import type { GitHubIssueCacheRecord } from '@crosscode/shared'

interface IssueCardProps {
	issue: GitHubIssueCacheRecord
	onClick: () => void
}

export function IssueCard({ issue, onClick }: IssueCardProps) {
	return (
		<div className="issue-card" onClick={onClick}>
			<div className="issue-card__header">
				<span className="issue-card__number">#{issue.issueNumber}</span>
				<span className={`issue-card__status issue-card__status--${issue.pipelineStatus}`}>
					{issue.pipelineStatus}
				</span>
			</div>
			<div className="issue-card__title">{issue.title}</div>
			<div className="issue-card__labels">
				{issue.labels.filter(l => l.startsWith('agent:')).map(l => (
					<span key={l} className="issue-card__label">{l}</span>
				))}
			</div>
		</div>
	)
}
