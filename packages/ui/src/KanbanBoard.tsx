'use client';

import { DndContext, type DragEndEvent, DragOverlay, type DragStartEvent } from '@dnd-kit/core';
import type { GitHubIssueCacheRecord } from '@shipcode/shared';
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
  resolveIssuePhaseChip,
} from './kanban-board/utils';

export function KanbanBoard({
  issues,
  project,
  settings,
  threads = [],
  readOnly = false,
  onIssueClick,
  onRefresh,
  onNewIssue,
  onStartPipeline,
  onRetry,
  onRerun,
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

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIssue = issues.find((issue) => issue.id === activeId);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [sortOrder, setSortOrder] = useState<BoardSortOrder>('priority');
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
        issues.map((issue) => [
          issue.id,
          resolveIssuePhaseChip(
            issue,
            settings,
            project,
            issue.threadId ? threadById.get(issue.threadId) : null,
          ),
        ]),
      ),
    [issues, project, settings, threadById],
  );
  const sortedIssues = useMemo(
    () => [...issues].sort((a, b) => compareIssues(a, b, sortOrder)),
    [issues, sortOrder],
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
      (issue.pipelineStatus === 'failed' || issue.pipelineStatus === 'awaiting_approval') &&
      onRetry
    ) {
      onRetry(issue);
      return;
    }
    // 4. agent (queued) → todo (dequeue)
    if (
      sourceColumn === 'agent' &&
      dropId === 'todo' &&
      issue.pipelineStatus === 'queued' &&
      onRetry
    ) {
      onRetry(issue);
      return;
    }
    // All other drops: no-op (snap back)
  }

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
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
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onNewIssue={onNewIssue}
        projectName={projectName}
        repoUrl={repoUrl}
        projectsUrl={projectsUrl}
        onRepoClick={repoUrl ? handleExternalClick(repoUrl) : undefined}
        onProjectsClick={projectsUrl ? handleExternalClick(projectsUrl) : undefined}
      />
      <DndContext
        collisionDetection={customCollisionDetection}
        onDragStart={readOnly ? undefined : handleDragStart}
        onDragEnd={readOnly ? undefined : handleDragEnd}
      >
        {view === 'list' && (
          <IssueListView
            issues={sortedIssues}
            selectedIssueNumber={selectedIssueNumber}
            activeId={activeId}
            onIssueClick={onIssueClick}
            onOpenPullRequest={onOpenPullRequest}
            onArchiveIssue={onArchiveIssue}
            onArchiveAllDone={onArchiveAllDone}
          />
        )}
        {view === 'kanban' && (
          <div className="flex flex-1 overflow-x-auto overflow-y-hidden gap-0.5 p-3 px-2">
            {COLUMNS.map((col) => {
              if (col.sections) {
                return (
                  <StackedColumn
                    key={col.key}
                    column={col}
                    issues={sortedIssues}
                    onIssueClick={onIssueClick}
                    onRerun={handleRerun}
                    onCancel={onCancel}
                    onOpenPullRequest={onOpenPullRequest}
                    rerunningId={rerunningId}
                    selectedIssueNumber={selectedIssueNumber}
                    issuePhaseChipById={issuePhaseChipById}
                    readOnly={readOnly}
                  />
                );
              }
              const columnIssues = sortedIssues.filter((i) =>
                col.statuses.includes(i.pipelineStatus),
              );
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
                  readOnly={readOnly}
                />
              );
            })}
          </div>
        )}
        {!readOnly && (
          <DragOverlay dropAnimation={null}>
            {activeIssue ? <DragOverlayCard issue={activeIssue} /> : null}
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
