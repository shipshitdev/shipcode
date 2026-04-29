import type {
  ActivePipelineSummary,
  GitHubIssueCacheRecord,
  PipelinePhase,
  PlanRecord,
  Thread,
} from '@shipcode/shared';
import { PIPELINE_PHASE } from '@shipcode/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { STABLE_APP_STATE_STALE_TIME } from '../../query-stale-times';
import { useAppStore } from '../../stores/app-store';
import {
  CONSOLE_VISIBLE_STATUSES,
  DEFAULT_HEIGHT,
  MIN_HEIGHT,
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
          : thread.kind === 'instant'
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
  const isMaximized = useAppStore((s) => s.terminalMaximized);
  const githubIssues = useAppStore((s) => s.githubIssues);
  const activeIssue = useAppStore((s) => s.activeIssue);
  const scopedIssues = githubIssues.filter((issue) => issue.projectId === activeProjectId);
  const { data: activePipelines = [] } = useQuery<ActivePipelineSummary[]>({
    queryKey: ['pipeline-list-active'],
    queryFn: async () => {
      const result = await window.shipcode.invoke<ActivePipelineSummary[]>('pipeline:list-active');
      return Array.isArray(result) ? result : [];
    },
    refetchInterval: 2_000,
  });
  const issueTargets = scopedIssues
    .map(issueTarget)
    .filter((target): target is TerminalDrawerTarget => target !== null);
  const runningIssueTargets = issueTargets.filter((target) =>
    CONSOLE_VISIBLE_STATUSES.has(target.phase),
  );
  const issueThreadIds = new Set(issueTargets.map((target) => target.threadId));
  const syntheticActiveTargets = activePipelines
    .filter((summary) => summary.projectId === activeProjectId)
    .filter((summary) => !issueThreadIds.has(summary.threadId))
    .map(activeSummaryTarget);
  const runningTargets = [...runningIssueTargets, ...syntheticActiveTargets];
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
    explicitThread && explicitThread.projectId === activeProjectId
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
    enabled: !!visibleTerminalThreadId && displayTarget?.phase === PIPELINE_PHASE.awaitingApproval,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });
  const latestPlanStatus = displayThreadPlans[0]?.status ?? null;
  const approvedAwaitingExecution =
    displayTarget?.phase === PIPELINE_PHASE.awaitingApproval && latestPlanStatus === 'approved';
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
    isMaximized,
    pipelinePhase,
    resolvedHeight: isMaximized ? undefined : height,
    runningTargets,
    showEmptyState: displayTarget === null,
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
