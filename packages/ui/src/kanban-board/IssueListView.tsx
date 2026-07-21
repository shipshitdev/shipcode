'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Archive, ChevronDown, ChevronRight, Loader2, Lock, Maximize2, User } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { IssueExternalBlockers, StalenessDot } from '@/kanban-board/IssueCardParts';
import {
  type GitHubIssueCacheRecord,
  ISSUE_PIPELINE_STATUS,
  type IssueStalenessResult,
} from '@/lib/shipcode';
import { cn } from '@/lib/utils';
import { Badge } from '@/primitives/badge';
import { Button } from '@/primitives/button';
import {
  ACTIVE_STATUSES,
  COLUMNS,
  DRAGGABLE_STATUSES,
  LIST_COLUMN_DROP_ID,
  LIST_COLUMN_LABEL,
} from './constants';
import { ColumnHeader } from './ColumnHeader';
import { StatusCircleIcon } from './StatusCircleIcon';
import type {
  ColumnKey,
  IssueApprovalBadge,
  IssuePriorityBadge,
  IssueRevisionBadge,
  PhaseSection,
} from './types';
import {
  formatDate,
  isApprovedAwaitingExecutionIssue,
  isAutomationIssue,
  isIssueCreating,
  issueMatchesColumn,
  issueMatchesSection,
  issueReferenceLabel,
  rowToneFor,
  sectionToneFor,
  statusDotFill,
} from './utils';

const EMPTY_STALENESS_MAP = new Map<string, IssueStalenessResult | null>();
const EMPTY_APPROVED_AWAITING_EXECUTION = new Set<string>();

interface DraggableListRowProps {
  issue: GitHubIssueCacheRecord;
  revisionBadge?: IssueRevisionBadge | null;
  approvalBadge?: IssueApprovalBadge | null;
  priorityBadge?: IssuePriorityBadge | null;
  staleness?: IssueStalenessResult | null;
  repoUrl?: string | null;
  selectedIssueNumber?: number;
  activeId: string | null;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onOpenPullRequest?: (url: string) => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  approvedAwaitingExecution?: boolean;
}

