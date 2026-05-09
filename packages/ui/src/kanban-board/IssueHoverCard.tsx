'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from 'react';
import { modelDisplay } from '@/lib/model-display';
import {
  displayAgentLabel,
  type GitHubIssueCacheRecord,
  ISSUE_PIPELINE_STATUS,
  type IssuePipelineStatus,
  isAgentRoutingLabel,
  phaseToProgress,
} from '@/lib/shipcode';
import { formatElapsedDuration } from '@/lib/time';
import { cn } from '@/lib/utils';
import { PhaseChip } from '@/PhaseChip';
import { Badge } from '@/primitives/badge';
import { ACTIVE_STATUSES, PHASE_ELAPSED_STATUSES } from './constants';
import { issueBodySnippet } from './issue-body-snippet';
import type { IssuePhaseChip, PlanStepSummary } from './types';
import { resolveIssuePriorityBadge } from './utils';

function statusDotClass(status: IssuePipelineStatus): string {
  if (status === ISSUE_PIPELINE_STATUS.failed) return 'bg-danger';
  if (
    status === ISSUE_PIPELINE_STATUS.approval ||
    status === ISSUE_PIPELINE_STATUS.clarifying ||
    status === ISSUE_PIPELINE_STATUS.paused
  )
    return 'bg-warning';
  if (status === ISSUE_PIPELINE_STATUS.completed) return 'bg-success';
  if (status === ISSUE_PIPELINE_STATUS.closed) return 'bg-done';
  if (ACTIVE_STATUSES.includes(status)) return 'bg-agent';
  return 'bg-muted-foreground/50';
}

const HOVER_DELAY_MS = 350;
const MAX_VISIBLE_STEPS = 8;

interface IssueHoverCardProps {
  issue: GitHubIssueCacheRecord;
  phaseChip?: IssuePhaseChip | null;
  disabled?: boolean;
  onFetchPlanSteps?: (threadId: string) => Promise<PlanStepSummary[] | null>;
  children: React.ReactNode;
}

const STEP_STATUS_ICON: Record<PlanStepSummary['status'], { char: string; className: string }> = {
  running: { char: '●', className: 'text-agent animate-pulse' },
  completed: { char: '✓', className: 'text-success' },
  failed: { char: '✕', className: 'text-danger' },
  ready: { char: '○', className: 'text-muted-foreground/50' },
  pending: { char: '○', className: 'text-muted-foreground/50' },
  blocked: { char: '⊘', className: 'text-muted-foreground/50' },
};

function PlanStepsSection({ steps }: { steps: PlanStepSummary[] }) {
  const sorted = steps.toSorted((a, b) => a.order - b.order);
  const visible = sorted.slice(0, MAX_VISIBLE_STEPS);
  const overflow = sorted.length - visible.length;

  return (
    <div className="mb-2">
      <div className="mb-1 mt-2 border-t border-border/40 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Plan
      </div>
      <div className="flex flex-col gap-0.5">
        {visible.map((step) => {
          const icon = STEP_STATUS_ICON[step.status];
          const isRunning = step.status === 'running';
          return (
            <div
              key={step.id}
              className={cn(
                'flex items-center gap-1.5 rounded px-1 py-0.5 -mx-1',
                isRunning && 'bg-agent/10',
              )}
            >
              <span
                className={cn('w-3 shrink-0 text-center text-[10px] leading-none', icon.className)}
              >
                {icon.char}
              </span>
              <span
                className={cn(
                  'text-[11px] leading-tight truncate',
                  isRunning ? 'text-primary font-medium' : 'text-secondary',
                  step.status === 'completed' && 'text-muted-foreground',
                )}
              >
                {step.title}
              </span>
            </div>
          );
        })}
        {overflow > 0 && (
          <span className="text-[10px] text-muted-foreground/60 pl-[18px]">+ {overflow} more</span>
        )}
      </div>
    </div>
  );
}

