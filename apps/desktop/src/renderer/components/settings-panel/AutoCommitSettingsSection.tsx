import type { AppSettings } from '@shipcode/shared';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  Switch,
} from '@shipshitdev/ui';

export function AutoCommitSettingsSection({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}) {
  const updateCriteria = (key: keyof AppSettings['cleanupCriteria'], value: boolean) => {
    onUpdate({
      cleanupCriteria: { ...settings.cleanupCriteria, [key]: value },
    });
  };

  return (
    <>
      <h3 className="mb-5">Auto-commit & Cleanup</h3>

      <section className="mb-8">
        <h4 className="mb-3 text-secondary">Auto-commit</h4>
        <SettingsRow
          label="Enabled"
          htmlFor="auto-commit-enabled"
          description="Adds an Auto-commit button to the Git tab."
        >
          <Switch
            id="auto-commit-enabled"
            checked={settings.autoCommitEnabled}
            onCheckedChange={(checked: boolean) => onUpdate({ autoCommitEnabled: !!checked })}
          />
        </SettingsRow>
        <SettingsRow
          label="Model"
          htmlFor="auto-commit-model"
          description="OpenRouter model id. Default lets OpenRouter pick the cheapest fast model."
        >
          <Input
            id="auto-commit-model"
            className="w-[260px]"
            value={settings.autoCommitModel}
            onChange={(e) => onUpdate({ autoCommitModel: e.target.value })}
            placeholder="openrouter/auto"
          />
        </SettingsRow>
        <SettingsRow
          label="Mode"
          htmlFor="auto-commit-mode"
          description="Split = LLM groups files into multiple commits by intent. Single = one commit for everything."
        >
          <Select
            value={settings.autoCommitMode}
            onValueChange={(value: string) =>
              onUpdate({ autoCommitMode: value as AppSettings['autoCommitMode'] })
            }
          >
            <SelectTrigger id="auto-commit-mode" className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="split">Split (LLM decides)</SelectItem>
              <SelectItem value="single">Single commit</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </section>

      <section className="mb-8">
        <h4 className="mb-3 text-secondary">Cleanup criteria</h4>
        <p className="mb-3 text-sm text-secondary">
          Which categories the Cleanup button surfaces. Confirm modal still required before any
          destructive action.
        </p>
        <SettingsRow
          label="Worktrees with merged PR"
          htmlFor="cleanup-merged"
          description="Show worktrees whose PR is already merged."
        >
          <Switch
            id="cleanup-merged"
            checked={settings.cleanupCriteria.worktreeMergedPr}
            onCheckedChange={(checked: boolean) => updateCriteria('worktreeMergedPr', !!checked)}
          />
        </SettingsRow>
        <SettingsRow
          label="Worktrees with closed PR"
          htmlFor="cleanup-closed"
          description="Show worktrees whose PR was closed without merging."
        >
          <Switch
            id="cleanup-closed"
            checked={settings.cleanupCriteria.worktreeClosedPr}
            onCheckedChange={(checked: boolean) => updateCriteria('worktreeClosedPr', !!checked)}
          />
        </SettingsRow>
        <SettingsRow
          label="Local branches with no remote"
          htmlFor="cleanup-orphan"
          description="Show local branches that have no upstream and no active worktree."
        >
          <Switch
            id="cleanup-orphan"
            checked={settings.cleanupCriteria.localBranchNoRemote}
            onCheckedChange={(checked: boolean) => updateCriteria('localBranchNoRemote', !!checked)}
          />
        </SettingsRow>
        <SettingsRow
          label="Worktrees without PR (clean)"
          htmlFor="cleanup-no-pr"
          description="More aggressive: show clean worktrees that never opened a PR."
        >
          <Switch
            id="cleanup-no-pr"
            checked={settings.cleanupCriteria.worktreeNoPrCleanTree}
            onCheckedChange={(checked: boolean) =>
              updateCriteria('worktreeNoPrCleanTree', !!checked)
            }
          />
        </SettingsRow>
      </section>
    </>
  );
}
