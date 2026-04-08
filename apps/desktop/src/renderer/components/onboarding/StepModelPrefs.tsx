import type { AgentType } from '@shipcode/shared'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shipcode/ui'

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
		<div>
			<h3 className="text-[15px] font-semibold mb-2">Model preferences</h3>
			<p className="text-text-secondary text-[13px] mb-4 leading-relaxed">
				ShipCode uses an adversarial review model: one AI plans, a different one critiques.
				This catches blind spots that single-model self-review misses.
			</p>

			<div className="flex flex-col gap-3 mb-4">
				<div className="flex items-center justify-between py-2">
					<span className="font-medium">Planner</span>
					<Select
						value={plannerModel}
						onValueChange={(val) => onChange(val as AgentType, reviewerModel)}
					>
						<SelectTrigger className="w-[140px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{MODELS.map((m) => (
								<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex items-center justify-between py-2">
					<span className="font-medium">Reviewer</span>
					<Select
						value={reviewerModel}
						onValueChange={(val) => onChange(plannerModel, val as AgentType)}
						disabled={singleAgentMode}
					>
						<SelectTrigger className="w-[140px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{MODELS.map((m) => (
								<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			{singleAgentMode && (
				<div className="rounded-md border border-[#3d2e00] bg-[#1c1c00] px-3 py-2.5 text-xs text-warning">
					Only one AI CLI is available. Review will be skipped during pipeline execution.
				</div>
			)}
		</div>
	)
}
