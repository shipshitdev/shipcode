import type {
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
  clampError,
  extractFeatureQaState,
  formatReasoningEffortLabel,
  getCapabilitySupportedReasoningEfforts,
  getSupportedReasoningEfforts,
  resolveProviderReasoningEffort,
} from '@shipcode/shared';
import { TaskGraphViewer } from '@shipcode/ui';
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
import { ChevronRight, ExternalLink } from 'lucide-react';
import { useEffect, useReducer } from 'react';
import { formatTimestamp } from '../format-timestamp';
import {
  formatProviderSelectionLabel,
  getModelOptions,
  InheritValueDisplay,
  PROVIDER_DISPLAY,
} from '../model-provider-options';
import { encodePhaseOption, PHASE_PROVIDER_OPTIONS } from './helpers';
import type { PhaseKey, PhaseSelection } from './tab-types';

type ManualQaServer = { baseUrl: string; port: number };

type ManualQaState = {
  server: ManualQaServer | null;
  pending: boolean;
  error: string | null;
  evidenceError: string | null;
};

type ManualQaAction =
  | { type: 'server-loaded'; server: ManualQaServer | null }
  | { type: 'pending'; pending: boolean }
  | { type: 'error'; error: string | null }
  | { type: 'evidence-error'; error: string | null };

function manualQaReducer(state: ManualQaState, action: ManualQaAction): ManualQaState {
  switch (action.type) {
    case 'server-loaded':
      return { ...state, server: action.server };
    case 'pending':
      return { ...state, pending: action.pending };
    case 'error':
      return { ...state, error: action.error };
    case 'evidence-error':
      return { ...state, evidenceError: action.error };
  }
}

