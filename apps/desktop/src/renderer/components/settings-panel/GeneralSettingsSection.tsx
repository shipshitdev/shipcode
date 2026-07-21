import { type AppSettings, DEFAULT_SETTINGS, type TelemetryStatus } from '@shipcode/shared';
import { SettingsSection } from '@shipcode/ui';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  Switch,
} from '@shipshitdev/ui';

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
        <SettingsRow
          label="Theme"
          htmlFor="theme"
          description="Follow the system appearance or force ShipCode into light or dark mode."
        >
          <Select
            value={settings.theme}
            onValueChange={(value) => onUpdate({ theme: value as AppSettings['theme'] })}
          >
            <SelectTrigger id="theme" className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label="Font style"
          htmlFor="font-style"
          description="Switch the main app typeface without affecting code or terminal monospace text."
        >
          <Select
            value={settings.fontStyle}
            onValueChange={(value) => onUpdate({ fontStyle: value as AppSettings['fontStyle'] })}
          >
            <SelectTrigger id="font-style" className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dm-sans">DM Sans</SelectItem>
              <SelectItem value="system">System UI</SelectItem>
              <SelectItem value="serif">Editorial Serif</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label="Font size"
          htmlFor="font-size"
          description="Adjust the base UI text size across the desktop app."
        >
          <Select
            value={String(settings.fontSize)}
            onValueChange={(value) =>
              onUpdate({ fontSize: Number(value) as AppSettings['fontSize'] })
            }
          >
            <SelectTrigger id="font-size" className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="12">Small</SelectItem>
              <SelectItem value="13">Default</SelectItem>
              <SelectItem value="14">Large</SelectItem>
              <SelectItem value="15">Extra large</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
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