function DraggableListRow({
  issue,
  revisionBadge,
  approvalBadge,
  priorityBadge,
  staleness,
  repoUrl,
  selectedIssueNumber,
  activeId,
  onIssueClick,
  onOpenPullRequest,
  onArchiveIssue,
  approvedAwaitingExecution = false,
}: DraggableListRowProps) {
  const presentationStatus = issue.pipelineStatus;
  const isClosed = presentationStatus === ISSUE_PIPELINE_STATUS.closed;
  const isCreating = isIssueCreating(issue);
  const isAutomation = isAutomationIssue(issue);
  const referenceLabel = issueReferenceLabel(issue, isCreating);
  const isDraggable =
    !isCreating &&
    DRAGGABLE_STATUSES.includes(presentationStatus) &&
    (!isAutomation || presentationStatus === ISSUE_PIPELINE_STATUS.completed);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
    data: issue,
    disabled: !isDraggable,
  });
  const isSelected = selectedIssueNumber === issue.issueNumber;
  const tone = rowToneFor(presentationStatus, approvedAwaitingExecution);
  const isActive = ACTIVE_STATUSES.includes(presentationStatus);

  return (
    // biome-ignore lint/a11y/useSemanticElements: The row contains nested action buttons, so it cannot be a semantic button.
    <div
      ref={setNodeRef}
      className={cn(
        'group flex w-full items-center gap-3 rounded-md border-l-2 pl-3 pr-3 py-2 text-left text-sm transition-colors',
        tone === 'default' &&
          (isSelected
            ? 'border-transparent bg-accent/10 text-primary'
            : 'border-transparent text-primary hover:bg-secondary'),
        tone === 'success' &&
          (isSelected
            ? 'border-success bg-success/[0.08] text-primary'
            : 'border-success/60 bg-success/[0.035] text-primary hover:bg-success/[0.055]'),
        tone === 'done' &&
          (isSelected
            ? 'border-done bg-done/[0.09] text-primary'
            : 'border-done/55 bg-done/[0.045] text-primary hover:bg-done/[0.06]'),
        tone === 'agent' &&
          (isSelected
            ? 'border-agent bg-agent/[0.08] text-primary'
            : 'border-agent/60 bg-agent/[0.03] text-primary hover:bg-agent/[0.06]'),
        tone === 'danger' &&
          (isSelected
            ? 'border-danger bg-[color-mix(in_srgb,var(--danger)_10%,var(--bg-tertiary))] text-primary'
            : 'border-danger/55 bg-[color-mix(in_srgb,var(--danger)_6%,var(--bg-tertiary))] text-primary hover:bg-[color-mix(in_srgb,var(--danger)_10%,var(--bg-tertiary))]'),
        tone === 'warning' &&
          (isSelected
            ? 'border-warning bg-warning/[0.08] text-primary'
            : 'border-warning/60 bg-warning/[0.03] text-primary hover:bg-warning/[0.06]'),
        isDragging && 'opacity-40',
        isDraggable ? 'cursor-grab' : 'cursor-default',
        isCreating && 'opacity-80',
        activeId && activeId !== issue.id && 'pointer-events-none',
      )}
      onClick={(event) => {
        if (event.defaultPrevented || isDragging || isCreating) return;
        onIssueClick(issue);
      }}
      {...(isDraggable ? { ...attributes, ...listeners } : {})}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.currentTarget !== event.target) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (isCreating) return;
        onIssueClick(issue);
      }}
    >
      {isActive ? (
        <span className="relative flex size-2 shrink-0 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-agent opacity-60" />
          <StatusCircleIcon fill={0.5} className="relative text-agent" size={8} />
        </span>
      ) : (
        <StatusCircleIcon
          fill={statusDotFill(presentationStatus)}
          className={cn(
            tone === 'success' && 'text-success',
            tone === 'done' && 'text-done',
            tone === 'danger' && 'text-danger',
            tone === 'warning' && 'text-warning',
            tone === 'agent' && 'text-agent',
            tone === 'default' && 'text-muted-foreground/40',
          )}
          size={8}
        />
      )}
      <StalenessDot staleness={staleness} className="size-2" />
      <div className="flex shrink-0 items-center gap-1.5">
        {repoUrl && issue.issueNumber > 0 && !isCreating && !isAutomation && onOpenPullRequest ? (
          <Button
            variant="ghost"
            size="xs"
            className="h-auto p-0 font-mono text-xs text-secondary hover:bg-transparent hover:text-primary hover:underline"
            title="Open issue on GitHub"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onOpenPullRequest(`${repoUrl}/issues/${issue.issueNumber}`);
            }}
          >
            {referenceLabel}
          </Button>
        ) : (
          <span className="font-mono text-xs text-secondary">{referenceLabel}</span>
        )}
        {issue.linkedPrNumber &&
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
              PR #{issue.linkedPrNumber}
            </Button>
          ) : (
            <Badge variant="done" className="px-1.5 py-px text-[10px] font-medium">
              PR #{issue.linkedPrNumber}
            </Badge>
          ))}
      </div>
      <span className="flex-1 truncate">{issue.title}</span>
      <span className="flex shrink-0 items-center gap-1">
        {priorityBadge ? (
          <Badge
            variant={priorityBadge.variant}
            className="px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
            title={priorityBadge.title}
          >
            {priorityBadge.label}
          </Badge>
        ) : null}
        <IssueExternalBlockers issue={issue} />
        {revisionBadge ? (
          <Badge
            variant={revisionBadge.variant}
            className="px-1.5 py-px text-[10px] font-medium"
            title={revisionBadge.title}
          >
            {revisionBadge.label}
          </Badge>
        ) : null}
        {isCreating ? (
          <Badge className="inline-flex items-center gap-1 border-agent/25 bg-agent/10 px-1.5 py-px text-[10px] font-medium text-agent">
            <Loader2 size={10} className="animate-spin" />
            Creating
            <Lock size={10} />
          </Badge>
        ) : approvedAwaitingExecution ? (
          <>
            <Badge variant="success" className="px-1.5 py-px text-[10px] font-medium">
              Approved
            </Badge>
            <Badge className="border-agent/25 bg-agent/10 px-1.5 py-px text-[10px] font-medium text-agent">
              Waiting for slot
            </Badge>
          </>
        ) : approvalBadge ? (
          <Badge
            variant="warning"
            className="px-1.5 py-px text-[10px] font-medium"
            title={approvalBadge.title}
          >
            {approvalBadge.label}
          </Badge>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs text-secondary">
        <User size={11} className="text-muted-foreground" />
        {issue.assignee ?? '—'}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatDate(issue.fetchedAt)}</span>
      <span className="flex shrink-0 items-center gap-1">
        {!isCreating && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground/70 hover:bg-muted/10 hover:text-primary"
            title="Open issue detail"
            aria-label="Open issue detail"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onIssueClick(issue);
            }}
          >
            <Maximize2 size={12} />
          </Button>
        )}
        {isClosed && onArchiveIssue && !isAutomation && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground/50 opacity-0 transition-opacity hover:bg-muted/10 hover:text-muted-foreground group-hover:opacity-100"
            title="Archive issue"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onArchiveIssue(issue);
            }}
          >
            <Archive size={12} />
          </Button>
        )}
      </span>
    </div>
  );
}

