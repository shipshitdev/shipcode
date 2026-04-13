import { type AppSettings, DEFAULT_SETTINGS } from '@shipcode/shared';
import { Button, Input, SettingsRow } from '@shipcode/ui';

export function GeneralSettingsSection({
  settings,
  worktreeRootError,
  onUpdate,
  onUpdateWorktreeRoot,
}: {
  settings: AppSettings;
  worktreeRootError: string | null;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onUpdateWorktreeRoot: (value: string | null) => void;
}) {
  return (
    <>
      <h3 className="mb-5">General</h3>

      <section className="mb-8">
        <h4 className="mb-3 text-secondary">Worktree Location</h4>
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
      </section>

      <section className="mb-8">
        <h4 className="mb-3 text-secondary">Setup</h4>
        <SettingsRow label="Re-run the onboarding wizard">
          <Button variant="secondary" onClick={() => onUpdate({ onboardingVersion: 0 })}>
            Re-run Setup
          </Button>
        </SettingsRow>
      </section>
    </>
  );
}
