'use client';

import { useDroppable } from '@dnd-kit/core';
import { Archive, ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { DraggableCard } from '@/kanban-board/IssueCardParts';
import type { GitHubIssueCacheRecord, IssueStalenessResult } from '@/lib/shipcode';
import { cn } from '@/lib/utils';
import { Button } from '@/primitives/button';
import { COLUMN_DOT_CLASS } from './constants';
import type {
  BoardColumn,
  ColumnKey,
  IssueApprovalBadge,
  IssuePhaseChip,
  IssuePriorityBadge,
  IssueRevisionBadge,
  PhaseSection,
  RowTone,
} from './types';
import {
  isApprovedAwaitingExecutionIssue,
  isAutomationIssue,
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
const EMPTY_PRIORITY_BADGE_MAP = new Map<string, IssuePriorityBadge | null>();
const EMPTY_STALENESS_MAP = new Map<string, IssueStalenessResult | null>();
const EMPTY_APPROVED_AWAITING_EXECUTION = new Set<string>();

interface DroppableColumnProps {
  id: string;
  columnKey: ColumnKey;
  columnDotColor?: string | null;
  label: string;
  issues: GitHubIssueCacheRecord[];
  droppable: boolean;
  readOnly?: boolean;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onStartPipeline?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onOpenPullRequest?: (url: string) => void;
  onCopyBranchName?: (issue: GitHubIssueCacheRecord, branchName: string) => void;
  selectedIssueNumber?: number;
  onArchiveAllDone?: () => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  onCreatePr?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  repoUrl?: string | null;
  issueBranchNameById?: Map<string, string>;
  branchCopyIssueId?: string | null;
  branchCopyStatus?: 'copied' | 'error' | null;
  focusedIssueId?: string | null;
  startingPipelineId?: string | null;
  issuePhaseChipById: Map<string, IssuePhaseChip | null>;
  issueRevisionBadgeById: Map<string, IssueRevisionBadge | null>;
  issueApprovalBadgeById: Map<string, IssueApprovalBadge | null>;
  issuePriorityBadgeById: Map<string, IssuePriorityBadge | null>;
  issueStalenessById?: Map<string, IssueStalenessResult | null>;
  approvedAwaitingExecutionIssueIds?: ReadonlySet<string>;
  flashingIssueIds?: ReadonlySet<string>;
}

export function DroppableColumn({
  id,
  columnKey,
  columnDotColor,
  label,
  issues,
  droppable,
  readOnly = false,
  onIssueClick,
  onStartPipeline,
  onOpenPullRequest,
  onCopyBranchName,
  selectedIssueNumber,
  onArchiveAllDone,
  onArchiveIssue,
  onCreatePr,
  repoUrl,
  issueBranchNameById,
  branchCopyIssueId,
  branchCopyStatus,
  focusedIssueId,
  startingPipelineId,
  issuePhaseChipById = EMPTY_PHASE_CHIP_MAP,
  issueRevisionBadgeById = EMPTY_REVISION_BADGE_MAP,
  issueApprovalBadgeById = EMPTY_APPROVAL_BADGE_MAP,
  issuePriorityBadgeById = EMPTY_PRIORITY_BADGE_MAP,
  issueStalenessById = EMPTY_STALENESS_MAP,
  approvedAwaitingExecutionIssueIds = EMPTY_APPROVED_AWAITING_EXECUTION,
  flashingIssueIds,
}: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !droppable || readOnly });
  const hasIssues = issues.length > 0;
  const hasArchivableIssues = issues.some((issue) => !isAutomationIssue(issue));

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-0 max-w-[300px] min-w-[240px] flex-1 flex-col overflow-hidden rounded-md border border-border/40 bg-secondary transition-colors',
        isOver && droppable && 'bg-tertiary ring-2 ring-accent',
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              !columnDotColor && COLUMN_DOT_CLASS[columnKey],
            )}
            style={columnDotColor ? { backgroundColor: columnDotColor } : undefined}
          />
          {label}
        </span>
        <div className="flex items-center gap-1">
          <span
            className={cn(
              'min-w-[18px] rounded-full border border-transparent bg-tertiary px-1.5 py-px text-center text-[10px] font-medium',
              !hasIssues && 'text-muted/70',
              hasIssues && 'text-muted',
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
            priorityBadge={issuePriorityBadgeById.get(issue.id) ?? null}
            staleness={issueStalenessById.get(issue.id) ?? null}
            approvedAwaitingExecution={isApprovedAwaitingExecutionIssue(
              issue,
              approvedAwaitingExecutionIssueIds,
            )}
            onClick={onIssueClick}
            onStartPipeline={onStartPipeline}
            onOpenPullRequest={onOpenPullRequest}
            onCopyBranchName={onCopyBranchName}
            issueGithubUrl={
              repoUrl && issue.issueNumber > 0 ? `${repoUrl}/issues/${issue.issueNumber}` : null
            }
            branchName={issueBranchNameById?.get(issue.id) ?? null}
            branchCopyState={branchCopyIssueId === issue.id ? branchCopyStatus : null}
            isSelected={issue.issueNumber === selectedIssueNumber}
            isKeyboardFocused={issue.id === focusedIssueId}
            isStartingPipeline={issue.id === startingPipelineId}
            onArchiveIssue={onArchiveIssue}
            onCreatePr={onCreatePr}
            readOnly={readOnly}
            isFlashing={flashingIssueIds?.has(issue.id) ?? false}
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
  onRerun?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onCancel?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onOpenPullRequest?: (url: string) => void;
  onCopyBranchName?: (issue: GitHubIssueCacheRecord, branchName: string) => void;
  onMarkDone?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  onCreatePr?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onArchiveAllDone?: () => void;
  selectedIssueNumber?: number;
  rerunningId?: string | null;
  cancellingId?: string | null;
  markingDoneId?: string | null;
  repoUrl?: string | null;
  issueBranchNameById?: Map<string, string>;
  branchCopyIssueId?: string | null;
  branchCopyStatus?: 'copied' | 'error' | null;
  focusedIssueId?: string | null;
  issuePhaseChipById: Map<string, IssuePhaseChip | null>;
  issueRevisionBadgeById: Map<string, IssueRevisionBadge | null>;
  issueApprovalBadgeById: Map<string, IssueApprovalBadge | null>;
  issuePriorityBadgeById: Map<string, IssuePriorityBadge | null>;
  issueStalenessById?: Map<string, IssueStalenessResult | null>;
  approvedAwaitingExecutionIssueIds?: ReadonlySet<string>;
  flashingIssueIds?: ReadonlySet<string>;
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
  onCopyBranchName,
  onMarkDone,
  onArchiveIssue,
  onCreatePr,
  onArchiveAllDone,
  selectedIssueNumber,
  rerunningId,
  cancellingId,
  markingDoneId,
  repoUrl,
  issueBranchNameById,
  branchCopyIssueId,
  branchCopyStatus,
  focusedIssueId,
  issuePhaseChipById = EMPTY_PHASE_CHIP_MAP,
  issueRevisionBadgeById = EMPTY_REVISION_BADGE_MAP,
  issueApprovalBadgeById = EMPTY_APPROVAL_BADGE_MAP,
  issuePriorityBadgeById = EMPTY_PRIORITY_BADGE_MAP,
  issueStalenessById = EMPTY_STALENESS_MAP,
  approvedAwaitingExecutionIssueIds = EMPTY_APPROVED_AWAITING_EXECUTION,
  flashingIssueIds,
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
      <div
        className={cn(
          'sticky top-0 z-10 flex w-full items-center justify-between gap-2 border-b border-transparent px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide backdrop-blur supports-[backdrop-filter]:bg-secondary/85',
          'transition-colors',
          SECTION_HEADER_CLASS[tone],
          empty && 'opacity-60',
          section.droppable && isOver && 'border-accent/50 bg-tertiary/95',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1.5 p-0 text-left text-[10px] font-semibold uppercase tracking-wide hover:bg-transparent"
          onClick={onToggle}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span className="min-w-0 truncate">{section.label}</span>
        </Button>
        <div className="flex items-center gap-1">
          {onArchiveAllDone && section.key === 'done' && !empty && (
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
              'min-w-[18px] rounded-full border px-1.5 py-px text-center text-[10px] font-medium',
              SECTION_COUNT_CLASS[tone],
              empty && 'opacity-75',
            )}
          >
            {count}
          </span>
        </div>
      </div>
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
              priorityBadge={issuePriorityBadgeById.get(issue.id) ?? null}
              staleness={issueStalenessById.get(issue.id) ?? null}
              approvedAwaitingExecution={isApprovedAwaitingExecutionIssue(
                issue,
                approvedAwaitingExecutionIssueIds,
              )}
              onClick={onIssueClick}
              onRerun={onRerun}
              onCancel={onCancel}
              onOpenPullRequest={onOpenPullRequest}
              onCopyBranchName={onCopyBranchName}
              onMarkDone={columnKey === 'done' ? onMarkDone : undefined}
              issueGithubUrl={
                repoUrl && issue.issueNumber > 0 ? `${repoUrl}/issues/${issue.issueNumber}` : null
              }
              branchName={issueBranchNameById?.get(issue.id) ?? null}
              branchCopyState={branchCopyIssueId === issue.id ? branchCopyStatus : null}
              isSelected={issue.issueNumber === selectedIssueNumber}
              isKeyboardFocused={issue.id === focusedIssueId}
              isRerunning={issue.id === rerunningId}
              isCancelling={issue.id === cancellingId}
              isMarkingDone={issue.id === markingDoneId}
              onArchiveIssue={columnKey === 'done' ? onArchiveIssue : undefined}
              onCreatePr={onCreatePr}
              readOnly={readOnly}
              isFlashing={flashingIssueIds?.has(issue.id) ?? false}
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
  columnDotColor?: string | null;
  issues: GitHubIssueCacheRecord[];
  readOnly?: boolean;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onRerun?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onCancel?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onOpenPullRequest?: (url: string) => void;
  onCopyBranchName?: (issue: GitHubIssueCacheRecord, branchName: string) => void;
  onMarkDone?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onArchiveAllDone?: () => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  onCreatePr?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  selectedIssueNumber?: number;
  rerunningId?: string | null;
  cancellingId?: string | null;
  markingDoneId?: string | null;
  repoUrl?: string | null;
  issueBranchNameById?: Map<string, string>;
  branchCopyIssueId?: string | null;
  branchCopyStatus?: 'copied' | 'error' | null;
  focusedIssueId?: string | null;
  issuePhaseChipById: Map<string, IssuePhaseChip | null>;
  issueRevisionBadgeById: Map<string, IssueRevisionBadge | null>;
  issueApprovalBadgeById: Map<string, IssueApprovalBadge | null>;
  issuePriorityBadgeById: Map<string, IssuePriorityBadge | null>;
  issueStalenessById?: Map<string, IssueStalenessResult | null>;
  approvedAwaitingExecutionIssueIds?: ReadonlySet<string>;
  flashingIssueIds?: ReadonlySet<string>;
}

export function StackedColumn({
  column,
  columnDotColor,
  issues,
  readOnly = false,
  onIssueClick,
  onRerun,
  onCancel,
  onOpenPullRequest,
  onCopyBranchName,
  onMarkDone,
  onArchiveAllDone,
  onArchiveIssue,
  onCreatePr,
  selectedIssueNumber,
  rerunningId,
  cancellingId,
  markingDoneId,
  repoUrl,
  issueBranchNameById,
  branchCopyIssueId,
  branchCopyStatus,
  focusedIssueId,
  issuePhaseChipById = EMPTY_PHASE_CHIP_MAP,
  issueRevisionBadgeById = EMPTY_REVISION_BADGE_MAP,
  issueApprovalBadgeById = EMPTY_APPROVAL_BADGE_MAP,
  issuePriorityBadgeById = EMPTY_PRIORITY_BADGE_MAP,
  issueStalenessById = EMPTY_STALENESS_MAP,
  approvedAwaitingExecutionIssueIds = EMPTY_APPROVED_AWAITING_EXECUTION,
  flashingIssueIds,
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
  const hasArchivableIssues = columnIssues.some((issue) => !isAutomationIssue(issue));
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  return (
    <div className="flex min-h-0 min-w-[280px] max-w-[360px] flex-[1.3] flex-col overflow-hidden rounded-md border border-border/40 bg-secondary">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              !columnDotColor && COLUMN_DOT_CLASS[column.key],
            )}
            style={columnDotColor ? { backgroundColor: columnDotColor } : undefined}
          />
          {column.label}
        </span>
        <div className="flex items-center gap-1">
          <span
            className={cn(
              'min-w-[18px] rounded-full border border-transparent bg-tertiary px-1.5 py-px text-center text-[10px] font-medium',
              !hasIssues && 'text-muted/70',
              hasIssues && 'text-muted',
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
            onCopyBranchName={onCopyBranchName}
            onMarkDone={onMarkDone}
            onArchiveIssue={onArchiveIssue}
            onCreatePr={onCreatePr}
            onArchiveAllDone={section.key === 'done' ? onArchiveAllDone : undefined}
            selectedIssueNumber={selectedIssueNumber}
            rerunningId={rerunningId}
            cancellingId={cancellingId}
            markingDoneId={markingDoneId}
            repoUrl={repoUrl}
            issueBranchNameById={issueBranchNameById}
            branchCopyIssueId={branchCopyIssueId}
            branchCopyStatus={branchCopyStatus}
            focusedIssueId={focusedIssueId}
            issuePhaseChipById={issuePhaseChipById}
            issueRevisionBadgeById={issueRevisionBadgeById}
            issueApprovalBadgeById={issueApprovalBadgeById}
            issuePriorityBadgeById={issuePriorityBadgeById}
            issueStalenessById={issueStalenessById}
            approvedAwaitingExecutionIssueIds={approvedAwaitingExecutionIssueIds}
            flashingIssueIds={flashingIssueIds}
          />
        ))}
      </div>
    </div>
  );
}
