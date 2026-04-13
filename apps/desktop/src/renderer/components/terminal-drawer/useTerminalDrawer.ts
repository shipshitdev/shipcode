import type { GitHubIssueCacheRecord } from '@shipcode/shared';
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

export function useTerminalDrawer() {
  const { toggleTerminal } = useAppStore();
  const terminalThreadId = useAppStore((s) => s.terminalThreadId);
  const canonicalStream = useAppStore((s) =>
    s.terminalThreadId
      ? (s.canonicalTerminalStream[s.terminalThreadId] ?? EMPTY_STREAM)
      : EMPTY_STREAM,
  );
  const activeIssue = useAppStore((s) => s.activeIssue);
  const pipelinePhase = useAppStore((s) => s.pipelinePhase);
  const currentModel = useAppStore(
    (s) => (s.terminalThreadId ? s.currentModels[s.terminalThreadId] : null) ?? null,
  );
  const githubIssues = useAppStore((s) => s.githubIssues);
  const setTerminalThread = useAppStore((s) => s.setTerminalThread);
  const selectIssue = useAppStore((s) => s.selectIssue);

  const [pinnedIssue, setPinnedIssue] = useState<GitHubIssueCacheRecord | null>(null);
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

  useEffect(() => {
    if (activeIssue) setPinnedIssue(activeIssue);
  }, [activeIssue]);

  useEffect(() => {
    if (!terminalThreadId) return;
    const found = githubIssues.find((issue) => issue.threadId === terminalThreadId);
    if (found) setPinnedIssue(found);
  }, [terminalThreadId, githubIssues]);

  const runningTabs = githubIssues.filter((issue) =>
    AGENT_ACTIVE_STATUSES.has(issue.pipelineStatus),
  );

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
      theme: {
        background: '#0c0d10',
        foreground: '#b4b4bc',
        cursor: '#f4f4f5',
        selectionBackground: 'rgba(244, 244, 245, 0.2)',
        black: '#1a1b1e',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#89dceb',
        white: '#cdd6f4',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#89dceb',
        brightWhite: '#ffffff',
      },
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

    if (terminalThreadId !== prevThreadIdRef.current) {
      stopSpinner();
      term.reset();
      canonicalWrittenRef.current = 0;
      startedAtRef.current = null;
      lastKindRef.current = null;
      setActionBanner(null);
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      prevThreadIdRef.current = terminalThreadId;

      const nextIssue = githubIssues.find((issue) => issue.threadId === terminalThreadId);
      const nextStream = terminalThreadId
        ? (useAppStore.getState().canonicalTerminalStream[terminalThreadId] ?? [])
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
  }, [githubIssues, startSpinner, stopSpinner, terminalThreadId]);

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
      startedAtRef.current = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }

    for (const event of newEvents) {
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
    if (actionBanner?.action === 'open-issue-detail' && pinnedIssue) {
      selectIssue(pinnedIssue);
    }
  }, [actionBanner?.action, pinnedIssue, selectIssue]);

  const dismissActionBanner = useCallback(() => {
    setActionBanner(null);
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
  }, []);

  return {
    actionBanner,
    canonicalStream,
    containerRef,
    currentModel,
    displayIssue: pinnedIssue,
    dismissActionBanner,
    handleActionBannerClick,
    handleResizeMouseDown,
    handleRunningTabSelect,
    isMaximized,
    pipelinePhase,
    resolvedHeight: isMaximized ? undefined : height,
    runningTabs,
    startedAt: startedAtRef.current,
    terminalThreadId,
    toggleMaximize,
    toggleTerminal,
  };
}
