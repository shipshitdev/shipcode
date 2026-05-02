import type {
  DiffRecord,
  FeatureQaResult,
  GitHubIssueCacheRecord,
  IntegrationStatus,
  OpenRouterModelValidation,
  PipelineCheckpoint,
  ReasoningEffort,
  TaskGraphWithNodes,
  Thread,
} from '@shipcode/shared';
import {
  assessCliModelAvailability,
  formatReasoningEffortLabel,
  getCapabilitySupportedReasoningEfforts,
  getSupportedReasoningEfforts,
  MODEL_DISPLAY,
  resolveProviderReasoningEffort,
} from '@shipcode/shared';
import { SideBySideDiffViewer, TaskGraphViewer } from '@shipcode/ui';
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { ExternalLink } from 'lucide-react';
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
  effectiveRequireApproval,
  effectiveRevisionCount,
  executorEditable,
  hasPrFeedbackBlockers,
  inheritedPhaseReasoningEfforts,
  inheritedRequireApproval,
  inheritedRevisionCount,
  integrationStatus,
  isSubmitting,
  linkedPrUrl,
  phaseEffortSelectValues,
  phaseModelValidation,
  phaseSelectValues,
  qaResults,
  requireApprovalSelectValue,
  projectDefaultPhaseSelections,
  revisionCountSelectValue,
  taskGraph,
  thread,
  githubIssueUrl,
  onPhaseAgentChange,
  onPhaseEffortChange,
  onRequireApprovalChange,
  onRevisionCountChange,
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
  effectiveRequireApproval: boolean;
  effectiveRevisionCount: number;
  executorEditable: boolean;
  hasPrFeedbackBlockers: boolean;
  inheritedPhaseReasoningEfforts: Record<PhaseKey, ReasoningEffort>;
  inheritedRequireApproval: boolean;
  inheritedRevisionCount: number;
  integrationStatus?: IntegrationStatus;
  isSubmitting: boolean;
  linkedPrUrl: string | null;
  phaseEffortSelectValues: Record<PhaseKey, string>;
  phaseModelValidation: Partial<Record<PhaseKey, OpenRouterModelValidation | null>>;
  phaseSelectValues: Record<PhaseKey, string>;
  qaResults: FeatureQaResult[];
  requireApprovalSelectValue: string;
  projectDefaultPhaseSelections: Record<PhaseKey, PhaseSelection>;
  revisionCountSelectValue: string;
  taskGraph: TaskGraphWithNodes | null;
  thread: Thread | null | undefined;
  githubIssueUrl: string | null;
  onPhaseAgentChange: (phase: PhaseKey, value: string) => void;
  onPhaseEffortChange: (phase: PhaseKey, effort: string) => void;
  onRequireApprovalChange: (value: string) => void;
  onRevisionCountChange: (value: string) => void;
  onPhaseOpenRouterSlugBlur: (phase: PhaseKey, rawValue: string) => void;
  onRestoreCheckpoint: (checkpoint: PipelineCheckpoint) => void;
  onStabilizePr: () => void;
}) {
  const getTaskIssueUrl = githubIssueUrl
    ? (issueNumber: number) =>
        githubIssueUrl.replace(/\/issues\/\d+(?:[#?].*)?$/, `/issues/${issueNumber}`)
    : undefined;

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
                              integrationStatus,
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
                          integrationStatus,
                        )})`}
                      </SelectItem>
                      <SelectSeparator />
                      {PHASE_PROVIDER_OPTIONS[phase].map((providerOption) => {
                        const selectedSelection = currentPhaseSelections[phase];
                        const selectedModelId =
                          selectedSelection.provider === providerOption
                            ? selectedSelection.modelId
                            : null;
                        const modelOptions = getModelOptions(providerOption, integrationStatus);
                        const selectedModelAvailability = assessCliModelAvailability(
                          integrationStatus,
                          providerOption,
                          selectedModelId,
                        );
                        return (
                          <SelectGroup key={providerOption}>
                            <SelectLabel>{PROVIDER_DISPLAY[providerOption]}</SelectLabel>
                            <SelectItem value={encodePhaseOption(providerOption, null)}>
                              {PROVIDER_DISPLAY[providerOption]} default
                            </SelectItem>
                            {selectedModelId &&
                            !modelOptions.some((option) => option.value === selectedModelId) ? (
                              <SelectItem
                                value={encodePhaseOption(providerOption, selectedModelId)}
                                disabled={!selectedModelAvailability.available}
                              >
                                {selectedModelId}
                                {!selectedModelAvailability.available ? ' (Unavailable)' : ''}
                              </SelectItem>
                            ) : null}
                            {modelOptions.map((option) => (
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

                  {(() => {
                    const selection = currentPhaseSelections[phase];
                    const availability = assessCliModelAvailability(
                      integrationStatus,
                      selection.provider,
                      selection.modelId,
                    );
                    return availability.available ? null : (
                      <div className="rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                        {availability.message}
                      </div>
                    );
                  })()}

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
                    const supportedEfforts =
                      provider === 'openrouter'
                        ? getSupportedReasoningEfforts(provider, modelId)
                        : getCapabilitySupportedReasoningEfforts(
                            integrationStatus,
                            provider,
                            modelId,
                          );
                    const configuredEffort = currentPhaseReasoningEfforts[phase];
                    const effortResolution = resolveProviderReasoningEffort(
                      provider,
                      configuredEffort,
                      modelId,
                    );
                    const effortSelectValue = phaseEffortSelectValues[phase];
                    const isInherited = effortSelectValue === '__inherit__';
                    const displayedEffortValue = isInherited
                      ? '__inherit__'
                      : effortResolution.effective;
                    return (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-muted">
                          {provider === 'claude' ? 'Thinking budget' : 'Effort'}
                        </span>
                        <Select
                          value={displayedEffortValue}
                          onValueChange={(next) => onPhaseEffortChange(phase, next)}
                        >
                          <SelectTrigger className="h-6 w-full text-[11px]">
                            <SelectValue>
                              {isInherited ? (
                                <InheritValueDisplay
                                  detail={`inherit (${formatReasoningEffortLabel(inheritedPhaseReasoningEfforts[phase])})`}
                                />
                              ) : undefined}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__inherit__">
                              {`Inherit (${formatReasoningEffortLabel(inheritedPhaseReasoningEfforts[phase])})`}
                            </SelectItem>
                            <SelectSeparator />
                            {supportedEfforts.map((effort) => (
                              <SelectItem key={effort} value={effort}>
                                {formatReasoningEffortLabel(effort)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!isInherited && !effortResolution.exact && provider !== 'claude' ? (
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
                      {formatReasoningEffortLabel(
                        resolveProviderReasoningEffort(
                          currentPhaseSelections[phase].provider,
                          currentPhaseReasoningEfforts[phase],
                          currentPhaseSelections[phase].modelId,
                        ).effective,
                      )}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mb-5 rounded-md border border-border bg-secondary p-2">
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">
          Human Approval
        </span>
        <Select value={requireApprovalSelectValue} onValueChange={onRequireApprovalChange}>
          <SelectTrigger className="h-7 w-full text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit__">
              {`Inherit project default (${inheritedRequireApproval ? 'Required' : 'Off'})`}
            </SelectItem>
            <SelectItem value="true">Required</SelectItem>
            <SelectItem value="false">Off</SelectItem>
          </SelectContent>
        </Select>
        <div className="mt-1 text-[11px] text-muted">
          {effectiveRequireApproval
            ? 'Current workflow pauses for approval before execution.'
            : 'Current workflow executes automatically after planning/revisions.'}
        </div>
      </div>

      <div className="mb-5 rounded-md border border-border bg-secondary p-2">
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">
          Revisions
        </span>
        <Select value={revisionCountSelectValue} onValueChange={onRevisionCountChange}>
          <SelectTrigger className="h-7 w-full text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit__">
              {`Inherit project default (${inheritedRevisionCount})`}
            </SelectItem>
            <SelectItem value="0">0 · Skip review</SelectItem>
            <SelectItem value="1">1 revision</SelectItem>
            <SelectItem value="2">2 revisions</SelectItem>
            <SelectItem value="3">3 revisions</SelectItem>
            <SelectItem value="4">4 revisions</SelectItem>
            <SelectItem value="5">5 revisions</SelectItem>
          </SelectContent>
        </Select>
        <div className="mt-1 text-[11px] text-muted">
          {`Current workflow uses ${effectiveRevisionCount} revision${effectiveRevisionCount === 1 ? '' : 's'} before approval/execution.`}
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

      {taskGraph ? (
        <div className="mb-5">
          <TaskGraphViewer
            graph={taskGraph}
            getIssueUrl={getTaskIssueUrl}
            onOpenIssue={(url) => {
              void window.shipcode.invoke('shell:open-external', { url });
            }}
          />
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
                  <LoadingButtonContent loading={isSubmitting}>
                    Run stabilization pass
                  </LoadingButtonContent>
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
          <div className="mb-2 text-[11px] text-muted">
            Restoring a checkpoint rewinds code state only. It does not resume the same planner
            session.
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

      {qaResults.length > 0 ? (
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
              QA Results
            </h4>
            <span className="text-[11px] text-muted">
              {qaResults.length} run{qaResults.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="space-y-3">
            {qaResults.slice(0, 5).map((result) => (
              <div
                key={`${result.featureId}-${result.runAt}`}
                className="rounded-md border border-border bg-secondary p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        result.status === 'passed'
                          ? 'success'
                          : result.status === 'partial'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {result.status}
                    </Badge>
                    <span className="text-[12px] font-medium text-primary">{result.featureId}</span>
                  </div>
                  <span className="text-[11px] text-muted">
                    {new Date(result.runAt).toLocaleString()}
                  </span>
                </div>
                {result.summary ? (
                  <div className="mb-2 text-[11px] text-muted">{result.summary}</div>
                ) : null}
                {result.flowResults.length > 0 ? (
                  <div className="space-y-1">
                    {result.flowResults.map((flow) => (
                      <div key={flow.flowName} className="flex items-start gap-2 text-[11px]">
                        <span className={flow.passed ? 'text-green-500' : 'text-red-500'}>
                          {flow.passed ? '✓' : '✗'}
                        </span>
                        <span className="font-medium text-primary">{flow.flowName}</span>
                        {flow.failureReason ? (
                          <span className="text-muted">— {flow.failureReason}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
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
            <div className="h-[500px] overflow-hidden rounded-md border border-border bg-secondary/20">
              <SideBySideDiffViewer diffs={diffs} className="h-full" />
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
