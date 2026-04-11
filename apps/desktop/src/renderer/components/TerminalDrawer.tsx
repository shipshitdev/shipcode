import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Button, cn, Maximize2, Minimize2, X } from '@shipcode/ui';
import { useAppStore } from '../stores/app-store';
import type { GitHubIssueCacheRecord } from '@shipcode/shared';

const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 250;

// Strip the final JSON result envelope that claude -p --output-format stream-json emits.
// The result blob is for StreamParser; not useful to display in the terminal.
const JSON_RESULT_RE = /\{"type":"result"[^\n]*\n?/g;

function sanitize(chunk: string): string {
  return chunk.replace(JSON_RESULT_RE, '');
}

/**
 * Extract displayable text from a single parsed NDJSON event.
 * Handles both claude --output-format stream-json and codex exec --json formats.
 * Returns null for events that should not be displayed (system noise, etc.).
 */
/** Format a claude tool_use input into a short, readable summary. */
function formatToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': return `Read ${input.file_path ?? ''}`
    case 'Write': return `Write ${input.file_path ?? ''}`
    case 'Edit': return `Edit ${input.file_path ?? ''}`
    case 'Glob': return `Glob ${input.pattern ?? ''}`
    case 'Grep': return `Grep "${input.pattern ?? ''}"${input.path ? ` in ${input.path}` : ''}`
    case 'Bash': {
      const cmd = String(input.command ?? '')
      return `$ ${cmd.length > 60 ? cmd.slice(0, 60) + '…' : cmd}`
    }
    case 'TodoWrite': return `TodoWrite (${(input.todos as unknown[])?.length ?? '?'} items)`
    default: {
      const first = Object.values(input)[0]
      return first ? `${name}: ${String(first).slice(0, 60)}` : name
    }
  }
}

function extractNdjsonText(event: Record<string, unknown>): string | null {
  // ── claude stream-json ──────────────────────────────────────────────────
  if (event.type === 'assistant') {
    const content = (event.message as Record<string, unknown>)?.content;
    if (Array.isArray(content)) {
      const parts: string[] = []
      for (const c of content as Record<string, unknown>[]) {
        if (c.type === 'text' && c.text) {
          parts.push(c.text as string)
        } else if (c.type === 'tool_use') {
          const name = c.name as string
          const input = (c.input ?? {}) as Record<string, unknown>
          parts.push(`\x1b[2m→ ${formatToolCall(name, input)}\x1b[0m`)
        }
      }
      return parts.join('') || null
    }
  }

  // ── codex exec --json ───────────────────────────────────────────────────
  const item = event.item as Record<string, unknown> | undefined;
  if (event.type === 'item.started' && item?.type === 'command_execution') {
    return `\x1b[33m$ ${item.command as string}\x1b[0m`;
  }
  // Real-time text streaming: item.delta carries incremental tokens as they generate.
  // When present, item.completed agent_message is suppressed by the caller to avoid
  // double-printing the same text.
  if (event.type === 'item.delta') {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      return delta.text;
    }
  }
  if (event.type === 'item.completed' && item?.type === 'agent_message') {
    // Fallback only — caller suppresses this if item.delta events were already streamed.
    return (item.text as string) || null;
  }
  if (event.type === 'item.completed' && item?.type === 'command_execution') {
    const code = item.exit_code as number | null;
    return code === 0 ? '\x1b[32m[exit 0]\x1b[0m' : `\x1b[31m[exit ${code}]\x1b[0m`;
  }

  return null;
}

// Fenced blocks that the LLM outputs for structured data — we replace them with
// a clean indicator rather than dumping raw JSON into the terminal.
const FENCE_TAGS: Record<string, string> = {
  'shipcode-plan': '\x1b[2m[Plan ready — open Issue Detail to view]\x1b[0m',
  'shipcode-review': '\x1b[2m[Review ready — open Issue Detail to view]\x1b[0m',
  'shipcode-verification': '\x1b[2m[Verification complete — open Issue Detail to view]\x1b[0m',
};
const FENCE_RE = new RegExp('```(' + Object.keys(FENCE_TAGS).join('|') + ')');

const AGENT_ACTIVE_STATUSES = new Set(['planning', 'reviewing', 'revising', 'executing', 'verifying', 'shipping']);