export function IssueHoverCard({
  issue,
  phaseChip,
  disabled = false,
  onFetchPlanSteps,
  children,
}: IssueHoverCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [planSteps, setPlanSteps] = useState<PlanStepSummary[] | null>(null);
  const [planStepsLoading, setPlanStepsLoading] = useState(false);
  const enterTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const isActive = ACTIVE_STATUSES.includes(issue.pipelineStatus);
  const canFetchSteps = !!(onFetchPlanSteps && issue.threadId && isActive);
  const resetKey = `${issue.threadId ?? ''}:${issue.pipelineStatus}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (enterTimeoutRef.current) clearTimeout(enterTimeoutRef.current);
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    void resetKey;
    setPlanSteps(null);
    setPlanStepsLoading(false);
    abortRef.current?.abort();
  }, [resetKey]);

  const fetchSteps = useCallback(() => {
    if (!canFetchSteps || !onFetchPlanSteps || !issue.threadId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPlanStepsLoading(true);

    onFetchPlanSteps(issue.threadId)
      .then((steps) => {
        if (!controller.signal.aborted && mountedRef.current) {
          setPlanSteps(steps);
          setPlanStepsLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && mountedRef.current) {
          setPlanStepsLoading(false);
        }
      });
  }, [canFetchSteps, onFetchPlanSteps, issue.threadId]);

  const handlePointerEnter = useCallback(() => {
    if (disabled) return;
    enterTimeoutRef.current = setTimeout(() => {
      setIsOpen(true);
      if (canFetchSteps && planSteps === null && !planStepsLoading) {
        fetchSteps();
      }
    }, HOVER_DELAY_MS);
  }, [disabled, canFetchSteps, planSteps, planStepsLoading, fetchSteps]);

  const handlePointerLeave = useCallback(() => {
    if (enterTimeoutRef.current) {
      clearTimeout(enterTimeoutRef.current);
      enterTimeoutRef.current = null;
    }
    setIsOpen(false);
  }, []);

  const priorityBadge = resolveIssuePriorityBadge(issue);
  const agentLabels = issue.labels?.filter(isAgentRoutingLabel) ?? [];
  const lastUpdate = issue.lastPhaseUpdate ? new Date(issue.lastPhaseUpdate).getTime() : null;
  const bodySnippet = issueBodySnippet(issue);
  const anchorChild = isValidElement<{ onPointerEnter?: () => void; onPointerLeave?: () => void }>(
    children,
  )
    ? cloneElement(children, {
        onPointerEnter: handlePointerEnter,
        onPointerLeave: handlePointerLeave,
      })
    : children;

  const showPlanSteps = isActive && onFetchPlanSteps;
  const isPlanning = issue.pipelineStatus === 'planning';

  return (
    <PopoverPrimitive.Root open={isOpen && !disabled}>
      <PopoverPrimitive.Anchor asChild>{anchorChild}</PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="right"
          sideOffset={8}
          align="start"
          className={cn(
            'z-50 w-72 rounded-lg border border-border/60 p-3 shadow-xl',
            'bg-[color-mix(in_srgb,var(--bg-elevated)_88%,transparent)] backdrop-blur-xl',
            'animate-in fade-in-0 zoom-in-95 data-[side=right]:slide-in-from-left-2',
          )}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {/* Issue number + status */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
              <span
                className={cn(
                  'inline-block size-2 rounded-full',
                  statusDotClass(issue.pipelineStatus),
                )}
              />
              #{issue.issueNumber}
            </span>
            <PhaseChip status={issue.pipelineStatus} />
          </div>

          {/* Title */}
          <h4 className="text-[13px] font-semibold text-primary leading-snug line-clamp-2 mb-1.5">
            {issue.title}
          </h4>

          {/* Plan steps for active issues, body snippet for others */}
          {showPlanSteps ? (
            planSteps && planSteps.length > 0 ? (
              <PlanStepsSection steps={planSteps} />
            ) : planStepsLoading ? (
              <p className="text-[11px] text-muted-foreground/60 leading-relaxed mb-2 mt-2">
                Loading plan…
              </p>
            ) : isPlanning ? (
              <p className="text-[11px] text-muted-foreground/60 leading-relaxed mb-2 mt-2">
                Planning in progress…
              </p>
            ) : (
              bodySnippet && (
                <p className="text-[11px] text-secondary leading-relaxed line-clamp-3 mb-2">
                  {bodySnippet}
                </p>
              )
            )
          ) : (
            bodySnippet && (
              <p className="text-[11px] text-secondary leading-relaxed line-clamp-3 mb-2">
                {bodySnippet}
              </p>
            )
          )}

          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {priorityBadge && (
              <Badge variant="default" className="text-[10px] px-1.5 py-0">
                {priorityBadge.label}
              </Badge>
            )}
            {issue.linkedPrNumber && (
              <Badge
                variant={issue.linkedPrIsDraft ? 'default' : 'done'}
                className="text-[10px] px-1.5 py-0 font-mono"
              >
                {issue.linkedPrIsDraft ? 'Draft ' : ''}PR #{issue.linkedPrNumber}
              </Badge>
            )}
            {issue.ciBlocked && (
              <Badge variant="danger" className="text-[10px] px-1.5 py-0">
                CI blocked
              </Badge>
            )}
            {issue.unresolvedReviewCommentCount > 0 && (
              <Badge variant="warning" className="text-[10px] px-1.5 py-0">
                {issue.unresolvedReviewCommentCount} review
                {issue.unresolvedReviewCommentCount === 1 ? '' : 's'}
              </Badge>
            )}
            {agentLabels.map((label) => (
              <Badge key={label} variant="default" className="text-[10px] px-1.5 py-0 text-accent">
                {displayAgentLabel(label)}
              </Badge>
            ))}
          </div>

          {/* Model + progress for active issues */}
          {isActive && (phaseChip || PHASE_ELAPSED_STATUSES.includes(issue.pipelineStatus)) && (
            <div className="flex items-center gap-2 mb-2 text-[10px] text-muted-foreground">
              {phaseChip && (
                <Badge
                  variant="default"
                  className="whitespace-nowrap px-1.5 py-0 text-[10px] font-medium normal-case tracking-normal"
                >
                  {modelDisplay(phaseChip.model)}
                  {phaseChip.effort ? ` · ${phaseChip.effort}` : ''}
                </Badge>
              )}
              {PHASE_ELAPSED_STATUSES.includes(issue.pipelineStatus) && (
                <span className="font-mono tabular-nums">
                  {phaseToProgress(issue.pipelineStatus)}%
                </span>
              )}
            </div>
          )}

          {/* Meta row: assignee + last activity */}
          <div className="flex items-center justify-between gap-2">
            {issue.assignee ? (
              <span className="text-[10px] text-muted-foreground truncate">@{issue.assignee}</span>
            ) : (
              <span />
            )}
            {lastUpdate && (
              <div className="text-[10px] text-muted-foreground shrink-0">
                {isActive ? 'Running' : 'Last activity'} {formatElapsedDuration(lastUpdate)} ago
              </div>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
