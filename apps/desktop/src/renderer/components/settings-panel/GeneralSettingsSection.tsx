import { type AppSettings, DEFAULT_SETTINGS, type TelemetryStatus } from '@shipcode/shared';
import { SettingsSection, SettingsSelectRow } from '@shipcode/ui';
import { Button, Input, SettingsRow, Switch } from '@shipshitdev/ui';

export function GeneralSettingsSection({
  settings,
  telemetryStatus,
  launchAtLoginSupported = false,
  worktreeRootError,
  onUpdate,
  onUpdateWorktreeRoot,
}: {
  settings: AppSettings;
  telemetryStatus?: TelemetryStatus;
  launchAtLoginSupported?: boolean;
  worktreeRootError: string | null;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onUpdateWorktreeRoot: (value: string | null) => void;
}) {
  const telemetryDisabledByEnv = telemetryStatus?.envDisabled === true;
  const telemetryMissingDsn = telemetryStatus?.dsnConfigured === false;

  return (
    <>
      <h3 className="mb-5">General</h3>

      <SettingsSection title="Appearance">
        <SettingsSelectRow
          id="theme"
          label="Theme"
          description="Follow the system appearance or force ShipCode into light or dark mode."
          value={settings.theme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          onValueChange={(value) => onUpdate({ theme: value as AppSettings['theme'] })}
          triggerClassName="w-[180px]"
        />
        <SettingsSelectRow
          id="font-style"
          label="Font style"
          description="Switch the main app typeface without affecting code or terminal monospace text."
          value={settings.fontStyle}
          options={[
            { value: 'dm-sans', label: 'DM Sans' },
            { value: 'system', label: 'System UI' },
            { value: 'serif', label: 'Editorial Serif' },
          ]}
          onValueChange={(value) => onUpdate({ fontStyle: value as AppSettings['fontStyle'] })}
          triggerClassName="w-[180px]"
        />
        <SettingsSelectRow
          id="font-size"
          label="Font size"
          description="Adjust the base UI text size across the desktop app."
          value={String(settings.fontSize)}
          options={[
            { value: '12', label: 'Small' },
            { value: '13', label: 'Default' },
            { value: '14', label: 'Large' },
            { value: '15', label: 'Extra large' },
          ]}
          onValueChange={(value) =>
            onUpdate({ fontSize: Number(value) as AppSettings['fontSize'] })
          }
          triggerClassName="w-[180px]"
        />
      </SettingsSection>

      <SettingsSection title="Startup">
        {launchAtLoginSupported ? (
          <SettingsRow
            label="Launch ShipCode at login"
            htmlFor="launch-at-login"
            description="Open the packaged ShipCode app automatically when you log in to macOS."
          >
            <Switch
              id="launch-at-login"
              checked={settings.launchAtLogin}
              onCheckedChange={(checked) => onUpdate({ launchAtLogin: checked })}
            />
          </SettingsRow>
        ) : (
          <p className="text-xs text-secondary">
            Launch at login is currently available in packaged macOS builds only.
          </p>
        )}
      </SettingsSection>

      <SettingsSection title="Privacy">
        <SettingsRow
          label="Send anonymous error reports"
          htmlFor="telemetry-enabled"
          description={
            telemetryDisabledByEnv
              ? 'Disabled by SHIPCODE_TELEMETRY_ENABLED=false.'
              : 'Sends crash, IPC, and pipeline failure metadata to Sentry. Prompts and terminal output are not sent.'
          }
        >
          <Switch
            id="telemetry-enabled"
            checked={settings.telemetryEnabled === true && !telemetryDisabledByEnv}
            disabled={telemetryDisabledByEnv}
            onCheckedChange={(checked) => onUpdate({ telemetryEnabled: checked })}
          />
        </SettingsRow>
        <p className="text-xs text-secondary mt-2">
          Current state:{' '}
          {telemetryDisabledByEnv
            ? 'disabled by environment'
            : settings.telemetryEnabled == null
              ? 'waiting for consent'
              : settings.telemetryEnabled
                ? telemetryMissingDsn
                  ? 'allowed, but no Sentry DSN is configured'
                  : 'enabled'
                : 'disabled'}
          .
        </p>
      </SettingsSection>

      <SettingsSection title="Worktree Location">
        <SettingsRow label="Worktree root" htmlFor="worktree-root">
          <Input
            id="worktree-root"
            type="text"
            placeholder="~/.shipcode/worktrees"
            className="w-[280px]"
            defaultValue={settings.worktreeRoot ?? ''}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              onUpdateWorktreeRoot(raw === '' ? null : raw);
            }}
          />
        </SettingsRow>
        <p className="text-xs text-secondary mt-2">
          Default: <code>~/.shipcode/worktrees</code>. Use an absolute path or <code>~/...</code> to
          customize, or leave blank to reset to default. Relative paths are rejected.
        </p>
        {worktreeRootError ? (
          <p className="text-xs text-red-500 mt-1">{worktreeRootError}</p>
        ) : null}
        <SettingsRow label="Branch format" htmlFor="worktree-branch-format">
          <Input
            id="worktree-branch-format"
            type="text"
            placeholder={DEFAULT_SETTINGS.worktreeBranchFormat}
            className="w-[280px]"
            defaultValue={settings.worktreeBranchFormat ?? DEFAULT_SETTINGS.worktreeBranchFormat}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              onUpdate({
                worktreeBranchFormat: raw === '' ? DEFAULT_SETTINGS.worktreeBranchFormat : raw,
              });
            }}
          />
        </SettingsRow>
        <p className="text-xs text-secondary mt-2">
          Tokens: <code>{'{id}'}</code> = issue number, <code>{'{slug}'}</code> = slugified title.
          Default: <code>{DEFAULT_SETTINGS.worktreeBranchFormat}</code>. Leave blank to reset.
        </p>
      </SettingsSection>

      <SettingsSection title="Add Project">
        <SettingsRow
          label="Start browsing in"
          htmlFor="add-project-starts-in"
          description="The directory the project explorer opens to when adding a new repository."
        >
          <Input
            id="add-project-starts-in"
            type="text"
            placeholder="~/"
            className="w-[240px]"
            defaultValue={settings.addProjectStartsIn ?? ''}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              onUpdate({ addProjectStartsIn: raw === '' ? null : raw });
            }}
          />
        </SettingsRow>
        <p className="text-xs text-secondary mt-2">
          Default: <code>~/</code> (home directory). Use an absolute path or <code>~/...</code>.
          Leave blank to reset.
        </p>
      </SettingsSection>

      <SettingsSection title="Setup">
        <SettingsRow label="Re-run the onboarding wizard">
          <Button variant="secondary" onClick={() => onUpdate({ onboardingVersion: 0 })}>
            Re-run Setup
          </Button>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
