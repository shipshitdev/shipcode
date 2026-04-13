import type {
  ActivityEntry,
  ExecutorModel,
  GitHubIssueCacheRecord,
  IntegrationStatus,
  OpenRouterModelValidation,
  PipelineCheckpoint,
  PipelinePhase,
  PlanRecord,
  ReviewRecord,
  Thread,
} from '@shipcode/shared';
import {
  Badge,
  Button,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  cn,
  ExternalLink,
  Input,
  Maximize2,
  MODEL_DISPLAY,
  Pencil,
  PhaseChip,
  PlanViewer,
  RefreshCw,
  ReviewViewer,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@shipcode/ui';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  formatProviderSelectionLabel,
  getModelOptions,
  InheritValueDisplay,
  PROVIDER_DISPLAY,
} from '../model-provider-options';
import { PlanWaiting } from './PlanWaiting';
import {
  encodePhaseOption,
  getPlanStatusPresentation,
  getReviewDecisionPresentation,
  PHASE_PROVIDER_OPTIONS,
  PRD_PROSE_CLASSES,
  resolveClientSidePlan,
  resolveRawPlanText,
  timeAgo,
} from './helpers';

type PhaseKey = 'planner' | 'reviewer' | 'executor' | 'verifier';

type PhaseSelection = {
  provider: ExecutorModel;
  modelId: string | null;
};

type PlanRunGroup = {
  threadId: string;
  plans: PlanRecord[];
  runNumber: number;
  isCurrentRun: boolean;
};

interface IssueDetailTabsProps {
  activeIssue: GitHubIssueCacheRecord;
  activeThreadId: string | null;
  checkpoints: PipelineCheckpoint[];
  currentPhaseSelections: Record<PhaseKey, PhaseSelection>;
  effectiveExpanded: string | null | undefined;
  effectivePhaseResolvedModels: Record<PhaseKey, string>;
  executorEditable: boolean;
  expanded: boolean;
  hasPrFeedbackBlockers: boolean;
  integrationStatus?: IntegrationStatus;
  isRefreshingFromGithub: boolean;
  isSubmitting: boolean;
  linkedPrUrl: string | null;
  normalizedIssueActivity: ActivityEntry[];
  normalizedPlanHistory: PlanRecord[];
  normalizedReviewsByPlanId: Record<string, ReviewRecord>;
  normalizedThreadPlanHistory: PlanRecord[];
  phaseModelValidation: Partial<Record<PhaseKey, OpenRouterModelValidation | null>>;
  phaseSelectValues: Record<PhaseKey, string>;
  planHistoryCollapsed: boolean;
  planRunCount: number;
  planRunGroups: PlanRunGroup[];
  prdCollapsed: boolean;
  projectDefaultPhaseSelections: Record<PhaseKey, PhaseSelection>;
  runNumberByThreadId: Record<string, number>;
  thread: Thread | null | undefined;
  threadPhase: PipelinePhase | 'idle';
  onEditPrd: () => void;
  onFullScreenPlan: (planId: string | null) => void;
  onPhaseAgentChange: (phase: PhaseKey, value: string) => void;
  onPhaseOpenRouterSlugBlur: (phase: PhaseKey, rawValue: string) => void;
  onPlanExpandedChange: (planId: string | null | undefined) => void;
  onPlanHistoryCollapsedChange: (collapsed: boolean) => void;
  onPrdCollapsedChange: (collapsed: boolean) => void;
  onRefreshFromGithub: () => void;
  onRestoreCheckpoint: (checkpoint: PipelineCheckpoint) => void;
  onStabilizePr: () => void;
}

