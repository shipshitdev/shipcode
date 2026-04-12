import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
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
import { useAppStore } from '../stores/app-store';
import type { GitHubIssueCacheRecord } from '@shipcode/shared';

const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 250;

const AGENT_ACTIVE_STATUSES = new Set(['planning', 'reviewing', 'revising', 'executing', 'testing', 'verifying', 'shipping']);

// Braille spinner frames for animated status indicator
const SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
const SPINNER_INTERVAL_MS = 80;

// Map pipeline phase to a human-readable label for the spinner
const PHASE_LABELS: Record<string, string> = {
  planning: 'Thinking',
  reviewing: 'Reviewing',
  revising: 'Thinking',
  executing: 'Working',
  testing: 'Running tests',
  verifying: 'Verifying',
  shipping: 'Shipping',
};

/**
 * Render a canonical TerminalEvent into an ANSI-formatted string for xterm.
 */
function renderTerminalEvent(event: import('@shipcode/agents').TerminalEvent): string | null {
  switch (event.kind) {
    case 'text':
      return event.content;
    case 'thinking':
      // Dim italic for reasoning/thinking blocks
      return `\x1b[2;3m${event.content}\x1b[0m`;
    case 'tool_start':
      return `\x1b[2m\u2192 ${event.summary}\x1b[0m`;
    case 'tool_end':
      if (event.exitCode !== undefined) {
        return event.exitCode === 0
          ? '\x1b[32m[exit 0]\x1b[0m'
          : `\x1b[31m[exit ${event.exitCode}]\x1b[0m`;
      }
      if (event.durationMs !== undefined) {
        return `\x1b[2m(${(event.durationMs / 1000).toFixed(1)}s)\x1b[0m`;
      }
      return null;
    case 'turn_start':
      return `\x1b[2m\u2500\u2500 Turn ${event.turn} \u2500\u2500\x1b[0m`;
    case 'turn_end': {
      const parts: string[] = [];
      if (event.tokensUsed) {
        parts.push(`${event.tokensUsed.prompt}+${event.tokensUsed.completion} tok`);
      }
      if (event.costUsd && event.costUsd > 0) {
        parts.push(`$${event.costUsd.toFixed(4)}`);
      }
      return parts.length > 0 ? `\x1b[2m${parts.join(' \u00b7 ')}\x1b[0m` : null;
    }
    case 'lifecycle':
      // Already contains ANSI codes from useIpc formatting
      return event.message;
    case 'raw':
      return event.content;
    case 'error':
      return `\x1b[31m${event.message}\x1b[0m`;
    case 'done': {
      const parts: string[] = [];
      if (event.totalTokens) {
        parts.push(`${event.totalTokens.prompt}+${event.totalTokens.completion} tok`);
      }
      if (event.totalCostUsd && event.totalCostUsd > 0) {
        parts.push(`~$${event.totalCostUsd.toFixed(4)}`);
      }
      return parts.length > 0 ? `\x1b[2m[done: ${parts.join(' \u00b7 ')}]\x1b[0m` : null;
    }
    default:
      return null;
  }
}

export function TerminalDrawer() {
  const { toggleTerminal } = useAppStore();
  const terminalThreadId = useAppStore((s) => s.terminalThreadId);
  const canonicalStream = useAppStore((s) =>
    s.terminalThreadId ? (s.canonicalTerminalStream[s.terminalThreadId] ?? []) : [],
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
  // Show skeleton between thread switches until first output arrives
  const [isTransitioning, setIsTransitioning] = useState(false);
  // Resize state
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isMaximized, setIsMaximized] = useState(false);
  const prevHeightRef = useRef(DEFAULT_HEIGHT);
  const dragStartRef = useRef<{ y: number; h: number } | null>(null);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
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
  }, [height]);

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
    };
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
      prevThreadIdRef.current = terminalThreadId;
      // Show skeleton only for threads with an active pipeline process —
      // idle/completed/failed threads will never produce output to clear it.
      const nextIssue = githubIssues.find((i) => i.threadId === terminalThreadId);
      setIsTransitioning(
        Boolean(nextIssue && AGENT_ACTIVE_STATUSES.has(nextIssue.pipelineStatus)),
      );
    }
  }, [terminalThreadId]);

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
      termRef.current.write(`\r\x1b[K\x1b[2;36m${SPINNER_FRAMES[frame]} ${spinnerLabelRef.current}...\x1b[0m`);
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

    // Hide skeleton when first canonical event arrives
    if (canonicalWrittenRef.current === 0 && newEvents.length > 0) {
      setIsTransitioning(false);
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
      // Determine spinner behavior based on event kind
      switch (event.kind) {
        case 'lifecycle': {
          // Extract phase from lifecycle message and start spinner
          const phaseMatch = /phase: \x1b\[36m(\w+)/.exec(event.message);
          if (phaseMatch) {
            const phase = phaseMatch[1];
            const label = PHASE_LABELS[phase] ?? 'Working';
            // Write the lifecycle line first, then start spinner on next line
            const normalized = event.message.replace(/\r?\n/g, '\r\n');
            term.write(normalized + '\r\n');
            startSpinner(label);
            continue;
          }
          // Non-phase lifecycle events (process start/exit, model resolved)
          stopSpinner();
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
          break;
        case 'text':
        case 'raw':
          stopSpinner();
          break;
        case 'turn_start':
          stopSpinner();
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
      term.write(normalized.endsWith('\r\n') ? normalized : normalized + '\r\n');

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
        <div
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
              <span className="text-xs text-accent font-medium shrink-0 capitalize">{pipelinePhase}</span>
            </>
          )}
          {currentModel && pipelinePhase !== 'idle' && (
            <>
              <span className="text-muted text-xs shrink-0">·</span>
              <span className="text-xs font-mono text-muted shrink-0 truncate max-w-[180px]">{currentModel}</span>
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
        {/* Skeleton overlay while switching threads */}
        {isTransitioning && (
          <div className="absolute inset-0 flex flex-col gap-2 p-3 bg-[#0c0d10]">
            {[70, 50, 85, 40, 65].map((w, i) => (
              <div
                key={i}
                className="h-3 rounded animate-pulse bg-white/5"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
