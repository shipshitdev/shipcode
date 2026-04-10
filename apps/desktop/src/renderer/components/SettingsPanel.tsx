import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { StatusMappingEditor, Button, Input, Label, Switch, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shipcode/ui'
import type { AppSettings } from '@shipcode/shared'
import { useAppStore } from '../stores/app-store'

export function SettingsPanel() {
	const queryClient = useQueryClient()
	const { settingsSection } = useAppStore()
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
		<div className="flex-1 overflow-y-auto p-8">
			<div className="max-w-2xl">
				{settingsSection === 'general' && (
					<>
						<h3 className="mb-5">General</h3>

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
					</>
				)}

				{settingsSection === 'github' && (
					<>
						<h3 className="mb-5">GitHub</h3>

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
					</>
				)}

				{settingsSection === 'notifications' && (
					<>
						<h3 className="mb-5">Notifications</h3>

						<section className="mb-8">
							<div className="flex items-center justify-between border-b border-bg-tertiary py-2">
								<Label htmlFor="notifications-enabled">Enable notifications</Label>
								<Switch
									id="notifications-enabled"
									checked={settings.notificationsEnabled}
									onCheckedChange={(checked) => updateSettings.mutate({ notificationsEnabled: !!checked })}
								/>
							</div>
							<div className="flex items-center justify-between border-b border-bg-tertiary py-2">
								<Label htmlFor="notification-os">OS notifications</Label>
								<Switch
									id="notification-os"
									checked={settings.notificationOsEnabled}
									onCheckedChange={(checked) => updateSettings.mutate({ notificationOsEnabled: !!checked })}
									disabled={!settings.notificationsEnabled}
								/>
							</div>
							<div className="flex items-center justify-between border-b border-bg-tertiary py-2">
								<Label htmlFor="notification-badge">Dock badge count</Label>
								<Switch
									id="notification-badge"
									checked={settings.notificationBadgeEnabled}
									onCheckedChange={(checked) => updateSettings.mutate({ notificationBadgeEnabled: !!checked })}
									disabled={!settings.notificationsEnabled}
								/>
							</div>
							<div className="flex items-center justify-between border-b border-bg-tertiary py-2">
								<Label htmlFor="notification-sound">Play sound</Label>
								<Switch
									id="notification-sound"
									checked={settings.notificationSoundEnabled}
									onCheckedChange={(checked) => updateSettings.mutate({ notificationSoundEnabled: !!checked })}
									disabled={!settings.notificationsEnabled}
								/>
							</div>
							<div className="mt-3 text-xs uppercase tracking-wide text-text-muted">Notify me when</div>
							<div className="flex items-center justify-between border-b border-bg-tertiary py-2">
								<Label htmlFor="notify-awaiting-approval">Awaiting approval</Label>
								<Switch
									id="notify-awaiting-approval"
									checked={settings.notificationEvents.awaitingApproval}
									onCheckedChange={(checked) => updateSettings.mutate({
										notificationEvents: { ...settings.notificationEvents, awaitingApproval: !!checked },
									})}
									disabled={!settings.notificationsEnabled}
								/>
							</div>
							<div className="flex items-center justify-between border-b border-bg-tertiary py-2">
								<Label htmlFor="notify-failed">Pipeline failed</Label>
								<Switch
									id="notify-failed"
									checked={settings.notificationEvents.failed}
									onCheckedChange={(checked) => updateSettings.mutate({
										notificationEvents: { ...settings.notificationEvents, failed: !!checked },
									})}
									disabled={!settings.notificationsEnabled}
								/>
							</div>
							<div className="flex items-center justify-between border-b border-bg-tertiary py-2">
								<Label htmlFor="notify-completed">Pipeline completed</Label>
								<Switch
									id="notify-completed"
									checked={settings.notificationEvents.completed}
									onCheckedChange={(checked) => updateSettings.mutate({
										notificationEvents: { ...settings.notificationEvents, completed: !!checked },
									})}
									disabled={!settings.notificationsEnabled}
								/>
							</div>
							<div className="flex items-center justify-between border-b border-bg-tertiary py-2">
								<Label htmlFor="notify-verification-exhausted">Verification retries exhausted</Label>
								<Switch
									id="notify-verification-exhausted"
									checked={settings.notificationEvents.verificationExhausted}
									onCheckedChange={(checked) => updateSettings.mutate({
										notificationEvents: { ...settings.notificationEvents, verificationExhausted: !!checked },
									})}
									disabled={!settings.notificationsEnabled}
								/>
							</div>
						</section>
					</>
				)}

				{settingsSection === 'pipeline' && (
					<>
						<h3 className="mb-5">Pipeline</h3>

						<section className="mb-8">
							<div className="flex items-center justify-between mb-4">
								<Label htmlFor="executor-model">Executor model</Label>
								<Select
									value={settings.executorModel}
									onValueChange={(value) => updateSettings.mutate({ executorModel: value as AppSettings['executorModel'] })}
								>
									<SelectTrigger id="executor-model" className="w-[160px]">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="claude">claude</SelectItem>
										<SelectItem value="codex">codex</SelectItem>
										<SelectItem value="openrouter">openrouter</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</section>

						<section className="mb-8">
							<StatusMappingEditor
								mappings={settings.statusLabelMappings}
								onSave={(mappings) => updateSettings.mutate({ statusLabelMappings: mappings })}
							/>
						</section>
					</>
				)}
			</div>
		</div>
	)
}
