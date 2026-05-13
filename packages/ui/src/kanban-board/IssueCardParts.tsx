'use client';

import { useDraggable } from '@dnd-kit/core';
import {
  AlertTriangle,
  Archive,
  Check,
  Copy,
  GitPullRequest,
  Loader2,
  MoreVertical,
  Play,
  RefreshCw,
  Square,
  XCircle,
} from 'lucide-react';
import { memo } from 'react';
import { IssueHoverCard } from '@/kanban-board/IssueHoverCard';
import type {
  GitHubIssueCacheRecord,
  IssuePipelineStatus,
  IssueStalenessResult,
} from '@/lib/shipcode';
import { ISSUE_PIPELINE_STATUS, phaseToProgress } from '@/lib/shipcode';
import { cn } from '@/lib/utils';
import { Badge } from '@/primitives/badge';
import { Button } from '@/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/primitives/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/primitives/tooltip';
import { ACTIVE_STATUSES, DRAGGABLE_STATUSES } from './constants';
import type {
  IssueApprovalBadge,
  IssuePhaseChip,
  IssuePriorityBadge,
  IssueRevisionBadge,
} from './types';
import { isAutomationIssue, isIssueCreating, statusDotColorClass } from './utils';

const ISSUE_CARD_BASE_CLASS =
  'group relative flex shrink-0 flex-col overflow-hidden rounded-md border border-white/[0.04] bg-tertiary p-3 text-left transition-colors outline-none';

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

function issueCardToneClass({
  isCreating,
  isSelected,
  isCompleted,
  isClosed,
  isFailed,
}: {
  isCreating: boolean;
  isSelected?: boolean;
  isCompleted: boolean;
  isClosed: boolean;
  isFailed: boolean;
  isPaused: boolean;
  isAwaiting: boolean;
  isActive: boolean;
  isTodo: boolean;
  approvedAwaitingExecution: boolean;
}) {
  if (isCreating) return 'opacity-80';
  if (isCompleted) {
    return isSelected ? 'ring-1 ring-border-strong' : 'opacity-85 hover:opacity-90';
  }
  if (isClosed) {
    return isSelected ? 'ring-1 ring-border-strong' : 'opacity-70 hover:opacity-80';
  }
  if (isFailed) {
    return isSelected
      ? 'ring-1 ring-danger/40 border-danger/30'
      : 'border-danger/25 hover:border-danger/40';
  }
  if (isSelected) return 'ring-1 ring-border-strong';
  return 'hover:border-white/[0.08]';
}

