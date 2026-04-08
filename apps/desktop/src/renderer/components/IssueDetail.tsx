import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../stores/app-store'
import { PlanViewer, ReviewViewer, Badge, Button } from '@shipcode/ui'
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
		<div className="flex w-[480px] min-w-[380px] shrink-0 flex-col overflow-hidden border-l border-border bg-bg-primary">
			{/* Header */}
			<div className="relative shrink-0 border-b border-border p-4">
				<button
					type="button"
					className="absolute right-3 top-3 cursor-pointer rounded border-none bg-transparent px-2 py-1 text-sm text-text-muted hover:bg-bg-hover hover:text-text-primary"
					onClick={() => selectIssue(null)}
					title="Close"
				>
					✕
				</button>
				<span className="font-mono text-xs text-text-muted">#{activeIssue.issueNumber}</span>
				<h3 className="my-1 pr-8 text-[15px] font-semibold">{activeIssue.title}</h3>
				<div className="flex flex-wrap gap-1.5">
					<Badge variant="default" className="text-[11px] uppercase font-semibold">
						{activeIssue.pipelineStatus}
					</Badge>
					{activeIssue.assignee && (
						<Badge variant="default" className="text-[11px]">
							{activeIssue.assignee}
						</Badge>
					)}
					{activeIssue.labels.filter(l => l.startsWith('agent:')).map(l => (
						<Badge key={l} className="text-[10px] bg-accent/15 text-accent">
							{l}
						</Badge>
					))}
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto p-4">
				{/* Issue body (PRD) */}
				{activeIssue.body && (
					<div className="mb-5">
						<h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Description</h4>
						<div className="max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-bg-secondary p-3 text-[13px] leading-relaxed text-text-primary">
							{activeIssue.body}
						</div>
					</div>
				)}

				{/* Pipeline thread info */}
				{thread && (
					<div className="mb-5">
						<h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Pipeline</h4>
						<div className="flex flex-col gap-1 text-xs text-text-secondary">
							<span>Status: <strong className="text-text-primary">{thread.status}</strong></span>
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
					<div className="mb-5">
						<h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
							Plan History ({planHistory.length} version{planHistory.length !== 1 ? 's' : ''})
						</h4>
						<div className="flex flex-col gap-1">
							{planHistory.map(plan => {
								const isExpanded = effectiveExpanded === plan.id
								const review = reviewsByPlanId[plan.id]

								return (
									<div key={plan.id} className={`rounded-md border ${isExpanded ? 'border-border' : 'border-transparent'}`}>
										<button
											type="button"
											className="flex w-full items-center gap-2 bg-transparent border-none cursor-pointer px-3 py-2 text-left text-[13px] text-text-primary hover:bg-bg-hover rounded-md"
											onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
										>
											<span className="font-mono text-xs font-semibold text-text-muted">v{plan.version}</span>
											<span className="text-xs" style={{ color: statusColor(plan.status) }}>
												{plan.status}
											</span>
											{review && (
												<Badge variant={review.decision === 'approve' ? 'success' : 'warning'} className="text-[10px]">
													{review.decision}
												</Badge>
											)}
											<span className="ml-auto text-[11px] text-text-muted">
												{new Date(plan.createdAt).toLocaleString()}
											</span>
											<span className="text-text-muted">{isExpanded ? '▾' : '▸'}</span>
										</button>

										{isExpanded && (
											<div className="border-t border-border p-3">
												{plan.structured && (
													<PlanViewer plan={plan.structured} />
												)}
												{review?.structured && (
													<ReviewViewer review={review.structured} />
												)}
												{!plan.structured && (
													<div className="overflow-x-auto">
														<pre className="whitespace-pre-wrap text-xs text-text-secondary">{plan.rawOutput}</pre>
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
					<div className="mb-5 py-6 text-center">
						<p className="mb-3 text-text-muted">This issue hasn't been picked up by the pipeline yet.</p>
						<Button
							size="lg"
							onClick={() => {
								window.shipcode.invoke('github:start-issue', {
									projectId: activeProjectId,
									issueNumber: activeIssue.issueNumber,
								})
							}}
						>
							Start Pipeline
						</Button>
					</div>
				)}

				{/* Thread exists but no plans yet */}
				{activeThreadId && planHistory.length === 0 && (
					<div className="mb-5">
						<p className="py-4 text-center text-[13px] text-text-muted">Pipeline is running — waiting for plan generation...</p>
					</div>
				)}
			</div>
		</div>
	)
}
