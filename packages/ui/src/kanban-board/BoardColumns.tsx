'use client';

import { useDroppable } from '@dnd-kit/core';
import { Archive, ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { DraggableCard } from '@/kanban-board/IssueCardParts';
import type { GitHubIssueCacheRecord, IssueStalenessResult } from '@/lib/shipcode';
import { cn } from '@/lib/utils';
import { Button } from '@/primitives/button';
import { COLUMN_DOT_CLASS, COLUMN_SCROLLBAR_COLOR, COLUMN_TEXT_CLASS } from './constants';
import type {
  BoardColumn,
  ColumnKey,
  IssueApprovalBadge,
  IssuePhaseChip,
  IssuePriorityBadge,
  IssueRevisionBadge,
  PhaseSection,
  PlanStepSummary,
  RowTone,
} from './types';
import {
  isApprovedAwaitingExecutionIssue,
  issueMatchesColumn,
  issueMatchesSection,
  sectionToneFor,
} from './utils';

const SECTION_HEADER_CLASS: Record<RowTone, string> = {
  default: 'bg-secondary text-muted-foreground',
  success: 'bg-secondary text-muted-foreground',
  done: 'bg-secondary text-muted-foreground',
  agent: 'bg-secondary text-muted-foreground',
  danger: 'bg-secondary text-muted-foreground',
  warning: 'bg-secondary text-muted-foreground',
};

const SECTION_COUNT_CLASS: Record<RowTone, string> = {
  default: 'border-border/60 bg-tertiary text-muted-foreground',
  success: 'border-border/60 bg-tertiary text-muted-foreground',
  done: 'border-border/60 bg-tertiary text-muted-foreground',
  agent: 'border-border/60 bg-tertiary text-muted-foreground',
  danger: 'border-border/60 bg-tertiary text-muted-foreground',
  warning: 'border-border/60 bg-tertiary text-muted-foreground',
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
  compact?: boolean;
  issueHoverCards?: boolean;
  onFetchPlanSteps?: (threadId: string) => Promise<PlanStepSummary[] | null>;
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
  onArchiveAllDone: _onArchiveAllDone,
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
  compact = false,
  issueHoverCards = true,
  onFetchPlanSteps,
}: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !droppable || readOnly });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/40 bg-secondary transition-colors',
        compact ? 'min-w-0 max-w-none basis-0' : 'max-w-[300px] min-w-[240px]',
        isOver && droppable && 'bg-tertiary ring-2 ring-accent',
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-between border-b border-border px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide',
          COLUMN_TEXT_CLASS[columnKey],
        )}
      >
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
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
              COLUMN_TEXT_CLASS[columnKey],
            )}
          >
            {issues.length}
          </span>
        </div>
      </div>
      <div
        className="kanban-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5 supports-[scrollbar-gutter:stable]:[scrollbar-gutter:stable]"
        style={{ '--column-scrollbar': COLUMN_SCROLLBAR_COLOR[columnKey] } as React.CSSProperties}
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
            hoverCardEnabled={issueHoverCards}
            onFetchPlanSteps={onFetchPlanSteps}
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
  onPause?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onResume?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onCancel?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onOpenPullRequest?: (url: string) => void;
  onCopyBranchName?: (issue: GitHubIssueCacheRecord, branchName: string) => void;
  onMarkDone?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  onCreatePr?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onArchiveAllDone?: () => void;
  selectedIssueNumber?: number;
  rerunningId?: string | null;
  pausingId?: string | null;
  resumingId?: string | null;
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
  compact?: boolean;
  issueHoverCards?: boolean;
  onFetchPlanSteps?: (threadId: string) => Promise<PlanStepSummary[] | null>;
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
  onPause,
  onResume,
  onCancel,
  onOpenPullRequest,
  onCopyBranchName,
  onMarkDone,
  onArchiveIssue,
  onCreatePr,
  onArchiveAllDone,
  selectedIssueNumber,
  rerunningId,
  pausingId,
  resumingId,
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
  compact = false,
  issueHoverCards = true,
  onFetchPlanSteps,
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
        'border-t border-border first:border-t-0',
        section.droppable && isOver && 'bg-tertiary/40',
      )}
    >
      <div
        className={cn(
          'sticky top-0 z-20 flex w-full items-center justify-between gap-2 border-b border-transparent px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide',
          'transition-colors',
          compact ? 'bg-secondary text-secondary' : SECTION_HEADER_CLASS[tone],
          section.droppable && isOver && 'border-accent/50 bg-tertiary text-primary',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          aria-expanded={!collapsed}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 bg-transparent p-0 text-left text-[10px] font-semibold uppercase tracking-wide text-current hover:bg-transparent hover:text-current',
            empty && 'text-current/70',
          )}
          onClick={onToggle}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span className="min-w-0 truncate">{section.label}</span>
          </span>
        </Button>
        <div className="flex items-center gap-1">
          {onArchiveAllDone && section.key === 'closed' && !empty && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground/60 hover:bg-muted/10 hover:text-muted-foreground"
              title="Archive closed issues"
              onClick={onArchiveAllDone}
            >
              <Archive size={12} />
            </Button>
          )}
          <span
            className={cn(
              'min-w-[18px] rounded-full border px-1.5 py-px text-center text-[10px] font-medium',
              compact
                ? 'border-border/60 bg-tertiary text-muted-foreground'
                : SECTION_COUNT_CLASS[tone],
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
            'relative z-0 flex flex-col gap-1 p-1.5',
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
              onPause={onPause}
              onResume={onResume}
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
              isPausing={issue.id === pausingId}
              isResuming={issue.id === resumingId}
              isCancelling={issue.id === cancellingId}
              isMarkingDone={issue.id === markingDoneId}
              onArchiveIssue={columnKey === 'done' ? onArchiveIssue : undefined}
              onCreatePr={onCreatePr}
              readOnly={readOnly}
              isFlashing={flashingIssueIds?.has(issue.id) ?? false}
              hoverCardEnabled={issueHoverCards}
              onFetchPlanSteps={onFetchPlanSteps}
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
  onPause?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onResume?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onCancel?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onOpenPullRequest?: (url: string) => void;
  onCopyBranchName?: (issue: GitHubIssueCacheRecord, branchName: string) => void;
  onMarkDone?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onArchiveAllDone?: () => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  onCreatePr?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  selectedIssueNumber?: number;
  rerunningId?: string | null;
  pausingId?: string | null;
  resumingId?: string | null;
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
  compact?: boolean;
  issueHoverCards?: boolean;
  onFetchPlanSteps?: (threadId: string) => Promise<PlanStepSummary[] | null>;
}

export function StackedColumn({
  column,
  columnDotColor,
  issues,
  readOnly = false,
  onIssueClick,
  onRerun,
  onPause,
  onResume,
  onCancel,
  onOpenPullRequest,
  onCopyBranchName,
  onMarkDone,
  onArchiveAllDone,
  onArchiveIssue,
  onCreatePr,
  selectedIssueNumber,
  rerunningId,
  pausingId,
  resumingId,
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
  compact = false,
  issueHoverCards = true,
  onFetchPlanSteps,
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
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-md border border-border/40 bg-secondary',
        compact ? 'min-w-0 max-w-none flex-1 basis-0' : 'min-w-[280px] max-w-[360px] flex-[1.3]',
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-between border-b border-border px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide',
          COLUMN_TEXT_CLASS[column.key],
        )}
      >
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
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
              COLUMN_TEXT_CLASS[column.key],
            )}
          >
            {columnIssues.length}
          </span>
        </div>
      </div>
      <div
        className="kanban-scroll isolate min-h-0 flex-1 overflow-y-auto supports-[scrollbar-gutter:stable]:[scrollbar-gutter:stable]"
        style={{ '--column-scrollbar': COLUMN_SCROLLBAR_COLOR[column.key] } as React.CSSProperties}
      >
        {(column.sections ?? []).map((section) => (
          <SectionBlock
            key={section.key}
            columnKey={column.key}
            section={section}
            issues={sectionIssuesByKey.get(section.key)!}
            collapsed={collapsedSections[section.key] ?? false}
            onToggle={() => toggleSection(section.key)}
            readOnly={readOnly}
            onIssueClick={onIssueClick}
            onRerun={onRerun}
            onPause={onPause}
            onResume={onResume}
            onCancel={onCancel}
            onOpenPullRequest={onOpenPullRequest}
            onCopyBranchName={onCopyBranchName}
            onMarkDone={onMarkDone}
            onArchiveIssue={onArchiveIssue}
            onCreatePr={onCreatePr}
            onArchiveAllDone={section.key === 'closed' ? onArchiveAllDone : undefined}
            selectedIssueNumber={selectedIssueNumber}
            rerunningId={rerunningId}
            pausingId={pausingId}
            resumingId={resumingId}
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
            compact={compact}
            issueHoverCards={issueHoverCards}
            onFetchPlanSteps={onFetchPlanSteps}
          />
        ))}
      </div>
    </div>
  );
}