function usePipelineTabView({
  activeIssue,
  activeThreadId,
  checkpoints,
  currentPhaseReasoningEfforts,
  currentPhaseSelections,
  effectiveRequireApproval,
  effectiveRevisionCount,
  executorEditable,
  hasPrFeedbackBlockers,
  inheritedPhaseReasoningEfforts,
  inheritedRequireApproval,
  inheritedRevisionCount,
  integrationStatus,
  isSubmitting,
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
  effectiveRequireApproval: boolean;
  effectiveRevisionCount: number;
  executorEditable: boolean;
  hasPrFeedbackBlockers: boolean;
  inheritedPhaseReasoningEfforts: Record<PhaseKey, ReasoningEffort>;
  inheritedRequireApproval: boolean;
  inheritedRevisionCount: number;
  integrationStatus?: IntegrationStatus;
  isSubmitting: boolean;
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
  const qaExtraction = activeIssue.body ? extractFeatureQaState(activeIssue.body) : null;
  const featureQaState = qaExtraction?.status === 'present' ? qaExtraction.qaState : null;
  const [manualQa, dispatchManualQa] = useReducer(manualQaReducer, {
    server: null,
    pending: false,
    error: null,
    evidenceError: null,
  });

  useEffect(() => {
    if (!activeThreadId) {
      dispatchManualQa({ type: 'server-loaded', server: null });
      return;
    }

    let cancelled = false;
    window.shipcode
      .invoke<{ baseUrl: string; port: number } | null>('feature-qa:get-server', {
        threadId: activeThreadId,
      })
      .then((server) => {
        if (!cancelled) dispatchManualQa({ type: 'server-loaded', server });
      })
      .catch(() => {
        if (!cancelled) dispatchManualQa({ type: 'server-loaded', server: null });
      });

    return () => {
      cancelled = true;
    };
  }, [activeThreadId]);

  const startManualQa = async () => {
    if (!activeThreadId) return;
    dispatchManualQa({ type: 'pending', pending: true });
    dispatchManualQa({ type: 'error', error: null });
    try {
      const server = await window.shipcode.invoke<{ baseUrl: string; port: number }>(
        'feature-qa:start-server',
        {
          projectId: activeIssue.projectId,
          threadId: activeThreadId,
        },
      );
      dispatchManualQa({ type: 'server-loaded', server });
    } catch (error) {
      dispatchManualQa({ type: 'error', error: clampError(error) });
    } finally {
      dispatchManualQa({ type: 'pending', pending: false });
    }
  };

  const stopManualQa = async () => {
    if (!activeThreadId) return;
    dispatchManualQa({ type: 'pending', pending: true });
    dispatchManualQa({ type: 'error', error: null });
    try {
      await window.shipcode.invoke('feature-qa:stop-server', { threadId: activeThreadId });
      dispatchManualQa({ type: 'server-loaded', server: null });
    } catch (error) {
      dispatchManualQa({ type: 'error', error: clampError(error) });
    } finally {
      dispatchManualQa({ type: 'pending', pending: false });
    }
  };

  const openEvidence = async (path: string) => {
    if (!activeThreadId) return;
    dispatchManualQa({ type: 'evidence-error', error: null });
    try {
      await window.shipcode.invoke('feature-qa:open-evidence', { threadId: activeThreadId, path });
    } catch (error) {
      dispatchManualQa({ type: 'evidence-error', error: clampError(error) });
    }
  };
  const manualQaServer = manualQa.server;
  const manualQaPending = manualQa.pending;
  const manualQaError = manualQa.error;
  const qaEvidenceError = manualQa.evidenceError;
  const runtimeServerSection = (
    <div className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">Run app</h4>
        {thread?.worktreeBranch ? (
          <span className="max-w-[12rem] truncate font-mono text-[10px] text-muted-foreground">
            {thread.worktreeBranch}
          </span>
        ) : null}
      </div>
      <div className="rounded-md border border-border bg-secondary p-3">
        <div className="space-y-3">
          {thread?.worktreePath ? (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-secondary">
                Worktree
              </div>
              <div className="break-all font-mono text-[10px] text-muted-foreground">
                {thread.worktreePath}
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-secondary">
                Test server
              </div>
              {manualQaServer ? (
                <button
                  type="button"
                  className="mt-1 inline-flex max-w-full items-center gap-1 break-all font-mono text-[10px] text-accent hover:underline"
                  onClick={() =>
                    window.shipcode.invoke('shell:open-external', {
                      url: manualQaServer.baseUrl,
                    })
                  }
                >
                  {manualQaServer.baseUrl}
                  <ExternalLink size={10} className="shrink-0" />
                </button>
              ) : (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {thread?.worktreePath
                    ? 'Starts the configured Runtime QA command in this issue worktree.'
                    : 'Run the pipeline first to create an issue worktree.'}
                </div>
              )}
            </div>
            <Button
              variant={manualQaServer ? 'outline' : 'secondary'}
              size="xs"
              onClick={manualQaServer ? stopManualQa : startManualQa}
              disabled={!activeThreadId || !thread?.worktreePath || manualQaPending}
            >
              <LoadingButtonContent loading={manualQaPending}>
                {manualQaServer ? 'Stop' : 'Start'}
              </LoadingButtonContent>
            </Button>
          </div>
          {manualQaError ? (
            <div className="rounded-sm border border-danger/30 bg-danger/10 px-2 py-1 text-[11px] text-danger">
              {manualQaError}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="mb-8">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">
          Agents
        </h4>
        <div className="flex flex-col gap-2">
          {(
            [
              {
                role: 'Planner',
                phase: 'planner' as const,
              },
              {
                role: 'Reviewer',
                phase: 'reviewer' as const,
              },
              {
                role: 'Executor',
                phase: 'executor' as const,
              },
              {
                role: 'Verifier',
                phase: 'verifier' as const,
              },
            ] as const
          ).map(({ role, phase }) => {
            const provider = currentPhaseSelections[phase].provider;
            const modelId = currentPhaseSelections[phase].modelId;
            const supportedEfforts =
              provider === 'openrouter'
                ? getSupportedReasoningEfforts(provider, modelId)
                : getCapabilitySupportedReasoningEfforts(integrationStatus, provider, modelId);
            const configuredEffort = currentPhaseReasoningEfforts[phase];
            const effortResolution = resolveProviderReasoningEffort(
              provider,
              configuredEffort,
              modelId,
            );
            const effortSelectValue = phaseEffortSelectValues[phase];
            const isEffortInherited = effortSelectValue === '__inherit__';
            const displayedEffortValue = isEffortInherited
              ? '__inherit__'
              : effortResolution.effective;
            const selection = currentPhaseSelections[phase];
            const availability = assessCliModelAvailability(
              integrationStatus,
              selection.provider,
              selection.modelId,
            );

            return (
              <div key={role} className="min-w-0 flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {role}
                </span>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Select
                    value={phaseSelectValues[phase]}
                    onValueChange={(value: string) => onPhaseAgentChange(phase, value)}
                    disabled={!executorEditable}
                  >
                    <SelectTrigger
                      className="h-7 w-full text-[11px]"
                      data-testid={`phase-provider-select-${phase}`}
                    >
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
                  <Select
                    value={displayedEffortValue}
                    onValueChange={(next) => onPhaseEffortChange(phase, next)}
                    disabled={!executorEditable}
                  >
                    <SelectTrigger className="h-7 w-full text-[11px]">
                      <SelectValue>
                        {isEffortInherited ? (
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
                </div>
                {/* Below-row extras (openrouter slug, validation messages) */}
                {executorEditable && provider === 'openrouter' && phase !== 'executor' ? (
                  <div>
                    <Input
                      key={`${phase}-${modelId ?? ''}`}
                      className="h-7 text-[11px]"
                      placeholder="e.g. anthropic/claude-sonnet-4.6"
                      defaultValue={modelId ?? ''}
                      onBlur={(event) => onPhaseOpenRouterSlugBlur(phase, event.target.value)}
                    />
                  </div>
                ) : null}
                {executorEditable &&
                provider === 'openrouter' &&
                integrationStatus?.openrouter.authStatus !== 'valid' ? (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                    {integrationStatus?.openrouter.message ?? 'OpenRouter is not ready.'}
                  </div>
                ) : null}
                {executorEditable && !availability.available ? (
                  <div className="rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                    {availability.message}
                  </div>
                ) : null}
                {executorEditable &&
                phaseModelValidation[phase] &&
                phaseModelValidation[phase]?.status !== 'valid' ? (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                    {phaseModelValidation[phase]?.message}
                  </div>
                ) : null}
                {executorEditable &&
                !isEffortInherited &&
                !effortResolution.exact &&
                provider !== 'claude' ? (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                    {effortResolution.message}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mb-8 flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
          Human Approval
        </h4>
        <Select value={requireApprovalSelectValue} onValueChange={onRequireApprovalChange}>
          <SelectTrigger className="h-6 w-full text-[11px]">
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
        <span className="text-[11px] text-muted-foreground">
          {effectiveRequireApproval
            ? 'Pauses for approval before execution.'
            : 'Executes automatically after planning/revisions.'}
        </span>
      </div>

      <div className="mb-8 flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">Revisions</h4>
        <Select value={revisionCountSelectValue} onValueChange={onRevisionCountChange}>
          <SelectTrigger className="h-6 w-full text-[11px]">
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
        <span className="text-[11px] text-muted-foreground">
          {`${effectiveRevisionCount} revision${effectiveRevisionCount === 1 ? '' : 's'} before approval/execution.`}
        </span>
      </div>

      {taskGraph ? (
        <details className="group mb-8 rounded-md border border-border bg-secondary/20 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-secondary [&::-webkit-details-marker]:hidden">
            <ChevronRight
              size={12}
              className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
            />
            <span className="flex-1">Task Graph</span>
            <span className="text-[10px] font-normal normal-case text-muted-foreground">
              {taskGraph.nodes.length}
            </span>
          </summary>
          <div className="mt-3">
            <TaskGraphViewer
              graph={taskGraph}
              getIssueUrl={getTaskIssueUrl}
              onOpenIssue={(url) => {
                void window.shipcode.invoke('shell:open-external', { url });
              }}
            />
          </div>
        </details>
      ) : null}

      {activeIssue.linkedPrNumber ? (
        <div className="mb-8">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
              PR Feedback
            </h4>
            {activeIssue.prLastSyncAt ? (
              <span className="text-[10px] text-muted-foreground">
                {formatTimestamp(activeIssue.prLastSyncAt)}
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
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
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
                    <div className="text-[11px] text-muted-foreground">
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
        <details className="group mb-8 rounded-md border border-border bg-secondary/20 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-secondary [&::-webkit-details-marker]:hidden">
            <ChevronRight
              size={12}
              className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
            />
            <span className="flex-1">Checkpoints</span>
            <span className="text-[10px] font-normal normal-case text-muted-foreground">
              {checkpoints.length}
            </span>
          </summary>
          <div className="mt-3 mb-2 text-[11px] text-muted-foreground">
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
                  <div className="truncate text-[11px] text-muted-foreground">
                    {checkpoint.branch ? `${checkpoint.branch} · ` : ''}
                    {checkpoint.commitSha.slice(0, 12)} · {formatTimestamp(checkpoint.createdAt)}
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
        </details>
      ) : null}

      {runtimeServerSection}

      {featureQaState ? (
        <div className="mb-8">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
              Human QA
            </h4>
            <span className="text-[11px] text-muted-foreground">{featureQaState.featureId}</span>
          </div>
          <div className="rounded-md border border-border bg-secondary p-3">
            <div className="space-y-3">
              {featureQaState.routes.length > 0 ? (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-secondary">
                    Feature scope
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {featureQaState.routes.map((route) => (
                      <Badge key={route} variant="default">
                        {route}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-secondary">
                  Scenarios
                </div>
                <div className="space-y-2">
                  {featureQaState.criticalFlows.map((flow) => (
                    <div
                      key={flow.name}
                      className="rounded-sm border border-border bg-background p-2"
                    >
                      <div className="mb-1 text-[12px] font-medium text-primary">{flow.name}</div>
                      <ol className="ml-4 list-decimal space-y-1 text-[11px] text-muted-foreground">
                        {flow.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                      <div className="mt-2 text-[11px] text-secondary">
                        Success: {flow.successCriteria}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {featureQaState.expectedStates.length > 0 ? (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-secondary">
                    Expected states
                  </div>
                  <ul className="ml-4 list-disc space-y-1 text-[11px] text-muted-foreground">
                    {featureQaState.expectedStates.map((state) => (
                      <li key={state}>{state}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {featureQaState.testDataAssumptions.length > 0 ? (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-secondary">
                    Test data
                  </div>
                  <ul className="ml-4 list-disc space-y-1 text-[11px] text-muted-foreground">
                    {featureQaState.testDataAssumptions.map((assumption) => (
                      <li key={assumption}>{assumption}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {qaResults.length > 0 ? (
        <div className="mb-8">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
              QA Results
            </h4>
            <span className="text-[11px] text-muted-foreground">
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
                  <span className="text-[11px] text-muted-foreground">
                    {formatTimestamp(result.runAt)}
                  </span>
                </div>
                {result.summary ? (
                  <div className="mb-2 text-[11px] text-muted-foreground">{result.summary}</div>
                ) : null}
                {result.flowResults.length > 0 ? (
                  <div className="space-y-2">
                    {result.flowResults.map((flow) => (
                      <div key={flow.flowName} className="text-[11px]">
                        <div className="flex items-start gap-2">
                          <span className={flow.passed ? 'text-green-500' : 'text-red-500'}>
                            {flow.passed ? '✓' : '✗'}
                          </span>
                          <span className="font-medium text-primary">{flow.flowName}</span>
                          {flow.failureReason ? (
                            <span className="text-muted-foreground">{flow.failureReason}</span>
                          ) : null}
                        </div>
                        {flow.assertions?.length ? (
                          <div className="ml-4 mt-1 space-y-1 border-l border-border pl-2">
                            {flow.assertions.map((assertion) => (
                              <div key={assertion.name} className="space-y-0.5">
                                <div className="flex items-center gap-1">
                                  <span
                                    className={assertion.passed ? 'text-green-500' : 'text-red-500'}
                                  >
                                    {assertion.passed ? '✓' : '✗'}
                                  </span>
                                  <span className="font-medium text-primary">{assertion.name}</span>
                                </div>
                                <div className="break-words text-muted-foreground">
                                  Expected: {assertion.expected}
                                </div>
                                <div className="break-words text-muted-foreground">
                                  Actual: {assertion.actual}
                                </div>
                                {assertion.evidencePath ? (
                                  <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1 break-all font-mono text-[10px] text-muted-foreground">
                                      {assertion.evidencePath}
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="xs"
                                      className="h-5 px-1.5 text-[10px]"
                                      onClick={() =>
                                        void openEvidence(assertion.evidencePath ?? '')
                                      }
                                    >
                                      <ExternalLink size={10} />
                                      Open
                                    </Button>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {flow.evidencePaths?.length ? (
                          <div className="ml-4 mt-1 space-y-0.5">
                            {flow.evidencePaths.slice(0, 3).map((path) => (
                              <div key={path} className="flex items-center gap-2">
                                <div className="min-w-0 flex-1 break-all font-mono text-[10px] text-muted-foreground">
                                  {path}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  className="h-5 px-1.5 text-[10px]"
                                  onClick={() => void openEvidence(path)}
                                >
                                  <ExternalLink size={10} />
                                  Open
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {result.evidencePaths?.length ? (
                  <div className="mt-2 border-t border-border pt-2">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-secondary">
                      Evidence
                    </div>
                    <div className="space-y-0.5">
                      {result.evidencePaths.slice(0, 5).map((path) => (
                        <div key={path} className="flex items-center gap-2">
                          <div className="min-w-0 flex-1 break-all font-mono text-[10px] text-muted-foreground">
                            {path}
                          </div>
                          <Button
                            variant="ghost"
                            size="xs"
                            className="h-5 px-1.5 text-[10px]"
                            onClick={() => void openEvidence(path)}
                          >
                            <ExternalLink size={10} />
                            Open
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {qaEvidenceError ? (
                  <div className="mt-2 rounded-sm border border-danger/30 bg-danger/10 px-2 py-1 text-[11px] text-danger">
                    {qaEvidenceError}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function PipelineTab(props: Parameters<typeof usePipelineTabView>[0]) {
  return usePipelineTabView(props);
}
