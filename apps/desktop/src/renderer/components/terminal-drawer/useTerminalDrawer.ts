import type { GitHubIssueCacheRecord, PlanRecord } from '@shipcode/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { STABLE_APP_STATE_STALE_TIME } from '../../query-stale-times';
import { useAppStore } from '../../stores/app-store';
import { CONSOLE_VISIBLE_STATUSES, DEFAULT_HEIGHT, MIN_HEIGHT } from './constants';

export function useTerminalDrawer() {
  const toggleTerminal = useAppStore((s) => s.toggleTerminal);
  const setTerminalMaximized = useAppStore((s) => s.setTerminalMaximized);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const terminalThreadId = useAppStore((s) => s.terminalThreadId);
  const isMaximized = useAppStore((s) => s.terminalMaximized);
  const githubIssues = useAppStore((s) => s.githubIssues);
  const activeIssue = useAppStore((s) => s.activeIssue);
  const scopedIssues = githubIssues.filter((issue) => issue.projectId === activeProjectId);
  const runningTabs = scopedIssues.filter((issue) =>
    CONSOLE_VISIBLE_STATUSES.has(issue.pipelineStatus),
  );
  const scopedActiveIssue = activeIssue?.projectId === activeProjectId ? activeIssue : null;
  const explicitIssue =
    terminalThreadId != null
      ? (scopedIssues.find((issue) => issue.threadId === terminalThreadId) ??
        (scopedActiveIssue?.threadId === terminalThreadId ? scopedActiveIssue : null))
      : null;
  const activeIssueMatch =
    scopedActiveIssue?.threadId != null
      ? (scopedIssues.find((issue) => issue.threadId === scopedActiveIssue.threadId) ??
        scopedActiveIssue)
      : null;
  const fallbackIssue =
    activeIssueMatch || runningTabs.find((issue) => issue.threadId != null) || null;
  const displayIssue = explicitIssue ?? fallbackIssue;
  const visibleTerminalThreadId = displayIssue?.threadId ?? null;
  const firstEventCreatedAt = useAppStore((s) =>
    visibleTerminalThreadId
      ? (s.canonicalTerminalStream[visibleTerminalThreadId]?.[0]?.createdAt ?? null)
      : null,
  );
  const activeThreadId = useAppStore((s) => s.activeThreadId);
  const pipelinePhase = useAppStore((s) =>
    displayIssue == null
      ? 'idle'
      : displayIssue.threadId === activeThreadId
        ? s.pipelinePhase
        : (displayIssue.pipelineStatus as typeof s.pipelinePhase),
  );
  const { data: displayThreadPlans = [] } = useQuery<PlanRecord[]>({
    queryKey: ['terminal-drawer-plan-history', visibleTerminalThreadId],
    queryFn: () => window.shipcode.invoke('plan:list', { threadId: visibleTerminalThreadId }),
    enabled: !!visibleTerminalThreadId && displayIssue?.pipelineStatus === 'awaiting_approval',
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });
  const latestPlanStatus = displayThreadPlans[0]?.status ?? null;
  const approvedAwaitingExecution =
    displayIssue?.pipelineStatus === 'awaiting_approval' && latestPlanStatus === 'approved';
  const currentModel = useAppStore(
    (s) => (visibleTerminalThreadId ? s.currentModels[visibleTerminalThreadId] : null) ?? null,
  );
  const setTerminalThread = useAppStore((s) => s.setTerminalThread);
  const selectIssue = useAppStore((s) => s.selectIssue);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const prevHeightRef = useRef(DEFAULT_HEIGHT);
  const dragStartRef = useRef<{ y: number; h: number } | null>(null);

  const handleResizeMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      dragStartRef.current = { y: event.clientY, h: height };

      const onMove = (moveEvent: MouseEvent) => {
        if (!dragStartRef.current) return;
        const delta = dragStartRef.current.y - moveEvent.clientY;
        setHeight(Math.max(MIN_HEIGHT, dragStartRef.current.h + delta));
      };

      const onUp = () => {
        dragStartRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [height],
  );

  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      setHeight(prevHeightRef.current);
    } else {
      prevHeightRef.current = height;
      setHeight(9999);
    }
    setTerminalMaximized(!isMaximized);
  }, [height, isMaximized, setTerminalMaximized]);

  const handleRunningTabSelect = useCallback(
    (issue: GitHubIssueCacheRecord) => {
      setTerminalThread(issue.threadId ?? null);
      selectIssue(issue);
    },
    [selectIssue, setTerminalThread],
  );

  return {
    currentModel,
    displayIssue,
    handleResizeMouseDown,
    handleRunningTabSelect,
    approvedAwaitingExecution,
    isMaximized,
    pipelinePhase,
    resolvedHeight: isMaximized ? undefined : height,
    runningTabs,
    showEmptyState: displayIssue === null,
    startedAt:
      firstEventCreatedAt != null
        ? new Date(firstEventCreatedAt).toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        : null,
    terminalThreadId: visibleTerminalThreadId,
    toggleMaximize,
    toggleTerminal,
  };
}
