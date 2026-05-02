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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DroppableColumn, StackedColumn } from './kanban-board/BoardColumns';
import { BoardToolbar } from './kanban-board/BoardToolbar';
import { COLUMNS } from './kanban-board/constants';
import { DragOverlayCard } from './kanban-board/IssueCardParts';
import { IssueListView } from './kanban-board/IssueListView';
import type { BoardSortOrder, BoardView, ColumnKey, KanbanBoardProps } from './kanban-board/types';
import {
  compareIssues,
  customCollisionDetection,
  isAutomationIssue,
  isIssueCreating,
  issueMatchesColumn,
  issueMatchesSection,
  resolveIssueApprovalBadge,
  resolveIssuePhaseChip,
  resolveIssuePriorityBadge,
  resolveIssueRevisionBadge,
} from './kanban-board/utils';
import {
  formatIssueBranch,
  type GitHubIssueCacheRecord,
  ISSUE_PIPELINE_STATUS,
  resolveIssueStaleness,
} from './lib/shipcode';
import { cn } from './lib/utils';

type KeyboardFocusColumn = {
  key: ColumnKey;
  issues: GitHubIssueCacheRecord[];
};

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null
  );
}

function firstFocusableIssueId(columns: KeyboardFocusColumn[]): string | null {
  for (const column of columns) {
    const issue = column.issues[0];
    if (issue) return issue.id;
  }
  return null;
}

function findFocusedPosition(columns: KeyboardFocusColumn[], issueId: string | null) {
  if (!issueId) return null;
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const issueIndex = columns[columnIndex].issues.findIndex((issue) => issue.id === issueId);
    if (issueIndex >= 0) return { columnIndex, issueIndex };
  }
  return null;
}

function adjacentColumnIssueId(
  columns: KeyboardFocusColumn[],
  columnIndex: number,
  issueIndex: number,
  direction: -1 | 1,
): string | null {
  for (
    let nextColumnIndex = columnIndex + direction;
    nextColumnIndex >= 0 && nextColumnIndex < columns.length;
    nextColumnIndex += direction
  ) {
    const issues = columns[nextColumnIndex].issues;
    if (issues.length === 0) continue;
    return issues[Math.min(issueIndex, issues.length - 1)]?.id ?? null;
  }
  return null;
}

function moveFocusedIssueId(
  columns: KeyboardFocusColumn[],
  currentIssueId: string | null,
  key: 'j' | 'k' | 'h' | 'l',
): string | null {
  const firstIssueId = firstFocusableIssueId(columns);
  if (!firstIssueId) return null;

  const position = findFocusedPosition(columns, currentIssueId);
  if (!position) return firstIssueId;

  const currentColumn = columns[position.columnIndex];
  if (key === 'j') {
    return (
      currentColumn.issues[Math.min(position.issueIndex + 1, currentColumn.issues.length - 1)]
        ?.id ?? currentIssueId
    );
  }
  if (key === 'k') {
    return currentColumn.issues[Math.max(position.issueIndex - 1, 0)]?.id ?? currentIssueId;
  }

  return (
    adjacentColumnIssueId(
      columns,
      position.columnIndex,
      position.issueIndex,
      key === 'h' ? -1 : 1,
    ) ?? currentIssueId
  );
}

