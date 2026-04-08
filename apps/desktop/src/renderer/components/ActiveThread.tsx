import { useState } from 'react'
import { useAppStore } from '../stores/app-store'
import { useIpc } from '../hooks/useIpc'
import { PipelineStatus, PlanViewer, ReviewViewer, VerificationViewer, DiffViewer, Button } from '@shipcode/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { DiffRecord } from '@shipcode/shared'

export function ActiveThread() {
	const { activeProjectId, activeThreadId, currentPlan, currentReview, currentVerification, pipelinePhase, toggleTerminal } = useAppStore()
	const queryClient = useQueryClient()
	const [isStarting, setIsStarting] = useState(false)

	// Initialize IPC listeners
	useIpc()

	const { data: diffs = [] } = useQuery<DiffRecord[]>({
		queryKey: ['diffs', activeThreadId],
		queryFn: () => window.shipcode.invoke('diff:list', { threadId: activeThreadId }),
		enabled: !!activeThreadId && (pipelinePhase === 'executing' || pipelinePhase === 'completed'),
		refetchInterval: pipelinePhase === 'executing' ? 2000 : false,
	})

	if (!activeThreadId) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center overflow-hidden">
				<div className="text-center text-text-secondary">
					<h2 className="mb-2 text-xl text-text-primary">ShipCode</h2>
					<p>Drag an issue to Planning on the kanban, or create a thread to start the pipeline.</p>
					<div className="mt-4 flex gap-4 text-xs text-text-muted">
						<span><kbd className="mr-1 rounded border border-border bg-bg-tertiary px-2 py-0.5 font-mono text-[11px]">⌘N</kbd> New thread</span>
						<span><kbd className="mr-1 rounded border border-border bg-bg-tertiary px-2 py-0.5 font-mono text-[11px]">⌘K</kbd> Command palette</span>
						<span><kbd className="mr-1 rounded border border-border bg-bg-tertiary px-2 py-0.5 font-mono text-[11px]">Ctrl+`</kbd> Toggle terminal</span>
					</div>
				</div>
			</div>
		)
	}

	const handleStart = async () => {
		setIsStarting(true)
		try {
			await window.shipcode.invoke('pipeline:start', { threadId: activeThreadId })
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
		await window.shipcode.invoke('pipeline:approve', { threadId: activeThreadId })
		queryClient.invalidateQueries({ queryKey: ['threads'] })
	}

	const handleReject = async () => {
		const feedback = prompt('What should be changed?') ?? 'Please revise the plan.'
		await window.shipcode.invoke('pipeline:reject', {
			threadId: activeThreadId,
			feedback,
		})
		queryClient.invalidateQueries({ queryKey: ['threads'] })
	}

	const handleSkipReview = async () => {
		await window.shipcode.invoke('pipeline:skip-review', { threadId: activeThreadId })
		queryClient.invalidateQueries({ queryKey: ['threads'] })
	}

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<PipelineStatus currentPhase={pipelinePhase} />

			<div className="flex-1 overflow-y-auto p-4">
				{pipelinePhase === 'idle' && (
					<div className="flex h-full items-center justify-center">
						<div className="text-center">
							<h3 className="mb-2 text-lg">Ready to plan</h3>
							<p className="mb-5 text-[13px] text-text-secondary">Claude Code will generate an implementation plan, then Codex will review it.</p>
							<div className="flex justify-center gap-2">
								<Button
									size="lg"
									onClick={handleStart}
									disabled={isStarting}
								>
									{isStarting ? 'Starting...' : 'Start Pipeline (⌘↩)'}
								</Button>
							</div>
						</div>
					</div>
				)}

				{(pipelinePhase === 'planning' || pipelinePhase === 'revising') && (
					<div>
						{currentPlan ? (
							<PlanViewer plan={currentPlan} />
						) : (
							<div className="flex h-[300px] flex-col items-center justify-center text-text-secondary">
								<div className="mb-4 animate-spin text-[32px] text-accent">⟳</div>
								<p>Claude Code is generating the implementation plan...</p>
								<p className="mt-2 text-xs text-text-muted">Watch the terminal below for real-time output</p>
							</div>
						)}
					</div>
				)}

				{pipelinePhase === 'reviewing' && (
					<div>
						<div className="grid h-full grid-cols-2 gap-4">
							<PlanViewer plan={currentPlan} />
							{currentReview ? (
								<ReviewViewer review={currentReview} />
							) : (
								<div className="flex items-center justify-center text-text-muted">
									<p>Codex is reviewing the plan...</p>
								</div>
							)}
						</div>
						<div className="flex justify-end py-2">
							<Button variant="ghost" onClick={handleSkipReview}>
								Skip Review →
							</Button>
						</div>
					</div>
				)}

				{pipelinePhase === 'awaiting_approval' && (
					<div>
						<div className="grid h-full grid-cols-2 gap-4">
							<PlanViewer plan={currentPlan} isEditable />
							<ReviewViewer review={currentReview} />
						</div>
						<div className="flex justify-center gap-2 border-t border-border p-4">
							<Button onClick={handleApprove}>
								Approve & Execute (⌘↩)
							</Button>
							<Button variant="secondary" onClick={handleReject}>
								Request Changes
							</Button>
						</div>
					</div>
				)}

				{pipelinePhase === 'verifying' && (
					<div>
						{currentVerification ? (
							<VerificationViewer verification={currentVerification} />
						) : (
							<div className="flex h-[300px] flex-col items-center justify-center text-text-secondary">
								<div className="mb-4 animate-spin text-[32px] text-accent">⟳</div>
								<p>Verifying implementation...</p>
							</div>
						)}
					</div>
				)}

				{pipelinePhase === 'shipping' && (
					<div>
						<div className="flex h-[300px] flex-col items-center justify-center text-text-secondary">
							<div className="mb-4 animate-spin text-[32px] text-accent">⟳</div>
							<p>Creating PR...</p>
						</div>
					</div>
				)}

				{pipelinePhase === 'executing' && (
					<div>
						{diffs.length > 0 ? (
							<DiffViewer diffs={diffs} />
						) : (
							<div className="flex h-[300px] flex-col items-center justify-center text-text-secondary">
								<div className="mb-4 animate-spin text-[32px] text-accent">⟳</div>
								<p>Claude Code is executing the approved plan...</p>
								<p className="mt-2 text-xs text-text-muted">File changes will appear here as they happen</p>
							</div>
						)}
					</div>
				)}

				{pipelinePhase === 'completed' && (
					<div>
						<div className="mb-4 flex items-center gap-2 rounded-md border border-[#1a5c36] bg-[#0d3321] px-4 py-2.5 font-semibold text-success">
							<span>✓</span> Plan executed successfully
						</div>
						<DiffViewer diffs={diffs} />
						<div className="flex justify-center gap-2 border-t border-border p-4">
							<Button
								onClick={async () => {
									const message = currentPlan
										? `feat: ${currentPlan.objective}`
										: 'feat: ShipCode changes'
									await window.shipcode.invoke('git:commit', {
										projectId: activeProjectId,
										message,
									})
								}}
							>
								Commit Changes (⌘⇧C)
							</Button>
							<Button
								variant="secondary"
								onClick={async () => {
									await window.shipcode.invoke('git:push', {
										projectId: activeProjectId,
									})
								}}
							>
								Push (⌘⇧P)
							</Button>
						</div>
					</div>
				)}

				{pipelinePhase === 'failed' && (
					<div className="flex h-full items-center justify-center">
						<div className="text-center text-danger">
							<h3 className="mb-2">Pipeline Failed</h3>
							<p className="mb-4 text-text-secondary">Check the terminal for error details.</p>
							<div className="flex justify-center gap-2">
								<Button onClick={handleStart}>
									Retry
								</Button>
								<Button variant="ghost" onClick={toggleTerminal}>
									Show Terminal
								</Button>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
