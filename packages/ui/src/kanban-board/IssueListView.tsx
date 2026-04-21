'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { Archive, ChevronDown, ChevronRight, User } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '../lib/utils';
import { Badge } from '../primitives/badge';
import { Button } from '../primitives/button';
import {
  ACTIVE_STATUSES,
  COLUMN_DOT_CLASS,
  COLUMNS,
  DRAGGABLE_STATUSES,
  LIST_COLUMN_DROP_ID,
  LIST_COLUMN_LABEL,
} from './constants';
import { IssueExternalBlockers } from './IssueCardParts';
import type { ColumnKey, IssueApprovalBadge, PhaseSection } from './types';
import { formatDate, rowToneFor } from './utils';

interface DraggableListRowProps {
  issue: GitHubIssueCacheRecord;
  revisionLabel?: string | null;
  approvalBadge?: IssueApprovalBadge | null;
  selectedIssueNumber?: number;
  activeId: string | null;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onOpenPullRequest?: (url: string) => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
}

function DraggableListRow({
  issue,
  revisionLabel,
  approvalBadge,
  selectedIssueNumber,
  activeId,
  onIssueClick,
  onOpenPullRequest,
  onArchiveIssue,
}: DraggableListRowProps) {
  const isDoneState = issue.pipelineStatus === 'completed' || issue.pipelineStatus === 'done';
  const isDraggable = DRAGGABLE_STATUSES.includes(issue.pipelineStatus);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
    data: issue,
    disabled: !isDraggable,
  });
  const isSelected = selectedIssueNumber === issue.issueNumber;
  const tone = rowToneFor(issue.pipelineStatus);
  const isActive = ACTIVE_STATUSES.includes(issue.pipelineStatus);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dnd-kit's useDraggable provides keyboard accessibility via listeners/attributes spread below
    // biome-ignore lint/a11y/useKeyWithClickEvents: dnd-kit KeyboardSensor handles activation; the onClick only forwards selection on pointer click
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-full items-center gap-3 rounded-md border-l-2 pl-3 pr-3 py-2 text-left text-sm transition-colors',
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
            ? 'border-danger bg-danger/[0.08] text-primary'
            : 'border-danger/60 bg-danger/[0.03] text-primary hover:bg-danger/[0.06]'),
        tone === 'warning' &&
          (isSelected
            ? 'border-warning bg-warning/[0.08] text-primary'
            : 'border-warning/60 bg-warning/[0.03] text-primary hover:bg-warning/[0.06]'),
        isDragging && 'opacity-40',
        isDraggable ? 'cursor-grab' : 'cursor-pointer',
        activeId && activeId !== issue.id && 'pointer-events-none',
      )}
      {...(isDraggable ? { ...attributes, ...listeners } : {})}
      onClick={!isDragging ? () => onIssueClick(issue) : undefined}
    >
      {isActive ? (
        <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-agent opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-agent" />
        </span>
      ) : (
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            tone === 'success' && 'bg-success',
            tone === 'done' && 'bg-done',
            tone === 'danger' && 'bg-danger',
            tone === 'warning' && 'bg-warning',
            tone === 'default' && (issue.pipelineStatus === 'done' ? 'bg-done' : 'bg-text-muted'),
          )}
        />
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="font-mono text-xs text-secondary">#{issue.issueNumber}</span>
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
        <IssueExternalBlockers issue={issue} />
        {revisionLabel ? (
          <Badge variant="default" className="px-1.5 py-px text-[10px] font-medium">
            {revisionLabel}
          </Badge>
        ) : null}
        {approvalBadge ? (
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
        <User size={11} className="text-muted" />
        {issue.assignee ?? '—'}
      </span>
      <span className="shrink-0 text-xs text-muted">{formatDate(issue.fetchedAt)}</span>
      {isDoneState && onArchiveIssue && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted/50 opacity-0 transition-opacity hover:bg-muted/10 hover:text-muted group-hover:opacity-100"
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
    </div>
  );
}

interface ListSectionBlockProps {
  columnKey: ColumnKey;
  section: PhaseSection;
  issues: GitHubIssueCacheRecord[];
  issueRevisionLabelById: Map<string, string | null>;
  issueApprovalBadgeById: Map<string, IssueApprovalBadge | null>;
  selectedIssueNumber?: number;
  activeId: string | null;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onOpenPullRequest?: (url: string) => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
}

function ListSectionBlock({
  columnKey,
  section,
  issues,
  issueRevisionLabelById,
  issueApprovalBadgeById,
  selectedIssueNumber,
  activeId,
  onIssueClick,
  onOpenPullRequest,
  onArchiveIssue,
}: ListSectionBlockProps) {
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
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide',
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
            'ml-1 min-w-[18px] rounded-full border border-transparent bg-tertiary px-1.5 py-px text-center text-[10px] font-medium',
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
        <div className="flex flex-col gap-0.5">
          {issues.map((issue) => (
            <DraggableListRow
              key={issue.id}
              issue={issue}
              revisionLabel={issueRevisionLabelById.get(issue.id) ?? null}
              approvalBadge={issueApprovalBadgeById.get(issue.id) ?? null}
              selectedIssueNumber={selectedIssueNumber}
              activeId={activeId}
              onIssueClick={onIssueClick}
              onOpenPullRequest={onOpenPullRequest}
              onArchiveIssue={columnKey === 'done' ? onArchiveIssue : undefined}
            />
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
  issueRevisionLabelById: Map<string, string | null>;
  issueApprovalBadgeById: Map<string, IssueApprovalBadge | null>;
  selectedIssueNumber?: number;
  activeId: string | null;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onOpenPullRequest?: (url: string) => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  onArchiveAllDone?: () => void;
}

export function IssueListView({
  issues,
  issueRevisionLabelById,
  issueApprovalBadgeById,
  selectedIssueNumber,
  activeId,
  onIssueClick,
  onOpenPullRequest,
  onArchiveIssue,
  onArchiveAllDone,
}: IssueListViewProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (key: string) => {
    setCollapsed((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {COLUMNS.map((column) => {
        const label = LIST_COLUMN_LABEL[column.key];
        const columnIssues = issues.filter((issue) =>
          column.statuses.includes(issue.pipelineStatus),
        );
        const isCollapsed = collapsed[column.key] ?? false;
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
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span
                  className={cn('h-2 w-2 shrink-0 rounded-full', COLUMN_DOT_CLASS[column.key])}
                />
                {label}
                <span className="ml-0.5 font-normal normal-case tracking-normal text-muted">
                  ({columnIssues.length})
                </span>
              </Button>
              {column.key === 'done' && onArchiveAllDone && columnIssues.length > 0 && (
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
                          section.statuses.includes(issue.pipelineStatus),
                        )}
                        issueRevisionLabelById={issueRevisionLabelById}
                        issueApprovalBadgeById={issueApprovalBadgeById}
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
                        issue={issue}
                        revisionLabel={issueRevisionLabelById.get(issue.id) ?? null}
                        approvalBadge={issueApprovalBadgeById.get(issue.id) ?? null}
                        selectedIssueNumber={selectedIssueNumber}
                        activeId={activeId}
                        onIssueClick={onIssueClick}
                        onOpenPullRequest={onOpenPullRequest}
                        onArchiveIssue={column.key === 'done' ? onArchiveIssue : undefined}
                      />
                    ))}
                    {columnIssues.length === 0 && (
                      <p className="py-1 pl-2 text-xs text-muted">No issues</p>
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
