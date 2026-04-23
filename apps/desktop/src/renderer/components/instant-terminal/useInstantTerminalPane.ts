import type { TerminalEventRecord } from '@shipcode/shared';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { InstantPaneMode } from '../../stores/app-store';
import { useAppStore } from '../../stores/app-store';
import { renderTerminalEvent } from '../terminal-drawer/render-terminal-event';

const EMPTY_STREAM: TerminalEventRecord[] = [];

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

function writeTerminalRecord(term: Terminal, mode: InstantPaneMode, record: TerminalEventRecord) {
  if (mode === 'live' && record.event.kind === 'raw') {
    term.write(record.event.content);
    return;
  }

  const rendered = renderTerminalEvent(record.event);
  if (!rendered) return;
  const normalized = rendered.replace(/\n/g, '\r\n');
  term.write(normalized);
}

export function useInstantTerminalPane(
  threadId: string,
  mode: InstantPaneMode,
  isRunning: boolean,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const writtenCountRef = useRef(0);
  const lastWrittenEventIdRef = useRef<string | null>(null);
  const streamRef = useRef<TerminalEventRecord[]>(EMPTY_STREAM);
  const [isReady, setIsReady] = useState(false);

  const syncPtySize = useCallback(() => {
    if (mode !== 'live') return;
    const term = termRef.current;
    if (!term) return;
    void window.shipcode
      .invoke('instant:shell-resize', {
        threadId,
        cols: term.cols,
        rows: term.rows,
      })
      .catch(() => {
        // Best-effort resize sync only.
      });
  }, [mode, threadId]);

  // Initialize xterm
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      disableStdin: mode !== 'live',
      convertEol: true,
      scrollback: 5000,
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      theme: buildTerminalTheme(),
      cursorBlink: mode === 'live',
      cursorStyle: mode === 'live' ? 'block' : 'underline',
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);

    const dataDisposable =
      mode === 'live'
        ? term.onData((data) => {
            void window.shipcode.invoke('instant:shell-input', { threadId, data }).catch(() => {
              // Session may have exited before the keystroke is delivered.
            });
          })
        : null;

    // Initial fit after DOM layout
    requestAnimationFrame(() => {
      fit.fit();
      syncPtySize();
    });

    termRef.current = term;
    fitRef.current = fit;
    writtenCountRef.current = 0;
    lastWrittenEventIdRef.current = null;
    streamRef.current = EMPTY_STREAM;
    setIsReady(true);

    return () => {
      setIsReady(false);
      dataDisposable?.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [mode, syncPtySize, threadId]);

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.disableStdin = mode !== 'live' || !isRunning;
    termRef.current.options.cursorBlink = mode === 'live' && isRunning;
    termRef.current.options.cursorStyle = mode === 'live' ? 'block' : 'underline';
  }, [isRunning, mode]);

  // ResizeObserver for CSS grid resizing — re-attaches after terminal initialises
  useEffect(() => {
    if (!containerRef.current || !fitRef.current) return;
    const fit = fitRef.current;
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        syncPtySize();
      } catch {
        // ignore fit errors during teardown
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [syncPtySize]);

  // Write new events from the canonical stream
  useEffect(() => {
    if (!isReady) return;

    const writeStream = (stream: TerminalEventRecord[]) => {
      const term = termRef.current;
      if (!term) return;

      const lastWrittenEventId = lastWrittenEventIdRef.current;
      const startIndex =
        lastWrittenEventId == null
          ? writtenCountRef.current
          : stream.findIndex((record) => record.id === lastWrittenEventId) + 1;
      const newEvents = stream.slice(Math.max(0, startIndex));
      for (const record of newEvents) {
        writeTerminalRecord(term, mode, record);
      }
      writtenCountRef.current = stream.length;
      lastWrittenEventIdRef.current = stream.at(-1)?.id ?? lastWrittenEventIdRef.current;
    };

    const initialStream = useAppStore.getState().canonicalTerminalStream[threadId] ?? EMPTY_STREAM;
    streamRef.current = initialStream;
    writeStream(initialStream);

    return useAppStore.subscribe((state) => {
      const nextStream = state.canonicalTerminalStream[threadId] ?? EMPTY_STREAM;
      if (nextStream === streamRef.current) return;
      streamRef.current = nextStream;
      writeStream(nextStream);
    });
  }, [isReady, mode, threadId]);

  // Theme sync on data-theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (termRef.current) {
        termRef.current.options.theme = buildTerminalTheme();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return { containerRef };
}
