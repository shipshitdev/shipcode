import type { TerminalEventRecord } from '@shipcode/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TerminalPaneMode } from '../../stores/app-store';
import { useAppStore } from '../../stores/app-store';
import { renderTerminalEvent } from '../terminal-drawer/render-terminal-event';
import type { TerminalSurface } from './terminal-surface';
import { XtermSurface } from './xterm-surface';

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
    brightBlack: readCssColor('--text-muted-foreground', '#6b6b78'),
    brightRed: '#f87171',
    brightGreen: '#34d399',
    brightYellow: '#fbbf24',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: readCssColor('--accent', '#fafafa'),
  };
}

function writeTerminalRecord(
  surface: TerminalSurface,
  mode: TerminalPaneMode,
  record: TerminalEventRecord,
) {
  if (mode === 'live' && record.event.kind === 'raw') {
    surface.write(record.event.content);
    return;
  }

  const rendered = renderTerminalEvent(record.event);
  if (!rendered) return;
  const normalized = rendered.replace(/\n/g, '\r\n');
  surface.write(normalized);
}

export function useTerminalPane(threadId: string, mode: TerminalPaneMode, isRunning: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<TerminalSurface | null>(null);
  const writtenCountRef = useRef(0);
  const lastWrittenEventIdRef = useRef<string | null>(null);
  const streamRef = useRef<TerminalEventRecord[]>(EMPTY_STREAM);
  const [isReady, setIsReady] = useState(false);

  const syncPtySize = useCallback(() => {
    if (mode !== 'live') return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const size = surface.getSize();
    void window.shipcode
      .invoke('instant:shell-resize', {
        threadId,
        cols: size.cols,
        rows: size.rows,
      })
      .catch(() => {
        // Best-effort resize sync only.
      });
  }, [mode, threadId]);

  // Initialize xterm
  useEffect(() => {
    if (!containerRef.current) return;

    const surface = new XtermSurface({
      interactive: mode === 'live',
      theme: buildTerminalTheme(),
    });
    surface.mount(containerRef.current);

    const dataDisposable =
      mode === 'live'
        ? surface.onData((data) => {
            void window.shipcode.invoke('instant:shell-input', { threadId, data }).catch(() => {
              // Session may have exited before the keystroke is delivered.
            });
          })
        : null;

    // Initial fit after DOM layout
    requestAnimationFrame(() => {
      surface.fit();
      syncPtySize();
    });

    surfaceRef.current = surface;
    writtenCountRef.current = 0;
    lastWrittenEventIdRef.current = null;
    streamRef.current = EMPTY_STREAM;
    setIsReady(true);

    return () => {
      setIsReady(false);
      dataDisposable?.dispose();
      surface.dispose();
      surfaceRef.current = null;
    };
  }, [mode, syncPtySize, threadId]);

  useEffect(() => {
    if (!surfaceRef.current) return;
    surfaceRef.current.setInteractive(mode === 'live' && isRunning);
  }, [isRunning, mode]);

  // ResizeObserver for CSS grid resizing — re-attaches after terminal initialises
  useEffect(() => {
    if (!containerRef.current || !surfaceRef.current) return;
    const surface = surfaceRef.current;
    const observer = new ResizeObserver(() => {
      try {
        surface.fit();
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
      const surface = surfaceRef.current;
      if (!surface) return;

      const lastWrittenEventId = lastWrittenEventIdRef.current;
      const startIndex =
        lastWrittenEventId == null
          ? writtenCountRef.current
          : stream.findIndex((record) => record.id === lastWrittenEventId) + 1;
      const newEvents = stream.slice(Math.max(0, startIndex));
      for (const record of newEvents) {
        writeTerminalRecord(surface, mode, record);
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
      if (surfaceRef.current) {
        surfaceRef.current.setTheme(buildTerminalTheme());
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
