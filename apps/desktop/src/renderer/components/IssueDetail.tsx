import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../stores/app-store'
import { PlanViewer, ReviewViewer, Badge, Button, Textarea, X, ExternalLink, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Dialog, DialogContent, DialogTitle } from '@shipcode/ui'
import type { Thread, PlanRecord, ReviewRecord, Project, NotificationRecord, PipelinePhase } from '@shipcode/shared'

const ACTIVE_PHASES: PipelinePhase[] = [
	'planning',
	'reviewing',
	'revising',
	'executing',
	'verifying',
	'shipping',
]

// Derive https://github.com/owner/repo/issues/N from a git remote. Covers:
//   - scp-style:  git@github.com:owner/repo(.git)
//   - ssh scheme: ssh://git@github.com/owner/repo(.git)
//   - https:      https://github.com/owner/repo(.git)
// Rejects non-github.com hosts; host comparison is case-insensitive.
function deriveGithubIssueUrl(remote: string | null | undefined, issueNumber: number): string | null {
	if (!remote) return null
	const trimmed = remote.trim()
	// scp-style: git@host:owner/repo(.git)
	const scp = trimmed.match(/^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/i)
	if (scp && scp[1].toLowerCase() === 'github.com') {
		return `https://github.com/${scp[2]}/${scp[3]}/issues/${issueNumber}`
	}
	// URL-parseable forms (ssh://git@... or https://...)
	try {
		const u = new URL(trimmed)
		if (u.hostname.toLowerCase() !== 'github.com') return null
		const parts = u.pathname.replace(/^\/+/, '').replace(/\.git$/i, '').split('/')
		if (parts.length < 2 || !parts[0] || !parts[1]) return null
		return `https://github.com/${parts[0]}/${parts[1]}/issues/${issueNumber}`
	} catch {
		return null
	}
}

