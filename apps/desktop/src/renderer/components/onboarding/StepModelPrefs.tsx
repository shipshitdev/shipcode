import type { AgentType } from '@shipcode/shared'

interface Props {
	plannerModel: AgentType
	reviewerModel: AgentType
	onChange: (planner: AgentType, reviewer: AgentType) => void
	singleAgentMode: boolean
}

const MODELS: { value: AgentType; label: string }[] = [
	{ value: 'claude', label: 'Claude' },
	{ value: 'codex', label: 'Codex' },
]

export function StepModelPrefs({ plannerModel, reviewerModel, onChange, singleAgentMode }: Props) {
	return (
		<div className="onboarding__step">
			<h3>Model preferences</h3>
			<p className="onboarding__description">
				ShipCode uses an adversarial review model: one AI plans, a different one critiques.
				This catches blind spots that single-model self-review misses.
			</p>

			<div className="onboarding__model-fields">
				<label className="onboarding__model-field">
					<span>Planner</span>
					<select
						value={plannerModel}
						onChange={(e) => onChange(e.target.value as AgentType, reviewerModel)}
					>
						{MODELS.map((m) => (
							<option key={m.value} value={m.value}>{m.label}</option>
						))}
					</select>
				</label>
				<label className="onboarding__model-field">
					<span>Reviewer</span>
					<select
						value={reviewerModel}
						onChange={(e) => onChange(plannerModel, e.target.value as AgentType)}
						disabled={singleAgentMode}
					>
						{MODELS.map((m) => (
							<option key={m.value} value={m.value}>{m.label}</option>
						))}
					</select>
				</label>
			</div>

			{singleAgentMode && (
				<div className="onboarding__warning">
					Only one AI CLI is available. Review will be skipped during pipeline execution.
				</div>
			)}
		</div>
	)
}
