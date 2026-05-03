'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cloneElement, isValidElement, useCallback, useRef, useState } from 'react';
import type { GitHubIssueCacheRecord } from '@/lib/shipcode';
import { formatElapsedDuration } from '@/lib/time';
import { cn } from '@/lib/utils';
import { PhaseChip } from '@/PhaseChip';
import { Badge } from '@/primitives/badge';
import { ACTIVE_STATUSES } from './constants';
import { resolveIssuePriorityBadge } from './utils';

const HOVER_DELAY_MS = 350;

interface IssueHoverCardProps {
  issue: GitHubIssueCacheRecord;
  disabled?: boolean;
  children: React.ReactNode;
}

export function IssueHoverCard({ issue, disabled = false, children }: IssueHoverCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const enterTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePointerEnter = useCallback(() => {
    if (disabled) return;
    enterTimeoutRef.current = setTimeout(() => setIsOpen(true), HOVER_DELAY_MS);
  }, [disabled]);

  const handlePointerLeave = useCallback(() => {
    if (enterTimeoutRef.current) {
      clearTimeout(enterTimeoutRef.current);
      enterTimeoutRef.current = null;
    }
    setIsOpen(false);
  }, []);

  const priorityBadge = resolveIssuePriorityBadge(issue);
  const agentLabels = issue.labels?.filter((l) => l.startsWith('agent:')) ?? [];
  const lastUpdate = issue.lastPhaseUpdate ? new Date(issue.lastPhaseUpdate).getTime() : null;
  const isActive = ACTIVE_STATUSES.includes(issue.pipelineStatus);
  const bodySnippet =
    issue.body
      ?.replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\n+/g, ' ')
      .trim()
      .slice(0, 200) ?? null;
  const anchorChild = isValidElement<{ onPointerEnter?: () => void; onPointerLeave?: () => void }>(
    children,
  )
    ? cloneElement(children, {
        onPointerEnter: handlePointerEnter,
        onPointerLeave: handlePointerLeave,
      })
    : children;

  return (
    <PopoverPrimitive.Root open={isOpen && !disabled}>
      <PopoverPrimitive.Anchor asChild>{anchorChild}</PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="right"
          sideOffset={8}
          align="start"
          className={cn(
            'z-50 w-72 rounded-lg border border-border bg-elevated p-3 shadow-xl',
            'animate-in fade-in-0 zoom-in-95 data-[side=right]:slide-in-from-left-2',
          )}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {/* Issue number + status */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-mono text-muted">#{issue.issueNumber}</span>
            <PhaseChip status={issue.pipelineStatus} />
          </div>

          {/* Title */}
          <h4 className="text-[13px] font-semibold text-primary leading-snug line-clamp-2 mb-1.5">
            {issue.title}
          </h4>

          {/* Body snippet */}
          {bodySnippet && (
            <p className="text-[11px] text-secondary leading-relaxed line-clamp-3 mb-2">
              {bodySnippet}
            </p>
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
                {label.replace('agent:', '')}
              </Badge>
            ))}
          </div>

          {/* Meta row: assignee + last activity */}
          <div className="flex items-center justify-between gap-2">
            {issue.assignee ? (
              <span className="text-[10px] text-muted truncate">@{issue.assignee}</span>
            ) : (
              <span />
            )}
            {lastUpdate && (
              <div className="text-[10px] text-muted shrink-0">
                {isActive ? 'Running' : 'Last activity'} {formatElapsedDuration(lastUpdate)} ago
              </div>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
