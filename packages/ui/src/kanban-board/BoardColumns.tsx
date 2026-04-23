'use client';

import { useDroppable } from '@dnd-kit/core';
import { Archive, ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { GitHubIssueCacheRecord } from '../lib/shipcode';
import { cn } from '../lib/utils';
import { Button } from '../primitives/button';
import { COLUMN_DOT_CLASS } from './constants';
import { DraggableCard } from './IssueCardParts';
import type {
  BoardColumn,
  ColumnKey,
  IssueApprovalBadge,
  IssuePhaseChip,
  IssueRevisionBadge,
  PhaseSection,
  RowTone,
} from './types';
import {
  isApprovedAwaitingExecutionIssue,
  issueMatchesColumn,
  issueMatchesSection,
  sectionToneFor,
} from './utils';

const SECTION_HEADER_CLASS: Record<RowTone, string> = {
  default: 'border-border/60 bg-secondary/95 text-secondary',
  success: 'border-success/20 bg-success/[0.08] text-success',
  done: 'border-done/20 bg-done/[0.08] text-done',
  agent: 'border-agent/20 bg-agent/[0.08] text-agent',
  danger: 'border-danger/20 bg-danger/[0.08] text-danger',
  warning: 'border-warning/20 bg-warning/[0.08] text-warning',
};

const SECTION_COUNT_CLASS: Record<RowTone, string> = {
  default: 'border-border/60 bg-tertiary text-muted',
  success: 'border-success/20 bg-success/15 text-success',
  done: 'border-done/20 bg-done/15 text-done',
  agent: 'border-agent/20 bg-agent/15 text-agent',
  danger: 'border-danger/20 bg-danger/15 text-danger',
  warning: 'border-warning/20 bg-warning/15 text-warning',
};

const EMPTY_PHASE_CHIP_MAP = new Map<string, IssuePhaseChip | null>();
const EMPTY_REVISION_BADGE_MAP = new Map<string, IssueRevisionBadge | null>();
const EMPTY_APPROVAL_BADGE_MAP = new Map<string, IssueApprovalBadge | null>();
const EMPTY_APPROVED_AWAITING_EXECUTION = new Set<string>();

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
  issueRevisionBadgeById: Map<string, IssueRevisionBadge | null>;
  issueApprovalBadgeById: Map<string, IssueApprovalBadge | null>;
  approvedAwaitingExecutionIssueIds?: ReadonlySet<string>;
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
  issuePhaseChipById = EMPTY_PHASE_CHIP_MAP,
  issueRevisionBadgeById = EMPTY_REVISION_BADGE_MAP,
  issueApprovalBadgeById = EMPTY_APPROVAL_BADGE_MAP,
  approvedAwaitingExecutionIssueIds = EMPTY_APPROVED_AWAITING_EXECUTION,
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
            revisionBadge={issueRevisionBadgeById.get(issue.id) ?? null}
            approvalBadge={issueApprovalBadgeById.get(issue.id) ?? null}
            approvedAwaitingExecution={isApprovedAwaitingExecutionIssue(
              issue,
              approvedAwaitingExecutionIssueIds,
            )}
            onClick={onIssueClick}
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
  collapsed: boolean;
  onToggle: () => void;
  readOnly?: boolean;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onRerun?: (issue: GitHubIssueCacheRecord) => void;
  onCancel?: (issue: GitHubIssueCacheRecord) => void;
  onOpenPullRequest?: (url: string) => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  selectedIssueNumber?: number;
  rerunningId?: string | null;
  issuePhaseChipById: Map<string, IssuePhaseChip | null>;
  issueRevisionBadgeById: Map<string, IssueRevisionBadge | null>;
  issueApprovalBadgeById: Map<string, IssueApprovalBadge | null>;
  approvedAwaitingExecutionIssueIds?: ReadonlySet<string>;
}

