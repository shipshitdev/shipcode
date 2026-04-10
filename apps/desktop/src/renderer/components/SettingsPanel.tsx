import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { StatusMappingEditor, Button, Input, Label, Switch } from '@shipcode/ui'
import type { AppSettings } from '@shipcode/shared'

export function SettingsPanel() {
	const queryClient = useQueryClient()
	const [worktreeRootError, setWorktreeRootError] = useState<string | null>(null)

	const { data: settings } = useQuery<AppSettings>({
		queryKey: ['settings'],
		queryFn: () => window.shipcode.invoke('settings:get'),
	})

	const updateSettings = useMutation({
		mutationFn: (patch: Partial<AppSettings>) =>
			window.shipcode.invoke('settings:set', patch),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['settings'] })
		},
	})

	if (!settings) return null

	return (
		<div className="flex-1 overflow-y-auto p-6 max-w-[600px]">
			<h3 className="mb-5">Settings</h3>

			<section className="mb-8">
				<h4 className="mb-3 text-text-secondary">GitHub Integration</h4>
				<div className="flex items-center justify-between border-b border-bg-tertiary py-2">
					<Label htmlFor="polling-enabled">Polling Enabled</Label>
					<Switch
						id="polling-enabled"
						checked={settings.githubPollingEnabled}
						onCheckedChange={(checked) => updateSettings.mutate({ githubPollingEnabled: !!checked })}
					/>
				</div>
				<div className="flex items-center justify-between border-b border-bg-tertiary py-2">
					<Label htmlFor="poll-interval">Poll Interval (ms)</Label>
					<Input
						id="poll-interval"
						type="number"
						className="w-[120px]"
						value={settings.githubPollingIntervalMs}
						onChange={(e) => updateSettings.mutate({ githubPollingIntervalMs: parseInt(e.target.value, 10) })}
						min={5000}
						step={5000}
					/>
				</div>
				<div className="flex items-center justify-between border-b border-bg-tertiary py-2">
					<Label htmlFor="auto-pickup">Auto-pickup Issues</Label>
					<Switch
						id="auto-pickup"
						checked={settings.autoPickupEnabled}
						onCheckedChange={(checked) => updateSettings.mutate({ autoPickupEnabled: !!checked })}
					/>
				</div>
			</section>

			<section className="mb-8">
				<StatusMappingEditor
					mappings={settings.statusLabelMappings}
					onSave={(mappings) => updateSettings.mutate({ statusLabelMappings: mappings })}
				/>
			</section>

			<section className="mb-8">
				<h4 className="mb-3 text-text-secondary">Worktree Location</h4>
				<div className="flex items-center justify-between border-b border-bg-tertiary py-2">
					<Label htmlFor="worktree-root">Worktree root</Label>
					<Input
						id="worktree-root"
						type="text"
						placeholder="~/.shipcode/worktrees"
						className="w-[280px]"
						defaultValue={settings.worktreeRoot ?? ''}
						onBlur={(e) => {
							const raw = e.target.value.trim()
							const next = raw === '' ? null : raw
							setWorktreeRootError(null)
							updateSettings.mutate(
								{ worktreeRoot: next },
								{
									onError: (err: unknown) => {
										setWorktreeRootError(err instanceof Error ? err.message : String(err))
									},
								},
							)
						}}
					/>
				</div>
				<p className="text-xs text-text-secondary mt-2">
					Default: <code>~/.shipcode/worktrees</code>. Use an absolute path or{' '}
					<code>~/…</code> to customize, or leave blank to reset to default. Relative paths
					are rejected.
				</p>
				{worktreeRootError ? (
					<p className="text-xs text-red-500 mt-1">{worktreeRootError}</p>
				) : null}
			</section>

			<section className="mb-8">
				<h4 className="mb-3 text-text-secondary">Setup</h4>
				<div className="flex items-center justify-between border-b border-bg-tertiary py-2">
					<span className="text-text-primary">Re-run the onboarding wizard</span>
					<Button
						variant="secondary"
						onClick={() => updateSettings.mutate({ onboardingVersion: 0 })}
					>
						Re-run Setup
					</Button>
				</div>
			</section>
		</div>
	)
}
