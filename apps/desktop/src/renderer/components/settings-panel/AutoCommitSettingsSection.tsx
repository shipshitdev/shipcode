import {
  type AppSettings,
  type ExecutorModel,
  type IntegrationStatus,
  PINNED_MODEL_DEFAULTS,
} from '@shipcode/shared';
import { SettingsSection, SettingsSelectRow } from '@shipcode/ui';
import { Input, SettingsRow, Switch } from '@shipshitdev/ui';
import { getModelOptions, PROVIDER_DISPLAY } from '../model-provider-options-data';

const AUTO_COMMIT_PROVIDERS = [
  'claude',
  'codex',
  'openrouter',
] as const satisfies readonly ExecutorModel[];
type AutoCommitProvider = (typeof AUTO_COMMIT_PROVIDERS)[number];

const AUTO_COMMIT_DEFAULT_MODELS = {
  claude: PINNED_MODEL_DEFAULTS.claude.phase,
  codex: PINNED_MODEL_DEFAULTS.codex.phase,
  openrouter: PINNED_MODEL_DEFAULTS.openrouter.paid,
} as const satisfies Record<AutoCommitProvider, string>;

function defaultModelForProvider(
  provider: AutoCommitProvider,
  integrationStatus: IntegrationStatus | undefined,
): string {
  const options = getModelOptions(provider, integrationStatus);
  const pinnedDefault = AUTO_COMMIT_DEFAULT_MODELS[provider];
  return options.some((option) => option.value === pinnedDefault)
    ? pinnedDefault
    : (options[0]?.value ?? provider);
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
    const nextProvider = value as AutoCommitProvider;
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
        <SettingsSelectRow
          id="auto-commit-provider"
          label="Provider"
          description="CLI or OpenRouter provider used for commit grouping and messages."
          value={provider}
          options={AUTO_COMMIT_PROVIDERS.map((option) => ({
            value: option,
            label: PROVIDER_DISPLAY[option],
          }))}
          onValueChange={updateProvider}
          triggerClassName="w-[180px]"
        />
        <SettingsSelectRow
          id="auto-commit-model"
          label="Model"
          description="Model used to group changed files and write commit messages."
          value={modelSelection}
          options={[
            { value: '__default__', label: `${PROVIDER_DISPLAY[provider]} default` },
            ...(!usesProviderDefault && !knownModelValues.has(settings.autoCommitModel)
              ? [{ value: settings.autoCommitModel, label: settings.autoCommitModel }]
              : []),
            ...modelOptions.map((option) => ({ value: option.value, label: option.label })),
          ]}
          onValueChange={(value) =>
            onUpdate({ autoCommitModel: value === '__default__' ? provider : value })
          }
          triggerClassName="w-[260px]"
        />
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
        <SettingsSelectRow
          id="auto-commit-mode"
          label="Mode"
          description="Split = LLM groups files into multiple commits by intent. Single = one commit for everything."
          value={settings.autoCommitMode}
          options={[
            { value: 'split', label: 'Split (LLM decides)' },
            { value: 'single', label: 'Single commit' },
          ]}
          onValueChange={(value) =>
            onUpdate({ autoCommitMode: value as AppSettings['autoCommitMode'] })
          }
          triggerClassName="w-[180px]"
        />
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
