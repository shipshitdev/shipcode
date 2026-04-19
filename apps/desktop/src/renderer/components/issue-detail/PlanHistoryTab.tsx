import type { PipelinePhase, PlanRecord, ReviewRecord } from '@shipcode/shared';
import {
  Badge,
  Button,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  cn,
  Maximize2,
  PhaseChip,
  PlanViewer,
  ReviewViewer,
} from '@shipcode/ui';
import {
  diagnosePlanParseFailure,
  getPlanStatusPresentation,
  resolveClientSidePlan,
  resolveRawPlanText,
} from './helpers';
import { PlanWaiting } from './PlanWaiting';
import type { PlanRunGroup } from './tab-types';

export function PlanHistoryTab({
  activeThreadId,
  effectiveExpanded,
  expanded,
  isPlanHistoryLoading,
  normalizedPlanHistory,
  normalizedReviewsByPlanId,
  normalizedThreadPlanHistory,
  planHistoryCollapsed,
  planRunCount,
  planRunGroups,
  threadPhase,
  onFullScreenPlan,
  onPlanExpandedChange,
  onPlanHistoryCollapsedChange,
}: {
  activeThreadId: string | null;
  effectiveExpanded: string | null | undefined;
  expanded: boolean;
  isPlanHistoryLoading: boolean;
  normalizedPlanHistory: PlanRecord[];
  normalizedReviewsByPlanId: Record<string, ReviewRecord>;
  normalizedThreadPlanHistory: PlanRecord[];
  planHistoryCollapsed: boolean;
  planRunCount: number;
  planRunGroups: PlanRunGroup[];
  threadPhase: PipelinePhase | 'idle';
  onFullScreenPlan: (planId: string | null) => void;
  onPlanExpandedChange: (planId: string | null | undefined) => void;
  onPlanHistoryCollapsedChange: (collapsed: boolean) => void;
}) {
  const planHistoryCollapseLabel = planHistoryCollapsed
    ? 'Expand plan history'
    : 'Collapse plan history';

  return (
    <>
      {normalizedPlanHistory.length > 0 ? (
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
          {!planHistoryCollapsed ? (
            <div className="flex flex-col gap-3">
              {planRunGroups.map((runGroup) => (
                <div
                  key={runGroup.threadId}
                  className="rounded-md border border-border bg-tertiary"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
                        Run {runGroup.runNumber}
                      </span>
                      {runGroup.isCurrentRun ? (
                        <Badge variant="info" className="text-[10px]">
                          Current run
                        </Badge>
                      ) : null}
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
                                {statusPresentation.style === 'phase-chip' ? (
                                  <PhaseChip
                                    status={statusPresentation.phaseStatus}
                                    label={statusPresentation.label}
                                    className="text-[10px]"
                                  />
                                ) : (
                                  <Badge
                                    variant={statusPresentation.badgeVariant}
                                    className="text-[10px] text-muted border-border/70 bg-secondary/40"
                                  >
                                    {statusPresentation.label}
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
                                  {inlineDisplayPlan ? (
                                    <PlanViewer plan={inlineDisplayPlan} />
                                  ) : null}
                                  {review?.structured ? (
                                    <ReviewViewer review={review.structured} />
                                  ) : null}
                                  {!inlineDisplayPlan &&
                                    (() => {
                                      const fallbackRaw = plan.rawOutput ?? '';
                                      const resolved = resolveRawPlanText(fallbackRaw);
                                      const displayText = resolved.trim() || fallbackRaw.trim();
                                      return displayText ? (
                                        <div className="space-y-2">
                                          <p className="text-xs italic text-muted">
                                            {diagnosePlanParseFailure(fallbackRaw)}
                                          </p>
                                          <div className="overflow-x-auto">
                                            <pre className="whitespace-pre-wrap text-xs text-secondary">
                                              {displayText}
                                            </pre>
                                          </div>
                                        </div>
                                      ) : (
                                        <p className="text-xs italic text-muted">
                                          Plan output could not be parsed. Check devtools console
                                          for the full trace.
                                        </p>
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
          ) : null}
        </div>
      ) : null}

      {isPlanHistoryLoading && normalizedPlanHistory.length === 0 ? (
        <div className="mb-5">
          <p className="py-4 text-center text-[13px] text-muted">Loading plan history…</p>
        </div>
      ) : null}

      {activeThreadId &&
      !isPlanHistoryLoading &&
      normalizedThreadPlanHistory.length === 0 &&
      normalizedPlanHistory.length === 0 &&
      threadPhase !== 'failed' ? (
        expanded ? (
          <PlanWaiting threadId={activeThreadId} />
        ) : (
          <div className="mb-5">
            <p className="py-4 text-center text-[13px] text-muted">
              Pipeline is running - waiting for plan generation...
            </p>
          </div>
        )
      ) : null}
    </>
  );
}
