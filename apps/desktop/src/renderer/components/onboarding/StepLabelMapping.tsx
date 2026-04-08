import { StatusMappingEditor } from '@shipcode/ui'
import type { StatusLabelMapping } from '@shipcode/shared'

interface Props {
	mappings: StatusLabelMapping
	onChange: (mappings: StatusLabelMapping) => void
}

export function StepLabelMapping({ mappings, onChange }: Props) {
	return (
		<div className="onboarding__step">
			<h3>Status label mapping</h3>
			<p className="onboarding__description">
				Configure how pipeline statuses map to GitHub issue labels.
				The defaults work well for most projects.
			</p>
			<StatusMappingEditor mappings={mappings} onSave={onChange} />
		</div>
	)
}
