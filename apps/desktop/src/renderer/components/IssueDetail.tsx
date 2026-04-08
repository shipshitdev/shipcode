import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../stores/app-store'
import { PlanViewer, ReviewViewer } from '@shipcode/ui'
import type { Thread, PlanRecord, ReviewRecord } from '@shipcode/shared'

export function IssueDetail() {
	const { activeIssue, activeThreadId, activeProjectId, selectIssue } = useAppStore()
	const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null)

	// Fetch thread data if issue is linked
	const { data: thread } = useQuery<Thread | null>({
		queryKey: ['thread', activeThreadId],
		queryFn: () => window.shipcode.invoke('thread:get', { threadId: activeThreadId }),
		enabled: !!activeThreadId,
	})

	// Fetch plan history
	const { data: planHistory = [] } = useQuery<PlanRecord[]>({
		queryKey: ['plan-history', activeThreadId],
		queryFn: () => window.shipcode.invoke('plan:list', { threadId: activeThreadId }),
		enabled: !!activeThreadId,
	})

	// Fetch reviews for all plans
	const planIds = planHistory.map(p => p.id)
	const { data: reviewsByPlanId = {} } = useQuery<Record<string, ReviewRecord>>({
		queryKey: ['reviews-by-plans', planIds.join(',')],
		queryFn: () => window.shipcode.invoke('review:list-by-plans', { planIds }),
		enabled: planIds.length > 0,
	})

	// Auto-expand latest plan
	const latestPlanId = planHistory[0]?.id ?? null
	const effectiveExpanded = expandedPlanId ?? latestPlanId

	if (!activeIssue) return null

	const statusColor = (status: string) => {
		switch (status) {
			case 'approved': return 'var(--success)'
			case 'superseded': return 'var(--text-muted)'
			case 'rejected': return 'var(--danger)'
			case 'pending_review': return 'var(--warning)'
			default: return 'var(--accent)'
		}
	}

	return (
		<div className="issue-detail">
			<div className="issue-detail__header">
				<button
					type="button"
					className="issue-detail__close"
					onClick={() => selectIssue(null)}
					title="Close"
				>
					✕
				</button>
				<span className="issue-detail__number">#{activeIssue.issueNumber}</span>
				<h3 className="issue-detail__title">{activeIssue.title}</h3>
				<div className="issue-detail__meta">
					<span className={`issue-detail__status issue-detail__status--${activeIssue.pipelineStatus}`}>
						{activeIssue.pipelineStatus}
					</span>
					{activeIssue.assignee && (
						<span className="issue-detail__assignee">{activeIssue.assignee}</span>
					)}
					{activeIssue.labels.filter(l => l.startsWith('agent:')).map(l => (
						<span key={l} className="issue-detail__label">{l}</span>
					))}
				</div>
			</div>

			<div className="issue-detail__content">
				{/* Issue body (PRD) */}
				{activeIssue.body && (
					<div className="issue-detail__section">
						<h4>Description</h4>
						<div className="issue-detail__body">
							{activeIssue.body}
						</div>
					</div>
				)}

				{/* Pipeline thread info */}
				{thread && (
					<div className="issue-detail__section">
						<h4>Pipeline</h4>
						<div className="issue-detail__pipeline-info">
							<span>Status: <strong>{thread.status}</strong></span>
							{thread.githubPrNumber && (
								<span>PR: #{thread.githubPrNumber}</span>
							)}
							{thread.worktreeBranch && (
								<span>Branch: {thread.worktreeBranch}</span>
							)}
						</div>
					</div>
				)}

				{/* Plan history */}
				{planHistory.length > 0 && (
					<div className="issue-detail__section">
						<h4>Plan History ({planHistory.length} version{planHistory.length !== 1 ? 's' : ''})</h4>
						<div className="plan-history">
							{planHistory.map(plan => {
								const isExpanded = effectiveExpanded === plan.id
								const review = reviewsByPlanId[plan.id]

								return (
									<div key={plan.id} className={`plan-history__item ${isExpanded ? 'plan-history__item--expanded' : ''}`}>
										<button
											type="button"
											className="plan-history__header"
											onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
										>
											<span className="plan-history__version">v{plan.version}</span>
											<span className="plan-history__status" style={{ color: statusColor(plan.status) }}>
												{plan.status}
											</span>
											{review && (
												<span className={`plan-history__review-badge plan-history__review-badge--${review.decision}`}>
													{review.decision}
												</span>
											)}
											<span className="plan-history__date">
												{new Date(plan.createdAt).toLocaleString()}
											</span>
											<span className="plan-history__chevron">{isExpanded ? '▾' : '▸'}</span>
										</button>

										{isExpanded && (
											<div className="plan-history__body">
												{plan.structured && (
													<PlanViewer plan={plan.structured} />
												)}
												{review?.structured && (
													<ReviewViewer review={review.structured} />
												)}
												{!plan.structured && (
													<div className="plan-history__raw">
														<pre>{plan.rawOutput}</pre>
													</div>
												)}
											</div>
										)}
									</div>
								)
							})}
						</div>
					</div>
				)}

				{/* No thread yet — offer to start */}
				{!activeThreadId && (
					<div className="issue-detail__section issue-detail__start">
						<p>This issue hasn't been picked up by the pipeline yet.</p>
						<button
							type="button"
							className="btn btn--primary btn--lg"
							onClick={() => {
								window.shipcode.invoke('github:start-issue', {
									projectId: activeProjectId,
									issueNumber: activeIssue.issueNumber,
								})
							}}
						>
							Start Pipeline
						</button>
					</div>
				)}

				{/* Thread exists but no plans yet */}
				{activeThreadId && planHistory.length === 0 && (
					<div className="issue-detail__section">
						<p className="issue-detail__empty">Pipeline is running — waiting for plan generation...</p>
					</div>
				)}
			</div>
		</div>
	)
}