export function IssueDetailTabs({
  activeIssue,
  activeThreadId,
  checkpoints,
  currentPhaseSelections,
  effectiveExpanded,
  effectivePhaseResolvedModels,
  executorEditable,
  expanded,
  hasPrFeedbackBlockers,
  integrationStatus,
  isRefreshingFromGithub,
  isSubmitting,
  linkedPrUrl,
  normalizedIssueActivity,
  normalizedPlanHistory,
  normalizedReviewsByPlanId,
  normalizedThreadPlanHistory,
  phaseModelValidation,
  phaseSelectValues,
  planHistoryCollapsed,
  planRunCount,
  planRunGroups,
  prdCollapsed,
  projectDefaultPhaseSelections,
  runNumberByThreadId,
  thread,
  threadPhase,
  onEditPrd,
  onFullScreenPlan,
  onPhaseAgentChange,
  onPhaseOpenRouterSlugBlur,
  onPlanExpandedChange,
  onPlanHistoryCollapsedChange,
  onPrdCollapsedChange,
  onRefreshFromGithub,
  onRestoreCheckpoint,
  onStabilizePr,
}: IssueDetailTabsProps) {
  const prdCollapseLabel = prdCollapsed ? 'Expand PRD' : 'Collapse PRD';
  const planHistoryCollapseLabel = planHistoryCollapsed
    ? 'Expand plan history'
    : 'Collapse plan history';

  const agentsSection = (
    <div className="mb-5">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">Agents</h4>
      <div className="grid grid-cols-2 gap-2">
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
                        selectedSelection.provider === providerOption ? selectedSelection.modelId : null;
                      return (
                        <SelectGroup key={providerOption}>
                          <SelectLabel>{PROVIDER_DISPLAY[providerOption]}</SelectLabel>
                          <SelectItem value={encodePhaseOption(providerOption, null)}>
                            {PROVIDER_DISPLAY[providerOption]} default
                          </SelectItem>
                          {selectedModelId &&
                            !getModelOptions(providerOption).some(
                              (option) => option.value === selectedModelId,
                            ) && (
                              <SelectItem value={encodePhaseOption(providerOption, selectedModelId)}>
                                {selectedModelId}
                              </SelectItem>
                            )}
                          {getModelOptions(providerOption).map((option) => (
                            <SelectItem key={option.value} value={encodePhaseOption(providerOption, option.value)}>
                              {option.label}
                            </SelectItem>
                          ))}
                          {providerOption !==
                            PHASE_PROVIDER_OPTIONS[phase][PHASE_PROVIDER_OPTIONS[phase].length - 1] && (
                            <SelectSeparator />
                          )}
                        </SelectGroup>
                      );
                    })}
                  </SelectContent>
                </Select>

                {currentPhaseSelections[phase].provider === 'openrouter' && phase !== 'executor' && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted">
                      Custom OpenRouter slug
                    </span>
                    <Input
                      key={`${phase}-${currentPhaseSelections[phase].modelId ?? ''}`}
                      className="h-7 text-[11px]"
                      placeholder="e.g. anthropic/claude-sonnet-4-6"
                      defaultValue={currentPhaseSelections[phase].modelId ?? ''}
                      onBlur={(event) => onPhaseOpenRouterSlugBlur(phase, event.target.value)}
                    />
                  </div>
                )}

                {currentPhaseSelections[phase].provider === 'openrouter' &&
                integrationStatus?.openrouter.authStatus !== 'valid' ? (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                    {integrationStatus?.openrouter.message ?? 'OpenRouter is not ready.'}
                  </div>
                ) : null}

                {phaseModelValidation[phase] && phaseModelValidation[phase]?.status !== 'valid' ? (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                    {phaseModelValidation[phase]?.message}
                  </div>
                ) : null}
              </>
            ) : (
              <Badge variant="default" className="w-fit font-mono normal-case tracking-normal">
                {MODEL_DISPLAY[displayModel] ?? displayModel}
              </Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const pipelineSection = thread ? (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">Pipeline</h4>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {thread.worktreeBranch && (
          <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
              Branch
            </span>
            <span className="truncate font-mono text-[11px] text-primary">
              {thread.worktreeBranch}
            </span>
          </div>
        )}
        {activeIssue.linkedPrNumber && linkedPrUrl && (
          <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                Pull Request
              </span>
              <Badge variant={activeIssue.linkedPrIsDraft ? 'warning' : 'success'} className="text-[10px]">
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
                onClick={() => window.shipcode.invoke('shell:open-external', { url: linkedPrUrl })}
                title="Open pull request on GitHub"
              >
                <ExternalLink size={12} />
              </Button>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Cost</span>
          <span className="text-[11px] font-medium text-primary">
            {thread.totalCostUsd === 0
              ? '$0.00'
              : thread.totalCostUsd < 0.005
                ? '< $0.01'
                : `$${thread.totalCostUsd.toFixed(2)}`}
          </span>
          {thread.totalTokensPrompt > 0 && (
            <span className="text-[10px] text-muted">
              {thread.totalTokensPrompt + thread.totalTokensCompletion >= 1000
                ? `${Math.round((thread.totalTokensPrompt + thread.totalTokensCompletion) / 1000)}k`
                : String(thread.totalTokensPrompt + thread.totalTokensCompletion)}{' '}
              tokens
            </span>
          )}
        </div>
      </div>
    </div>
  ) : null;

  const prFeedbackSection = activeIssue.linkedPrNumber ? (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
          PR Feedback
        </h4>
        {activeIssue.prLastSyncAt && (
          <span className="text-[10px] text-muted">
            {new Date(activeIssue.prLastSyncAt).toLocaleString()}
          </span>
        )}
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
        {activeIssue.failingChecks.length > 0 && (
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
                  {check.detailsUrl && (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-5 px-1.5 text-[10px]"
                      onClick={() =>
                        window.shipcode.invoke('shell:open-external', { url: check.detailsUrl! })
                      }
                    >
                      Open
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {activeIssue.unresolvedReviewComments.length > 0 && (
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
        )}
        {hasPrFeedbackBlockers && activeThreadId && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={onStabilizePr}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Starting…' : 'Run stabilization pass'}
            </Button>
          </div>
        )}
      </div>
    </div>
  ) : null;

  const checkpointSection =
    thread && checkpoints.length > 0 ? (
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
    ) : null;

  const issueActivitySection = (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
          Issue History
        </h4>
        <span className="text-[11px] text-muted">{normalizedIssueActivity.length} events</span>
      </div>
      {normalizedIssueActivity.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-secondary/10 px-4 py-8 text-center text-[12px] text-muted">
          No issue activity yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-secondary/20">
          <div className="divide-y divide-border">
            {normalizedIssueActivity.map((entry) => {
              const runNumber =
                entry.threadId && runNumberByThreadId[entry.threadId]
                  ? runNumberByThreadId[entry.threadId]
                  : null;
              return (
                <div key={entry.id} className="flex items-start gap-3 px-3 py-2.5">
                  <span className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded border border-border bg-tertiary px-1.5 py-0.5 text-[9px] uppercase text-muted">
                    {entry.actor}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 text-[12px] text-primary break-words">{entry.title}</p>
                      {runNumber && (
                        <Badge variant="default" className="text-[10px]">
                          Run {runNumber}
                        </Badge>
                      )}
                    </div>
                    {entry.subtitle && (
                      <p className="mt-0.5 text-[11px] text-muted break-words">
                        {entry.subtitle}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-[10px] text-muted">
                    {timeAgo(entry.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  const planHistorySection =
    normalizedPlanHistory.length > 0 ? (
      <div className="mb-5">
        <div className="mb-2 flex w-full items-center gap-1">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center text-left"
            onClick={() => onPlanHistoryCollapsedChange(!planHistoryCollapsed)}
            title={planHistoryCollapseLabel}
            aria-label={planHistoryCollapseLabel}
          >
            <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">
              Plan History ({normalizedPlanHistory.length} version
              {normalizedPlanHistory.length !== 1 ? 's' : ''}
              {planRunCount > 1 ? ` across ${planRunCount} runs` : ''})
            </h4>
          </button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(event) => {
              event.stopPropagation();
              onPlanHistoryCollapsedChange(!planHistoryCollapsed);
            }}
            title={planHistoryCollapseLabel}
            aria-label={planHistoryCollapseLabel}
          >
            {planHistoryCollapsed ? (
              <ChevronDown size={16} strokeWidth={2.25} className="text-muted" />
            ) : (
              <ChevronUp size={16} strokeWidth={2.25} className="text-muted" />
            )}
          </Button>
        </div>
        {!planHistoryCollapsed && (
          <div className="flex flex-col gap-3">
            {planRunGroups.map((runGroup) => (
              <div key={runGroup.threadId} className="rounded-md border border-border bg-secondary/20">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
                      Run {runGroup.runNumber}
                    </span>
                    {runGroup.isCurrentRun && (
                      <Badge variant="info" className="text-[10px]">
                        Current run
                      </Badge>
                    )}
                    <span className="text-[11px] text-muted">
                      {runGroup.plans.length} version{runGroup.plans.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted">
                    {new Date(runGroup.plans[0].createdAt).toLocaleString()}
                  </span>
                </div>

                <div className="divide-y divide-border">
                  {runGroup.plans.map((plan) => {
                    const isExpanded = effectiveExpanded === plan.id;
                    const review = normalizedReviewsByPlanId[plan.id];
                    const statusPresentation = getPlanStatusPresentation(plan, review);
                    const reviewPresentation = review
                      ? getReviewDecisionPresentation(review, threadPhase)
                      : null;
                    const isSuperseded = plan.status === 'superseded';

                    return (
                      <div
                        key={plan.id}
                        className={cn(
                          'transition-opacity',
                          isSuperseded && !isExpanded && 'opacity-60',
                        )}
                      >
                        <div className="flex items-center gap-1 px-2 py-1.5">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="shrink-0 text-muted hover:text-primary"
                            aria-label="View plan full screen"
                            onClick={() => onFullScreenPlan(plan.id)}
                          >
                            <Maximize2 size={12} />
                          </Button>
                          <Button
                            variant="ghost"
                            className={cn(
                              'h-auto min-w-0 flex-1 justify-start rounded-md px-2 py-2 text-left text-[13px] font-normal',
                              isSuperseded ? 'text-secondary' : 'text-primary',
                            )}
                            onClick={() => onPlanExpandedChange(isExpanded ? null : plan.id)}
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <span className="font-mono text-xs font-semibold text-muted">
                                v{plan.version}
                              </span>
                              {statusPresentation.usePhaseChip ? (
                                <PhaseChip
                                  status={statusPresentation.phaseStatus}
                                  label={statusPresentation.label}
                                  className="text-[10px]"
                                />
                              ) : (
                                <span className="text-xs text-muted">{statusPresentation.label}</span>
                              )}
                              {review && plan.status !== 'superseded' && reviewPresentation && (
                                <Badge
                                  variant={reviewPresentation.badgeVariant}
                                  className="text-[10px]"
                                >
                                  {reviewPresentation.label}
                                </Badge>
                              )}
                              <span className="ml-auto shrink-0 text-[11px] text-muted">
                                {new Date(plan.createdAt).toLocaleString()}
                              </span>
                              {isExpanded ? (
                                <ChevronDown size={12} className="shrink-0 text-muted" />
                              ) : (
                                <ChevronRight size={12} className="shrink-0 text-muted" />
                              )}
                            </div>
                          </Button>
                        </div>

                        {isExpanded &&
                          (() => {
                            const inlineDisplayPlan =
                              plan.structured ?? resolveClientSidePlan(plan.rawOutput ?? '');
                            return (
                              <div className="border-t border-border p-3">
                                {inlineDisplayPlan && <PlanViewer plan={inlineDisplayPlan} />}
                                {review?.structured && <ReviewViewer review={review.structured} />}
                                {!inlineDisplayPlan && (() => {
                                  const fallbackRaw = plan.rawOutput ?? '';
                                  const resolved = resolveRawPlanText(fallbackRaw);
                                  return resolved === fallbackRaw ? (
                                    <p className="text-xs italic text-muted">
                                      Plan output could not be parsed. Check devtools console for the
                                      full trace.
                                    </p>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      <pre className="whitespace-pre-wrap text-xs text-secondary">
                                        {resolved}
                                      </pre>
                                    </div>
                                  );
                                })()}
                              </div>
                            );
                          })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    ) : null;

  const prdSection = (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center text-left"
          onClick={() => onPrdCollapsedChange(!prdCollapsed)}
          title={prdCollapseLabel}
          aria-label={prdCollapseLabel}
        >
          <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">PRD</h4>
        </button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(event) => {
              event.stopPropagation();
              onRefreshFromGithub();
            }}
            disabled={isRefreshingFromGithub}
            title="Re-fetch issue body from GitHub"
            aria-label="Refresh PRD from GitHub"
          >
            <RefreshCw size={12} className={isRefreshingFromGithub ? 'animate-spin' : ''} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(event) => {
              event.stopPropagation();
              onEditPrd();
            }}
            title="Edit the PRD body"
            aria-label="Edit PRD"
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(event) => {
              event.stopPropagation();
              onPrdCollapsedChange(!prdCollapsed);
            }}
            title={prdCollapseLabel}
            aria-label={prdCollapseLabel}
          >
            {prdCollapsed ? (
              <ChevronDown size={16} strokeWidth={2.25} className="text-muted" />
            ) : (
              <ChevronUp size={16} strokeWidth={2.25} className="text-muted" />
            )}
          </Button>
        </div>
      </div>
      {!prdCollapsed &&
        (activeIssue.body ? (
          <div
            className={cn(
              'rounded-md bg-secondary p-3 text-[13px] leading-relaxed text-primary',
              !expanded && 'max-h-[300px] overflow-y-auto',
            )}
          >
            <div className={PRD_PROSE_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeIssue.body}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <div className="rounded-md bg-secondary p-3 text-[13px] text-muted">
            This issue has no PRD body yet. Click "Edit PRD" to author one.
          </div>
        ))}
    </div>
  );

  const planHistoryTabContent = (
    <>
      {planHistorySection}
      {activeThreadId &&
        normalizedThreadPlanHistory.length === 0 &&
        threadPhase !== 'failed' &&
        (expanded ? (
          <PlanWaiting threadId={activeThreadId} />
        ) : (
          <div className="mb-5">
            <p className="py-4 text-center text-[13px] text-muted">
              Pipeline is running - waiting for plan generation...
            </p>
          </div>
        ))}
    </>
  );

  const pipelineTabContent = (
    <>
      {agentsSection}
      {pipelineSection}
      {prFeedbackSection}
      {checkpointSection}
    </>
  );

  return (
    <Tabs defaultValue="prd" className="flex min-h-0 flex-col">
      <TabsList className={cn('shrink-0', expanded ? 'mb-5' : 'px-4')}>
        <TabsTrigger value="prd">PRD</TabsTrigger>
        <TabsTrigger value="history">
          Plan History
          {normalizedPlanHistory.length > 0 ? ` (${normalizedPlanHistory.length})` : ''}
        </TabsTrigger>
        <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
        <TabsTrigger value="activity">
          Issue History
          {normalizedIssueActivity.length > 0 ? ` (${normalizedIssueActivity.length})` : ''}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="prd" className={cn('mt-0', !expanded && 'p-4')}>
        {prdSection}
      </TabsContent>

      <TabsContent value="history" className={cn('mt-0', !expanded && 'p-4')}>
        {planHistoryTabContent}
      </TabsContent>

      <TabsContent value="pipeline" className={cn('mt-0', !expanded && 'p-4')}>
        {pipelineTabContent}
      </TabsContent>

      <TabsContent value="activity" className={cn('mt-0', !expanded && 'p-4')}>
        {issueActivitySection}
      </TabsContent>
    </Tabs>
  );
}
