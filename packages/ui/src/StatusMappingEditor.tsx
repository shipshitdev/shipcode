import { useState, useEffect } from 'react'
import type { StatusLabelMapping } from '@shipcode/shared'
import { Button } from './primitives/button'
import { Input } from './primitives/input'
import { cn } from './lib/utils'

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
		<div>
			<div className="flex items-center justify-between mb-3">
				<h4 className="m-0 text-text-primary font-medium">Status → GitHub Label Mapping</h4>
				<div className="flex gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={handleReset}
					>
						Reset to Defaults
					</Button>
					<Button
						type="button"
						variant="default"
						size="sm"
						onClick={handleSave}
						disabled={!dirty}
					>
						Save
					</Button>
				</div>
			</div>
			<table className="w-full border-collapse">
				<thead>
					<tr>
						<th className="text-left p-2 text-text-secondary border-b border-bg-tertiary font-medium">
							Pipeline Status
						</th>
						<th className="text-left p-2 text-text-secondary border-b border-bg-tertiary font-medium">
							GitHub Label
						</th>
					</tr>
				</thead>
				<tbody>
					{PIPELINE_STATUSES.map(({ key, label }) => (
						<tr key={key}>
							<td className="px-2 py-1.5 border-b border-bg-tertiary text-text-primary font-medium">
								{label}
							</td>
							<td className="px-2 py-1.5 border-b border-bg-tertiary">
								<Input
									type="text"
									className="h-7 px-2 py-1"
									value={local[key] ?? ''}
									onChange={(e) => handleChange(key, e.target.value)}
									placeholder="(no label)"
								/>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="mt-2 text-xs text-text-muted">
				Empty = no label applied for that status. Labels are auto-created on GitHub if they don't exist.
			</p>
		</div>
	)
}
