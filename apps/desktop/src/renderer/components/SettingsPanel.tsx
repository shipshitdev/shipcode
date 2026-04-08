import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { StatusMappingEditor } from '@shipcode/ui'
import type { AppSettings } from '@shipcode/shared'

export function SettingsPanel() {
	const queryClient = useQueryClient()

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
		<div className="settings-panel">
			<h3>Settings</h3>

			<section className="settings-panel__section">
				<h4>GitHub Integration</h4>
				<label className="settings-panel__field">
					<span>Polling Enabled</span>
					<input
						type="checkbox"
						checked={settings.githubPollingEnabled}
						onChange={(e) => updateSettings.mutate({ githubPollingEnabled: e.target.checked })}
					/>
				</label>
				<label className="settings-panel__field">
					<span>Poll Interval (ms)</span>
					<input
						type="number"
						value={settings.githubPollingIntervalMs}
						onChange={(e) => updateSettings.mutate({ githubPollingIntervalMs: parseInt(e.target.value, 10) })}
						min={5000}
						step={5000}
					/>
				</label>
				<label className="settings-panel__field">
					<span>Auto-pickup Issues</span>
					<input
						type="checkbox"
						checked={settings.autoPickupEnabled}
						onChange={(e) => updateSettings.mutate({ autoPickupEnabled: e.target.checked })}
					/>
				</label>
			</section>

			<section className="settings-panel__section">
				<StatusMappingEditor
					mappings={settings.statusLabelMappings}
					onSave={(mappings) => updateSettings.mutate({ statusLabelMappings: mappings })}
				/>
			</section>

			<section className="settings-panel__section">
				<h4>Setup</h4>
				<div className="settings-panel__field">
					<span>Re-run the onboarding wizard</span>
					<button
						type="button"
						className="btn btn--secondary"
						onClick={() => updateSettings.mutate({ onboardingVersion: 0 })}
					>
						Re-run Setup
					</button>
				</div>
			</section>
		</div>
	)
}
