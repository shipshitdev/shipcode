'use client';

import { useDraggable } from '@dnd-kit/core';
import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { phaseToProgress } from '@shipcode/shared';
import { Archive } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MODEL_DISPLAY } from '../lib/model-display';
import { cn } from '../lib/utils';
import { PhaseChip } from '../PhaseChip';
import { Badge } from '../primitives/badge';
import { Button } from '../primitives/button';
import { ACTIVE_STATUSES, DRAGGABLE_STATUSES, PHASE_ELAPSED_STATUSES } from './constants';
import type { IssuePhaseChip } from './types';
import { dragOverlayBorderClass, formatPhaseElapsed } from './utils';

function PhaseElapsed({ since }: { since: number }) {
  const [label, setLabel] = useState(() => formatPhaseElapsed(since));

  useEffect(() => {
    setLabel(formatPhaseElapsed(since));
    const id = setInterval(() => setLabel(formatPhaseElapsed(since)), 1000);
    return () => clearInterval(id);
  }, [since]);

  return <span className="font-mono tabular-nums text-[10px] text-muted">{label}</span>;
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

interface DraggableCardProps {
  issue: GitHubIssueCacheRecord;
  phaseChip?: IssuePhaseChip | null;
  readOnly?: boolean;
  onClick: () => void;
  onRerun?: (issue: GitHubIssueCacheRecord) => void;
  onCancel?: (issue: GitHubIssueCacheRecord) => void;
  onStartPipeline?: (issue: GitHubIssueCacheRecord) => void;
  onOpenPullRequest?: (url: string) => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  isSelected?: boolean;
  isRerunning?: boolean;
}

export function DraggableCard({
  issue,
  phaseChip,
  readOnly = false,
  onClick,
  onRerun,
  onCancel,
  onStartPipeline,
  onOpenPullRequest,
  onArchiveIssue,
  isSelected,
  isRerunning,
}: DraggableCardProps) {
  const draggable = !readOnly && DRAGGABLE_STATUSES.includes(issue.pipelineStatus);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
    data: issue,
    disabled: !draggable,
  });

  const isFailed = issue.pipelineStatus === 'failed';
  const isAwaiting = issue.pipelineStatus === 'awaiting_approval';
  const isActive = ACTIVE_STATUSES.includes(issue.pipelineStatus);
  const isTodo = issue.pipelineStatus === 'todo';
  const isCompleted = issue.pipelineStatus === 'completed';
  const isDone = issue.pipelineStatus === 'done';
  const isDoneState = isCompleted || isDone;
  const showPhaseElapsed =
    PHASE_ELAPSED_STATUSES.includes(issue.pipelineStatus) && !!issue.lastPhaseUpdate;
  const phaseSince =
    showPhaseElapsed && issue.lastPhaseUpdate ? new Date(issue.lastPhaseUpdate).getTime() : 0;
  const linkedPrLabel = issue.linkedPrNumber ? `PR #${issue.linkedPrNumber}` : null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dnd-kit's useDraggable provides keyboard accessibility via listeners/attributes spread below
    // biome-ignore lint/a11y/useKeyWithClickEvents: dnd-kit KeyboardSensor handles activation; the onClick only forwards selection on pointer click
    <div
      ref={setNodeRef}
      className={cn(
        'group relative overflow-hidden rounded-md border bg-elevated p-2 transition-colors outline-none',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
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
            ? 'border-danger bg-danger/[0.07]'
            : 'border-danger/40 bg-danger/[0.04] hover:border-danger/60'),
        isAwaiting &&
          (isSelected
            ? 'border-warning bg-warning/[0.07]'
            : 'border-warning/30 bg-warning/[0.03] hover:border-warning/50'),
        isActive && 'shadow-[0_0_12px_rgba(56,189,248,0.18)]',
        isActive &&
          (isSelected
            ? 'border-agent/70 bg-agent/[0.06]'
            : 'border-agent/40 bg-agent/[0.03] hover:border-agent/60'),
        isDragging && 'opacity-50',
      )}
      {...listeners}
      {...attributes}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {isActive && (
        <div
          aria-hidden="true"
          className="issue-card-active-bg pointer-events-none absolute inset-0 rounded-[inherit]"
        >
          <span className="absolute inset-0 bg-gradient-to-br from-agent/[0.05] via-agent/[0.02] to-transparent" />
          <span className="absolute inset-0 animate-slide-progress-card bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
        </div>
      )}
      {issue.pipelineStatus !== 'todo' &&
        issue.pipelineStatus !== 'queued' &&
        issue.pipelineStatus !== 'failed' && (
          <div
            className={cn(
              'absolute right-0 bottom-0 left-0 z-10 h-[3px] overflow-hidden rounded-b-md',
              isCompleted ? 'bg-success/15' : isDone ? 'bg-done/15' : 'bg-agent/15',
            )}
          >
            <div
              className={cn(
                'absolute h-full transition-[width] duration-700',
                isCompleted
                  ? 'bg-success'
                  : isDone
                    ? 'bg-done'
                    : issue.pipelineStatus === 'awaiting_approval'
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
      {isDoneState && onArchiveIssue && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute top-1.5 right-1.5 z-10 text-muted/60 opacity-0 transition-opacity hover:bg-muted/10 hover:text-muted group-hover:opacity-100"
          title="Archive issue"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onArchiveIssue(issue);
          }}
        >
          <Archive size={14} />
        </Button>
      )}
      <div className="relative z-10 mb-0.5 flex items-center justify-between gap-2 text-left">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 font-mono text-[11px] text-secondary">
            #{issue.issueNumber}
          </span>
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
          <span className="flex items-center gap-1.5">
            <span className="font-mono tabular-nums text-[10px] text-muted">
              {phaseToProgress(issue.pipelineStatus)}%
            </span>
            <PhaseElapsed since={phaseSince} />
          </span>
        )}
      </div>
      <div className="relative z-10 line-clamp-2 text-left text-xs font-medium leading-snug text-primary">
        {issue.title}
      </div>
      <div className="relative z-10 mt-1 flex flex-wrap items-center gap-1 text-left">
        {phaseChip && isActive && (
          <Badge
            variant="default"
            className="px-1.5 py-px text-[10px] font-medium normal-case tracking-normal"
            title={`${phaseChip.phase} model ${phaseChip.model}${
              phaseChip.effort ? ` (${phaseChip.effort})` : ''
            }`}
          >
            {MODEL_DISPLAY[phaseChip.model] ?? phaseChip.model}
            {phaseChip.effort ? ` · ${phaseChip.effort}` : ''}
          </Badge>
        )}
        {issue.labels
          .filter((label) => !readOnly && label.startsWith('agent:'))
          .map((label) => (
            <Badge key={label} variant="accent" className="px-1.5 py-px text-[10px] font-medium">
              {label}
            </Badge>
          ))}
        <IssueExternalBlockers issue={issue} />
        {readOnly ? (
          <PhaseChip status={issue.pipelineStatus} />
        ) : isTodo && onStartPipeline ? (
          <span className="relative inline-flex items-center">
            <span className="pointer-events-none transition-opacity group-hover:opacity-0">
              <PhaseChip status={issue.pipelineStatus} />
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="absolute inset-0 h-auto rounded px-1.5 py-0.5 text-[10px] font-medium text-agent/70 opacity-0 transition-opacity hover:bg-agent/10 hover:text-agent group-hover:opacity-100"
              title="Start planning"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onStartPipeline(issue);
              }}
            >
              PLAN
            </Button>
          </span>
        ) : isActive && onCancel ? (
          <span className="relative inline-flex items-center">
            <span className="pointer-events-none transition-opacity group-hover:opacity-0">
              <PhaseChip status={issue.pipelineStatus} />
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="absolute inset-0 h-auto rounded px-1.5 py-0.5 text-[10px] font-medium text-danger/70 opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
              title="Cancel pipeline"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onCancel(issue);
              }}
            >
              CANCEL
            </Button>
          </span>
        ) : isFailed && onRerun ? (
          <span className="relative inline-flex items-center">
            <span className="pointer-events-none transition-opacity group-hover:opacity-0">
              <PhaseChip status={issue.pipelineStatus} />
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="absolute inset-0 h-auto rounded px-1.5 py-0.5 text-[10px] font-medium text-danger/70 opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger disabled:opacity-60 group-hover:opacity-100"
              title="Retry pipeline"
              disabled={isRerunning}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onRerun(issue);
              }}
            >
              RETRY
            </Button>
          </span>
        ) : (
          <PhaseChip status={issue.pipelineStatus} />
        )}
        {!readOnly && (
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              className={cn(
                'h-5 px-1.5 text-[10px] font-medium opacity-0 transition-all group-hover:opacity-100',
                isFailed
                  ? 'text-danger/60 hover:bg-danger/10 hover:text-danger'
                  : isAwaiting
                    ? 'text-warning/60 hover:bg-warning/10 hover:text-warning'
                    : isActive
                      ? 'text-agent/60 hover:bg-agent/10 hover:text-agent'
                      : 'text-muted hover:bg-border/20 hover:text-primary',
              )}
              title="Open issue detail"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onClick();
              }}
            >
              View
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function DragOverlayCard({ issue }: { issue: GitHubIssueCacheRecord }) {
  return (
    <div
      className={cn(
        'cursor-grabbing rounded-md border bg-secondary p-2 opacity-80 shadow-lg',
        dragOverlayBorderClass(issue.pipelineStatus),
      )}
    >
      <div className="mb-0.5 font-mono text-[11px] text-muted">#{issue.issueNumber}</div>
      <div className="line-clamp-2 text-xs leading-snug text-primary">{issue.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <PhaseChip status={issue.pipelineStatus} />
        <div className="ml-auto h-5" />
      </div>
    </div>
  );
}
