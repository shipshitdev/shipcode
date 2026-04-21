import type { GitHubIssueCacheRecord, TerminalEventRecord } from '@shipcode/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/app-store';
import {
  CONSOLE_VISIBLE_STATUSES,
  DEFAULT_HEIGHT,
  EMPTY_STREAM,
  MIN_HEIGHT,
  PHASE_LABELS,
} from './constants';

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
  const canonicalStream = useAppStore((s) =>
    visibleTerminalThreadId
      ? (s.canonicalTerminalStream[visibleTerminalThreadId] ?? EMPTY_STREAM)
      : EMPTY_STREAM,
  );
  const activeThreadId = useAppStore((s) => s.activeThreadId);
  const pipelinePhase = useAppStore((s) =>
    displayIssue == null
      ? 'idle'
      : displayIssue.threadId === activeThreadId
        ? s.pipelinePhase
        : (displayIssue.pipelineStatus as typeof s.pipelinePhase),
  );
  const currentModel = useAppStore(
    (s) => (visibleTerminalThreadId ? s.currentModels[visibleTerminalThreadId] : null) ?? null,
  );
  const hydrateCanonicalEvents = useAppStore((s) => s.hydrateCanonicalEvents);
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

  useEffect(() => {
    if (!visibleTerminalThreadId) return;
    if (canonicalStream.length > 0) return;

    let cancelled = false;
    void window.shipcode
      .invoke<TerminalEventRecord[]>('terminal:list', {
        threadId: visibleTerminalThreadId,
        limit: 2000,
      })
      .then((events) => {
        if (cancelled || !Array.isArray(events) || events.length === 0) return;
        hydrateCanonicalEvents(visibleTerminalThreadId, events);
      })
      .catch(() => {
        // Best-effort hydration only.
      });

    return () => {
      cancelled = true;
    };
  }, [canonicalStream.length, hydrateCanonicalEvents, visibleTerminalThreadId]);

  const handleRunningTabSelect = useCallback(
    (issue: GitHubIssueCacheRecord) => {
      setTerminalThread(issue.threadId ?? null);
      selectIssue(issue);
    },
    [selectIssue, setTerminalThread],
  );

  return {
    canonicalStream,
    currentModel,
    displayIssue,
    handleResizeMouseDown,
    handleRunningTabSelect,
    isMaximized,
    pendingLabel:
      canonicalStream.length === 0 && displayIssue?.pipelineStatus
        ? (PHASE_LABELS[displayIssue.pipelineStatus] ?? 'Working')
        : null,
    pipelinePhase,
    resolvedHeight: isMaximized ? undefined : height,
    runningTabs,
    showEmptyState: displayIssue === null,
    startedAt:
      canonicalStream[0]?.createdAt != null
        ? new Date(canonicalStream[0].createdAt).toLocaleTimeString('en-US', {
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
