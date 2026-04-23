'use client';

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DroppableColumn, StackedColumn } from './kanban-board/BoardColumns';
import { BoardToolbar } from './kanban-board/BoardToolbar';
import { COLUMNS } from './kanban-board/constants';
import { DragOverlayCard } from './kanban-board/IssueCardParts';
import { IssueListView } from './kanban-board/IssueListView';
import type { BoardSortOrder, ColumnKey, KanbanBoardProps } from './kanban-board/types';
import {
  compareIssues,
  customCollisionDetection,
  resolveIssueApprovalBadge,
  resolveIssuePhaseChip,
  resolveIssueRevisionBadge,
} from './kanban-board/utils';
import type { GitHubIssueCacheRecord } from './lib/shipcode';

export function KanbanBoard({
  issues,
  project,
  settings,
  threads = [],
  approvedAwaitingExecutionIssueIds,
  readOnly = false,
  onIssueClick,
  onRefresh,
  onStartPipeline,
  onRetry,
  onRerun,
  onMarkDone,
  onCancel,
  baseBranch,
  branches,
  onBaseBranchChange,
  onRefreshBranches,
  refreshingBranches = false,
  selectedIssueNumber,
  projectName,
  repoUrl,
  projectsUrl,
  onOpenExternal,
  onOpenPullRequest,
  onArchiveIssue,
  onArchiveAllDone,
}: KanbanBoardProps) {
  const handleExternalClick = (url: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (onOpenExternal) {
      event.preventDefault();
      onOpenExternal(url);
    }
  };

  const boardIssues = useMemo(
    () => Array.from(new Map(issues.map((issue) => [issue.id, issue])).values()),
    [issues],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIssue = boardIssues.find((issue) => issue.id === activeId);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [sortOrder, setSortOrder] = useState<BoardSortOrder>('priority');
  const [approvalFilter, setApprovalFilter] = useState<'all' | 'needs-approval'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [showRefreshToast, setShowRefreshToast] = useState(false);
  const [rerunningId, setRerunningId] = useState<string | null>(null);
  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread])),
    [threads],
  );
  const issuePhaseChipById = useMemo(
    () =>
      new Map(
        boardIssues.map((issue) => [
          issue.id,
          resolveIssuePhaseChip(
            issue,
            settings,
            project,
            issue.threadId ? threadById.get(issue.threadId) : null,
          ),
        ]),
      ),
    [boardIssues, project, settings, threadById],
  );
  const issueRevisionBadgeById = useMemo(
    () =>
      new Map(
        boardIssues.map((issue) => [
          issue.id,
          resolveIssueRevisionBadge(
            issue,
            settings,
            project,
            issue.threadId ? threadById.get(issue.threadId) : null,
          ),
        ]),
      ),
    [boardIssues, project, settings, threadById],
  );
  const issueApprovalBadgeById = useMemo(
    () =>
      new Map(
        boardIssues.map((issue) => [
          issue.id,
          approvedAwaitingExecutionIssueIds?.has(issue.id)
            ? null
            : resolveIssueApprovalBadge(issue, settings, project),
        ]),
      ),
    [approvedAwaitingExecutionIssueIds, boardIssues, project, settings],
  );
  const sortedIssues = useMemo(
    () => [...boardIssues].sort((a, b) => compareIssues(a, b, sortOrder)),
    [boardIssues, sortOrder],
  );
  const visibleIssues = useMemo(
    () =>
      approvalFilter === 'needs-approval'
        ? sortedIssues.filter((issue) => issueApprovalBadgeById.get(issue.id) != null)
        : sortedIssues,
    [approvalFilter, issueApprovalBadgeById, sortedIssues],
  );
  const visibleIssuesByColumn = useMemo(
    () =>
      new Map(
        COLUMNS.filter((column) => !column.sections).map((column) => [
          column.key,
          visibleIssues.filter((issue) =>
            approvedAwaitingExecutionIssueIds?.has(issue.id)
              ? column.key === 'agent'
              : column.statuses.includes(issue.pipelineStatus),
          ),
        ]),
      ),
    [approvedAwaitingExecutionIssueIds, visibleIssues],
  );

  const handleRerun = useCallback(
    (issue: GitHubIssueCacheRecord) => {
      setRerunningId(issue.id);
      onRerun?.(issue);
      setTimeout(() => setRerunningId(null), 800);
    },
    [onRerun],
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setShowRefreshToast(true);
    onRefresh();
    // Keep the spin for at least 600ms so it's visible
    setTimeout(() => setRefreshing(false), 600);
  }, [onRefresh]);

  useEffect(() => {
    if (!showRefreshToast) return;
    const id = setTimeout(() => setShowRefreshToast(false), 2000);
    return () => clearTimeout(id);
  }, [showRefreshToast]);

  function getColumnForIssue(issue: GitHubIssueCacheRecord): ColumnKey {
    if (approvedAwaitingExecutionIssueIds?.has(issue.id)) return 'agent';
    return COLUMNS.find((c) => c.statuses.includes(issue.pipelineStatus))?.key ?? 'todo';
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || !active.data.current) return;

    const issue = active.data.current as GitHubIssueCacheRecord;
    const sourceColumn = getColumnForIssue(issue);
    const dropId = String(over.id);

    // Only these transitions are allowed:
    // 1. todo → agent:planning (start pipeline)
    if (sourceColumn === 'todo' && dropId === 'agent:planning' && onStartPipeline) {
      onStartPipeline(issue);
      return;
    }
    // 2. failed → agent:planning (re-run directly from failed)
    if (
      sourceColumn === 'human' &&
      dropId === 'agent:planning' &&
      issue.pipelineStatus === 'failed' &&
      (onRerun ?? onStartPipeline)
    ) {
      (onRerun ?? onStartPipeline)?.(issue);
      return;
    }
    // 3. human → todo (reset failed or awaiting_approval back to todo)
    if (
      sourceColumn === 'human' &&
      dropId === 'todo' &&
      (issue.pipelineStatus === 'failed' ||
        issue.pipelineStatus === 'clarifying' ||
        issue.pipelineStatus === 'awaiting_approval') &&
      onRetry
    ) {
      onRetry(issue);
      return;
    }
    // 4. agent (queued) → todo (dequeue)
    if (
      sourceColumn === 'agent' &&
      dropId === 'todo' &&
      (issue.pipelineStatus === 'queued' || issue.pipelineStatus === 'awaiting_approval') &&
      onRetry
    ) {
      onRetry(issue);
      return;
    }
    // 5. any manually draggable card → done (explicitly complete issue)
    if ((dropId === 'done' || dropId === 'done:done') && onMarkDone) {
      onMarkDone(issue);
      return;
    }
    // All other drops: no-op (snap back)
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <BoardToolbar
        baseBranch={baseBranch}
        branches={branches}
        onBaseBranchChange={onBaseBranchChange}
        onRefreshBranches={onRefreshBranches}
        refreshingBranches={refreshingBranches}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        view={view}
        onViewChange={setView}
        approvalFilter={approvalFilter}
        onApprovalFilterChange={setApprovalFilter}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        projectName={projectName}
        repoUrl={repoUrl}
        projectsUrl={projectsUrl}
        onRepoClick={repoUrl ? handleExternalClick(repoUrl) : undefined}
        onProjectsClick={projectsUrl ? handleExternalClick(projectsUrl) : undefined}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={customCollisionDetection}
        onDragStart={readOnly ? undefined : handleDragStart}
        onDragEnd={readOnly ? undefined : handleDragEnd}
      >
        {view === 'list' && (
          <IssueListView
            issues={visibleIssues}
            selectedIssueNumber={selectedIssueNumber}
            activeId={activeId}
            issueRevisionBadgeById={issueRevisionBadgeById}
            issueApprovalBadgeById={issueApprovalBadgeById}
            approvedAwaitingExecutionIssueIds={approvedAwaitingExecutionIssueIds}
            onIssueClick={onIssueClick}
            onOpenPullRequest={onOpenPullRequest}
            onArchiveIssue={onArchiveIssue}
            onArchiveAllDone={onArchiveAllDone}
          />
        )}
        {view === 'kanban' && (
          <div className="flex min-h-0 flex-1 gap-0.5 overflow-x-auto overflow-y-hidden p-3 px-2">
            {COLUMNS.map((col) => {
              if (col.sections) {
                return (
                  <StackedColumn
                    key={col.key}
                    column={col}
                    issues={visibleIssues}
                    onIssueClick={onIssueClick}
                    onRerun={handleRerun}
                    onCancel={onCancel}
                    onOpenPullRequest={onOpenPullRequest}
                    onArchiveAllDone={col.key === 'done' ? onArchiveAllDone : undefined}
                    onArchiveIssue={col.key === 'done' ? onArchiveIssue : undefined}
                    rerunningId={rerunningId}
                    selectedIssueNumber={selectedIssueNumber}
                    issuePhaseChipById={issuePhaseChipById}
                    issueRevisionBadgeById={issueRevisionBadgeById}
                    issueApprovalBadgeById={issueApprovalBadgeById}
                    approvedAwaitingExecutionIssueIds={approvedAwaitingExecutionIssueIds}
                    readOnly={readOnly}
                  />
                );
              }
              const columnIssues = visibleIssuesByColumn.get(col.key) ?? [];
              return (
                <DroppableColumn
                  key={col.key}
                  id={col.key}
                  columnKey={col.key}
                  label={col.label}
                  issues={columnIssues}
                  droppable={!!col.droppable}
                  onIssueClick={onIssueClick}
                  selectedIssueNumber={selectedIssueNumber}
                  onStartPipeline={col.key === 'todo' ? onStartPipeline : undefined}
                  onOpenPullRequest={onOpenPullRequest}
                  onArchiveAllDone={col.key === 'done' ? onArchiveAllDone : undefined}
                  onArchiveIssue={col.key === 'done' ? onArchiveIssue : undefined}
                  issuePhaseChipById={issuePhaseChipById}
                  issueRevisionBadgeById={issueRevisionBadgeById}
                  issueApprovalBadgeById={issueApprovalBadgeById}
                  approvedAwaitingExecutionIssueIds={approvedAwaitingExecutionIssueIds}
                  readOnly={readOnly}
                />
              );
            })}
          </div>
        )}
        {!readOnly && (
          <DragOverlay dropAnimation={null}>
            {activeIssue ? (
              <DragOverlayCard
                issue={activeIssue}
                approvedAwaitingExecution={approvedAwaitingExecutionIssueIds?.has(activeIssue.id)}
              />
            ) : null}
          </DragOverlay>
        )}
      </DndContext>

      {showRefreshToast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 shadow-lg text-xs text-secondary">
            <RefreshCw size={12} className="text-muted" />
            Board refreshed
          </div>
        </div>
      )}
    </div>
  );
}
