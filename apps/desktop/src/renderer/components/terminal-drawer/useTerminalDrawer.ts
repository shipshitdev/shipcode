import type { GitHubIssueCacheRecord, TerminalEventRecord } from '@shipcode/shared';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/app-store';
import {
  AGENT_ACTIVE_STATUSES,
  CONTENT_KINDS,
  DEFAULT_HEIGHT,
  EMPTY_STREAM,
  LIFECYCLE_KINDS,
  MIN_HEIGHT,
  PHASE_LABELS,
  SPINNER_FRAMES,
  SPINNER_INTERVAL_MS,
} from './constants';
import { renderTerminalEvent } from './render-terminal-event';

function readCssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function buildTerminalTheme() {
  return {
    background: readCssColor('--bg-secondary', '#0c0d10'),
    foreground: readCssColor('--text-secondary', '#b4b4bc'),
    cursor: readCssColor('--text-primary', '#f4f4f5'),
    selectionBackground:
      readCssColor('--data-terminal-selection', '') ||
      (document.documentElement.dataset.theme === 'light'
        ? 'rgba(17, 24, 39, 0.14)'
        : 'rgba(244, 244, 245, 0.20)'),
    black: readCssColor('--bg-elevated', '#1a1c21'),
    red: '#ef4444',
    green: '#10b981',
    yellow: '#f59e0b',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: readCssColor('--text-primary', '#f4f4f5'),
    brightBlack: readCssColor('--text-muted', '#6b6b78'),
    brightRed: '#f87171',
    brightGreen: '#34d399',
    brightYellow: '#fbbf24',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: readCssColor('--accent', '#fafafa'),
  };
}