export function TerminalDrawer() {
  const { toggleTerminal, agentOutputs } = useAppStore();
  const terminalThreadId = useAppStore((s) => s.terminalThreadId);
  const terminalEventsByThread = useAppStore((s) => s.terminalEventsByThread);
  const terminalEvents = terminalThreadId ? (terminalEventsByThread[terminalThreadId] ?? []) : [];
  const activeIssue = useAppStore((s) => s.activeIssue);
  const pipelinePhase = useAppStore((s) => s.pipelinePhase);
  const currentModel = useAppStore((s) => s.currentModel);
  const githubIssues = useAppStore((s) => s.githubIssues);
  const processToThread = useAppStore((s) => s.processToThread);
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
  // Track how many chunks have been written per process (regular streaming)
  const writtenRef = useRef<Record<string, number | typeof Infinity>>({});
  // Buffer incomplete NDJSON lines across PTY read chunks
  const lineBufferRef = useRef<Record<string, string>>({});
  // Per-process suppression: once a fence tag is detected, suppress remaining text
  const suppressedRef = useRef<Record<string, boolean>>({});
  // Codex item.delta dedup: track item IDs that have received delta events so we
  // can suppress the redundant item.completed agent_message for the same item.
  const deltaItemIdsRef = useRef<Record<string, Set<string>>>({});
  const prevThreadIdRef = useRef<string | null>(null);
  // Track how many terminal event lines have been written
  const eventsWrittenRef = useRef(0);
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
      term.reset();
      writtenRef.current = {};
      lineBufferRef.current = {};
      suppressedRef.current = {};
      deltaItemIdsRef.current = {};
      eventsWrittenRef.current = 0;
      startedAtRef.current = null;
      prevThreadIdRef.current = terminalThreadId;
      // Show skeleton until first output arrives for this thread
      setIsTransitioning(true);
    }
  }, [terminalThreadId]);

  // Write incremental agent output as chunks arrive (filtered to current terminal thread)
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    for (const [processId, chunks] of Object.entries(agentOutputs)) {
      if (writtenRef.current[processId] === Infinity) continue;

      // Only show output for processes belonging to the currently focused thread
      const mappedThread = processToThread[processId];
      if (mappedThread && terminalThreadId && mappedThread !== terminalThreadId) continue;

      const prev = (writtenRef.current[processId] as number) ?? 0;
      const newChunks = chunks.slice(prev);
      // First output for this thread — hide skeleton
      if (newChunks.length > 0) setIsTransitioning(false);
      if (newChunks.length === 0) continue;

      // Detect NDJSON (stream-json) mode: look across first ~10 chunks since
      // PTY may emit control sequences before the first JSON line.
      const isNdjson =
        processId in lineBufferRef.current || chunks.slice(0, 10).join('').includes('{"type":"');

      if (isNdjson) {
        // Buffer-based line processing — handles PTY chunks that split NDJSON lines
        let buf = (lineBufferRef.current[processId] ?? '') + newChunks.join('');
        const lines = buf.split('\n');
        // Keep the last (potentially incomplete) segment in the buffer
        lineBufferRef.current[processId] = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed) as Record<string, unknown>;

            // Track Codex item.delta events so we can suppress the redundant
            // item.completed agent_message for the same item (avoids double-print).
            if (event.type === 'item.delta' && typeof event.item_id === 'string') {
              if (!deltaItemIdsRef.current[processId]) {
                deltaItemIdsRef.current[processId] = new Set();
              }
              deltaItemIdsRef.current[processId].add(event.item_id);
            }

            // Suppress item.completed agent_message when deltas were already streamed.
            if (
              event.type === 'item.completed' &&
              (event.item as Record<string, unknown>)?.type === 'agent_message' &&
              typeof event.item_id === 'string' &&
              deltaItemIdsRef.current[processId]?.has(event.item_id)
            ) {
              continue;
            }

            const text = extractNdjsonText(event);
            if (!text) continue;

            // Already suppressed (inside a structured fence block)
            if (suppressedRef.current[processId]) continue;

            const fenceMatch = FENCE_RE.exec(text);
            if (fenceMatch) {
              // Write preamble text before the fence, then a clean indicator
              const before = text.slice(0, fenceMatch.index).trimEnd();
              if (before) {
                const normalized = before.replace(/\r?\n/g, '\r\n');
                term.write(normalized.endsWith('\r\n') ? normalized : normalized + '\r\n');
              }
              const tag = fenceMatch[1];
              term.write((FENCE_TAGS[tag] ?? '\x1b[2m[output ready]\x1b[0m') + '\r\n');
              suppressedRef.current[processId] = true;
            } else {
              const normalized = text.replace(/\r?\n/g, '\r\n');
              term.write(normalized.endsWith('\r\n') ? normalized : normalized + '\r\n');
            }
          } catch {
            // Partial or non-JSON segment — skip silently
          }
        }
      } else {
        // Non-NDJSON streaming (e.g. plain-text PTY output from legacy providers)
        for (const chunk of newChunks) {
          const clean = sanitize(chunk);
          if (clean) term.write(clean);
        }
      }
      writtenRef.current[processId] = chunks.length;
    }

    // Clean up tracking for removed processes
    for (const processId of Object.keys(writtenRef.current)) {
      if (!agentOutputs[processId]) {
        delete writtenRef.current[processId];
        delete lineBufferRef.current[processId];
      }
    }
  }, [agentOutputs, processToThread, terminalThreadId]);

  // Write pipeline event log lines (phase transitions, process lifecycle)
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const newEvents = terminalEvents.slice(eventsWrittenRef.current);
    // Capture start time from first event of this run
    if (eventsWrittenRef.current === 0 && newEvents.length > 0 && !startedAtRef.current) {
      startedAtRef.current = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      // Hide skeleton when events start arriving
      if (newEvents.length > 0) setIsTransitioning(false);
    }
    for (const line of newEvents) {
      // Lines already contain their own ANSI codes — write directly without wrapping
      term.write(`${line}\r\n`);
    }
    eventsWrittenRef.current = terminalEvents.length;
  }, [terminalEvents]);

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
              <span className="text-xs font-mono text-muted shrink-0">#{displayIssue.issueNumber}</span>
              <span className="text-xs text-secondary truncate">{displayIssue.title}</span>
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
          {startedAtRef.current && terminalEvents.length > 0 && (
            <>
              <span className="text-muted text-xs shrink-0">·</span>
              <span className="text-xs font-mono text-muted shrink-0">{startedAtRef.current}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Running task tabs */}
          {runningTabs.length > 1 && runningTabs.map((issue) => (
            <Button
              key={issue.threadId}
              variant="ghost"
              size="xs"
              onClick={() => {
                setTerminalThread(issue.threadId ?? null);
                selectIssue(issue);
              }}
              className={cn(
                'h-6 gap-1 px-2 text-xs',
                issue.threadId === terminalThreadId && 'bg-hover text-primary',
              )}
              title={`#${issue.issueNumber} ${issue.title}`}
            >
              <span className="font-mono">#{issue.issueNumber}</span>
            </Button>
          ))}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={toggleMaximize}
            title={isMaximized ? 'Restore terminal' : 'Maximize terminal'}
          >
            {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={toggleTerminal}
            title="Close terminal"
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
