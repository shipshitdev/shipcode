import type {
  ActivePipelineSummary,
  GitHubIssueCacheRecord,
  PipelinePhase,
  PlanRecord,
  Thread,
} from '@shipcode/shared';
import { formatClockTime, PIPELINE_PHASE, THREAD_KIND } from '@shipcode/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { STABLE_APP_STATE_STALE_TIME } from '../../query-stale-times';
import { useAppStore } from '../../stores/app-store';
import {
  CONSOLE_VISIBLE_STATUSES,
  DEFAULT_HEIGHT,
  FULL_HEIGHT,
  MIN_HEIGHT,
  MINIMIZED_HEIGHT,
  type TerminalDrawerTarget,
} from './constants';

function issueTarget(issue: GitHubIssueCacheRecord): TerminalDrawerTarget | null {
  if (!issue.threadId) return null;
  return {
    kind: 'issue',
    threadId: issue.threadId,
    projectId: issue.projectId,
    title: issue.title,
    label: `#${issue.issueNumber}`,
    phase: issue.pipelineStatus as PipelinePhase,
    issue,
  };
}

function activeSummaryTarget(summary: ActivePipelineSummary): TerminalDrawerTarget {
  return {
    kind: 'thread',
    threadId: summary.threadId,
    projectId: summary.projectId,
    title: summary.threadTitle,
    label: summary.githubIssueNumber != null ? `#${summary.githubIssueNumber}` : 'Automation',
    phase: summary.phase,
    summary,
  };
}

function threadTarget(thread: Thread): TerminalDrawerTarget {
  return {
    kind: 'thread',
    threadId: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    label:
      thread.githubIssueNumber != null
        ? `#${thread.githubIssueNumber}`
        : thread.automationId
          ? 'Automation'
          : thread.kind === THREAD_KIND.instant
            ? 'Session'
            : 'Thread',
    phase: thread.status,
    thread,
  };
}