interface ListSectionBlockProps {
  columnKey: ColumnKey;
  section: PhaseSection;
  issues: GitHubIssueCacheRecord[];
  issueRevisionBadgeById: Map<string, IssueRevisionBadge | null>;
  issueApprovalBadgeById: Map<string, IssueApprovalBadge | null>;
  issuePriorityBadgeById: Map<string, IssuePriorityBadge | null>;
  issueStalenessById?: Map<string, IssueStalenessResult | null>;
  repoUrl?: string | null;
  selectedIssueNumber?: number;
  activeId: string | null;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onOpenPullRequest?: (url: string) => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  approvedAwaitingExecutionIssueIds?: ReadonlySet<string>;
}

type ListRowContext = Pick<
  ListSectionBlockProps,
  | 'issueRevisionBadgeById'
  | 'issueApprovalBadgeById'
  | 'issuePriorityBadgeById'
  | 'issueStalenessById'
  | 'repoUrl'
  | 'selectedIssueNumber'
  | 'activeId'
  | 'onIssueClick'
  | 'onOpenPullRequest'
  | 'onArchiveIssue'
  | 'approvedAwaitingExecutionIssueIds'
>;

function getListRowProps(
  issue: GitHubIssueCacheRecord,
  columnKey: ColumnKey,
  context: ListRowContext,
): DraggableListRowProps {
  return {
    issue,
    revisionBadge: context.issueRevisionBadgeById.get(issue.id) ?? null,
    approvalBadge: context.issueApprovalBadgeById.get(issue.id) ?? null,
    priorityBadge: context.issuePriorityBadgeById.get(issue.id) ?? null,
    staleness: context.issueStalenessById?.get(issue.id) ?? null,
    repoUrl: context.repoUrl,
    selectedIssueNumber: context.selectedIssueNumber,
    activeId: context.activeId,
    onIssueClick: context.onIssueClick,
    onOpenPullRequest: context.onOpenPullRequest,
    onArchiveIssue: columnKey === 'done' ? context.onArchiveIssue : undefined,
    approvedAwaitingExecution: isApprovedAwaitingExecutionIssue(
      issue,
      context.approvedAwaitingExecutionIssueIds,
    ),
  };
}

function ListSectionBlock(props: ListSectionBlockProps) {
  const { columnKey, section, issues } = props;
  const count = issues.length;
  const empty = count === 0;
  const tone = sectionToneFor(columnKey, section.key);

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-3 py-1 text-[10px] font-semibold uppercase tracking-wide',
          tone === 'done' && 'border-done/20 bg-done/[0.08] text-done',
          tone === 'agent' && 'border-agent/20 bg-agent/[0.08] text-agent',
          tone === 'danger' && 'border-danger/20 bg-danger/[0.08] text-danger',
          tone === 'warning' && 'border-warning/20 bg-warning/[0.08] text-warning',
          empty && 'opacity-60',
        )}
      >
        <span>{section.label}</span>
        <span
          className={cn(
            'ml-1 min-w-[18px] rounded-full border px-1.5 py-px text-center text-[10px] font-medium',
            tone === 'done' && 'border-done/20 bg-done/15 text-done',
            tone === 'agent' && 'border-agent/20 bg-agent/15 text-agent',
            tone === 'danger' && 'border-danger/20 bg-danger/15 text-danger',
            tone === 'warning' && 'border-warning/20 bg-warning/15 text-warning',
            empty && 'opacity-75',
          )}
        >
          {count}
        </span>
      </div>
      {!empty && (
        <div className="flex flex-col gap-0.5">
          {issues.map((issue) => (
            <DraggableListRow key={issue.id} {...getListRowProps(issue, columnKey, props)} />
          ))}
        </div>
      )}
    </div>
  );
}

