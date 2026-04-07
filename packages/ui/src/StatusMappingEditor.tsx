import { useState, useEffect } from 'react'
import type { StatusLabelMapping } from '@shipcode/shared'

interface StatusMappingEditorProps {
	mappings: StatusLabelMapping
	onSave: (mappings: StatusLabelMapping) => void
}

const PIPELINE_STATUSES = [
	{ key: 'todo', label: 'Todo' },
	{ key: 'queued', label: 'Queued' },
	{ key: 'planning', label: 'Planning' },
	{ key: 'reviewing', label: 'Reviewing' },
	{ key: 'revising', label: 'Revising' },
	{ key: 'executing', label: 'Executing' },
	{ key: 'verifying', label: 'Verifying' },
	{ key: 'shipping', label: 'Shipping' },
	{ key: 'completed', label: 'Completed' },
	{ key: 'failed', label: 'Failed' },
]

export function StatusMappingEditor({ mappings, onSave }: StatusMappingEditorProps) {
	const [local, setLocal] = useState<StatusLabelMapping>({ ...mappings })
	const [dirty, setDirty] = useState(false)

	useEffect(() => {
		setLocal({ ...mappings })
		setDirty(false)
	}, [mappings])

	function handleChange(key: string, value: string) {
		setLocal((prev) => ({ ...prev, [key]: value }))
		setDirty(true)
	}

	function handleSave() {
		onSave(local)
		setDirty(false)
	}

	function handleReset() {
		const defaults: StatusLabelMapping = {
			todo: '',
			queued: 'status:queued',
			planning: 'status:in-progress',
			reviewing: 'status:in-progress',
			revising: 'status:in-progress',
			executing: 'status:in-progress',
			verifying: 'status:in-progress',
			shipping: 'status:in-progress',
			completed: 'status:done',
			failed: 'status:failed',
		}
		setLocal(defaults)
		setDirty(true)
	}

	return (
		<div className="status-mapping">
			<div className="status-mapping__header">
				<h4>Status → GitHub Label Mapping</h4>
				<div className="status-mapping__actions">
					<button
						type="button"
						className="btn btn--ghost"
						onClick={handleReset}
					>
						Reset to Defaults
					</button>
					<button
						type="button"
						className="btn btn--primary"
						onClick={handleSave}
						disabled={!dirty}
					>
						Save
					</button>
				</div>
			</div>
			<table className="status-mapping__table">
				<thead>
					<tr>
						<th>Pipeline Status</th>
						<th>GitHub Label</th>
					</tr>
				</thead>
				<tbody>
					{PIPELINE_STATUSES.map(({ key, label }) => (
						<tr key={key}>
							<td className="status-mapping__status">{label}</td>
							<td>
								<input
									type="text"
									className="status-mapping__input"
									value={local[key] ?? ''}
									onChange={(e) => handleChange(key, e.target.value)}
									placeholder="(no label)"
								/>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="status-mapping__hint">
				Empty = no label applied for that status. Labels are auto-created on GitHub if they don't exist.
			</p>
		</div>
	)
}