export function IssueDetail() {
	const queryClient = useQueryClient()
	const { activeIssue, activeThreadId, activeProjectId, selectIssue, pipelinePhase, openEditPrdModal } = useAppStore()
	const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null)
	const [feedback, setFeedback] = useState('')
	const [showRejectForm, setShowRejectForm] = useState(false)
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [isRefreshingFromGithub, setIsRefreshingFromGithub] = useState(false)

	// Shared cache with ProjectSidebar / Titlebar — no extra request.
	const { data: projects } = useQuery<Project[]>({
		queryKey: ['projects'],
		queryFn: () => window.shipcode.invoke('project:list'),
	})
	const activeProject = (Array.isArray(projects) ? projects : []).find(p => p.id === activeProjectId) ?? null

	// Fetch thread data if issue is linked
	const { data: thread } = useQuery<Thread | null>({
		queryKey: ['thread', activeThreadId],
		queryFn: () => window.shipcode.invoke('thread:get', { threadId: activeThreadId }),
		enabled: !!activeThreadId,
		refetchInterval: activeThreadId ? 2000 : false,
	})

	// Fetch plan history
	const { data: planHistory = [] } = useQuery<PlanRecord[]>({
		queryKey: ['plan-history', activeThreadId],
		queryFn: () => window.shipcode.invoke('plan:list', { threadId: activeThreadId }),
		enabled: !!activeThreadId,
		refetchInterval: activeThreadId ? 2000 : false,
	})

	// Fetch reviews for all plans
	const planIds = planHistory.map(p => p.id)
	const { data: reviewsByPlanId = {} } = useQuery<Record<string, ReviewRecord>>({
		queryKey: ['reviews-by-plans', planIds.join(',')],
		queryFn: () => window.shipcode.invoke('review:list-by-plans', { planIds }),
		enabled: planIds.length > 0,
		refetchInterval: activeThreadId ? 2000 : false,
	})

	// Auto-expand latest plan
	const latestPlanId = planHistory[0]?.id ?? null
	const effectiveExpanded = expandedPlanId ?? latestPlanId
	const latestPlan = useMemo(() => planHistory[0] ?? null, [planHistory])
	const threadPhase = thread?.status ?? pipelinePhase
	const canStartPipeline = !activeThreadId && !!activeProjectId
	const canApprove = !!activeThreadId && !!latestPlan?.structured && threadPhase === 'awaiting_approval'
	const canReject = !!activeThreadId && threadPhase === 'awaiting_approval'

	if (!activeIssue) return null

	const refreshIssueState = async () => {
		if (!activeProjectId) return
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ['threads', activeProjectId] }),
			queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] }),
			queryClient.invalidateQueries({ queryKey: ['thread', activeThreadId] }),
			queryClient.invalidateQueries({ queryKey: ['plan-history', activeThreadId] }),
		])
	}

	const handleStartPipeline = async () => {
		if (!activeProjectId) return
		setIsSubmitting(true)
		try {
			await window.shipcode.invoke('github:start-issue', {
				projectId: activeProjectId,
				issueNumber: activeIssue.issueNumber,
			})
			await refreshIssueState()
		} finally {
			setIsSubmitting(false)
		}
	}

	const handleApprove = async () => {
		if (!activeThreadId || !canApprove) return
		setIsSubmitting(true)
		try {
			await window.shipcode.invoke('pipeline:approve', { threadId: activeThreadId })
			await refreshIssueState()
		} finally {
			setIsSubmitting(false)
		}
	}

	const handleReject = async () => {
		if (!activeThreadId || !feedback.trim()) return
		setIsSubmitting(true)
		try {
			await window.shipcode.invoke('pipeline:reject', {
				threadId: activeThreadId,
				feedback: feedback.trim(),
			})
			setFeedback('')
			setShowRejectForm(false)
			await refreshIssueState()
		} finally {
			setIsSubmitting(false)
		}
	}

	const handleCancel = async () => {
		if (!activeThreadId) return
		setIsSubmitting(true)
		try {
			await window.shipcode.invoke('pipeline:cancel', { threadId: activeThreadId })
			await refreshIssueState()
		} finally {
			setIsSubmitting(false)
		}
	}

	// Dismiss any pending notifications for this thread when the user opens it.
	// Catches the "fired before navigation" case; useIpc.ts handles the
	// "fired while already viewing" case.
	useEffect(() => {
		if (!activeThreadId) return
		let cancelled = false
		void (async () => {
			try {
				const list = await window.shipcode.invoke<NotificationRecord[]>('notification:list')
				if (cancelled) return
				const matching = list.filter((n) => n.threadId === activeThreadId)
				for (const n of matching) {
					await window.shipcode.invoke('notification:dismiss', { id: n.id })
				}
			} catch {
				// Best-effort.
			}
		})()
		return () => {
			cancelled = true
		}
	}, [activeThreadId])

	const phaseIsActive = ACTIVE_PHASES.includes(threadPhase as PipelinePhase)

	const handleExecutorChange = async (model: 'claude' | 'codex') => {
		if (!activeProjectId) return
		await window.shipcode.invoke('github:set-executor', {
			projectId: activeProjectId,
			issueNumber: activeIssue!.issueNumber,
			model,
		})
		await queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] })
	}

	const handleEditPrd = () => {
		if (!activeIssue) return
		openEditPrdModal(activeIssue.issueNumber, activeIssue.body ?? '')
	}

	const githubIssueUrl = activeIssue
		? deriveGithubIssueUrl(activeProject?.gitRemote ?? null, activeIssue.issueNumber)
		: null

	const handleOpenOnGithub = async () => {
		if (!githubIssueUrl) return
		await window.shipcode.invoke('shell:open-external', { url: githubIssueUrl })
	}

	const handleRefreshFromGithub = async () => {
		if (!activeProjectId) return
		setIsRefreshingFromGithub(true)
		try {
			await window.shipcode.invoke('github:refresh-issues', { projectId: activeProjectId })
			await queryClient.invalidateQueries({ queryKey: ['github-issues', activeProjectId] })
		} finally {
			setIsRefreshingFromGithub(false)
		}
	}

	// Executor is locked in once the pipeline is mid-loop. It's editable
	// before the run starts (todo/queued) and after terminal states where
	// the user will kick off a new run (failed/completed).
	const EXECUTOR_EDITABLE_STATUSES = new Set(['todo', 'queued', 'failed', 'completed'])
	const executorEditable = EXECUTOR_EDITABLE_STATUSES.has(activeIssue?.pipelineStatus ?? 'todo')

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
		<Dialog open={!!activeIssue} onOpenChange={(open) => { if (!open) selectIssue(null) }}>
			<DialogContent
				className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden p-0"
				aria-describedby={undefined}
			>
				{/* Visually hidden title — Radix a11y requirement */}
				<DialogTitle className="sr-only">{`#${activeIssue.issueNumber} ${activeIssue.title}`}</DialogTitle>
				{/* Header */}
				<div className="relative shrink-0 border-b border-border p-4">
					<button
						type="button"
						className="absolute right-3 top-3 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-text-muted hover:bg-bg-hover hover:text-text-primary"
						onClick={() => selectIssue(null)}
						title="Close"
					>
						<X size={14} />
					</button>
					<div className="flex items-center gap-2 pr-8">
						<span className="font-mono text-xs text-text-muted">#{activeIssue.issueNumber}</span>
						{githubIssueUrl && (
							<Button
								variant="ghost"
								size="sm"
								onClick={handleOpenOnGithub}
								className="h-6 gap-1 text-[11px]"
								title="Open this issue on github.com"
							>
								View on GitHub <ExternalLink size={12} />
							</Button>
						)}
					</div>
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
				{/* PRD (GitHub issue body IS the PRD) */}
				<div className="mb-5">
					<div className="mb-2 flex items-center justify-between">
						<h4 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">PRD</h4>
						<div className="flex gap-1">
							<Button
								variant="ghost"
								size="sm"
								onClick={handleRefreshFromGithub}
								disabled={isRefreshingFromGithub}
								className="h-6 text-[11px]"
								title="Re-fetch issue body from GitHub (use after editing on github.com)"
							>
								{isRefreshingFromGithub ? 'Refreshing...' : 'Refresh'}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={handleEditPrd}
								className="h-6 text-[11px]"
								title="Edit the PRD body (pushes to the GitHub issue on save)"
							>
								Edit PRD
							</Button>
						</div>
					</div>
					{activeIssue.body ? (
						<div className="max-h-[300px] overflow-y-auto rounded-md bg-bg-secondary p-3 text-[13px] leading-relaxed text-text-primary">
							<div className="space-y-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary [&_code]:rounded [&_code]:bg-bg-tertiary [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:whitespace-pre-wrap [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-bg-tertiary [&_pre]:p-3 [&_pre]:text-xs [&_ul]:list-disc [&_ul]:pl-5">
								<ReactMarkdown remarkPlugins={[remarkGfm]}>
									{activeIssue.body}
								</ReactMarkdown>
							</div>
						</div>
					) : (
						<div className="rounded-md bg-bg-secondary p-3 text-[13px] text-text-muted">
							This issue has no PRD body yet. Click "Edit PRD" to author one.
						</div>
					)}
				</div>


				{/* Executor selector — editable before the pipeline runs, read-only mid-loop. */}
				<div className="mb-5">
					<h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Agents</h4>
					<div className="grid grid-cols-[auto,1fr] items-center gap-x-3 gap-y-1.5 text-xs text-text-secondary">
						<span>Planner</span>
						<span className="font-mono text-text-primary">claude</span>
						<span>Reviewer</span>
						<span className="font-mono text-text-primary">codex</span>
						<span>Executor</span>
						{executorEditable ? (
							<Select value={activeIssue.executorModel} onValueChange={(v) => handleExecutorChange(v as 'claude' | 'codex')}>
								<SelectTrigger className="h-7 w-[140px] text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="claude">claude</SelectItem>
									<SelectItem value="codex">codex</SelectItem>
								</SelectContent>
							</Select>
						) : (
							<span className="font-mono text-text-primary">{activeIssue.executorModel}</span>
						)}
						<span>Verifier</span>
						<span className="font-mono text-text-primary">claude</span>
					</div>
				</div>

				{/* Pipeline thread info */}
				{thread && (
					<div className="mb-5">
						<div className="mb-2 flex items-center justify-between">
							<h4 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Pipeline</h4>
							{phaseIsActive && (
								<Button
									variant="destructive"
									size="xs"
									onClick={handleCancel}
									disabled={isSubmitting}
								>
									Stop
								</Button>
							)}
						</div>
						<div className="flex flex-col gap-1 text-xs text-text-secondary">
							<span>Status: <strong className="text-text-primary">{threadPhase}</strong></span>
							{thread.githubPrNumber && (
								<span>PR: #{thread.githubPrNumber}</span>
							)}
							{thread.worktreeBranch && (
								<span>Branch: {thread.worktreeBranch}</span>
							)}
						</div>
					</div>
				)}

				{canApprove && (
					<div className="mb-5 rounded-md border border-border bg-bg-secondary p-3">
						<div className="mb-3 flex flex-wrap gap-2">
							<Button onClick={handleApprove} disabled={isSubmitting}>
								{isSubmitting ? 'Approving...' : 'Approve & Execute'}
							</Button>
							<Button
								variant="secondary"
								onClick={() => setShowRejectForm((value) => !value)}
								disabled={isSubmitting}
							>
								Request Changes
							</Button>
						</div>
						{showRejectForm && (
							<div className="flex flex-col gap-2">
								<Textarea
									value={feedback}
									onChange={(event) => setFeedback(event.target.value)}
									placeholder="Describe what should change before execution..."
									rows={4}
								/>
								<div className="flex justify-end gap-2">
									<Button
										variant="ghost"
										onClick={() => {
											setShowRejectForm(false)
											setFeedback('')
										}}
										disabled={isSubmitting}
									>
										Cancel
									</Button>
									<Button
										variant="secondary"
										onClick={handleReject}
										disabled={!feedback.trim() || isSubmitting}
									>
										{isSubmitting ? 'Submitting...' : 'Submit Feedback'}
									</Button>
								</div>
							</div>
						)}
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
				{canStartPipeline && (
					<div className="mb-5 py-6 text-center">
						<p className="mb-3 text-text-muted">This issue hasn't been picked up by the pipeline yet.</p>
						<Button
							size="lg"
							onClick={handleStartPipeline}
							disabled={isSubmitting}
						>
							{isSubmitting ? 'Starting...' : 'Start Pipeline'}
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
			</DialogContent>
		</Dialog>
	)
}
