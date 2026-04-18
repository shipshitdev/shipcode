import type { TerminalEventRecord } from '@shipcode/shared';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/app-store';
import { renderTerminalEvent } from '../terminal-drawer/render-terminal-event';

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

export function useInstantTerminalPane(threadId: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const writtenCountRef = useRef(0);
  const [isReady, setIsReady] = useState(false);

  const canonicalStream = useAppStore(
    useCallback(
      (s) => s.canonicalTerminalStream[threadId] ?? ([] as TerminalEventRecord[]),
      [threadId],
    ),
  );

  // Initialize xterm
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      disableStdin: true,
      convertEol: true,
      scrollback: 5000,
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      theme: buildTerminalTheme(),
      cursorBlink: false,
      cursorStyle: 'underline',
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);

    // Initial fit after DOM layout
    requestAnimationFrame(() => {
      fit.fit();
    });

    termRef.current = term;
    fitRef.current = fit;
    writtenCountRef.current = 0;
    setIsReady(true);

    return () => {
      setIsReady(false);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // ResizeObserver for CSS grid resizing — re-attaches after terminal initialises
  useEffect(() => {
    if (!containerRef.current || !fitRef.current) return;
    const fit = fitRef.current;
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // ignore fit errors during teardown
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Write new events from the canonical stream
  useEffect(() => {
    const term = termRef.current;
    if (!term || !isReady) return;

    const newEvents = canonicalStream.slice(writtenCountRef.current);
    for (const record of newEvents) {
      const rendered = renderTerminalEvent(record.event);
      if (rendered) {
        const normalized = rendered.replace(/\n/g, '\r\n');
        term.write(normalized);
      }
    }
    writtenCountRef.current = canonicalStream.length;
  }, [canonicalStream, isReady]);

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
