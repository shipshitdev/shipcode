'use client';

import { useDroppable } from '@dnd-kit/core';
import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { Archive } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from '../primitives/button';
import { COLUMN_DOT_CLASS } from './constants';
import { DraggableCard } from './IssueCardParts';
import type {
  BoardColumn,
  ColumnKey,
  IssueApprovalBadge,
  IssuePhaseChip,
  PhaseSection,
} from './types';

interface DroppableColumnProps {
  id: string;
  columnKey: ColumnKey;
  label: string;
  issues: GitHubIssueCacheRecord[];
  droppable: boolean;
  readOnly?: boolean;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onStartPipeline?: (issue: GitHubIssueCacheRecord) => void;
  onOpenPullRequest?: (url: string) => void;
  selectedIssueNumber?: number;
  onArchiveAllDone?: () => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  issuePhaseChipById: Map<string, IssuePhaseChip | null>;
  issueRevisionLabelById: Map<string, string | null>;
  issueApprovalBadgeById: Map<string, IssueApprovalBadge | null>;
}

export function DroppableColumn({
  id,
  columnKey,
  label,
  issues,
  droppable,
  readOnly = false,
  onIssueClick,
  onStartPipeline,
  onOpenPullRequest,
  selectedIssueNumber,
  onArchiveAllDone,
  onArchiveIssue,
  issuePhaseChipById,
  issueRevisionLabelById,
  issueApprovalBadgeById,
}: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !droppable || readOnly });
  const hasIssues = issues.length > 0;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-0 max-w-[220px] min-w-[140px] flex-1 flex-col overflow-hidden rounded-md border border-border/40 bg-secondary transition-colors',
        isOver && droppable && 'bg-tertiary ring-2 ring-accent',
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary">
        <span className="flex items-center gap-1.5">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', COLUMN_DOT_CLASS[columnKey])} />
          {label}
        </span>
        <div className="flex items-center gap-1">
          {onArchiveAllDone && issues.length > 0 && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted/60 hover:bg-muted/10 hover:text-muted"
              title="Archive all done issues"
              onClick={onArchiveAllDone}
            >
              <Archive size={12} />
            </Button>
          )}
          <span
            className={cn(
              'min-w-[18px] rounded-full border border-transparent bg-tertiary px-1.5 py-px text-center text-[10px] font-medium',
              !hasIssues && 'text-muted/70',
              hasIssues && columnKey === 'done' && 'border-done/25 bg-done/15 text-done',
              hasIssues && columnKey !== 'done' && 'text-muted',
            )}
          >
            {issues.length}
          </span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5 supports-[scrollbar-gutter:stable]:[scrollbar-gutter:stable]">
        {issues.map((issue) => (
          <DraggableCard
            key={issue.id}
            issue={issue}
            phaseChip={issuePhaseChipById.get(issue.id) ?? null}
            revisionLabel={issueRevisionLabelById.get(issue.id) ?? null}
            approvalBadge={issueApprovalBadgeById.get(issue.id) ?? null}
            onClick={() => onIssueClick(issue)}
            onStartPipeline={onStartPipeline}
            onOpenPullRequest={onOpenPullRequest}
            isSelected={issue.issueNumber === selectedIssueNumber}
            onArchiveIssue={onArchiveIssue}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}

interface SectionBlockProps {
  columnKey: ColumnKey;
  section: PhaseSection;
  issues: GitHubIssueCacheRecord[];
  readOnly?: boolean;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onRerun?: (issue: GitHubIssueCacheRecord) => void;
  onCancel?: (issue: GitHubIssueCacheRecord) => void;
  onOpenPullRequest?: (url: string) => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  selectedIssueNumber?: number;
  rerunningId?: string | null;
  issuePhaseChipById: Map<string, IssuePhaseChip | null>;
  issueRevisionLabelById: Map<string, string | null>;
  issueApprovalBadgeById: Map<string, IssueApprovalBadge | null>;
}

function SectionBlock({
  columnKey,
  section,
  issues,
  readOnly = false,
  onIssueClick,
  onRerun,
  onCancel,
  onOpenPullRequest,
  onArchiveIssue,
  selectedIssueNumber,
  rerunningId,
  issuePhaseChipById,
  issueRevisionLabelById,
  issueApprovalBadgeById,
}: SectionBlockProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${columnKey}:${section.key}`,
    disabled: !section.droppable || readOnly,
  });
  const count = issues.length;
  const empty = count === 0;
  const tone: 'danger' | 'warning' | 'agent' | null =
    section.key === 'failed' && !empty
      ? 'danger'
      : section.key === 'awaiting' && !empty
        ? 'warning'
        : columnKey === 'agent' && !empty
          ? 'agent'
          : null;

  return (
    <div className="border-t border-border first:border-t-0">
      <div
        className={cn(
          'flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wide',
          empty && 'text-muted opacity-50',
          !empty && !tone && 'text-secondary',
          tone === 'agent' && 'text-agent',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
        )}
      >
        <span>{section.label}</span>
        <span
          className={cn(
            'min-w-[18px] rounded-full border border-transparent bg-tertiary px-1.5 py-px text-center text-[10px] font-medium',
            empty && 'text-muted/70',
            !empty && !tone && 'text-muted',
            tone === 'agent' && 'border-agent/25 bg-agent/15 text-agent',
            tone === 'danger' && 'border-danger/25 bg-danger/15 text-danger',
            tone === 'warning' && 'border-warning/25 bg-warning/15 text-warning',
          )}
        >
          {count}
        </span>
      </div>
      {!empty && (
        <div
          ref={section.droppable ? setNodeRef : undefined}
          className={cn(
            'flex flex-col gap-1 p-1.5 pt-0',
            section.droppable &&
              isOver &&
              'rounded-md border border-dashed border-accent bg-tertiary',
          )}
        >
          {issues.map((issue) => (
            <DraggableCard
              key={issue.id}
              issue={issue}
              phaseChip={issuePhaseChipById.get(issue.id) ?? null}
              revisionLabel={issueRevisionLabelById.get(issue.id) ?? null}
              approvalBadge={issueApprovalBadgeById.get(issue.id) ?? null}
              onClick={() => onIssueClick(issue)}
              onRerun={onRerun}
              onCancel={onCancel}
              onOpenPullRequest={onOpenPullRequest}
              isSelected={issue.issueNumber === selectedIssueNumber}
              isRerunning={issue.id === rerunningId}
              onArchiveIssue={columnKey === 'done' ? onArchiveIssue : undefined}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
      {empty && section.droppable && !readOnly && (
        <div
          ref={setNodeRef}
          className={cn(
            'mx-1.5 mb-1.5 min-h-[36px] rounded border border-dashed',
            isOver ? 'border-accent bg-tertiary' : 'border-border/50',
          )}
        />
      )}
    </div>
  );
}

interface StackedColumnProps {
  column: BoardColumn;
  issues: GitHubIssueCacheRecord[];
  readOnly?: boolean;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onRerun?: (issue: GitHubIssueCacheRecord) => void;
  onCancel?: (issue: GitHubIssueCacheRecord) => void;
  onOpenPullRequest?: (url: string) => void;
  onArchiveAllDone?: () => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  selectedIssueNumber?: number;
  rerunningId?: string | null;
  issuePhaseChipById: Map<string, IssuePhaseChip | null>;
  issueRevisionLabelById: Map<string, string | null>;
  issueApprovalBadgeById: Map<string, IssueApprovalBadge | null>;
}

export function StackedColumn({
  column,
  issues,
  readOnly = false,
  onIssueClick,
  onRerun,
  onCancel,
  onOpenPullRequest,
  onArchiveAllDone,
  onArchiveIssue,
  selectedIssueNumber,
  rerunningId,
  issuePhaseChipById,
  issueRevisionLabelById,
  issueApprovalBadgeById,
}: StackedColumnProps) {
  const columnIssues = issues.filter((issue) => column.statuses.includes(issue.pipelineStatus));
  const hasIssues = columnIssues.length > 0;

  return (
    <div className="flex min-h-0 min-w-[180px] max-w-[280px] flex-[1.3] flex-col overflow-hidden rounded-md border border-border/40 bg-secondary">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary">
        <span className="flex items-center gap-1.5">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', COLUMN_DOT_CLASS[column.key])} />
          {column.label}
        </span>
        <div className="flex items-center gap-1">
          {onArchiveAllDone && column.key === 'done' && columnIssues.length > 0 && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted/60 hover:bg-muted/10 hover:text-muted"
              title="Archive all done issues"
              onClick={onArchiveAllDone}
            >
              <Archive size={12} />
            </Button>
          )}
          <span
            className={cn(
              'min-w-[18px] rounded-full border border-transparent bg-tertiary px-1.5 py-px text-center text-[10px] font-medium',
              !hasIssues && 'text-muted/70',
              hasIssues && column.key === 'done' && 'border-done/25 bg-done/15 text-done',
              hasIssues && column.key !== 'done' && 'text-muted',
            )}
          >
            {columnIssues.length}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto supports-[scrollbar-gutter:stable]:[scrollbar-gutter:stable]">
        {(column.sections ?? []).map((section) => (
          <SectionBlock
            key={section.key}
            columnKey={column.key}
            section={section}
            issues={columnIssues.filter((issue) => section.statuses.includes(issue.pipelineStatus))}
            readOnly={readOnly}
            onIssueClick={onIssueClick}
            onRerun={onRerun}
            onCancel={onCancel}
            onOpenPullRequest={onOpenPullRequest}
            onArchiveIssue={onArchiveIssue}
            selectedIssueNumber={selectedIssueNumber}
            rerunningId={rerunningId}
            issuePhaseChipById={issuePhaseChipById}
            issueRevisionLabelById={issueRevisionLabelById}
            issueApprovalBadgeById={issueApprovalBadgeById}
          />
        ))}
      </div>
    </div>
  );
}
