import { useState } from 'react'
import { useAppStore } from '../stores/app-store'
import { useIpc } from '../hooks/useIpc'
import { PipelineStatus, PlanViewer, ReviewViewer, VerificationViewer, DiffViewer } from '@crosscode/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { DiffRecord } from '@crosscode/shared'

export function ActiveThread() {
	const { activeProjectId, activeThreadId, currentPlan, currentReview, currentVerification, pipelinePhase, toggleTerminal } = useAppStore()
	const queryClient = useQueryClient()
	const [isStarting, setIsStarting] = useState(false)

	// Initialize IPC listeners
	useIpc()

	const { data: diffs = [] } = useQuery<DiffRecord[]>({
		queryKey: ['diffs', activeThreadId],
		queryFn: () => window.crosscode.invoke('diff:list', { threadId: activeThreadId }),
		enabled: !!activeThreadId && (pipelinePhase === 'executing' || pipelinePhase === 'completed'),
		refetchInterval: pipelinePhase === 'executing' ? 2000 : false,
	})

	if (!activeThreadId) {
		return (
			<div className="active-thread active-thread--empty">
				<div className="active-thread__welcome">
					<h2>Welcome to CrossCode</h2>
					<p>Select a thread or create a new one to start the plan/review loop.</p>
					<div className="active-thread__shortcuts">
						<kbd>⌘N</kbd> New thread
						<kbd>⌘K</kbd> Command palette
						<kbd>Ctrl+`</kbd> Toggle terminal
					</div>
				</div>
			</div>
		)
	}

	const handleStart = async () => {
		setIsStarting(true)
		try {
			await window.crosscode.invoke('pipeline:start', { threadId: activeThreadId })
			// Open terminal so user can see CLI output
			const store = useAppStore.getState()
			if (!store.terminalVisible) toggleTerminal()
		} catch (err) {
			console.error('Pipeline start failed:', err)
		} finally {
			setIsStarting(false)
		}
		// Refresh thread list to show updated status
		queryClient.invalidateQueries({ queryKey: ['threads'] })
	}

	const handleApprove = async () => {
		await window.crosscode.invoke('pipeline:approve', { threadId: activeThreadId })
		queryClient.invalidateQueries({ queryKey: ['threads'] })
	}

	const handleReject = async () => {
		const feedback = prompt('What should be changed?') ?? 'Please revise the plan.'
		await window.crosscode.invoke('pipeline:reject', {
			threadId: activeThreadId,
			feedback,
		})
		queryClient.invalidateQueries({ queryKey: ['threads'] })
	}

	const handleSkipReview = async () => {
		await window.crosscode.invoke('pipeline:skip-review', { threadId: activeThreadId })
		queryClient.invalidateQueries({ queryKey: ['threads'] })
	}

	return (
		<div className="active-thread">
			<PipelineStatus currentPhase={pipelinePhase} />

			<div className="active-thread__content">
				{pipelinePhase === 'idle' && (
					<div className="active-thread__start">
						<div className="active-thread__start-content">
							<h3>Ready to plan</h3>
							<p>Claude Code will generate an implementation plan, then Codex will review it.</p>
							<div className="active-thread__start-actions">
								<button
									type="button"
									className="btn btn--primary btn--lg"
									onClick={handleStart}
									disabled={isStarting}
								>
									{isStarting ? 'Starting...' : 'Start Pipeline (⌘↩)'}
								</button>
							</div>
						</div>
					</div>
				)}

				{(pipelinePhase === 'planning' || pipelinePhase === 'revising') && (
					<div className="active-thread__planning">
						{currentPlan ? (
							<PlanViewer plan={currentPlan} />
						) : (
							<div className="active-thread__waiting">
								<div className="active-thread__spinner-icon">⟳</div>
								<p>Claude Code is generating the implementation plan...</p>
								<p className="active-thread__hint">Watch the terminal below for real-time output</p>
							</div>
						)}
					</div>
				)}

				{pipelinePhase === 'reviewing' && (
					<div className="active-thread__reviewing">
						<div className="active-thread__split">
							<PlanViewer plan={currentPlan} />
							{currentReview ? (
								<ReviewViewer review={currentReview} />
							) : (
								<div className="review-viewer review-viewer--empty">
									<p className="review-viewer__placeholder">Codex is reviewing the plan...</p>
								</div>
							)}
						</div>
						<div className="active-thread__review-actions">
							<button type="button" className="btn btn--ghost" onClick={handleSkipReview}>
								Skip Review →
							</button>
						</div>
					</div>
				)}

				{pipelinePhase === 'awaiting_approval' && (
					<div className="active-thread__approval">
						<div className="active-thread__split">
							<PlanViewer plan={currentPlan} isEditable />
							<ReviewViewer review={currentReview} />
						</div>
						<div className="active-thread__approval-actions">
							<button type="button" className="btn btn--primary" onClick={handleApprove}>
								Approve & Execute (⌘↩)
							</button>
							<button type="button" className="btn btn--secondary" onClick={handleReject}>
								Request Changes
							</button>
						</div>
					</div>
				)}

				{pipelinePhase === 'verifying' && (
					<div className="active-thread__verifying">
						{currentVerification ? (
							<VerificationViewer verification={currentVerification} />
						) : (
							<div className="active-thread__waiting">
								<div className="active-thread__spinner-icon">⟳</div>
								<p>Verifying implementation...</p>
							</div>
						)}
					</div>
				)}

				{pipelinePhase === 'shipping' && (
					<div className="active-thread__shipping">
						<div className="active-thread__waiting">
							<div className="active-thread__spinner-icon">⟳</div>
							<p>Creating PR...</p>
						</div>
					</div>
				)}

				{pipelinePhase === 'executing' && (
					<div className="active-thread__executing">
						{diffs.length > 0 ? (
							<DiffViewer diffs={diffs} />
						) : (
							<div className="active-thread__waiting">
								<div className="active-thread__spinner-icon">⟳</div>
								<p>Claude Code is executing the approved plan...</p>
								<p className="active-thread__hint">File changes will appear here as they happen</p>
							</div>
						)}
					</div>
				)}

				{pipelinePhase === 'completed' && (
					<div className="active-thread__completed">
						<div className="active-thread__success-banner">
							<span>✓</span> Plan executed successfully
						</div>
						<DiffViewer diffs={diffs} />
						<div className="active-thread__git-actions">
							<button
								type="button"
								className="btn btn--primary"
								onClick={async () => {
									const message = currentPlan
										? `feat: ${currentPlan.objective}`
										: 'feat: CrossCode changes'
									await window.crosscode.invoke('git:commit', {
										projectId: activeProjectId,
										message,
									})
								}}
							>
								Commit Changes (⌘⇧C)
							</button>
							<button
								type="button"
								className="btn btn--secondary"
								onClick={async () => {
									await window.crosscode.invoke('git:push', {
										projectId: activeProjectId,
									})
								}}
							>
								Push (⌘⇧P)
							</button>
						</div>
					</div>
				)}

				{pipelinePhase === 'failed' && (
					<div className="active-thread__failed">
						<div className="active-thread__error">
							<h3>Pipeline Failed</h3>
							<p>Check the terminal for error details.</p>
							<div className="active-thread__error-actions">
								<button type="button" className="btn btn--primary" onClick={handleStart}>
									Retry
								</button>
								<button type="button" className="btn btn--ghost" onClick={toggleTerminal}>
									Show Terminal
								</button>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