export function useTerminalDrawer() {
  const toggleTerminal = useAppStore((s) => s.toggleTerminal);
  const setTerminalMaximized = useAppStore((s) => s.setTerminalMaximized);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const terminalThreadId = useAppStore((s) => s.terminalThreadId);
  const assistantThreadId = useAppStore((s) => s.assistantThreadId);
  const githubIssues = useAppStore((s) => s.githubIssues);
  const activeIssue = useAppStore((s) => s.activeIssue);
  const scopedIssues = useMemo(
    () => githubIssues.filter((issue) => issue.projectId === activeProjectId),
    [githubIssues, activeProjectId],
  );
  const { data: activePipelines = [] } = useQuery<ActivePipelineSummary[]>({
    queryKey: ['dashboard', 'running'],
    queryFn: async () => {
      const result = await window.shipcode.invoke<ActivePipelineSummary[]>('pipeline:list-active');
      return Array.isArray(result) ? result : [];
    },
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });
  const issueTargets = useMemo(
    () =>
      scopedIssues.flatMap((issue) => {
        const target = issueTarget(issue);
        return target ? [target] : [];
      }),
    [scopedIssues],
  );
  const { runningIssueTargets, issueThreadIds } = useMemo(() => {
    const running: TerminalDrawerTarget[] = [];
    const threadIds = new Set<string>();
    for (const target of issueTargets) {
      if (CONSOLE_VISIBLE_STATUSES.has(target.phase)) {
        running.push(target);
      }
      threadIds.add(target.threadId);
    }
    return { runningIssueTargets: running, issueThreadIds: threadIds };
  }, [issueTargets]);
  const syntheticActiveTargets = useMemo(
    () =>
      activePipelines.flatMap((summary) =>
        summary.projectId === activeProjectId &&
        summary.threadId !== assistantThreadId &&
        !issueThreadIds.has(summary.threadId)
          ? [activeSummaryTarget(summary)]
          : [],
      ),
    [activePipelines, activeProjectId, assistantThreadId, issueThreadIds],
  );
  const runningTargets = useMemo(
    () => [...runningIssueTargets, ...syntheticActiveTargets],
    [runningIssueTargets, syntheticActiveTargets],
  );
  const scopedActiveIssue = activeIssue?.projectId === activeProjectId ? activeIssue : null;
  const explicitTarget =
    terminalThreadId != null
      ? (issueTargets.find((target) => target.threadId === terminalThreadId) ??
        (scopedActiveIssue?.threadId === terminalThreadId
          ? issueTarget(scopedActiveIssue)
          : null) ??
        syntheticActiveTargets.find((target) => target.threadId === terminalThreadId) ??
        null)
      : null;
  const { data: explicitThread = null } = useQuery<Thread | null>({
    queryKey: ['terminal-drawer-thread', terminalThreadId],
    queryFn: () => {
      if (!terminalThreadId) return null;
      return window.shipcode.invoke<Thread | null>('thread:get', { threadId: terminalThreadId });
    },
    enabled: !!terminalThreadId && explicitTarget == null,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });
  const explicitThreadTarget =
    explicitThread &&
    explicitThread.projectId === activeProjectId &&
    explicitThread.id !== assistantThreadId
      ? threadTarget(explicitThread)
      : null;
  const activeIssueMatch =
    scopedActiveIssue?.threadId != null
      ? (issueTargets.find((target) => target.threadId === scopedActiveIssue.threadId) ??
        issueTarget(scopedActiveIssue))
      : null;
  const fallbackTarget = activeIssueMatch || runningTargets[0] || null;
  const displayTarget = explicitTarget ?? explicitThreadTarget ?? fallbackTarget;
  const visibleTerminalThreadId = displayTarget?.threadId ?? null;
  const firstEventCreatedAt = useAppStore((s) =>
    visibleTerminalThreadId
      ? (s.canonicalTerminalStream[visibleTerminalThreadId]?.[0]?.createdAt ?? null)
      : null,
  );
  const activeThreadId = useAppStore((s) => s.activeThreadId);
  const pipelinePhase = useAppStore((s) =>
    displayTarget == null
      ? PIPELINE_PHASE.idle
      : displayTarget.threadId === activeThreadId
        ? s.pipelinePhase
        : displayTarget.phase,
  );
  const { data: displayThreadPlans = [] } = useQuery<PlanRecord[]>({
    queryKey: ['terminal-drawer-plan-history', visibleTerminalThreadId],
    queryFn: () => window.shipcode.invoke('plan:list', { threadId: visibleTerminalThreadId }),
    enabled: !!visibleTerminalThreadId && displayTarget?.phase === PIPELINE_PHASE.approval,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });
  const latestPlanStatus = displayThreadPlans[0]?.status ?? null;
  const approvedAwaitingExecution =
    displayTarget?.phase === PIPELINE_PHASE.approval && latestPlanStatus === 'approved';
  const currentModel = useAppStore(
    (s) => (visibleTerminalThreadId ? s.currentModels[visibleTerminalThreadId] : null) ?? null,
  );
  const setTerminalThread = useAppStore((s) => s.setTerminalThread);
  const selectIssue = useAppStore((s) => s.selectIssue);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ y: number; h: number } | null>(null);
  const isMaximized = height >= FULL_HEIGHT;
  const isMinimized = height <= MINIMIZED_HEIGHT;

  const handleResizeMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const measuredHeight = event.currentTarget.parentElement?.getBoundingClientRect().height;
      const currentHeight = measuredHeight && measuredHeight > 0 ? measuredHeight : height;
      dragStartRef.current = { y: event.clientY, h: currentHeight };
      setTerminalMaximized(false);
      setIsDragging(true);

      const onMove = (moveEvent: MouseEvent) => {
        if (!dragStartRef.current) return;
        const delta = dragStartRef.current.y - moveEvent.clientY;
        setHeight(Math.max(MIN_HEIGHT, dragStartRef.current.h + delta));
      };

      const onUp = () => {
        dragStartRef.current = null;
        setIsDragging(false);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [height, setTerminalMaximized],
  );

  const toggleMaximize = useCallback(() => {
    setHeight((current) => (current >= FULL_HEIGHT ? DEFAULT_HEIGHT : FULL_HEIGHT));
    setTerminalMaximized(false);
  }, [setTerminalMaximized]);

  const resetHeight = useCallback(() => {
    setHeight(DEFAULT_HEIGHT);
    setTerminalMaximized(false);
  }, [setTerminalMaximized]);

  const toggleMinimized = useCallback(() => {
    setHeight((current) => (current <= MINIMIZED_HEIGHT ? DEFAULT_HEIGHT : MINIMIZED_HEIGHT));
    setTerminalMaximized(false);
  }, [setTerminalMaximized]);

  const handleRunningTargetSelect = useCallback(
    (target: TerminalDrawerTarget) => {
      setTerminalThread(target.threadId);
      if (target.kind === 'issue') {
        selectIssue(target.issue);
      }
    },
    [selectIssue, setTerminalThread],
  );

  return {
    currentModel,
    displayTarget,
    handleResizeMouseDown,
    handleRunningTargetSelect,
    approvedAwaitingExecution,
    isDragging,
    isMaximized,
    isMinimized,
    pipelinePhase,
    resolvedHeight: height,
    runningTargets,
    showEmptyState: displayTarget === null,
    startedAt: firstEventCreatedAt != null ? formatClockTime(firstEventCreatedAt) : null,
    terminalThreadId: visibleTerminalThreadId,
    resetHeight,
    toggleMinimized,
    toggleMaximize,
    toggleTerminal,
  };
}
