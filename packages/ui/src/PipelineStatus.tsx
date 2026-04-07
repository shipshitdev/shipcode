import { type PipelinePhase } from '@shipcode/shared'

const PHASES: { key: PipelinePhase; label: string }[] = [
	{ key: 'planning', label: 'Plan' },
	{ key: 'reviewing', label: 'Review' },
	{ key: 'revising', label: 'Revise' },
	{ key: 'awaiting_approval', label: 'Approve' },
	{ key: 'executing', label: 'Execute' },
	{ key: 'verifying', label: 'Verify' },
	{ key: 'shipping', label: 'Ship' },
	{ key: 'completed', label: 'Done' },
]

const PHASE_ORDER = PHASES.map((p) => p.key)

interface PipelineStatusProps {
	currentPhase: PipelinePhase
	onPhaseClick?: (phase: PipelinePhase) => void
}

export function PipelineStatus({ currentPhase, onPhaseClick }: PipelineStatusProps) {
	const currentIndex = PHASE_ORDER.indexOf(currentPhase)
	const isFailed = currentPhase === 'failed'

	return (
		<div className="pipeline-status">
			{PHASES.map((phase, index) => {
				const isActive = phase.key === currentPhase
				const isCompleted = !isFailed && currentIndex > index
				const isFuture = !isFailed && currentIndex < index

				let className = 'pipeline-phase'
				if (isActive) className += ' pipeline-phase--active'
				if (isCompleted) className += ' pipeline-phase--completed'
				if (isFuture) className += ' pipeline-phase--future'
				if (isFailed && isActive) className += ' pipeline-phase--failed'

				return (
					<div key={phase.key} className="pipeline-step">
						<button
							type="button"
							className={className}
							onClick={() => onPhaseClick?.(phase.key)}
							disabled={isFuture}
						>
							<span className="pipeline-phase__indicator">
								{isCompleted ? '✓' : isActive && isFailed ? '✕' : index + 1}
							</span>
							<span className="pipeline-phase__label">{phase.label}</span>
						</button>
						{index < PHASES.length - 1 && (
							<span
								className={`pipeline-connector ${isCompleted ? 'pipeline-connector--completed' : ''}`}
							/>
						)}
					</div>
				)
			})}
		</div>
	)
}
