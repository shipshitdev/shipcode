'use client';

import { useDraggable } from '@dnd-kit/core';
import {
  Archive,
  Check,
  Copy,
  GitPullRequest,
  Loader2,
  Lock,
  Maximize2,
  MoreVertical,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react';
import { memo } from 'react';
import { IssueHoverCard } from '@/kanban-board/IssueHoverCard';
import { modelDisplay } from '@/lib/model-display';
import { useSharedSecondNow } from '@/lib/second-ticker';
import type { GitHubIssueCacheRecord, IssueStalenessResult } from '@/lib/shipcode';
import { ISSUE_PIPELINE_STATUS, phaseToProgress } from '@/lib/shipcode';
import { formatElapsedDuration } from '@/lib/time';
import { cn } from '@/lib/utils';
import { PhaseChip } from '@/PhaseChip';
import { Badge } from '@/primitives/badge';
import { Button } from '@/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/primitives/dropdown-menu';
import { ACTIVE_STATUSES, DRAGGABLE_STATUSES, PHASE_ELAPSED_STATUSES } from './constants';
import type {
  IssueApprovalBadge,
  IssuePhaseChip,
  IssuePriorityBadge,
  IssueRevisionBadge,
} from './types';
import {
  dragOverlayBorderClass,
  isAutomationIssue,
  isIssueCreating,
  resolveIssuePriorityBadge,
} from './utils';

function PhaseElapsed({ since }: { since: number }) {
  const now = useSharedSecondNow();
  const label = formatElapsedDuration(since, now);

  return <span className="font-mono tabular-nums text-[10px] text-muted">{label}</span>;
}

function issueReferenceLabel(issue: GitHubIssueCacheRecord, isCreating: boolean): string {
  if (isCreating) return 'Creating';
  if (issue.isQuickMode) return 'Quick';
  if (isAutomationIssue(issue)) return 'Auto';
  return `#${issue.issueNumber}`;
}

export function IssueExternalBlockers({ issue }: { issue: GitHubIssueCacheRecord }) {
  if (!issue.ciBlocked && issue.unresolvedReviewCommentCount === 0) return null;

  return (
    <>
      {issue.ciBlocked && (
        <Badge variant="danger" className="text-[10px] px-1.5 py-px font-medium">
          CI blocked
        </Badge>
      )}
      {issue.unresolvedReviewCommentCount > 0 && (
        <Badge variant="warning" className="text-[10px] px-1.5 py-px font-medium">
          {issue.unresolvedReviewCommentCount} review
          {issue.unresolvedReviewCommentCount === 1 ? '' : 's'}
        </Badge>
      )}
    </>
  );
}

const ACTION_BADGE_CLASS =
  'absolute inset-0 inline-flex h-full items-center justify-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide opacity-0 transition-opacity group-hover:opacity-100';
const PLAN_ACTION_BADGE_CLASS =
  'border-agent/25 bg-agent/10 text-agent hover:border-agent/35 hover:bg-agent/15 hover:text-agent';
const DANGER_ACTION_BADGE_CLASS =
  'border-danger/30 bg-danger/15 text-danger hover:border-danger/40 hover:bg-danger/20 hover:text-danger';
const DONE_ACTION_BADGE_CLASS =
  'border-done/30 bg-done/15 text-done hover:border-done/40 hover:bg-done/20 hover:text-done';

export function StalenessDot({
  staleness,
  className,
}: {
  staleness?: IssueStalenessResult | null;
  className?: string;
}) {
  if (!staleness) return null;

  return (
    <span
      data-staleness-dot="true"
      role="img"
      aria-label={`Stale: ${staleness.title}`}
      title={staleness.title}
      className={cn(
        'inline-flex h-2.5 w-2.5 shrink-0 rounded-full border border-danger/60 bg-danger shadow-[0_0_0_2px_rgba(239,68,68,0.14)]',
        className,
      )}
    />
  );
}

interface DraggableCardProps {
  issue: GitHubIssueCacheRecord;
  phaseChip?: IssuePhaseChip | null;
  revisionBadge?: IssueRevisionBadge | null;
  approvalBadge?: IssueApprovalBadge | null;
  priorityBadge?: IssuePriorityBadge | null;
  staleness?: IssueStalenessResult | null;
  approvedAwaitingExecution?: boolean;
  readOnly?: boolean;
  onClick: (issue: GitHubIssueCacheRecord) => void;
  onRerun?: (issue: GitHubIssueCacheRecord) => void;
  onCancel?: (issue: GitHubIssueCacheRecord) => void;
  onStartPipeline?: (issue: GitHubIssueCacheRecord) => void;
  onOpenPullRequest?: (url: string) => void;
  onCopyBranchName?: (issue: GitHubIssueCacheRecord, branchName: string) => void;
  onMarkDone?: (issue: GitHubIssueCacheRecord) => void;
  onCreatePr?: (issue: GitHubIssueCacheRecord) => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  issueGithubUrl?: string | null;
  branchName?: string | null;
  branchCopyState?: 'copied' | 'error' | null;
  isSelected?: boolean;
  isKeyboardFocused?: boolean;
  isRerunning?: boolean;
  isStartingPipeline?: boolean;
  isCancelling?: boolean;
  isMarkingDone?: boolean;
  isFlashing?: boolean;
}

function DraggableCardComponent({
  issue,
  phaseChip,
  revisionBadge,
  approvalBadge,
  priorityBadge,
  staleness,
  approvedAwaitingExecution = false,
  readOnly = false,
  onClick,
  onRerun,
  onCancel,
  onStartPipeline,
  onOpenPullRequest,
  onCopyBranchName,
  onMarkDone,
  onCreatePr,
  onArchiveIssue,
  issueGithubUrl,
  branchName,
  branchCopyState,
  isSelected,
  isKeyboardFocused,
  isRerunning,
  isStartingPipeline,
  isCancelling,
  isMarkingDone,
  isFlashing = false,
}: DraggableCardProps) {
  const isCreating = isIssueCreating(issue);
  const isAutomation = isAutomationIssue(issue);
  const referenceLabel = issueReferenceLabel(issue, isCreating);
  const draggable =
    !readOnly &&
    !isCreating &&
    DRAGGABLE_STATUSES.includes(issue.pipelineStatus) &&
    (!isAutomation || issue.pipelineStatus === ISSUE_PIPELINE_STATUS.completed);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
    data: issue,
    disabled: !draggable,
  });

  const isFailed = issue.pipelineStatus === ISSUE_PIPELINE_STATUS.failed;
  const isClarifying = issue.pipelineStatus === ISSUE_PIPELINE_STATUS.clarifying;
  const isAwaitingApproval =
    issue.pipelineStatus === ISSUE_PIPELINE_STATUS.awaitingApproval && !approvedAwaitingExecution;
  const isAwaiting = isAwaitingApproval || isClarifying;
  const isActive = ACTIVE_STATUSES.includes(issue.pipelineStatus);
  const isTodo = issue.pipelineStatus === ISSUE_PIPELINE_STATUS.todo;
  const isCompleted = issue.pipelineStatus === ISSUE_PIPELINE_STATUS.completed;
  const isDone = issue.pipelineStatus === ISSUE_PIPELINE_STATUS.done;
  const showPhaseElapsed =
    PHASE_ELAPSED_STATUSES.includes(issue.pipelineStatus) && !!issue.lastPhaseUpdate;
  const phaseSince =
    showPhaseElapsed && issue.lastPhaseUpdate ? new Date(issue.lastPhaseUpdate).getTime() : 0;
  const linkedPrLabel = issue.linkedPrNumber ? `PR #${issue.linkedPrNumber}` : null;

  return (
    <IssueHoverCard issue={issue} disabled={isDragging || isCreating}>
      {/* biome-ignore lint/a11y/useSemanticElements: The card contains nested action buttons, so it cannot be a semantic button. */}
      <div
        ref={setNodeRef}
        className={cn(
          'group relative flex min-h-[92px] flex-col overflow-hidden rounded-md border bg-elevated p-3 text-left transition-colors outline-none',
          draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
          isCreating && 'border-agent/30 bg-agent/[0.025] opacity-80',
          isSelected && !isFailed && !isAwaiting && !isActive
            ? 'border-text-primary/60 bg-elevated'
            : !isSelected && !isActive
              ? 'border-border/50 hover:border-border-strong'
              : '',
          isCompleted &&
            (isSelected
              ? 'border-success/65 bg-success/[0.08] opacity-90'
              : 'border-success/35 bg-success/[0.04] opacity-80 hover:border-success/55 hover:bg-success/[0.055] hover:opacity-90'),
          isDone &&
            (isSelected
              ? 'border-done/65 bg-done/[0.09] opacity-85'
              : 'border-done/35 bg-done/[0.045] opacity-70 hover:border-done/55 hover:bg-done/[0.06] hover:opacity-80'),
          isFailed &&
            (isSelected
              ? 'border-danger/65 bg-danger/[0.09] opacity-85'
              : 'border-danger/35 bg-danger/[0.045] opacity-70 hover:border-danger/55 hover:bg-danger/[0.06] hover:opacity-80'),
          approvedAwaitingExecution &&
            (isSelected
              ? 'border-agent/65 bg-agent/[0.08]'
              : 'border-agent/35 bg-agent/[0.04] hover:border-agent/55 hover:bg-agent/[0.055]'),
          isAwaiting &&
            (isSelected
              ? 'border-warning bg-warning/[0.07]'
              : 'border-warning/30 bg-warning/[0.03] hover:border-warning/50'),
          isActive && 'shadow-[0_0_12px_rgba(56,189,248,0.18)]',
          isActive &&
            (isSelected
              ? 'border-agent/70 bg-agent/[0.06]'
              : 'border-agent/40 bg-agent/[0.03] hover:border-agent/60'),
          isFlashing && 'animate-card-flash ring-2 ring-agent/55',
          isKeyboardFocused && 'border-accent/80 ring-2 ring-accent/70',
          isDragging && 'opacity-50',
        )}
        data-issue-card-id={issue.id}
        data-flashing={isFlashing ? 'true' : undefined}
        data-keyboard-focused={isKeyboardFocused ? 'true' : undefined}
        onClick={(event) => {
          if (event.defaultPrevented || isDragging || isCreating) return;
          onClick(issue);
        }}
        {...listeners}
        {...attributes}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.currentTarget !== event.target) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (isCreating) return;
          onClick(issue);
        }}
      >
        {isCreating && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[repeating-linear-gradient(135deg,rgba(56,189,248,0.04)_0,rgba(56,189,248,0.04)_8px,transparent_8px,transparent_16px)]"
          />
        )}
        {isActive && (
          <div
            aria-hidden="true"
            className="issue-card-active-bg pointer-events-none absolute inset-0 rounded-[inherit]"
          >
            <span className="absolute inset-0 bg-gradient-to-br from-agent/[0.05] via-agent/[0.02] to-transparent" />
            <span className="absolute inset-0 animate-slide-progress-card bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
          </div>
        )}
        {issue.pipelineStatus !== ISSUE_PIPELINE_STATUS.todo &&
          issue.pipelineStatus !== ISSUE_PIPELINE_STATUS.queued &&
          issue.pipelineStatus !== ISSUE_PIPELINE_STATUS.failed && (
            <div
              className={cn(
                'absolute right-0 bottom-0 left-0 z-10 h-[3px] overflow-hidden rounded-b-md',
                isCompleted
                  ? 'bg-success/15'
                  : isDone
                    ? 'bg-done/15'
                    : approvedAwaitingExecution
                      ? 'bg-agent/15'
                      : 'bg-agent/15',
              )}
            >
              <div
                className={cn(
                  'absolute h-full transition-[width] duration-700',
                  isCompleted
                    ? 'bg-success'
                    : isDone
                      ? 'bg-done'
                      : approvedAwaitingExecution
                        ? 'bg-agent'
                        : issue.pipelineStatus === ISSUE_PIPELINE_STATUS.awaitingApproval ||
                            issue.pipelineStatus === ISSUE_PIPELINE_STATUS.clarifying
                          ? 'bg-warning'
                          : 'bg-agent',
                )}
                style={{ width: `${phaseToProgress(issue.pipelineStatus)}%` }}
              />
              {isActive && (
                <span className="absolute inset-0 animate-slide-progress bg-gradient-to-r from-transparent via-white/30 to-transparent" />
              )}
            </div>
          )}
        <StalenessDot staleness={staleness} className="absolute right-2 bottom-2 z-10" />
        <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1">
          {!isCreating && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted/60 opacity-0 transition-opacity hover:bg-muted/10 hover:text-primary group-hover:opacity-100"
              title="Open issue detail"
              aria-label="Open issue detail"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onClick(issue);
              }}
            >
              <Maximize2 size={14} />
            </Button>
          )}
          {!isCreating && !readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted/60 opacity-0 transition-opacity hover:bg-muted/10 hover:text-primary group-hover:opacity-100"
                  title="More actions"
                  aria-label="More actions"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreVertical size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                {branchName && onCopyBranchName && !isAutomation && (
                  <DropdownMenuItem onClick={() => onCopyBranchName(issue, branchName)}>
                    {branchCopyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}
                    {branchCopyState === 'copied' ? 'Copied!' : 'Copy branch'}
                  </DropdownMenuItem>
                )}
                {isTodo && onStartPipeline && !isAutomation && (
                  <DropdownMenuItem onClick={() => onStartPipeline(issue)}>
                    <Play size={14} />
                    Start Pipeline
                  </DropdownMenuItem>
                )}
                {isActive && onCancel && (
                  <DropdownMenuItem
                    className="text-danger focus:text-danger"
                    onClick={() => onCancel(issue)}
                  >
                    <Square size={14} />
                    Cancel
                  </DropdownMenuItem>
                )}
                {isFailed && onRerun && (
                  <DropdownMenuItem onClick={() => onRerun(issue)}>
                    <RefreshCw size={14} />
                    Retry
                  </DropdownMenuItem>
                )}
                {isCompleted && onCreatePr && !issue.linkedPrNumber && (
                  <DropdownMenuItem onClick={() => onCreatePr(issue)}>
                    <GitPullRequest size={14} />
                    Create PR
                  </DropdownMenuItem>
                )}
                {(isCompleted || isFailed) && onMarkDone && (
                  <DropdownMenuItem onClick={() => onMarkDone(issue)}>
                    <Check size={14} />
                    Mark as Done
                  </DropdownMenuItem>
                )}
                {isDone && onArchiveIssue && !isAutomation && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-muted focus:text-muted"
                      onClick={() => onArchiveIssue(issue)}
                    >
                      <Archive size={14} />
                      Archive
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div
          className={cn(
            'relative flex min-w-0 items-center justify-between gap-2',
            readOnly ? 'pr-7' : 'pr-12',
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {issueGithubUrl &&
            !isCreating &&
            !isAutomation &&
            !issue.isQuickMode &&
            onOpenPullRequest ? (
              <Button
                variant="ghost"
                size="xs"
                className="h-auto shrink-0 p-0 font-mono text-[11px] text-secondary hover:bg-transparent hover:text-primary hover:underline"
                title="Open issue on GitHub"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenPullRequest(issueGithubUrl);
                }}
              >
                {referenceLabel}
              </Button>
            ) : (
              <span className="shrink-0 font-mono text-[11px] text-secondary">
                {referenceLabel}
              </span>
            )}
            {linkedPrLabel &&
              (issue.linkedPrUrl && onOpenPullRequest ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-5 shrink-0 px-1.5 text-[10px] font-medium text-done hover:bg-done/10 hover:text-done"
                  title="Open pull request on GitHub"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenPullRequest(issue.linkedPrUrl as string);
                  }}
                >
                  {linkedPrLabel}
                </Button>
              ) : (
                <Badge variant="done" className="px-1.5 py-px text-[10px] font-medium">
                  {linkedPrLabel}
                </Badge>
              ))}
          </div>
          {showPhaseElapsed && (
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <span className="font-mono tabular-nums text-[10px] text-muted">
                {phaseToProgress(issue.pipelineStatus)}%
              </span>
              <PhaseElapsed since={phaseSince} />
            </span>
          )}
        </div>
        <div className="relative z-10 mt-1 w-full min-w-0">
          <span className="line-clamp-2 text-[13px] font-medium leading-snug text-primary">
            {issue.title}
          </span>
        </div>
        <div className="relative z-10 mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          {priorityBadge ? (
            <Badge
              variant={priorityBadge.variant}
              className="px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
              title={priorityBadge.title}
            >
              {priorityBadge.label}
            </Badge>
          ) : null}
          {phaseChip && isActive && (
            <Badge
              variant="default"
              className="whitespace-nowrap px-1.5 py-px text-[10px] font-medium normal-case tracking-normal"
              title={`${phaseChip.phase} model: ${modelDisplay(phaseChip.model)}${
                phaseChip.effort ? ` · ${phaseChip.effort}` : ''
              }`}
            >
              {modelDisplay(phaseChip.model)}
              {phaseChip.effort ? ` · ${phaseChip.effort}` : ''}
            </Badge>
          )}
          {revisionBadge ? (
            <Badge
              variant={revisionBadge.variant}
              className="px-1.5 py-px text-[10px] font-medium"
              title={revisionBadge.title}
            >
              {revisionBadge.label}
            </Badge>
          ) : null}
          {approvedAwaitingExecution ? (
            <Badge variant="success" className="px-1.5 py-px text-[10px] font-medium">
              Approved
            </Badge>
          ) : null}
          {approvalBadge && !approvedAwaitingExecution ? (
            <Badge
              variant="warning"
              className="px-1.5 py-px text-[10px] font-medium"
              title={approvalBadge.title}
            >
              {approvalBadge.label}
            </Badge>
          ) : null}
          {issue.labels
            .filter((label) => !readOnly && label.startsWith('agent:'))
            .map((label) => (
              <Badge key={label} variant="accent" className="px-1.5 py-px text-[10px] font-medium">
                {label}
              </Badge>
            ))}
          <IssueExternalBlockers issue={issue} />
          {isCreating ? (
            <Badge
              variant="default"
              className="inline-flex items-center gap-1 border-agent/25 bg-agent/10 px-1.5 py-px text-[10px] font-medium text-agent"
              title="Creating issue on GitHub"
            >
              <Loader2 size={10} className="animate-spin" />
              Creating
              <Lock size={10} />
            </Badge>
          ) : readOnly ? (
            <PhaseChip status={issue.pipelineStatus} />
          ) : isTodo && onStartPipeline && !isAutomation ? (
            <span className="relative inline-flex items-center">
              <span
                className={cn(
                  'pointer-events-none transition-opacity group-hover:opacity-0',
                  isStartingPipeline && 'opacity-0',
                )}
              >
                <PhaseChip status={issue.pipelineStatus} />
              </span>
              <Button
                variant="ghost"
                size="xs"
                className={cn(
                  ACTION_BADGE_CLASS,
                  PLAN_ACTION_BADGE_CLASS,
                  isStartingPipeline && 'opacity-100',
                )}
                title={isStartingPipeline ? 'Starting pipeline' : 'Start planning'}
                disabled={isStartingPipeline}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isStartingPipeline) return;
                  onStartPipeline(issue);
                }}
              >
                {isStartingPipeline ? (
                  <>
                    <Loader2 size={10} className="animate-spin" />
                    PLAN
                  </>
                ) : (
                  'PLAN'
                )}
              </Button>
            </span>
          ) : isActive && onCancel ? (
            <span className="relative inline-flex items-center">
              <span
                className={cn(
                  'pointer-events-none transition-opacity group-hover:opacity-0',
                  isCancelling && 'opacity-0',
                )}
              >
                <PhaseChip status={issue.pipelineStatus} />
              </span>
              <Button
                variant="ghost"
                size="xs"
                className={cn(
                  ACTION_BADGE_CLASS,
                  DANGER_ACTION_BADGE_CLASS,
                  isCancelling && 'opacity-100',
                )}
                title={isCancelling ? 'Cancelling pipeline' : 'Cancel pipeline'}
                disabled={isCancelling}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isCancelling) return;
                  onCancel(issue);
                }}
              >
                {isCancelling ? (
                  <>
                    <Loader2 size={10} className="animate-spin" />
                    CANCEL
                  </>
                ) : (
                  'CANCEL'
                )}
              </Button>
            </span>
          ) : isFailed && onRerun ? (
            <span className="relative inline-flex items-center">
              <span
                className={cn(
                  'pointer-events-none transition-opacity group-hover:opacity-0',
                  isRerunning && 'opacity-0',
                )}
              >
                <PhaseChip status={issue.pipelineStatus} />
              </span>
              <Button
                variant="ghost"
                size="xs"
                className={cn(
                  ACTION_BADGE_CLASS,
                  DANGER_ACTION_BADGE_CLASS,
                  'disabled:opacity-100',
                  isRerunning && 'opacity-100',
                )}
                title={isRerunning ? 'Retrying pipeline' : 'Retry pipeline'}
                disabled={isRerunning}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isRerunning) return;
                  onRerun(issue);
                }}
              >
                {isRerunning ? (
                  <>
                    <Loader2 size={10} className="animate-spin" />
                    RETRY
                  </>
                ) : (
                  'RETRY'
                )}
              </Button>
            </span>
          ) : isCompleted && onMarkDone ? (
            <span className="relative inline-flex items-center">
              <span
                className={cn(
                  'pointer-events-none transition-opacity group-hover:opacity-0',
                  isMarkingDone && 'opacity-0',
                )}
              >
                <PhaseChip status={issue.pipelineStatus} />
              </span>
              <Button
                variant="ghost"
                size="xs"
                className={cn(
                  ACTION_BADGE_CLASS,
                  DONE_ACTION_BADGE_CLASS,
                  isMarkingDone && 'opacity-100',
                )}
                title={isMarkingDone ? 'Marking as done' : 'Mark as done'}
                disabled={isMarkingDone}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isMarkingDone) return;
                  onMarkDone(issue);
                }}
              >
                {isMarkingDone ? (
                  <>
                    <Loader2 size={10} className="animate-spin" />
                    DONE
                  </>
                ) : (
                  'DONE'
                )}
              </Button>
            </span>
          ) : approvedAwaitingExecution ? (
            <PhaseChip
              status={issue.pipelineStatus}
              label="Waiting for slot"
              className="border-agent/25 bg-agent/10 text-agent"
            />
          ) : (
            <PhaseChip status={issue.pipelineStatus} />
          )}
        </div>
      </div>
    </IssueHoverCard>
  );
}