function IssueProgressBar({
  status,
  isActive,
  isCompleted,
  approvedAwaitingExecution,
}: {
  status: IssuePipelineStatus;
  isActive: boolean;
  isCompleted: boolean;
  approvedAwaitingExecution: boolean;
}) {
  if (
    status === ISSUE_PIPELINE_STATUS.todo ||
    status === ISSUE_PIPELINE_STATUS.queued ||
    status === ISSUE_PIPELINE_STATUS.failed ||
    status === ISSUE_PIPELINE_STATUS.closed
  ) {
    return null;
  }

  const trackClass = isCompleted ? 'bg-success/15' : 'bg-agent/15';
  const fillClass = isCompleted
    ? 'bg-success'
    : approvedAwaitingExecution
      ? 'bg-agent'
      : status === ISSUE_PIPELINE_STATUS.approval ||
          status === ISSUE_PIPELINE_STATUS.clarifying ||
          status === ISSUE_PIPELINE_STATUS.paused
        ? 'bg-warning'
        : 'bg-agent';

  return (
    <div
      className={cn(
        'absolute right-0 bottom-0 left-0 z-10 h-[3px] overflow-hidden rounded-b-md',
        trackClass,
      )}
    >
      <div
        className={cn('absolute h-full transition-[width] duration-700', fillClass)}
        style={{ width: `${phaseToProgress(status)}%` }}
      />
      {isActive && (
        <span className="absolute inset-0 animate-slide-progress bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      )}
    </div>
  );
}

export function StalenessDot({
  staleness,
  className,
}: {
  staleness?: IssueStalenessResult | null;
  className?: string;
}) {
  if (!staleness) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-staleness-dot="true"
          role="img"
          aria-label={`Stale: ${staleness.title}`}
          className={cn(
            'inline-flex size-4 shrink-0 items-center justify-center text-danger',
            className,
          )}
        >
          <AlertTriangle size={14} className="drop-shadow-[0_0_2px_rgba(239,68,68,0.3)]" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px]">
        {staleness.title}
      </TooltipContent>
    </Tooltip>
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
  onPause?: (issue: GitHubIssueCacheRecord) => void;
  onResume?: (issue: GitHubIssueCacheRecord) => void;
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
  isPausing?: boolean;
  isResuming?: boolean;
  isCancelling?: boolean;
  isMarkingDone?: boolean;
  isFlashing?: boolean;
  hoverCardEnabled?: boolean;
  onFetchPlanSteps?: (threadId: string) => Promise<import('./types').PlanStepSummary[] | null>;
}

function useDraggableCardView({
  issue,
  phaseChip,
  staleness,
  approvedAwaitingExecution = false,
  readOnly = false,
  onClick,
  onRerun,
  onPause,
  onResume,
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
  isStartingPipeline,
  isRerunning,
  isCancelling,
  isFlashing = false,
  hoverCardEnabled = true,
  onFetchPlanSteps,
}: DraggableCardProps) {
  const isCreating = isIssueCreating(issue);
  const isAutomation = isAutomationIssue(issue);
  const presentationStatus = issue.pipelineStatus;
  const referenceLabel = issueReferenceLabel(issue, isCreating);
  const draggable =
    !readOnly &&
    !isCreating &&
    DRAGGABLE_STATUSES.includes(presentationStatus) &&
    (!isAutomation || presentationStatus === ISSUE_PIPELINE_STATUS.completed);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
    data: issue,
    disabled: !draggable,
  });

  const isFailed = presentationStatus === ISSUE_PIPELINE_STATUS.failed;
  const isClarifying = presentationStatus === ISSUE_PIPELINE_STATUS.clarifying;
  const isPaused = presentationStatus === ISSUE_PIPELINE_STATUS.paused;
  const isApproval =
    presentationStatus === ISSUE_PIPELINE_STATUS.approval && !approvedAwaitingExecution;
  const isAwaiting = isApproval || isClarifying;
  const isActive = ACTIVE_STATUSES.includes(presentationStatus);
  const isTodo = presentationStatus === ISSUE_PIPELINE_STATUS.todo;
  const isCompleted = presentationStatus === ISSUE_PIPELINE_STATUS.completed;
  const isClosed = presentationStatus === ISSUE_PIPELINE_STATUS.closed;
  const linkedPrLabel = issue.linkedPrNumber ? `PR #${issue.linkedPrNumber}` : null;
  const hasMenuItems =
    Boolean(branchName && onCopyBranchName && !isAutomation) ||
    Boolean(isPaused && onResume) ||
    Boolean(isActive && onCancel) ||
    Boolean(isCompleted && onCreatePr && !issue.linkedPrNumber) ||
    Boolean((isCompleted || isFailed) && onMarkDone) ||
    Boolean(isClosed && onArchiveIssue && !isAutomation);

  return (
    <IssueHoverCard
      issue={issue}
      phaseChip={phaseChip}
      disabled={!hoverCardEnabled || isDragging || isCreating}
      onFetchPlanSteps={onFetchPlanSteps}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: The card contains nested action buttons, so it cannot be a semantic button. */}
      <div
        ref={setNodeRef}
        className={cn(
          ISSUE_CARD_BASE_CLASS,
          draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
          issueCardToneClass({
            isCreating,
            isSelected,
            isCompleted,
            isClosed,
            isFailed,
            isPaused,
            isAwaiting,
            isActive,
            isTodo,
            approvedAwaitingExecution,
          }),
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
            <span className="absolute inset-0 animate-slide-progress-card bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
          </div>
        )}
        <IssueProgressBar
          status={presentationStatus}
          isActive={isActive}
          isCompleted={isCompleted}
          approvedAwaitingExecution={approvedAwaitingExecution}
        />
        <div className="relative flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {issueGithubUrl &&
            !isCreating &&
            !isAutomation &&
            !issue.isQuickMode &&
            onOpenPullRequest ? (
              <Button
                variant="ghost"
                size="xs"
                className="h-auto shrink-0 p-0 font-mono text-[11px] text-muted-foreground hover:bg-transparent hover:text-primary hover:underline"
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
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
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
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              statusDotColorClass(presentationStatus, approvedAwaitingExecution),
            )}
            aria-hidden="true"
          />
        </div>
        <div className="relative z-10 mt-1 w-full min-w-0">
          <span className="line-clamp-2 text-[13px] font-medium leading-snug text-primary">
            {issue.title}
          </span>
        </div>
        <div className="relative z-10 mt-1.5 flex items-center gap-1.5">
          {isTodo && onStartPipeline && !isAutomation && !readOnly && (
            <Button
              variant="ghost"
              size="xs"
              className="h-6 gap-1 rounded border border-agent/30 bg-agent/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-agent hover:border-agent/50 hover:bg-agent/20 hover:text-agent"
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
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Play size={10} />
              )}
              {isStartingPipeline ? 'Starting' : 'Start'}
            </Button>
          )}
          {isFailed && onRerun && !readOnly && (
            <Button
              variant="ghost"
              size="xs"
              className="h-6 gap-1 rounded border border-danger/30 bg-danger/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-danger hover:border-danger/50 hover:bg-danger/20 hover:text-danger"
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
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <RefreshCw size={10} />
              )}
              {isRerunning ? 'Retrying' : 'Retry'}
            </Button>
          )}
          {isActive && onCancel && !readOnly && (
            <Button
              variant="ghost"
              size="xs"
              className="h-6 gap-1 rounded border border-danger/30 bg-danger/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-danger hover:border-danger/50 hover:bg-danger/20 hover:text-danger"
              title={isCancelling ? 'Cancelling' : 'Cancel pipeline'}
              disabled={isCancelling}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                if (isCancelling) return;
                onCancel(issue);
              }}
            >
              {isCancelling ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <XCircle size={10} />
              )}
              {isCancelling ? 'Cancelling' : 'Cancel'}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1">
            {!isFailed && <StalenessDot staleness={staleness} />}
            {!isCreating && !readOnly && hasMenuItems && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted/10 hover:text-primary group-hover:opacity-100"
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
                  {isActive && onPause && (
                    <DropdownMenuItem onClick={() => onPause(issue)}>
                      <Square size={14} />
                      Pause
                    </DropdownMenuItem>
                  )}
                  {isPaused && onResume && (
                    <DropdownMenuItem onClick={() => onResume(issue)}>
                      <Play size={14} />
                      Resume
                    </DropdownMenuItem>
                  )}
                  {isActive && onCancel && (
                    <DropdownMenuItem
                      className="text-danger focus:text-danger"
                      onClick={() => onCancel(issue)}
                    >
                      <XCircle size={14} />
                      Cancel
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
                      Close Issue
                    </DropdownMenuItem>
                  )}
                  {isClosed && onArchiveIssue && !isAutomation && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-muted-foreground focus:text-muted-foreground"
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
        </div>
      </div>
    </IssueHoverCard>
  );
}

function DraggableCardComponent(props: DraggableCardProps) {
  return useDraggableCardView(props);
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
  const isCreating = isIssueCreating(issue);
  const presentationStatus = issue.pipelineStatus;
  const referenceLabel = issueReferenceLabel(issue, isCreating);
  return (
    <div className="cursor-grabbing rounded-md border border-white/[0.04] bg-secondary p-3 opacity-80 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{referenceLabel}</span>
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            statusDotColorClass(presentationStatus, approvedAwaitingExecution),
          )}
          aria-hidden="true"
        />
      </div>
      <div className="mt-1 w-full min-w-0">
        <span className="line-clamp-2 text-[13px] font-medium leading-snug text-primary">
          {issue.title}
        </span>
      </div>
    </div>
  );
}