interface DroppableListGroupProps {
  dropId?: string;
  children: ReactNode;
}

function DroppableListGroup({ dropId, children }: DroppableListGroupProps) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? '__noop__', disabled: !dropId });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[2rem] flex-col gap-0.5 rounded-md transition-colors',
        dropId && isOver ? 'bg-accent/5 ring-1 ring-accent/20' : '',
      )}
    >
      {children}
    </div>
  );
}

interface IssueListViewProps {
  issues: GitHubIssueCacheRecord[];
  columnDotColors?: Partial<Record<ColumnKey, string | null>>;
  issueRevisionBadgeById: Map<string, IssueRevisionBadge | null>;
  issueApprovalBadgeById: Map<string, IssueApprovalBadge | null>;
  issuePriorityBadgeById: Map<string, IssuePriorityBadge | null>;
  issueStalenessById?: Map<string, IssueStalenessResult | null>;
  repoUrl?: string | null;
  selectedIssueNumber?: number;
  activeId: string | null;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onOpenPullRequest?: (url: string) => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  approvedAwaitingExecutionIssueIds?: ReadonlySet<string>;
}

export function IssueListView(props: IssueListViewProps) {
  const {
    issues,
    columnDotColors,
    issueRevisionBadgeById,
    issueApprovalBadgeById,
    issuePriorityBadgeById,
    issueStalenessById = EMPTY_STALENESS_MAP,
    repoUrl,
    selectedIssueNumber,
    activeId,
    onIssueClick,
    onOpenPullRequest,
    onArchiveIssue,
    approvedAwaitingExecutionIssueIds = EMPTY_APPROVED_AWAITING_EXECUTION,
  } = props;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (key: string) => {
    setCollapsed((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {COLUMNS.map((column) => {
        const label = LIST_COLUMN_LABEL[column.key];
        const columnIssues = issues.filter((issue) =>
          issueMatchesColumn(issue, column, approvedAwaitingExecutionIssueIds),
        );
        const isCollapsed = collapsed[column.key] ?? false;
        const columnDotColor = columnDotColors?.[column.key];
        const dropId = LIST_COLUMN_DROP_ID[column.key];

        return (
          <div key={column.key}>
            <div className="mb-2 flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-auto flex-1 justify-start gap-2 px-0 text-xs font-semibold uppercase tracking-wider text-secondary hover:bg-transparent hover:text-primary"
                onClick={() => toggle(column.key)}
              >
                <ColumnHeader
                  columnKey={column.key}
                  label={label}
                  count={columnIssues.length}
                  countStyle="parenthetical"
                  columnDotColor={columnDotColor}
                  leading={isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                />
              </Button>
            </div>
            {!isCollapsed && (
              <DroppableListGroup dropId={dropId}>
                {column.sections ? (
                  <div className="flex flex-col gap-2">
                    {column.sections.map((section) => (
                      <ListSectionBlock
                        key={section.key}
                        columnKey={column.key}
                        section={section}
                        issues={columnIssues.filter((issue) =>
                          issueMatchesSection(issue, section, approvedAwaitingExecutionIssueIds),
                        )}
                        issueRevisionBadgeById={issueRevisionBadgeById}
                        issueApprovalBadgeById={issueApprovalBadgeById}
                        issuePriorityBadgeById={issuePriorityBadgeById}
                        issueStalenessById={issueStalenessById}
                        repoUrl={repoUrl}
                        approvedAwaitingExecutionIssueIds={approvedAwaitingExecutionIssueIds}
                        selectedIssueNumber={selectedIssueNumber}
                        activeId={activeId}
                        onIssueClick={onIssueClick}
                        onOpenPullRequest={onOpenPullRequest}
                        onArchiveIssue={onArchiveIssue}
                      />
                    ))}
                  </div>
                ) : (
                  <>
                    {columnIssues.map((issue) => (
                      <DraggableListRow
                        key={issue.id}
                        {...getListRowProps(issue, column.key, props)}
                      />
                    ))}
                    {columnIssues.length === 0 && (
                      <p className="py-1 pl-2 text-xs text-muted-foreground">No issues</p>
                    )}
                  </>
                )}
              </DroppableListGroup>
            )}
          </div>
        );
      })}
    </div>
  );
}