export function useTerminalDrawer() {
  const { toggleTerminal } = useAppStore();
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const terminalThreadId = useAppStore((s) => s.terminalThreadId);
  const githubIssues = useAppStore((s) => s.githubIssues);
  const activeIssue = useAppStore((s) => s.activeIssue);
  const scopedIssues = githubIssues.filter((issue) => issue.projectId === activeProjectId);
  const runningTabs = scopedIssues.filter((issue) =>
    AGENT_ACTIVE_STATUSES.has(issue.pipelineStatus),
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
  const [actionBanner, setActionBanner] = useState<{
    label: string;
    action: 'open-issue-detail';
  } | null>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isMaximized, setIsMaximized] = useState(false);

  const startedAtRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const prevThreadIdRef = useRef<string | null>(null);
  const canonicalWrittenRef = useRef(0);
  const spinnerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spinnerActiveRef = useRef(false);
  const spinnerLabelRef = useRef('Thinking');
  const lastKindRef = useRef<string | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        fitRef.current?.fit();
      };

      const onUp = () => {
        dragStartRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        fitRef.current?.fit();
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
    setIsMaximized((value) => !value);
    setTimeout(() => fitRef.current?.fit(), 0);
  }, [height, isMaximized]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: buildTerminalTheme(),
      fontFamily: '"SF Mono", SFMono-Regular, Consolas, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.5,
      cursorBlink: false,
      disableStdin: true,
      scrollback: 5000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const resizeObserver = new ResizeObserver(() => fit.fit());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const root = document.documentElement;
    const applyTheme = () => {
      term.options.theme = buildTerminalTheme();
      term.refresh(0, term.rows - 1);
    };

    applyTheme();

    const observer = new MutationObserver(applyTheme);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-font-style'],
    });

    return () => observer.disconnect();
  }, []);

  const startSpinner = useCallback((label: string) => {
    const term = termRef.current;
    if (!term || spinnerActiveRef.current) return;

    spinnerActiveRef.current = true;
    spinnerLabelRef.current = label;
    let frame = 0;

    term.write(`\r\x1b[K\x1b[2;36m${SPINNER_FRAMES[0]} ${label}...\x1b[0m`);
    spinnerTimerRef.current = setInterval(() => {
      if (!termRef.current) return;
      frame = (frame + 1) % SPINNER_FRAMES.length;
      termRef.current.write(
        `\r\x1b[K\x1b[2;36m${SPINNER_FRAMES[frame]} ${spinnerLabelRef.current}...\x1b[0m`,
      );
    }, SPINNER_INTERVAL_MS);
  }, []);

  const stopSpinner = useCallback(() => {
    if (!spinnerActiveRef.current) return;
    if (spinnerTimerRef.current) {
      clearInterval(spinnerTimerRef.current);
      spinnerTimerRef.current = null;
    }
    spinnerActiveRef.current = false;
    termRef.current?.write('\r\x1b[K');
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    if (visibleTerminalThreadId !== prevThreadIdRef.current) {
      stopSpinner();
      term.reset();
      fitRef.current?.fit();
      canonicalWrittenRef.current = 0;
      startedAtRef.current = null;
      lastKindRef.current = null;
      setActionBanner(null);
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      prevThreadIdRef.current = visibleTerminalThreadId;

      const nextIssue = scopedIssues.find((issue) => issue.threadId === visibleTerminalThreadId);
      const nextStream = visibleTerminalThreadId
        ? (useAppStore.getState().canonicalTerminalStream[visibleTerminalThreadId] ?? [])
        : [];
      const nextIssueStatus = nextIssue?.pipelineStatus;
      const isActivePipeline =
        nextIssueStatus != null &&
        (AGENT_ACTIVE_STATUSES.has(nextIssueStatus) || nextIssueStatus === 'queued');

      if (nextStream.length === 0 && isActivePipeline) {
        const label = nextIssueStatus ? (PHASE_LABELS[nextIssueStatus] ?? 'Working') : 'Working';
        setTimeout(() => {
          if (canonicalWrittenRef.current === 0) startSpinner(label);
        }, 0);
      }
    }
  }, [scopedIssues, startSpinner, stopSpinner, visibleTerminalThreadId]);

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

  useEffect(() => {
    return () => {
      if (spinnerTimerRef.current) clearInterval(spinnerTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const newEvents = canonicalStream.slice(canonicalWrittenRef.current);
    if (newEvents.length === 0) return;

    if (canonicalWrittenRef.current === 0 && newEvents.length > 0 && !startedAtRef.current) {
      // xterm wraps against its current column count, not CSS. Re-fit before
      // replaying the first batch so hydrated history wraps for the drawer's
      // current width instead of whatever size the terminal last used.
      fitRef.current?.fit();
      startedAtRef.current = new Date(newEvents[0].createdAt).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }

    for (const entry of newEvents) {
      const event = entry.event;
      if (event.kind === 'action') {
        stopSpinner();
        if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
        setActionBanner({ label: event.label, action: event.action });
        bannerTimerRef.current = setTimeout(() => setActionBanner(null), 8_000);
        lastKindRef.current = event.kind;
        continue;
      }

      switch (event.kind) {
        case 'lifecycle': {
          const phaseMessage = event.message.replaceAll('\x1b[36m', '').replaceAll('\x1b[0m', '');
          const phaseMatch = /phase: (\w+)/.exec(phaseMessage);
          if (phaseMatch) {
            const phase = phaseMatch[1];
            if (lastKindRef.current && !LIFECYCLE_KINDS.has(lastKindRef.current)) {
              term.write('\r\n');
            }
            const normalized = event.message.replace(/\r?\n/g, '\r\n');
            term.write(`${normalized}\r\n`);
            lastKindRef.current = event.kind;
            stopSpinner();
            if (AGENT_ACTIVE_STATUSES.has(phase)) {
              startSpinner(PHASE_LABELS[phase] ?? 'Working');
            }
            continue;
          }
          if (lastKindRef.current && CONTENT_KINDS.has(lastKindRef.current)) {
            stopSpinner();
            term.write('\r\n');
          } else {
            stopSpinner();
          }
          break;
        }
        case 'tool_start':
          stopSpinner();
          break;
        case 'tool_end':
          break;
        case 'thinking':
          stopSpinner();
          if (lastKindRef.current && LIFECYCLE_KINDS.has(lastKindRef.current)) {
            term.write('\r\n');
          }
          break;
        case 'text':
        case 'raw':
          stopSpinner();
          if (lastKindRef.current && LIFECYCLE_KINDS.has(lastKindRef.current)) {
            term.write('\r\n');
          }
          break;
        case 'turn_start':
          stopSpinner();
          if (lastKindRef.current) {
            term.write('\r\n');
          }
          break;
        case 'done':
        case 'error':
          stopSpinner();
          break;
        default:
          break;
      }

      const text = renderTerminalEvent(event);
      if (text === null) continue;

      const normalized = text.replace(/\r?\n/g, '\r\n');
      term.write(normalized.endsWith('\r\n') ? normalized : `${normalized}\r\n`);
      lastKindRef.current = event.kind;

      if (event.kind === 'tool_start') {
        startSpinner('Working');
      } else if (event.kind === 'tool_end' || event.kind === 'turn_end') {
        startSpinner('Thinking');
      }
    }

    canonicalWrittenRef.current = canonicalStream.length;
  }, [canonicalStream, startSpinner, stopSpinner]);

  const handleRunningTabSelect = useCallback(
    (issue: GitHubIssueCacheRecord) => {
      setTerminalThread(issue.threadId ?? null);
      selectIssue(issue);
    },
    [selectIssue, setTerminalThread],
  );

  const handleActionBannerClick = useCallback(() => {
    if (actionBanner?.action === 'open-issue-detail' && displayIssue) {
      selectIssue(displayIssue);
    }
  }, [actionBanner?.action, displayIssue, selectIssue]);

  const dismissActionBanner = useCallback(() => {
    setActionBanner(null);
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
  }, []);

  return {
    actionBanner,
    canonicalStream,
    containerRef,
    currentModel,
    displayIssue,
    dismissActionBanner,
    handleActionBannerClick,
    handleResizeMouseDown,
    handleRunningTabSelect,
    isMaximized,
    pipelinePhase,
    resolvedHeight: isMaximized ? undefined : height,
    runningTabs,
    showEmptyState: displayIssue === null,
    startedAt: startedAtRef.current,
    terminalThreadId: visibleTerminalThreadId,
    toggleMaximize,
    toggleTerminal,
  };
}
