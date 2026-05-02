import type { AppSettings } from '@shipcode/shared';
import { Input, SettingsRow, Switch } from '@shipshitdev/ui';

export function GithubSettingsSection({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}) {
  return (
    <>
      <h3 className="mb-5">GitHub</h3>

      <section className="mb-8">
        <h4 className="mb-3 text-secondary">GitHub Integration</h4>
        <SettingsRow label="Polling enabled" htmlFor="polling-enabled">
          <Switch
            id="polling-enabled"
            checked={settings.githubPollingEnabled}
            onCheckedChange={(checked: boolean) => onUpdate({ githubPollingEnabled: !!checked })}
          />
        </SettingsRow>
        <SettingsRow label="Poll interval (ms)" htmlFor="poll-interval">
          <Input
            id="poll-interval"
            type="number"
            className="w-[120px]"
            value={settings.githubPollingIntervalMs}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              if (!Number.isNaN(parsed)) onUpdate({ githubPollingIntervalMs: parsed });
            }}
            min={5000}
            step={5000}
          />
        </SettingsRow>
        <SettingsRow label="Auto-pickup issues" htmlFor="auto-pickup">
          <Switch
            id="auto-pickup"
            checked={settings.autoPickupEnabled}
            onCheckedChange={(checked: boolean) => onUpdate({ autoPickupEnabled: !!checked })}
          />
        </SettingsRow>
      </section>
    </>
  );
}
