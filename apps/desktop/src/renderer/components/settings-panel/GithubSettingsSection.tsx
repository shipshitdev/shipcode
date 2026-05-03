import type { AppSettings } from '@shipcode/shared';
import { Input, SettingsRow, Switch } from '@shipshitdev/ui';

const PRIORITY_OPTIONS: Array<{ rank: 'p0' | 'p1' | 'p2' | 'p3'; label: string }> = [
  { rank: 'p0', label: 'P0 — Critical' },
  { rank: 'p1', label: 'P1 — High' },
  { rank: 'p2', label: 'P2 — Medium' },
  { rank: 'p3', label: 'P3 — Low' },
];

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
      </section>

      <section className="mb-8">
        <h4 className="mb-3 text-secondary">Auto-Run</h4>
        <SettingsRow label="Max tasks per run (0 = all)" htmlFor="auto-run-max">
          <Input
            id="auto-run-max"
            type="number"
            className="w-[80px]"
            min={0}
            max={100}
            step={1}
            value={settings.autoRunMaxTasks}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!Number.isNaN(v) && v >= 0) onUpdate({ autoRunMaxTasks: v });
            }}
          />
        </SettingsRow>
        <p className="mb-3 mt-2 text-xs text-muted">
          {settings.autoRunPriorities.length === 0
            ? 'All priorities eligible — Run (X) will include every todo issue.'
            : `Only ${settings.autoRunPriorities.map((p) => p.toUpperCase()).join(', ')} issues will be included.`}
        </p>
        {PRIORITY_OPTIONS.map(({ rank, label }) => {
          const isChecked = settings.autoRunPriorities.includes(rank);
          return (
            <SettingsRow key={rank} label={label} htmlFor={`auto-run-${rank}`}>
              <Switch
                id={`auto-run-${rank}`}
                checked={isChecked}
                onCheckedChange={(checked: boolean) => {
                  const next = checked
                    ? [...settings.autoRunPriorities, rank]
                    : settings.autoRunPriorities.filter((p) => p !== rank);
                  onUpdate({ autoRunPriorities: next });
                }}
              />
            </SettingsRow>
          );
        })}
      </section>
    </>
  );
}
