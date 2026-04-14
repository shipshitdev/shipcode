import type { AppSettings, IntegrationStatus } from '@shipcode/shared';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  StatusMappingEditor,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@shipcode/ui';
import { getModelOptions } from '../model-provider-options';
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
  const openrouterModelOptions = getModelOptions('openrouter');

  return (
    <>
      <h3 className="mb-5">Pipeline</h3>

      <Tabs defaultValue="runtime">
        <TabsList className="mb-5">
          <TabsTrigger value="runtime">Runtime</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="testing">Testing</TabsTrigger>
          <TabsTrigger value="labels">Labels</TabsTrigger>
        </TabsList>

        <TabsContent value="runtime" className="mt-0">
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
          </section>
        </TabsContent>

        <TabsContent value="models" className="mt-0">
          <section className="mb-8">
            <div className="mb-5 rounded-md border border-border bg-secondary/40 p-3">
              <div className="mb-3">
                <div className="text-[13px] font-medium text-primary">OpenRouter Defaults</div>
                <div className="text-[11px] text-muted">
                  These defaults are used whenever a phase selects OpenRouter without a custom slug.
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="openrouter-default-paid-model"
                    className="text-[11px] text-secondary"
                  >
                    Paid default
                  </label>
                  <Select
                    value={settings.openrouterDefaultPaidModel}
                    onValueChange={(value) => onUpdate({ openrouterDefaultPaidModel: value })}
                  >
                    <SelectTrigger id="openrouter-default-paid-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {openrouterModelOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="openrouter-default-free-model"
                    className="text-[11px] text-secondary"
                  >
                    Free default
                  </label>
                  <Select
                    value={settings.openrouterDefaultFreeModel}
                    onValueChange={(value) => onUpdate({ openrouterDefaultFreeModel: value })}
                  >
                    <SelectTrigger id="openrouter-default-free-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {openrouterModelOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="openrouter-explicit-fallback"
                    className="text-[11px] text-secondary"
                  >
                    Explicit fallback
                  </label>
                  <Select
                    value={settings.openrouterExplicitFallback}
                    onValueChange={(value) => onUpdate({ openrouterExplicitFallback: value })}
                  >
                    <SelectTrigger id="openrouter-explicit-fallback">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {openrouterModelOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

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
                integrationStatus?.openrouter.modelChecks.find(
                  (check) => check.key === 'planner',
                ) ?? null
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
                integrationStatus?.openrouter.modelChecks.find(
                  (check) => check.key === 'reviewer',
                ) ?? null
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
                integrationStatus?.openrouter.modelChecks.find(
                  (check) => check.key === 'executor',
                ) ?? null
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
                integrationStatus?.openrouter.modelChecks.find(
                  (check) => check.key === 'verifier',
                ) ?? null
              }
              warningMessage={
                settings.verifierModel === 'openrouter' &&
                integrationStatus?.openrouter.authStatus !== 'valid'
                  ? (integrationStatus?.openrouter.message ?? 'OpenRouter is not ready.')
                  : null
              }
            />
          </section>
        </TabsContent>

        <TabsContent value="testing" className="mt-0">
          <section className="mb-8">
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
        </TabsContent>

        <TabsContent value="labels" className="mt-0">
          <section className="mb-8">
            <StatusMappingEditor
              mappings={settings.statusLabelMappings}
              onSave={(mappings) => onUpdate({ statusLabelMappings: mappings })}
            />
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}
