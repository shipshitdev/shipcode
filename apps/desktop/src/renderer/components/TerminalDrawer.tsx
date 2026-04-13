import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import {
  Button,
  ChevronDown,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Maximize2,
  Minimize2,
  X,
} from '@shipcode/ui';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/app-store';
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
} from './terminal-drawer/constants';
import { renderTerminalEvent } from './terminal-drawer/render-terminal-event';

export function TerminalDrawer() {
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

  // Pinned issue: tracks the last non-null activeIssue so header stays populated
  // when the user navigates to Dashboard/Costs/Activity.
  const [pinnedIssue, setPinnedIssue] = useState<GitHubIssueCacheRecord | null>(null);
  useEffect(() => {
    if (activeIssue) setPinnedIssue(activeIssue);
  }, [activeIssue]);
  // Also sync pinnedIssue when terminalThreadId points to a different issue than current pinnedIssue
  useEffect(() => {
    if (!terminalThreadId) return;
    const found = githubIssues.find((i) => i.threadId === terminalThreadId);
    if (found) setPinnedIssue(found);
  }, [terminalThreadId, githubIssues]);

  // Running tasks: issues with an active pipeline status — shown as tabs
  const runningTabs = githubIssues.filter((i) => AGENT_ACTIVE_STATUSES.has(i.pipelineStatus));

  // Track when the current pipeline run started (first event for this thread)
  const startedAtRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const prevThreadIdRef = useRef<string | null>(null);
  // Track how many canonical events have been written
  const canonicalWrittenRef = useRef(0);
  // Animated spinner state
  const spinnerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spinnerActiveRef = useRef(false);
  const spinnerLabelRef = useRef('Thinking');
  const lastKindRef = useRef<string | null>(null);
  // Action banner (single clickable link rendered as React, not xterm text)
  const [actionBanner, setActionBanner] = useState<{
    label: string;
    action: 'open-issue-detail';
  } | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Resize state
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isMaximized, setIsMaximized] = useState(false);
  const prevHeightRef = useRef(DEFAULT_HEIGHT);
  const dragStartRef = useRef<{ y: number; h: number } | null>(null);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartRef.current = { y: e.clientY, h: height };
      const onMove = (ev: MouseEvent) => {
        if (!dragStartRef.current) return;
        const delta = dragStartRef.current.y - ev.clientY;
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
      // Fill available content area — parent flex-col, so use a large value
      // and let the container clamp it naturally.
      setHeight(9999);
    }
    setIsMaximized((v) => !v);
    setTimeout(() => fitRef.current?.fit(), 0);
  }, [isMaximized, height]);

  // Init xterm once
  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      theme: {
        background: '#0c0d10',
        foreground: '#b4b4bc',
        cursor: '#f4f4f5',
        selectionBackground: 'rgba(244, 244, 245, 0.2)',
        // Catppuccin Mocha palette for readable ANSI colors on the dark background
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

    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, []);

  // Spinner helpers — animate a braille spinner on the current line
  const startSpinner = useCallback((label: string) => {
    const term = termRef.current;
    if (!term || spinnerActiveRef.current) return;
    spinnerActiveRef.current = true;
    spinnerLabelRef.current = label;
    let frame = 0;
    // Write the first frame immediately
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
    // Clear the spinner line
    termRef.current?.write('\r\x1b[K');
  }, []);

  // Clear terminal when the focused terminal thread changes
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
      // If the stream is empty but a pipeline is actively running on this thread,
      // start the xterm spinner immediately so the terminal isn't blank.
      // This covers the case where the app hot-reloaded mid-pipeline and the
      // historical pipeline:phase event was never re-received.
      const nextIssue = githubIssues.find((i) => i.threadId === terminalThreadId);
      const nextStream = terminalThreadId
        ? (useAppStore.getState().canonicalTerminalStream[terminalThreadId] ?? [])
        : [];
      const nextIssueStatus = nextIssue?.pipelineStatus;
      const isActivePipeline =
        nextIssueStatus != null &&
        (AGENT_ACTIVE_STATUSES.has(nextIssueStatus) || nextIssueStatus === 'queued');
      if (nextStream.length === 0 && isActivePipeline) {
        const label = nextIssueStatus ? (PHASE_LABELS[nextIssueStatus] ?? 'Working') : 'Working';
        // Defer past xterm reset so the spinner writes to a clean terminal.
        // Guard with canonicalWrittenRef check — if events arrived between
        // the reset and this timeout, the spinner was already started by the
        // event rendering effect and we should not double-start it.
        setTimeout(() => {
          if (canonicalWrittenRef.current === 0) startSpinner(label);
        }, 0);
      }
    }
  }, [githubIssues, startSpinner, stopSpinner, terminalThreadId]);

  // Clean up spinner on unmount
  useEffect(() => {
    return () => {
      if (spinnerTimerRef.current) clearInterval(spinnerTimerRef.current);
    };
  }, []);

  // Write canonical terminal events (normalized from all providers)
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const newEvents = canonicalStream.slice(canonicalWrittenRef.current);
    if (newEvents.length === 0) return;

    // Record start time when first canonical event arrives
    if (canonicalWrittenRef.current === 0 && newEvents.length > 0) {
      if (!startedAtRef.current) {
        startedAtRef.current = new Date().toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
      }
    }

    for (const event of newEvents) {
      // Action events → clickable React banner, not xterm text
      if (event.kind === 'action') {
        stopSpinner();
        if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
        setActionBanner({ label: event.label, action: event.action });
        bannerTimerRef.current = setTimeout(() => setActionBanner(null), 8_000);
        lastKindRef.current = event.kind;
        continue;
      }

      // Determine spinner behavior based on event kind
      switch (event.kind) {
        case 'lifecycle': {
          // Only active pipeline phases get a spinner. Terminal states like
          // failed/completed/idle should render the phase line and stop there.
          const phaseMessage = event.message.replaceAll('\x1b[36m', '').replaceAll('\x1b[0m', '');
          const phaseMatch = /phase: (\w+)/.exec(phaseMessage);
          if (phaseMatch) {
            const phase = phaseMatch[1];
            // Blank line before phase transitions for visual separation
            if (lastKindRef.current && !LIFECYCLE_KINDS.has(lastKindRef.current)) {
              term.write('\r\n');
            }
            // Write the lifecycle line first. Restart the spinner only for
            // phases that actually represent ongoing agent work.
            const normalized = event.message.replace(/\r?\n/g, '\r\n');
            term.write(`${normalized}\r\n`);
            lastKindRef.current = event.kind;
            stopSpinner();
            if (AGENT_ACTIVE_STATUSES.has(phase)) {
              startSpinner(PHASE_LABELS[phase] ?? 'Working');
            }
            continue;
          }
          // Non-phase lifecycle events (process start/exit, model resolved)
          // Insert blank line when transitioning from content → lifecycle
          if (lastKindRef.current && CONTENT_KINDS.has(lastKindRef.current)) {
            stopSpinner();
            term.write('\r\n');
          } else {
            stopSpinner();
          }
          break;
        }
        case 'tool_start':
          // Stop spinner, write the tool line, then restart with "Working"
          stopSpinner();
          break;
        case 'tool_end':
          // After tool completes, spinner restarts
          break;
        case 'thinking':
          // Stop any existing spinner — real thinking content is arriving
          stopSpinner();
          // Blank line before thinking when coming from lifecycle events
          if (lastKindRef.current && LIFECYCLE_KINDS.has(lastKindRef.current)) {
            term.write('\r\n');
          }
          break;
        case 'text':
        case 'raw':
          stopSpinner();
          // Blank line before agent text when coming from lifecycle events
          if (lastKindRef.current && LIFECYCLE_KINDS.has(lastKindRef.current)) {
            term.write('\r\n');
          }
          break;
        case 'turn_start':
          stopSpinner();
          // Always add blank line before turn separators
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
      // Normalize line endings for xterm
      const normalized = text.replace(/\r?\n/g, '\r\n');
      term.write(normalized.endsWith('\r\n') ? normalized : `${normalized}\r\n`);
      lastKindRef.current = event.kind;

      // After certain events, start/restart spinner
      if (event.kind === 'tool_start') {
        startSpinner('Working');
      } else if (event.kind === 'tool_end') {
        startSpinner('Thinking');
      } else if (event.kind === 'turn_end') {
        startSpinner('Thinking');
      }
    }
    canonicalWrittenRef.current = canonicalStream.length;
  }, [canonicalStream, startSpinner, stopSpinner]);

  const resolvedHeight = isMaximized ? undefined : height;
  const displayIssue = pinnedIssue;

  return (
    <div
      className="flex flex-col border-t border-border bg-secondary shrink-0"
      style={isMaximized ? { flex: '1 1 0', minHeight: 0 } : { height: resolvedHeight }}
    >
      {/* Drag-to-resize handle */}
      {!isMaximized && (
        <button
          type="button"
          aria-label="Resize terminal drawer"
          className="h-1 cursor-ns-resize hover:bg-accent/30 transition-colors shrink-0"
          onMouseDown={handleResizeMouseDown}
        />
      )}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 shrink-0 gap-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <span className="text-xs font-semibold text-secondary shrink-0">Terminal</span>
          {displayIssue && (
            <>
              <span className="text-muted text-xs shrink-0">·</span>
              {runningTabs.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-auto min-w-0 gap-1.5 px-1 py-0 text-xs font-normal hover:bg-transparent"
                    >
                      <span className="font-mono text-muted">#{displayIssue.issueNumber}</span>
                      <span className="text-secondary truncate max-w-[240px]">
                        {displayIssue.title}
                      </span>
                      <ChevronDown size={11} className="text-muted shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="top">
                    {runningTabs.map((issue) => (
                      <DropdownMenuItem
                        key={issue.threadId}
                        onSelect={() => {
                          setTerminalThread(issue.threadId ?? null);
                          selectIssue(issue);
                        }}
                        className={cn(
                          issue.threadId === terminalThreadId && 'bg-hover text-primary',
                        )}
                      >
                        <span className="font-mono text-muted text-xs">#{issue.issueNumber}</span>
                        <span className="truncate max-w-[280px]">{issue.title}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => selectIssue(displayIssue)}
                  className="h-auto min-w-0 gap-1.5 px-1 py-0 text-xs font-normal hover:bg-transparent"
                  title={`Open issue detail for #${displayIssue.issueNumber}`}
                >
                  <span className="font-mono text-muted">#{displayIssue.issueNumber}</span>
                  <span className="text-secondary truncate hover:text-primary">
                    {displayIssue.title}
                  </span>
                </Button>
              )}
            </>
          )}
          {pipelinePhase !== 'idle' && (
            <>
              <span className="text-muted text-xs shrink-0">·</span>
              <span className="text-xs text-accent font-medium shrink-0 capitalize">
                {pipelinePhase}
              </span>
            </>
          )}
          {currentModel && pipelinePhase !== 'idle' && (
            <>
              <span className="text-muted text-xs shrink-0">·</span>
              <span className="text-xs font-mono text-muted shrink-0 truncate max-w-[180px]">
                {currentModel}
              </span>
            </>
          )}
          {startedAtRef.current && canonicalStream.length > 0 && (
            <>
              <span className="text-muted text-xs shrink-0">·</span>
              <span className="text-xs font-mono text-muted shrink-0">{startedAtRef.current}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={toggleMaximize}
            title={isMaximized ? 'Restore terminal' : 'Maximize terminal'}
            aria-label={isMaximized ? 'Restore terminal' : 'Maximize terminal'}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={toggleTerminal}
            title="Close terminal"
            aria-label="Close terminal"
          >
            <X size={14} />
          </Button>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        {/* Action banner — clickable toast rendered over the terminal */}
        {actionBanner && (
          <div className="absolute bottom-0 left-0 right-0 z-10 p-3">
            <div className="group flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 shadow-lg backdrop-blur-sm">
              <Button
                variant="ghost"
                onClick={() => {
                  if (actionBanner.action === 'open-issue-detail' && pinnedIssue) {
                    selectIssue(pinnedIssue);
                  }
                }}
                className="h-auto flex-1 justify-start whitespace-normal px-0 py-0 text-left font-normal hover:bg-transparent"
              >
                <div className="flex flex-col items-start gap-0.5">
                  <div className="text-[12px] font-semibold text-primary">{actionBanner.label}</div>
                  <div className="text-[11px] text-secondary">
                    {pinnedIssue
                      ? `#${pinnedIssue.issueNumber} ${pinnedIssue.title} -- click to open`
                      : 'Click to open Issue Detail'}
                  </div>
                </div>
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => {
                  setActionBanner(null);
                  if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
                }}
                className="text-muted hover:bg-transparent hover:text-primary"
                title="Dismiss"
              >
                <X size={14} />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
