import type {
  DiffRecord,
  GitHubIssueCacheRecord,
  IntegrationStatus,
  OpenRouterModelValidation,
  PipelineCheckpoint,
  ReasoningEffort,
  Thread,
} from '@shipcode/shared';
import { getSupportedReasoningEfforts, resolveProviderReasoningEffort } from '@shipcode/shared';
import {
  Badge,
  Button,
  DiffViewer,
  ExternalLink,
  Input,
  MODEL_DISPLAY,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@shipcode/ui';
import { useEffect, useState } from 'react';
import {
  formatProviderSelectionLabel,
  getModelOptions,
  InheritValueDisplay,
  PROVIDER_DISPLAY,
} from '../model-provider-options';
import { encodePhaseOption, PHASE_PROVIDER_OPTIONS } from './helpers';
import type { PhaseKey, PhaseSelection } from './tab-types';

export function PipelineTab({
  activeIssue,
  activeThreadId,
  checkpoints,
  currentPhaseReasoningEfforts,
  currentPhaseSelections,
  diffs,
  effectivePhaseResolvedModels,
  executorEditable,
  hasPrFeedbackBlockers,
  inheritedPhaseReasoningEfforts,
  integrationStatus,
  isSubmitting,
  linkedPrUrl,
  phaseEffortSelectValues,
  phaseModelValidation,
  phaseSelectValues,
  projectDefaultPhaseSelections,
  thread,
  onPhaseAgentChange,
  onPhaseEffortChange,
  onPhaseOpenRouterSlugBlur,
  onRestoreCheckpoint,
  onStabilizePr,
}: {
  activeIssue: GitHubIssueCacheRecord;
  activeThreadId: string | null;
  checkpoints: PipelineCheckpoint[];
  currentPhaseReasoningEfforts: Record<PhaseKey, ReasoningEffort>;
  currentPhaseSelections: Record<PhaseKey, PhaseSelection>;
  diffs: DiffRecord[];
  effectivePhaseResolvedModels: Record<PhaseKey, string>;
  executorEditable: boolean;
  hasPrFeedbackBlockers: boolean;
  inheritedPhaseReasoningEfforts: Record<PhaseKey, ReasoningEffort>;
  integrationStatus?: IntegrationStatus;
  isSubmitting: boolean;
  linkedPrUrl: string | null;
  phaseEffortSelectValues: Record<PhaseKey, string>;
  phaseModelValidation: Partial<Record<PhaseKey, OpenRouterModelValidation | null>>;
  phaseSelectValues: Record<PhaseKey, string>;
  projectDefaultPhaseSelections: Record<PhaseKey, PhaseSelection>;
  thread: Thread | null | undefined;
  onPhaseAgentChange: (phase: PhaseKey, value: string) => void;
  onPhaseEffortChange: (phase: PhaseKey, effort: string) => void;
  onPhaseOpenRouterSlugBlur: (phase: PhaseKey, rawValue: string) => void;
  onRestoreCheckpoint: (checkpoint: PipelineCheckpoint) => void;
  onStabilizePr: () => void;
}) {
  const [activeDiffFile, setActiveDiffFile] = useState<string | undefined>();

  useEffect(() => {
    setActiveDiffFile(diffs[0]?.filePath);
  }, [diffs]);

  return (
    <>
      <div className="mb-5">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">
          Agents
        </h4>
        <div className="flex flex-col gap-2">
          {[
            {
              role: 'Planner',
              phase: 'planner' as const,
              displayModel: effectivePhaseResolvedModels.planner,
            },
            {
              role: 'Reviewer',
              phase: 'reviewer' as const,
              displayModel: effectivePhaseResolvedModels.reviewer,
            },
            {
              role: 'Executor',
              phase: 'executor' as const,
              displayModel: effectivePhaseResolvedModels.executor,
            },
            {
              role: 'Verifier',
              phase: 'verifier' as const,
              displayModel: effectivePhaseResolvedModels.verifier,
            },
          ].map(({ role, phase, displayModel }) => (
            <div
              key={role}
              className="flex flex-col gap-2 rounded-md border border-border bg-secondary p-2"
            >
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                {role}
              </span>
              {executorEditable ? (
                <>
                  <Select
                    value={phaseSelectValues[phase]}
                    onValueChange={(value: string) => onPhaseAgentChange(phase, value)}
                  >
                    <SelectTrigger className="h-6 w-full text-[11px]">
                      <SelectValue>
                        {phaseSelectValues[phase] === '__inherit__' ? (
                          <InheritValueDisplay
                            detail={`project default (${formatProviderSelectionLabel(
                              projectDefaultPhaseSelections[phase].provider,
                              projectDefaultPhaseSelections[phase].modelId,
                            )})`}
                          />
                        ) : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__inherit__">
                        {`Inherit project default (${formatProviderSelectionLabel(
                          projectDefaultPhaseSelections[phase].provider,
                          projectDefaultPhaseSelections[phase].modelId,
                        )})`}
                      </SelectItem>
                      <SelectSeparator />
                      {PHASE_PROVIDER_OPTIONS[phase].map((providerOption) => {
                        const selectedSelection = currentPhaseSelections[phase];
                        const selectedModelId =
                          selectedSelection.provider === providerOption
                            ? selectedSelection.modelId
                            : null;
                        return (
                          <SelectGroup key={providerOption}>
                            <SelectLabel>{PROVIDER_DISPLAY[providerOption]}</SelectLabel>
                            <SelectItem value={encodePhaseOption(providerOption, null)}>
                              {PROVIDER_DISPLAY[providerOption]} default
                            </SelectItem>
                            {selectedModelId &&
                            !getModelOptions(providerOption).some(
                              (option) => option.value === selectedModelId,
                            ) ? (
                              <SelectItem
                                value={encodePhaseOption(providerOption, selectedModelId)}
                              >
                                {selectedModelId}
                              </SelectItem>
                            ) : null}
                            {getModelOptions(providerOption).map((option) => (
                              <SelectItem
                                key={option.value}
                                value={encodePhaseOption(providerOption, option.value)}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                            {providerOption !==
                            PHASE_PROVIDER_OPTIONS[phase][
                              PHASE_PROVIDER_OPTIONS[phase].length - 1
                            ] ? (
                              <SelectSeparator />
                            ) : null}
                          </SelectGroup>
                        );
                      })}
                    </SelectContent>
                  </Select>

                  {currentPhaseSelections[phase].provider === 'openrouter' &&
                  phase !== 'executor' ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-muted">
                        Custom OpenRouter slug
                      </span>
                      <Input
                        key={`${phase}-${currentPhaseSelections[phase].modelId ?? ''}`}
                        className="h-7 text-[11px]"
                        placeholder="e.g. anthropic/claude-sonnet-4.6"
                        defaultValue={currentPhaseSelections[phase].modelId ?? ''}
                        onBlur={(event) => onPhaseOpenRouterSlugBlur(phase, event.target.value)}
                      />
                    </div>
                  ) : null}

                  {currentPhaseSelections[phase].provider === 'openrouter' &&
                  integrationStatus?.openrouter.authStatus !== 'valid' ? (
                    <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                      {integrationStatus?.openrouter.message ?? 'OpenRouter is not ready.'}
                    </div>
                  ) : null}

                  {phaseModelValidation[phase] &&
                  phaseModelValidation[phase]?.status !== 'valid' ? (
                    <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                      {phaseModelValidation[phase]?.message}
                    </div>
                  ) : null}

                  {/* Effort selector */}
                  {(() => {
                    const provider = currentPhaseSelections[phase].provider;
                    const modelId = currentPhaseSelections[phase].modelId;
                    const supportedEfforts = getSupportedReasoningEfforts(provider, modelId);
                    const configuredEffort = currentPhaseReasoningEfforts[phase];
                    const effortResolution = resolveProviderReasoningEffort(
                      provider,
                      configuredEffort,
                      modelId,
                    );
                    const effortSelectValue = phaseEffortSelectValues[phase];
                    const isInherited = effortSelectValue === '__inherit__';
                    return (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-muted">
                          {provider === 'claude' ? 'Thinking budget' : 'Effort'}
                        </span>
                        <Select
                          value={effortSelectValue}
                          onValueChange={(next) => onPhaseEffortChange(phase, next)}
                        >
                          <SelectTrigger className="h-6 w-full text-[11px]">
                            <SelectValue>
                              {isInherited ? (
                                <InheritValueDisplay
                                  detail={`inherit (${inheritedPhaseReasoningEfforts[phase]})`}
                                />
                              ) : undefined}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__inherit__">
                              Inherit ({inheritedPhaseReasoningEfforts[phase]})
                            </SelectItem>
                            <SelectSeparator />
                            {!isInherited && !effortResolution.exact ? (
                              <SelectItem value={configuredEffort}>
                                {`${configuredEffort} (maps to ${effortResolution.effective})`}
                              </SelectItem>
                            ) : null}
                            {supportedEfforts.map((effort) => (
                              <SelectItem key={effort} value={effort}>
                                {effort}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!isInherited && !effortResolution.exact ? (
                          <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                            {effortResolution.message}
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <>
                  <Badge variant="default" className="w-fit font-mono normal-case tracking-normal">
                    {MODEL_DISPLAY[displayModel] ?? displayModel}
                  </Badge>
                  {phaseEffortSelectValues[phase] !== '__inherit__' ? (
                    <span className="text-[10px] text-muted">
                      {currentPhaseReasoningEfforts[phase]}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {thread ? (
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
              Pipeline
            </h4>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {thread.worktreeBranch ? (
              <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                  Branch
                </span>
                <span className="truncate font-mono text-[11px] text-primary">
                  {thread.worktreeBranch}
                </span>
              </div>
            ) : null}
            {activeIssue.linkedPrNumber && linkedPrUrl ? (
              <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                    Pull Request
                  </span>
                  <Badge
                    variant={activeIssue.linkedPrIsDraft ? 'warning' : 'success'}
                    className="text-[10px]"
                  >
                    {activeIssue.linkedPrIsDraft ? 'Draft' : 'Ready'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[11px] text-primary">
                    #{activeIssue.linkedPrNumber}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted"
                    onClick={() =>
                      window.shipcode.invoke('shell:open-external', { url: linkedPrUrl })
                    }
                    title="Open pull request on GitHub"
                  >
                    <ExternalLink size={12} />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeIssue.linkedPrNumber ? (
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
              PR Feedback
            </h4>
            {activeIssue.prLastSyncAt ? (
              <span className="text-[10px] text-muted">
                {new Date(activeIssue.prLastSyncAt).toLocaleString()}
              </span>
            ) : null}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={activeIssue.ciBlocked ? 'danger' : 'success'} className="text-[10px]">
                {activeIssue.ciBlocked
                  ? `${activeIssue.failingChecks.length} failing check${activeIssue.failingChecks.length === 1 ? '' : 's'}`
                  : 'CI clear'}
              </Badge>
              <Badge
                variant={activeIssue.unresolvedReviewCommentCount > 0 ? 'warning' : 'default'}
                className="text-[10px]"
              >
                {activeIssue.unresolvedReviewCommentCount} unresolved review
                {activeIssue.unresolvedReviewCommentCount === 1 ? '' : 's'}
              </Badge>
            </div>
            {activeIssue.failingChecks.length > 0 ? (
              <div className="space-y-2">
                {activeIssue.failingChecks.map((check) => (
                  <div
                    key={`${check.workflowName ?? 'workflow'}:${check.name}`}
                    className="rounded-md border border-danger/20 bg-danger/5 p-2"
                  >
                    <div className="text-[12px] font-medium text-primary">
                      {[check.workflowName, check.name].filter(Boolean).join(' / ')}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                      <span>{check.conclusion ?? check.status}</span>
                      {check.detailsUrl ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="h-5 px-1.5 text-[10px]"
                          onClick={() =>
                            check.detailsUrl
                              ? window.shipcode.invoke('shell:open-external', {
                                  url: check.detailsUrl,
                                })
                              : Promise.resolve()
                          }
                        >
                          Open
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {activeIssue.unresolvedReviewComments.length > 0 ? (
              <div className="space-y-2">
                {activeIssue.unresolvedReviewComments.map((comment) => (
                  <div
                    key={comment.url}
                    className="rounded-md border border-warning/20 bg-warning/5 p-2"
                  >
                    <div className="text-[11px] text-muted">
                      {[comment.author, comment.path, comment.line ? `:${comment.line}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    <div className="mt-1 text-[12px] text-primary whitespace-pre-wrap break-words">
                      {comment.body}
                    </div>
                    <div className="mt-2">
                      <Button
                        variant="ghost"
                        size="xs"
                        className="h-5 px-1.5 text-[10px]"
                        onClick={() =>
                          window.shipcode.invoke('shell:open-external', { url: comment.url })
                        }
                      >
                        Open Comment
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {hasPrFeedbackBlockers && activeThreadId ? (
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={onStabilizePr} disabled={isSubmitting}>
                  {isSubmitting ? 'Starting...' : 'Run stabilization pass'}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {thread && checkpoints.length > 0 ? (
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
              Checkpoints
            </h4>
            <span className="text-[11px] text-muted">{checkpoints.length}</span>
          </div>
          <div className="space-y-2">
            {checkpoints.map((checkpoint) => (
              <div
                key={checkpoint.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary p-2"
              >
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-primary">{checkpoint.label}</div>
                  <div className="truncate text-[11px] text-muted">
                    {checkpoint.branch ? `${checkpoint.branch} · ` : ''}
                    {checkpoint.commitSha.slice(0, 12)} ·{' '}
                    {new Date(checkpoint.createdAt).toLocaleString()}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => onRestoreCheckpoint(checkpoint)}
                  disabled={isSubmitting}
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeThreadId ? (
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
              Code Diff
            </h4>
            {diffs.length > 0 ? (
              <span className="text-[11px] text-muted">
                {diffs.length} file{diffs.length === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>
          {diffs.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-border bg-secondary/20">
              <DiffViewer
                diffs={diffs}
                activeFile={activeDiffFile}
                onFileSelect={setActiveDiffFile}
              />
            </div>
          ) : (
            <div className="rounded-md border border-border bg-secondary px-3 py-2 text-[11px] text-muted">
              Diff will appear here after execution produces changes.
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