function SectionBlock({
  columnKey,
  section,
  issues,
  collapsed,
  onToggle,
  readOnly = false,
  onIssueClick,
  onRerun,
  onCancel,
  onOpenPullRequest,
  onArchiveIssue,
  selectedIssueNumber,
  rerunningId,
  issuePhaseChipById = EMPTY_PHASE_CHIP_MAP,
  issueRevisionBadgeById = EMPTY_REVISION_BADGE_MAP,
  issueApprovalBadgeById = EMPTY_APPROVAL_BADGE_MAP,
  approvedAwaitingExecutionIssueIds = EMPTY_APPROVED_AWAITING_EXECUTION,
}: SectionBlockProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${columnKey}:${section.key}`,
    disabled: !section.droppable || readOnly,
  });
  const count = issues.length;
  const empty = count === 0;
  const tone = sectionToneFor(columnKey, section.key);

  return (
    <div
      ref={section.droppable ? setNodeRef : undefined}
      className={cn(
        'relative border-t border-border first:border-t-0',
        section.droppable && isOver && 'bg-tertiary/40',
      )}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        className={cn(
          'sticky top-0 z-10 flex w-full items-center justify-between gap-2 border-b border-transparent px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide backdrop-blur supports-[backdrop-filter]:bg-secondary/85',
          'transition-colors',
          SECTION_HEADER_CLASS[tone],
          empty && 'opacity-60',
          section.droppable && isOver && 'border-accent/50 bg-tertiary/95',
        )}
        onClick={onToggle}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span className="min-w-0 truncate">{section.label}</span>
        </span>
        <span
          className={cn(
            'min-w-[18px] rounded-full border px-1.5 py-px text-center text-[10px] font-medium',
            SECTION_COUNT_CLASS[tone],
            empty && 'opacity-75',
          )}
        >
          {count}
        </span>
      </button>
      {!empty && !collapsed && (
        <div
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
              revisionBadge={issueRevisionBadgeById.get(issue.id) ?? null}
              approvalBadge={issueApprovalBadgeById.get(issue.id) ?? null}
              approvedAwaitingExecution={isApprovedAwaitingExecutionIssue(
                issue,
                approvedAwaitingExecutionIssueIds,
              )}
              onClick={onIssueClick}
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
      {empty && section.droppable && !readOnly && !collapsed && (
        <div
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
  issueRevisionBadgeById: Map<string, IssueRevisionBadge | null>;
  issueApprovalBadgeById: Map<string, IssueApprovalBadge | null>;
  approvedAwaitingExecutionIssueIds?: ReadonlySet<string>;
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
  issuePhaseChipById = EMPTY_PHASE_CHIP_MAP,
  issueRevisionBadgeById = EMPTY_REVISION_BADGE_MAP,
  issueApprovalBadgeById = EMPTY_APPROVAL_BADGE_MAP,
  approvedAwaitingExecutionIssueIds = EMPTY_APPROVED_AWAITING_EXECUTION,
}: StackedColumnProps) {
  const columnIssues = useMemo(
    () =>
      issues.filter((issue) =>
        issueMatchesColumn(issue, column, approvedAwaitingExecutionIssueIds),
      ),
    [approvedAwaitingExecutionIssueIds, column, issues],
  );
  const sectionIssuesByKey = useMemo(
    () =>
      new Map(
        (column.sections ?? []).map((section) => [
          section.key,
          columnIssues.filter((issue) =>
            issueMatchesSection(issue, section, approvedAwaitingExecutionIssueIds),
          ),
        ]),
      ),
    [approvedAwaitingExecutionIssueIds, column.sections, columnIssues],
  );
  const hasIssues = columnIssues.length > 0;
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((current) => ({ ...current, [key]: !current[key] }));
  }, []);

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
            issues={sectionIssuesByKey.get(section.key) ?? []}
            collapsed={collapsedSections[section.key] ?? false}
            onToggle={() => toggleSection(section.key)}
            readOnly={readOnly}
            onIssueClick={onIssueClick}
            onRerun={onRerun}
            onCancel={onCancel}
            onOpenPullRequest={onOpenPullRequest}
            onArchiveIssue={onArchiveIssue}
            selectedIssueNumber={selectedIssueNumber}
            rerunningId={rerunningId}
            issuePhaseChipById={issuePhaseChipById}
            issueRevisionBadgeById={issueRevisionBadgeById}
            issueApprovalBadgeById={issueApprovalBadgeById}
            approvedAwaitingExecutionIssueIds={approvedAwaitingExecutionIssueIds}
          />
        ))}
      </div>
    </div>
  );
}
