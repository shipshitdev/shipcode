import type { AppSettings, ExecutorModel, IntegrationStatus } from '@shipcode/shared';
import { SettingsSection } from '@shipcode/ui';
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
import { getModelOptions, PROVIDER_DISPLAY } from '../model-provider-options';

const AUTO_COMMIT_PROVIDERS: ExecutorModel[] = ['claude', 'codex', 'openrouter'];

function defaultModelForProvider(
  provider: ExecutorModel,
  integrationStatus: IntegrationStatus | undefined,
): string {
  if (provider === 'openrouter') return 'openrouter/auto';
  return getModelOptions(provider, integrationStatus)[0]?.value ?? provider;
}

export function AutoCommitSettingsSection({
  settings,
  integrationStatus,
  onUpdate,
}: {
  settings: AppSettings;
  integrationStatus?: IntegrationStatus;
  onUpdate: (patch: Partial<AppSettings>) => void;
}) {
  const provider = settings.autoCommitProvider;
  const modelOptions = getModelOptions(provider, integrationStatus);
  const knownModelValues = new Set(modelOptions.map((option) => option.value));
  const usesProviderDefault = settings.autoCommitModel === provider;
  const modelSelection = usesProviderDefault ? '__default__' : settings.autoCommitModel;

  const updateProvider = (value: string) => {
    const nextProvider = value as ExecutorModel;
    onUpdate({
      autoCommitProvider: nextProvider,
      autoCommitModel: defaultModelForProvider(nextProvider, integrationStatus),
    });
  };

  const updateCriteria = (key: keyof AppSettings['cleanupCriteria'], value: boolean) => {
    onUpdate({
      cleanupCriteria: { ...settings.cleanupCriteria, [key]: value },
    });
  };

  return (
    <>
      <h3 className="mb-5">Auto-commit & Cleanup</h3>

      <SettingsSection title="Auto-commit">
        <SettingsRow
          label="Enabled"
          htmlFor="auto-commit-enabled"
          description="Shows Auto-commit in the Git tab."
        >
          <Switch
            id="auto-commit-enabled"
            checked={settings.autoCommitEnabled}
            onCheckedChange={(checked: boolean) => onUpdate({ autoCommitEnabled: !!checked })}
          />
        </SettingsRow>
        <SettingsRow
          label="Provider"
          htmlFor="auto-commit-provider"
          description="CLI or OpenRouter provider used for commit grouping and messages."
        >
          <Select value={provider} onValueChange={updateProvider}>
            <SelectTrigger id="auto-commit-provider" className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTO_COMMIT_PROVIDERS.map((option) => (
                <SelectItem key={option} value={option}>
                  {PROVIDER_DISPLAY[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label="Model"
          htmlFor="auto-commit-model"
          description="Model used to group changed files and write commit messages."
        >
          <Select
            value={modelSelection}
            onValueChange={(value: string) =>
              onUpdate({ autoCommitModel: value === '__default__' ? provider : value })
            }
          >
            <SelectTrigger id="auto-commit-model" className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">{PROVIDER_DISPLAY[provider]} default</SelectItem>
              {!usesProviderDefault && !knownModelValues.has(settings.autoCommitModel) ? (
                <SelectItem value={settings.autoCommitModel}>{settings.autoCommitModel}</SelectItem>
              ) : null}
              {modelOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label="Custom model"
          htmlFor="auto-commit-custom-model"
          description="Optional raw model id when the preset list is not enough."
        >
          <Input
            id="auto-commit-custom-model"
            className="w-[260px]"
            defaultValue={
              !usesProviderDefault && !knownModelValues.has(settings.autoCommitModel)
                ? settings.autoCommitModel
                : ''
            }
            placeholder={provider === 'openrouter' ? 'anthropic/claude-sonnet-4.6' : ''}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value) {
                onUpdate({ autoCommitModel: value });
              }
            }}
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
      </SettingsSection>

      <SettingsSection title="Cleanup criteria">
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
          label="Local branches already merged"
          htmlFor="cleanup-local-merged"
          description="Show ShipCode local branches whose commits are already in the default branch."
        >
          <Switch
            id="cleanup-local-merged"
            checked={settings.cleanupCriteria.localBranchMerged}
            onCheckedChange={(checked: boolean) => updateCriteria('localBranchMerged', !!checked)}
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
          label="Remote branches already merged"
          htmlFor="cleanup-remote-merged"
          description="Show ShipCode remote branches whose commits are already in the default branch."
        >
          <Switch
            id="cleanup-remote-merged"
            checked={settings.cleanupCriteria.remoteBranchMerged}
            onCheckedChange={(checked: boolean) => updateCriteria('remoteBranchMerged', !!checked)}
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
      </SettingsSection>
    </>
  );
}