export function KanbanBoard({
  issues,
  project,
  settings,
  threads = [],
  approvedAwaitingExecutionIssueIds,
  flashingIssueIds,
  readOnly = false,
  keyboardShortcutsEnabled,
  onIssueClick,
  onCommentIssue,
  onRefresh,
  onTriageIssues,
  triagingIssues = false,
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
  graphContent,
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
  const boardRootRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<BoardView>('kanban');
  const [sortOrder, setSortOrder] = useState<BoardSortOrder>('priority');
  const [approvalFilter, setApprovalFilter] = useState<'all' | 'needs-approval'>('all');
  const [stalenessFilter, setStalenessFilter] = useState<'all' | 'stale'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [showRefreshToast, setShowRefreshToast] = useState(false);
  const [branchCopyToast, setBranchCopyToast] = useState<{
    issueId: string;
    branchName: string;
    status: 'copied' | 'error';
  } | null>(null);
  const [keyboardActionToast, setKeyboardActionToast] = useState<string | null>(null);
  const [focusedIssueId, setFocusedIssueId] = useState<string | null>(null);
  const [rerunningId, setRerunningId] = useState<string | null>(null);
  const shortcutsEnabled = keyboardShortcutsEnabled ?? !readOnly;
  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread])),
    [threads],
  );
  const issueStalenessById = useMemo(
    () =>
      new Map(
        boardIssues.map((issue) => {
          const thread = issue.threadId ? threadById.get(issue.threadId) : null;
          return [
            issue.id,
            resolveIssueStaleness({
              pipelineStatus: issue.pipelineStatus,
              issueUpdatedAt: issue.updatedAt ?? issue.fetchedAt,
              statusUpdatedAt: issue.lastPhaseUpdate ?? null,
              threadStatus: thread?.status ?? null,
              threadUpdatedAt: thread?.updatedAt ?? null,
            }),
          ] as const;
        }),
      ),
    [boardIssues, threadById],
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
  const issuePriorityBadgeById = useMemo(
    () => new Map(boardIssues.map((issue) => [issue.id, resolveIssuePriorityBadge(issue)])),
    [boardIssues],
  );
  const issueBranchNameById = useMemo(
    () =>
      new Map(
        boardIssues.map((issue) => [
          issue.id,
          isIssueCreating(issue) || isAutomationIssue(issue)
            ? ''
            : formatIssueBranch(
                issue.issueNumber,
                issue.title ?? '',
                settings?.worktreeBranchFormat ?? null,
              ),
        ]),
      ),
    [boardIssues, settings?.worktreeBranchFormat],
  );
  const sortedIssues = useMemo(
    () => [...boardIssues].sort((a, b) => compareIssues(a, b, sortOrder)),
    [boardIssues, sortOrder],
  );
  const visibleIssues = useMemo(
    () =>
      sortedIssues.filter((issue) => {
        if (approvalFilter === 'needs-approval' && issueApprovalBadgeById.get(issue.id) == null) {
          return false;
        }
        if (stalenessFilter === 'stale' && issueStalenessById.get(issue.id) == null) {
          return false;
        }
        return true;
      }),
    [approvalFilter, issueApprovalBadgeById, issueStalenessById, sortedIssues, stalenessFilter],
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
  const keyboardFocusColumns = useMemo<KeyboardFocusColumn[]>(
    () =>
      COLUMNS.map((column) => {
        if (!column.sections) {
          return { key: column.key, issues: visibleIssuesByColumn.get(column.key) ?? [] };
        }

        return {
          key: column.key,
          issues: column.sections.flatMap((section) =>
            visibleIssues.filter(
              (issue) =>
                issueMatchesColumn(issue, column, approvedAwaitingExecutionIssueIds) &&
                issueMatchesSection(issue, section, approvedAwaitingExecutionIssueIds),
            ),
          ),
        };
      }),
    [approvedAwaitingExecutionIssueIds, visibleIssues, visibleIssuesByColumn],
  );
  const focusedIssue = useMemo(() => {
    if (!focusedIssueId) return null;
    for (const column of keyboardFocusColumns) {
      const issue = column.issues.find((candidate) => candidate.id === focusedIssueId);
      if (issue) return issue;
    }
    return null;
  }, [focusedIssueId, keyboardFocusColumns]);

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

  const handleCopyBranchName = useCallback(
    async (issue: GitHubIssueCacheRecord, branchName: string) => {
      try {
        await navigator.clipboard.writeText(branchName);
        setBranchCopyToast({ issueId: issue.id, branchName, status: 'copied' });
      } catch {
        setBranchCopyToast({ issueId: issue.id, branchName, status: 'error' });
      }
    },
    [],
  );

  useEffect(() => {
    if (view !== 'kanban' || readOnly) {
      setFocusedIssueId(null);
      return;
    }

    setFocusedIssueId((current) => {
      if (findFocusedPosition(keyboardFocusColumns, current)) return current;
      return firstFocusableIssueId(keyboardFocusColumns);
    });
  }, [keyboardFocusColumns, readOnly, view]);

  useEffect(() => {
    if (view !== 'kanban' || !focusedIssueId) return;
    const root = boardRootRef.current;
    if (!root) return;
    const focusedCard = Array.from(root.querySelectorAll<HTMLElement>('[data-issue-card-id]')).find(
      (card) => card.dataset.issueCardId === focusedIssueId,
    );
    focusedCard?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [focusedIssueId, view]);

  useEffect(() => {
    if (!showRefreshToast) return;
    const id = setTimeout(() => setShowRefreshToast(false), 2000);
    return () => clearTimeout(id);
  }, [showRefreshToast]);

  useEffect(() => {
    if (!branchCopyToast) return;
    const id = setTimeout(() => setBranchCopyToast(null), 2000);
    return () => clearTimeout(id);
  }, [branchCopyToast]);

  useEffect(() => {
    if (!keyboardActionToast) return;
    const id = setTimeout(() => setKeyboardActionToast(null), 2000);
    return () => clearTimeout(id);
  }, [keyboardActionToast]);

  useEffect(() => {
    if (!shortcutsEnabled || view !== 'kanban') return;

    const handler = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      const raw = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const arrowMap: Record<string, 'j' | 'k' | 'h' | 'l'> = {
        ArrowDown: 'j',
        ArrowUp: 'k',
        ArrowLeft: 'h',
        ArrowRight: 'l',
      };
      const key = arrowMap[raw] ?? raw;
      if (key === 'j' || key === 'k' || key === 'h' || key === 'l') {
        event.preventDefault();
        setFocusedIssueId((current) => moveFocusedIssueId(keyboardFocusColumns, current, key));
        return;
      }

      if (!focusedIssue) return;
      if (isIssueCreating(focusedIssue)) {
        if (key === 'Enter' || key === 'c' || key === 'e') {
          event.preventDefault();
          setKeyboardActionToast('Issue is still being created on GitHub.');
        }
        return;
      }
      if (key === 'Enter') {
        event.preventDefault();
        onIssueClick(focusedIssue);
        return;
      }
      if (key === 'c') {
        event.preventDefault();
        (onCommentIssue ?? onIssueClick)(focusedIssue);
        return;
      }
      if (key !== 'e') return;

      event.preventDefault();
      if (
        focusedIssue.pipelineStatus === ISSUE_PIPELINE_STATUS.todo &&
        onStartPipeline &&
        !readOnly &&
        !isAutomationIssue(focusedIssue)
      ) {
        onStartPipeline(focusedIssue);
        return;
      }
      if (
        focusedIssue.pipelineStatus === ISSUE_PIPELINE_STATUS.failed &&
        onRerun &&
        !readOnly &&
        !isAutomationIssue(focusedIssue)
      ) {
        handleRerun(focusedIssue);
        return;
      }
      setKeyboardActionToast('Pipeline can only start from Todo cards.');
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    focusedIssue,
    handleRerun,
    keyboardFocusColumns,
    onCommentIssue,
    onIssueClick,
    onRerun,
    onStartPipeline,
    readOnly,
    shortcutsEnabled,
    view,
  ]);

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
      issue.pipelineStatus === ISSUE_PIPELINE_STATUS.failed &&
      (onRerun ?? onStartPipeline)
    ) {
      (onRerun ?? onStartPipeline)?.(issue);
      return;
    }
    // 3. human → todo (reset failed or awaiting_approval back to todo)
    if (
      sourceColumn === 'human' &&
      dropId === 'todo' &&
      (issue.pipelineStatus === ISSUE_PIPELINE_STATUS.failed ||
        issue.pipelineStatus === ISSUE_PIPELINE_STATUS.clarifying ||
        issue.pipelineStatus === ISSUE_PIPELINE_STATUS.awaitingApproval) &&
      onRetry
    ) {
      onRetry(issue);
      return;
    }
    // 4. agent (queued) → todo (dequeue)
    if (
      sourceColumn === 'agent' &&
      dropId === 'todo' &&
      (issue.pipelineStatus === ISSUE_PIPELINE_STATUS.queued ||
        issue.pipelineStatus === ISSUE_PIPELINE_STATUS.awaitingApproval) &&
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
    <div
      ref={boardRootRef}
      className={cn('relative flex h-full min-h-0 flex-col overflow-hidden rounded-sm')}
    >
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
        graphEnabled={!!graphContent}
        approvalFilter={approvalFilter}
        onApprovalFilterChange={setApprovalFilter}
        stalenessFilter={stalenessFilter}
        onStalenessFilterChange={setStalenessFilter}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        triagingIssues={triagingIssues}
        onTriageIssues={onTriageIssues}
        projectName={projectName}
        repoUrl={repoUrl}
        projectsUrl={projectsUrl}
        onRepoClick={repoUrl ? handleExternalClick(repoUrl) : undefined}
        onProjectsClick={projectsUrl ? handleExternalClick(projectsUrl) : undefined}
      />
      {view === 'graph' && graphContent ? (
        <div className="min-h-0 flex-1">{graphContent}</div>
      ) : (
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
              issuePriorityBadgeById={issuePriorityBadgeById}
              issueStalenessById={issueStalenessById}
              approvedAwaitingExecutionIssueIds={approvedAwaitingExecutionIssueIds}
              onIssueClick={onIssueClick}
              onOpenPullRequest={onOpenPullRequest}
              onArchiveIssue={onArchiveIssue}
              onArchiveAllDone={onArchiveAllDone}
            />
          )}
          {view !== 'list' && (
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
                      onCopyBranchName={handleCopyBranchName}
                      onArchiveAllDone={col.key === 'done' ? onArchiveAllDone : undefined}
                      onArchiveIssue={col.key === 'done' ? onArchiveIssue : undefined}
                      rerunningId={rerunningId}
                      selectedIssueNumber={selectedIssueNumber}
                      issueBranchNameById={issueBranchNameById}
                      branchCopyIssueId={branchCopyToast?.issueId ?? null}
                      branchCopyStatus={branchCopyToast?.status ?? null}
                      focusedIssueId={focusedIssueId}
                      issuePhaseChipById={issuePhaseChipById}
                      issueRevisionBadgeById={issueRevisionBadgeById}
                      issueApprovalBadgeById={issueApprovalBadgeById}
                      issuePriorityBadgeById={issuePriorityBadgeById}
                      issueStalenessById={issueStalenessById}
                      approvedAwaitingExecutionIssueIds={approvedAwaitingExecutionIssueIds}
                      flashingIssueIds={flashingIssueIds}
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
                    onCopyBranchName={handleCopyBranchName}
                    onArchiveAllDone={col.key === 'done' ? onArchiveAllDone : undefined}
                    onArchiveIssue={col.key === 'done' ? onArchiveIssue : undefined}
                    issueBranchNameById={issueBranchNameById}
                    branchCopyIssueId={branchCopyToast?.issueId ?? null}
                    branchCopyStatus={branchCopyToast?.status ?? null}
                    focusedIssueId={focusedIssueId}
                    issuePhaseChipById={issuePhaseChipById}
                    issueRevisionBadgeById={issueRevisionBadgeById}
                    issueApprovalBadgeById={issueApprovalBadgeById}
                    issuePriorityBadgeById={issuePriorityBadgeById}
                    issueStalenessById={issueStalenessById}
                    approvedAwaitingExecutionIssueIds={approvedAwaitingExecutionIssueIds}
                    flashingIssueIds={flashingIssueIds}
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
      )}

      {showRefreshToast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 shadow-lg text-xs text-secondary">
            <RefreshCw size={12} className="text-muted" />
            Board refreshed
          </div>
        </div>
      )}
      {branchCopyToast && (
        <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-secondary shadow-lg">
            {branchCopyToast.status === 'copied' ? (
              <>
                <span className="text-success">Copied</span>
                <span className="font-mono text-muted">{branchCopyToast.branchName}</span>
              </>
            ) : (
              <span className="text-danger">Clipboard write failed</span>
            )}
          </div>
        </div>
      )}
      {keyboardActionToast && (
        <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="rounded-lg border border-warning/30 bg-elevated px-3 py-2 text-xs text-warning shadow-lg">
            {keyboardActionToast}
          </div>
        </div>
      )}
    </div>
  );
}