export const DraggableCard = memo(DraggableCardComponent);
DraggableCard.displayName = 'DraggableCard';

export function DragOverlayCard({
  issue,
  approvedAwaitingExecution = false,
}: {
  issue: GitHubIssueCacheRecord;
  approvedAwaitingExecution?: boolean;
}) {
  const priorityBadge = resolveIssuePriorityBadge(issue);
  const isCreating = isIssueCreating(issue);
  const referenceLabel = issueReferenceLabel(issue, isCreating);
  return (
    <div
      className={cn(
        'cursor-grabbing rounded-md border bg-secondary p-3 opacity-80 shadow-lg',
        dragOverlayBorderClass(issue.pipelineStatus, approvedAwaitingExecution),
      )}
    >
      <div className="font-mono text-[11px] text-muted">{referenceLabel}</div>
      <div className="mt-1 w-full min-w-0">
        <span className="line-clamp-2 text-[13px] font-medium leading-snug text-primary">
          {issue.title}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {priorityBadge ? (
          <Badge
            variant={priorityBadge.variant}
            className="px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
            title={priorityBadge.title}
          >
            {priorityBadge.label}
          </Badge>
        ) : null}
        {isCreating ? (
          <Badge className="inline-flex items-center gap-1 border-agent/25 bg-agent/10 px-1.5 py-px text-[10px] font-medium text-agent">
            <Loader2 size={10} className="animate-spin" />
            Creating
          </Badge>
        ) : (
          <PhaseChip
            status={issue.pipelineStatus}
            label={approvedAwaitingExecution ? 'Waiting for slot' : undefined}
            className={approvedAwaitingExecution ? 'border-agent/25 bg-agent/10 text-agent' : ''}
          />
        )}
        <div className="ml-auto h-5" />
      </div>
    </div>
  );
}
