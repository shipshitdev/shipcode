import {
  type AppSettings,
  assessCliModelAvailability,
  buildAppSettingsModelPresetPatch,
  type ExecutorModel,
  formatReasoningEffortLabel,
  getCapabilitySupportedReasoningEfforts,
  type IntegrationStatus,
  MODEL_CONFIG_PRESETS,
  type ModelConfigPresetKey,
  resolveProviderReasoningEffort,
} from '@shipcode/shared';
import { SettingsSection } from '@shipcode/ui';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@shipshitdev/ui';
import { ChevronDown } from 'lucide-react';
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
  const openrouterModelOptions = getModelOptions('openrouter', integrationStatus);
  const prdRewriteProvider = settings.prdRewriteCli as Extract<ExecutorModel, 'claude' | 'codex'>;
  const prdRewriteModelOptions = getModelOptions(prdRewriteProvider, integrationStatus);
  const prdRewriteModelValue =
    prdRewriteProvider === 'claude'
      ? settings.prdRewriteClaudeModel
      : settings.prdRewriteCodexModel;
  const prdRewriteEffortResolution = resolveProviderReasoningEffort(
    prdRewriteProvider,
    settings.prdRewriteReasoningEffort,
    prdRewriteModelValue,
  );
  const prdRewriteSupportedEfforts = getCapabilitySupportedReasoningEfforts(
    integrationStatus,
    prdRewriteProvider,
    prdRewriteModelValue,
  );
  const prdRewriteDisplayedEffort = prdRewriteEffortResolution.effective;
  const prdRewriteModelAvailability = assessCliModelAvailability(
    integrationStatus,
    prdRewriteProvider,
    prdRewriteModelValue,
  );
  const triageModelOptions = getModelOptions(settings.triageModel, integrationStatus);
  const triageKnownModelValues = new Set(triageModelOptions.map((option) => option.value));
  const triageEffortResolution = resolveProviderReasoningEffort(
    settings.triageModel,
    settings.triageReasoningEffort,
    settings.triageModelId,
  );
  const triageSupportedEfforts =
    settings.triageModel === 'openrouter'
      ? (['none', 'low', 'medium', 'high'] as const)
      : getCapabilitySupportedReasoningEfforts(
          integrationStatus,
          settings.triageModel,
          settings.triageModelId,
        );
  const normalizeEffort = (
    provider: ExecutorModel,
    effort: AppSettings['plannerReasoningEffort'],
    modelId?: string | null,
  ) => resolveProviderReasoningEffort(provider, effort, modelId).effective;
  const applyPreset = (preset: ModelConfigPresetKey) => {
    onUpdate(buildAppSettingsModelPresetPatch(preset));
  };

  return (
    <>
      <h3 className="mb-5">Pipeline</h3>

      <Tabs defaultValue="runtime">
        <TabsList className="mb-5">
          <TabsTrigger value="runtime">Runtime</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="testing">Testing</TabsTrigger>
        </TabsList>

        <TabsContent value="runtime" className="mt-0">
          <SettingsSection>
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
              label="Max concurrent executions per project"
              htmlFor="max-concurrent-executions"
              description="How many pipelines can execute at once for each project. Approved pipelines wait until that project's slot opens."
            >
              <Input
                id="max-concurrent-executions"
                type="number"
                className="w-[80px]"
                value={settings.maxConcurrentExecutions}
                onChange={(e) => {
                  const value = Number.parseInt(e.target.value, 10);
                  if (value >= 1 && value <= 10) onUpdate({ maxConcurrentExecutions: value });
                }}
                min={1}
                max={10}
                step={1}
              />
            </SettingsRow>
            <SettingsRow
              label="Max concurrent CPU tasks"
              htmlFor="max-concurrent-cpu-tasks"
              description="How many local test/build/runtime QA command phases can run across all projects."
            >
              <Input
                id="max-concurrent-cpu-tasks"
                type="number"
                className="w-[80px]"
                value={settings.maxConcurrentCpuTasks}
                onChange={(e) => {
                  const value = Number.parseInt(e.target.value, 10);
                  if (value >= 1 && value <= 10) onUpdate({ maxConcurrentCpuTasks: value });
                }}
                min={1}
                max={10}
                step={1}
              />
            </SettingsRow>
            <SettingsRow
              label="CPU throttle threshold"
              htmlFor="cpu-throttle-threshold"
              description="New local test/build/runtime QA command phases wait while host CPU is at or above this level."
            >
              <Input
                id="cpu-throttle-threshold"
                type="number"
                className="w-[80px]"
                value={settings.cpuThrottleThresholdPercent}
                onChange={(e) => {
                  const value = Number.parseInt(e.target.value, 10);
                  if (value >= 50 && value <= 100) onUpdate({ cpuThrottleThresholdPercent: value });
                }}
                min={50}
                max={100}
                step={1}
              />
            </SettingsRow>
            <SettingsRow
              label="Default speed profile"
              description="Smart fast runs contained work in one execution pass. Thorough keeps task-graph decomposition and node verification."
            >
              <Select
                value={settings.pipelineSpeedProfile}
                onValueChange={(value) =>
                  onUpdate({
                    pipelineSpeedProfile: value as AppSettings['pipelineSpeedProfile'],
                  })
                }
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="smart_fast">Smart fast</SelectItem>
                  <SelectItem value="thorough">Thorough</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow
              label="Default revisions"
              description="How many review-to-revise cycles ShipCode runs before approval or execution. 0 skips plan review for the fastest path."
            >
              <Select
                value={String(settings.revisionCount)}
                onValueChange={(value) =>
                  onUpdate({
                    revisionCount: Number.parseInt(value, 10) as AppSettings['revisionCount'],
                  })
                }
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0 · Skip review</SelectItem>
                  <SelectItem value="1">1 revision</SelectItem>
                  <SelectItem value="2">2 revisions</SelectItem>
                  <SelectItem value="3">3 revisions</SelectItem>
                  <SelectItem value="4">4 revisions</SelectItem>
                  <SelectItem value="5">5 revisions</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
          </SettingsSection>
        </TabsContent>

        <TabsContent value="models" className="mt-0">
          <SettingsSection
            title="Model Presets"
            description="Apply a full Claude, Codex, or Hybrid phase layout in one shot. OpenRouter fallback defaults stay unchanged."
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  Apply Preset
                  <ChevronDown size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[260px]">
                {MODEL_CONFIG_PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset.key}
                    onSelect={() => applyPreset(preset.key)}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span>{preset.label}</span>
                    <span className="text-[11px] text-muted-foreground">{preset.description}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SettingsSection>

          <SettingsSection title="Format Defaults">
            <SettingsRow
              label="Format CLI"
              description="Powers Format in the PRD editor and automation prompt formatter. Automations with an explicit executor override use that provider first; inherited automations use this default."
            >
              <Select
                value={settings.prdRewriteCli}
                onValueChange={(value) => {
                  const nextCli = value as AppSettings['prdRewriteCli'];
                  onUpdate({
                    prdRewriteCli: nextCli,
                    prdRewriteReasoningEffort: resolveProviderReasoningEffort(
                      nextCli as Extract<ExecutorModel, 'claude' | 'codex'>,
                      settings.prdRewriteReasoningEffort,
                      nextCli === 'claude'
                        ? settings.prdRewriteClaudeModel
                        : settings.prdRewriteCodexModel,
                    ).effective as AppSettings['prdRewriteReasoningEffort'],
                  });
                }}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Claude CLI</SelectItem>
                  <SelectItem value="codex">Codex CLI</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow
              label="Format model"
              description="Preferred model for PRD and automation prompt formatting on the selected CLI."
            >
              <Select
                value={prdRewriteModelValue ?? '__default__'}
                onValueChange={(value) => {
                  const nextModelId = value === '__default__' ? null : value;
                  onUpdate(
                    prdRewriteProvider === 'claude'
                      ? {
                          prdRewriteClaudeModel: nextModelId,
                          prdRewriteReasoningEffort: resolveProviderReasoningEffort(
                            'claude',
                            settings.prdRewriteReasoningEffort,
                            nextModelId,
                          ).effective as AppSettings['prdRewriteReasoningEffort'],
                        }
                      : {
                          prdRewriteCodexModel: nextModelId,
                          prdRewriteReasoningEffort: resolveProviderReasoningEffort(
                            'codex',
                            settings.prdRewriteReasoningEffort,
                            nextModelId,
                          ).effective as AppSettings['prdRewriteReasoningEffort'],
                        },
                  );
                }}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">
                    {prdRewriteProvider === 'claude' ? 'Claude default' : 'Codex default'}
                  </SelectItem>
                  {prdRewriteModelValue &&
                  !prdRewriteModelOptions.some(
                    (option) => option.value === prdRewriteModelValue,
                  ) ? (
                    <SelectItem
                      value={prdRewriteModelValue}
                      disabled={!prdRewriteModelAvailability.available}
                    >
                      {prdRewriteModelValue}
                      {!prdRewriteModelAvailability.available ? ' (Unavailable)' : ''}
                    </SelectItem>
                  ) : null}
                  {prdRewriteModelOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow
              label={
                prdRewriteProvider === 'claude'
                  ? 'Format thinking budget'
                  : 'Format reasoning effort'
              }
              description="Reasoning setting for PRD and automation prompt formatting."
            >
              <Select
                value={prdRewriteDisplayedEffort}
                onValueChange={(value) =>
                  onUpdate({
                    prdRewriteReasoningEffort: value as AppSettings['prdRewriteReasoningEffort'],
                  })
                }
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {prdRewriteSupportedEfforts.map((effort) => (
                    <SelectItem key={effort} value={effort}>
                      {formatReasoningEffortLabel(effort)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
            {!prdRewriteEffortResolution.exact && prdRewriteProvider !== 'claude' && (
              <div className="mb-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                {prdRewriteEffortResolution.message}
              </div>
            )}
            {!prdRewriteModelAvailability.available && (
              <div className="mb-3 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                {prdRewriteModelAvailability.message}
              </div>
            )}
          </SettingsSection>

          <SettingsSection
            title="OpenRouter Defaults"
            description="These defaults are used whenever a phase selects OpenRouter without a custom slug."
          >
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
          </SettingsSection>

          <SettingsSection
            title="Issue triage"
            description="Board review model for classifying Todo issues and applying high-confidence labels."
          >
            <SettingsRow label="Triage provider" htmlFor="triage-provider">
              <Select
                value={settings.triageModel}
                onValueChange={(value) =>
                  onUpdate({
                    triageModel: value as AppSettings['triageModel'],
                    triageModelId: null,
                    triageReasoningEffort: normalizeEffort(
                      value as ExecutorModel,
                      settings.triageReasoningEffort,
                      null,
                    ),
                  })
                }
              >
                <SelectTrigger id="triage-provider" className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Anthropic</SelectItem>
                  <SelectItem value="codex">OpenAI</SelectItem>
                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow label="Triage model" htmlFor="triage-model">
              <Select
                value={settings.triageModelId ?? '__default__'}
                onValueChange={(value) => {
                  const nextModelId = value === '__default__' ? null : value;
                  onUpdate({
                    triageModelId: nextModelId,
                    triageReasoningEffort: normalizeEffort(
                      settings.triageModel,
                      settings.triageReasoningEffort,
                      nextModelId,
                    ),
                  });
                }}
              >
                <SelectTrigger id="triage-model" className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Default small model</SelectItem>
                  {settings.triageModelId && !triageKnownModelValues.has(settings.triageModelId) ? (
                    <SelectItem value={settings.triageModelId}>{settings.triageModelId}</SelectItem>
                  ) : null}
                  {triageModelOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow
              label={
                settings.triageModel === 'claude'
                  ? 'Triage thinking budget'
                  : 'Triage reasoning effort'
              }
              htmlFor="triage-reasoning"
            >
              <Select
                value={triageEffortResolution.effective}
                onValueChange={(value) =>
                  onUpdate({
                    triageReasoningEffort: value as AppSettings['triageReasoningEffort'],
                  })
                }
              >
                <SelectTrigger id="triage-reasoning" className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {triageSupportedEfforts.map((effort) => (
                    <SelectItem key={effort} value={effort}>
                      {formatReasoningEffortLabel(effort as AppSettings['triageReasoningEffort'])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow
              label="Auto-apply threshold"
              htmlFor="triage-threshold"
              description="Recommendations below this confidence are reported but not applied."
            >
              <Input
                id="triage-threshold"
                type="number"
                className="w-[90px]"
                min={0}
                max={1}
                step={0.05}
                value={settings.triageAutoApplyThreshold}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (value >= 0 && value <= 1) onUpdate({ triageAutoApplyThreshold: value });
                }}
              />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            title="Pipeline phases"
            description="Workflow order here is Planner -> Reviewer -> Executor -> Verifier. Clarifying and Awaiting Approval are human checkpoints, so they do not have model rows."
          >
            <PhaseModelRow
              label="Planner model"
              htmlFor="planner-model"
              modelValue={settings.plannerModel}
              openrouterModelValue={settings.openrouterPlannerModel}
              resolvedModelId={
                settings.plannerModel === 'openrouter'
                  ? (settings.openrouterPlannerModel ?? settings.openrouterDefaultPaidModel)
                  : null
              }
              reasoningEffortValue={settings.plannerReasoningEffort}
              validProviders={['claude', 'codex', 'gemini', 'openrouter']}
              onModelChange={(value) =>
                onUpdate({
                  plannerModel: value as AppSettings['plannerModel'],
                  plannerReasoningEffort: normalizeEffort(
                    value as ExecutorModel,
                    settings.plannerReasoningEffort,
                    value === 'openrouter'
                      ? (settings.openrouterPlannerModel ?? settings.openrouterDefaultPaidModel)
                      : null,
                  ),
                })
              }
              onOpenrouterModelChange={(value) =>
                onUpdate({
                  openrouterPlannerModel: value,
                  plannerReasoningEffort: normalizeEffort(
                    'openrouter',
                    settings.plannerReasoningEffort,
                    value ?? settings.openrouterDefaultPaidModel,
                  ),
                })
              }
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
              integrationStatus={integrationStatus}
            />
            <PhaseModelRow
              label="Reviewer model"
              htmlFor="reviewer-model"
              modelValue={settings.reviewerModel}
              openrouterModelValue={settings.openrouterReviewerModel}
              resolvedModelId={
                settings.reviewerModel === 'openrouter'
                  ? (settings.openrouterReviewerModel ?? settings.openrouterDefaultPaidModel)
                  : null
              }
              reasoningEffortValue={settings.reviewerReasoningEffort}
              validProviders={['claude', 'codex', 'gemini', 'openrouter']}
              onModelChange={(value) =>
                onUpdate({
                  reviewerModel: value as AppSettings['reviewerModel'],
                  reviewerReasoningEffort: normalizeEffort(
                    value as ExecutorModel,
                    settings.reviewerReasoningEffort,
                    value === 'openrouter'
                      ? (settings.openrouterReviewerModel ?? settings.openrouterDefaultPaidModel)
                      : null,
                  ),
                })
              }
              onOpenrouterModelChange={(value) =>
                onUpdate({
                  openrouterReviewerModel: value,
                  reviewerReasoningEffort: normalizeEffort(
                    'openrouter',
                    settings.reviewerReasoningEffort,
                    value ?? settings.openrouterDefaultPaidModel,
                  ),
                })
              }
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
              integrationStatus={integrationStatus}
            />
            <PhaseModelRow
              label="Executor model"
              htmlFor="executor-model"
              modelValue={settings.executorModel}
              openrouterModelValue={settings.openrouterExecutorModel}
              resolvedModelId={
                settings.executorModel === 'openrouter'
                  ? (settings.openrouterExecutorModel ?? settings.openrouterDefaultPaidModel)
                  : null
              }
              reasoningEffortValue={settings.executorReasoningEffort}
              validProviders={['claude', 'codex', 'gemini', 'openrouter']}
              onModelChange={(value) =>
                onUpdate({
                  executorModel: value as AppSettings['executorModel'],
                  executorReasoningEffort: normalizeEffort(
                    value as ExecutorModel,
                    settings.executorReasoningEffort,
                    value === 'openrouter'
                      ? (settings.openrouterExecutorModel ?? settings.openrouterDefaultPaidModel)
                      : null,
                  ),
                })
              }
              onOpenrouterModelChange={(value) =>
                onUpdate({
                  openrouterExecutorModel: value,
                  executorReasoningEffort: normalizeEffort(
                    'openrouter',
                    settings.executorReasoningEffort,
                    value ?? settings.openrouterDefaultPaidModel,
                  ),
                })
              }
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
              integrationStatus={integrationStatus}
            />
            <PhaseModelRow
              label="Verifier model"
              htmlFor="verifier-model"
              modelValue={settings.verifierModel}
              openrouterModelValue={settings.openrouterVerifierModel}
              resolvedModelId={
                settings.verifierModel === 'openrouter'
                  ? (settings.openrouterVerifierModel ?? settings.openrouterDefaultPaidModel)
                  : null
              }
              reasoningEffortValue={settings.verifierReasoningEffort}
              validProviders={['claude', 'codex', 'gemini', 'openrouter']}
              onModelChange={(value) =>
                onUpdate({
                  verifierModel: value as AppSettings['verifierModel'],
                  verifierReasoningEffort: normalizeEffort(
                    value as ExecutorModel,
                    settings.verifierReasoningEffort,
                    value === 'openrouter'
                      ? (settings.openrouterVerifierModel ?? settings.openrouterDefaultPaidModel)
                      : null,
                  ),
                })
              }
              onOpenrouterModelChange={(value) =>
                onUpdate({
                  openrouterVerifierModel: value,
                  verifierReasoningEffort: normalizeEffort(
                    'openrouter',
                    settings.verifierReasoningEffort,
                    value ?? settings.openrouterDefaultPaidModel,
                  ),
                })
              }
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
              integrationStatus={integrationStatus}
            />
          </SettingsSection>
        </TabsContent>

        <TabsContent value="testing" className="mt-0">
          <SettingsSection>
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
          </SettingsSection>
        </TabsContent>
      </Tabs>
    </>
  );
}
