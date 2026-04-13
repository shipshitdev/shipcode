import type { AppSettings, IntegrationStatus } from '@shipcode/shared';
import { Input, SettingsRow, StatusMappingEditor, Switch, Textarea } from '@shipcode/ui';
import { PhaseModelRow } from './PhaseModelRow';

export function PipelineSettingsSection({
  settings,
  integrationStatus,
  onUpdate,
}: {
  settings: AppSettings;
  integrationStatus: IntegrationStatus | undefined;
  onUpdate: (patch: Partial<AppSettings>) => void;
}) {
  return (
    <>
      <h3 className="mb-5">Pipeline</h3>

      <section className="mb-8">
        <SettingsRow
          label="Require approval before execution"
          htmlFor="require-approval"
          description="When on, pipeline pauses after review for your sign-off. When off, it executes automatically."
        >
          <Switch
            id="require-approval"
            checked={settings.requireApproval}
            onCheckedChange={(checked: boolean) => onUpdate({ requireApproval: checked })}
          />
        </SettingsRow>
        <SettingsRow
          label="Max concurrent pipelines"
          htmlFor="max-concurrent-pipelines"
          description="How many pipelines can run at once. Extras are queued."
        >
          <Input
            id="max-concurrent-pipelines"
            type="number"
            className="w-[80px]"
            value={settings.maxConcurrentPipelines}
            onChange={(e) => {
              const value = Number.parseInt(e.target.value, 10);
              if (value >= 1 && value <= 10) onUpdate({ maxConcurrentPipelines: value });
            }}
            min={1}
            max={10}
            step={1}
          />
        </SettingsRow>
        <SettingsRow
          label="Review rounds"
          htmlFor="max-review-rounds"
          description="How many review->revise cycles before execution or approval."
        >
          <Input
            id="max-review-rounds"
            type="number"
            className="w-[80px]"
            value={settings.maxReviewRounds}
            onChange={(e) => {
              const value = Number.parseInt(e.target.value, 10);
              if (value >= 1 && value <= 5) onUpdate({ maxReviewRounds: value });
            }}
            min={1}
            max={5}
            step={1}
          />
        </SettingsRow>
        <SettingsRow
          label="Planner max turns"
          htmlFor="planner-max-turns"
          description="Max Claude turns per plan / revision / verify phase."
        >
          <Input
            id="planner-max-turns"
            type="number"
            className="w-[80px]"
            value={settings.plannerMaxTurns}
            onChange={(e) => {
              const value = Number.parseInt(e.target.value, 10);
              if (value >= 1 && value <= 20) onUpdate({ plannerMaxTurns: value });
            }}
            min={1}
            max={20}
            step={1}
          />
        </SettingsRow>
        <PhaseModelRow
          label="Planner model"
          htmlFor="planner-model"
          modelValue={settings.plannerModel}
          openrouterModelValue={settings.openrouterPlannerModel}
          reasoningEffortValue={settings.plannerReasoningEffort}
          validProviders={['claude', 'codex', 'openrouter']}
          onModelChange={(value) =>
            onUpdate({ plannerModel: value as AppSettings['plannerModel'] })
          }
          onOpenrouterModelChange={(value) => onUpdate({ openrouterPlannerModel: value })}
          onReasoningEffortChange={(value) => onUpdate({ plannerReasoningEffort: value })}
          modelCheck={
            integrationStatus?.openrouter.modelChecks.find((check) => check.key === 'planner') ??
            null
          }
          warningMessage={
            settings.plannerModel === 'openrouter' &&
            integrationStatus?.openrouter.authStatus !== 'valid'
              ? (integrationStatus?.openrouter.message ?? 'OpenRouter is not ready.')
              : null
          }
        />
        <PhaseModelRow
          label="Reviewer model"
          htmlFor="reviewer-model"
          modelValue={settings.reviewerModel}
          openrouterModelValue={settings.openrouterReviewerModel}
          reasoningEffortValue={settings.reviewerReasoningEffort}
          validProviders={['claude', 'codex', 'openrouter']}
          onModelChange={(value) =>
            onUpdate({ reviewerModel: value as AppSettings['reviewerModel'] })
          }
          onOpenrouterModelChange={(value) => onUpdate({ openrouterReviewerModel: value })}
          onReasoningEffortChange={(value) => onUpdate({ reviewerReasoningEffort: value })}
          modelCheck={
            integrationStatus?.openrouter.modelChecks.find((check) => check.key === 'reviewer') ??
            null
          }
          warningMessage={
            settings.reviewerModel === 'openrouter' &&
            integrationStatus?.openrouter.authStatus !== 'valid'
              ? (integrationStatus?.openrouter.message ?? 'OpenRouter is not ready.')
              : null
          }
        />
        <PhaseModelRow
          label="Executor model"
          htmlFor="executor-model"
          modelValue={settings.executorModel}
          openrouterModelValue={settings.openrouterExecutorModel}
          reasoningEffortValue={settings.executorReasoningEffort}
          validProviders={['claude', 'codex', 'openrouter']}
          onModelChange={(value) =>
            onUpdate({ executorModel: value as AppSettings['executorModel'] })
          }
          onOpenrouterModelChange={(value) => onUpdate({ openrouterExecutorModel: value })}
          onReasoningEffortChange={(value) => onUpdate({ executorReasoningEffort: value })}
          modelCheck={
            integrationStatus?.openrouter.modelChecks.find((check) => check.key === 'executor') ??
            null
          }
          warningMessage={
            settings.executorModel === 'openrouter' &&
            integrationStatus?.openrouter.authStatus !== 'valid'
              ? (integrationStatus?.openrouter.message ?? 'OpenRouter is not ready.')
              : null
          }
        />
        <PhaseModelRow
          label="Verifier model"
          htmlFor="verifier-model"
          modelValue={settings.verifierModel}
          openrouterModelValue={settings.openrouterVerifierModel}
          reasoningEffortValue={settings.verifierReasoningEffort}
          validProviders={['claude', 'codex', 'openrouter']}
          onModelChange={(value) =>
            onUpdate({ verifierModel: value as AppSettings['verifierModel'] })
          }
          onOpenrouterModelChange={(value) => onUpdate({ openrouterVerifierModel: value })}
          onReasoningEffortChange={(value) => onUpdate({ verifierReasoningEffort: value })}
          modelCheck={
            integrationStatus?.openrouter.modelChecks.find((check) => check.key === 'verifier') ??
            null
          }
          warningMessage={
            settings.verifierModel === 'openrouter' &&
            integrationStatus?.openrouter.authStatus !== 'valid'
              ? (integrationStatus?.openrouter.message ?? 'OpenRouter is not ready.')
              : null
          }
        />
        <SettingsRow
          label="Test command"
          description="Shell command run after execution in the worktree. Leave blank to skip."
        >
          <Input
            placeholder="e.g. bun run test"
            defaultValue={settings.testCommand ?? ''}
            onBlur={(e) => onUpdate({ testCommand: e.target.value.trim() || null })}
          />
        </SettingsRow>
        <SettingsRow
          label="Testing context"
          description="Describe the project's test conventions (framework, file location, mock patterns). Injected into the executor."
        >
          <Textarea
            placeholder="e.g. Tests use Vitest, colocated as *.test.ts, use vi.mock() for mocking."
            defaultValue={settings.testingContext ?? ''}
            onBlur={(e) => onUpdate({ testingContext: e.target.value.trim() || null })}
          />
        </SettingsRow>
      </section>

      <section className="mb-8">
        <StatusMappingEditor
          mappings={settings.statusLabelMappings}
          onSave={(mappings) => onUpdate({ statusLabelMappings: mappings })}
        />
      </section>
    </>
  );
}
