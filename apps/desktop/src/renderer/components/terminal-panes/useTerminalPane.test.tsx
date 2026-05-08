// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { TerminalEventRecord } from '@shipcode/shared';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalPaneMode } from '../../stores/app-store';
import { useAppStore } from '../../stores/app-store';
import { useTerminalPane } from './useTerminalPane';

const { fitInstances, setResizeHandler, terminalInstances, triggerResize, triggerTerminalData } =
  vi.hoisted(() => {
    const terminalInstances: Array<{
      options: Record<string, unknown>;
      cols: number;
      rows: number;
      write: ReturnType<typeof vi.fn>;
      loadAddon: ReturnType<typeof vi.fn>;
      open: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
      onData: ReturnType<typeof vi.fn>;
      dataHandler: ((data: string) => void) | null;
    }> = [];
    const fitInstances: Array<{ fit: ReturnType<typeof vi.fn> }> = [];
    let resizeHandler: (() => void) | null = null;

    return {
      fitInstances,
      setResizeHandler: (handler: (() => void) | null) => {
        resizeHandler = handler;
      },
      terminalInstances,
      triggerResize: () => resizeHandler?.(),
      triggerTerminalData: (data: string) => terminalInstances.at(-1)?.dataHandler?.(data),
    };
  });

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(function MockTerminal(options: Record<string, unknown>) {
    const instance = {
      options: { ...options },
      cols: 80,
      rows: 24,
      write: vi.fn(),
      loadAddon: vi.fn(),
      open: vi.fn(),
      dispose: vi.fn(),
      onData: vi.fn((handler: (data: string) => void) => {
        instance.dataHandler = handler;
        return { dispose: vi.fn() };
      }),
      dataHandler: null as ((data: string) => void) | null,
    };
    terminalInstances.push(instance);
    return instance;
  } as never),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function MockFitAddon() {
    const instance = { fit: vi.fn() };
    fitInstances.push(instance);
    return instance;
  } as never),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(function MockWebLinksAddon() {
    return {};
  } as never),
}));

class MockResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe = vi.fn(() => {
    setResizeHandler(this.callback);
  });
  disconnect = vi.fn(() => setResizeHandler(null));
}

function TerminalPaneHarness({
  threadId = 'thread-1',
  mode = 'replay',
  isRunning = false,
}: {
  threadId?: string;
  mode?: TerminalPaneMode;
  isRunning?: boolean;
}) {
  const { containerRef } = useTerminalPane(threadId, mode, isRunning);
  return <div ref={containerRef} data-testid="terminal-container" />;
}

function makeRecord(id: string, event: TerminalEventRecord['event']): TerminalEventRecord {
  return {
    id,
    threadId: 'thread-1',
    event,
    createdAt: '2026-05-08T10:00:00.000Z',
  };
}

describe('useTerminalPane', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    terminalInstances.length = 0;
    fitInstances.length = 0;
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    invokeMock.mockResolvedValue(undefined);
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    globalThis.requestAnimationFrame = window.requestAnimationFrame;
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.setProperty('--text-primary', '#ffffff');
    useAppStore.setState({ canonicalTerminalStream: {} } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('initializes a history terminal and writes canonical rendered events only once', async () => {
    useAppStore.setState({
      canonicalTerminalStream: {
        'thread-1': [
          makeRecord('event-1', { kind: 'text', content: 'Hello\nWorld' }),
          makeRecord('event-2', { kind: 'raw', content: 'ignored raw in history' }),
        ],
      },
    } as never);

    render(<TerminalPaneHarness />);

    await waitFor(() => {
      expect(terminalInstances[0]?.open).toHaveBeenCalled();
    });
    expect(terminalInstances[0].options.disableStdin).toBe(true);
    expect(terminalInstances[0].write).toHaveBeenCalledWith(expect.stringContaining('Hello'));
    expect(terminalInstances[0].write).toHaveBeenCalledWith(expect.stringContaining('World'));
    expect(terminalInstances[0].write).toHaveBeenCalledWith(
      expect.stringContaining('ignored raw in history'),
    );

    terminalInstances[0].write.mockClear();
    useAppStore.setState({
      canonicalTerminalStream: {
        'thread-1': [
          makeRecord('event-1', { kind: 'text', content: 'Hello\nWorld' }),
          makeRecord('event-2', { kind: 'raw', content: 'ignored raw in history' }),
          makeRecord('event-3', { kind: 'lifecycle', message: 'Done' }),
        ],
      },
    } as never);

    await waitFor(() => {
      expect(terminalInstances[0].write).toHaveBeenCalledTimes(1);
    });
    expect(terminalInstances[0].write).toHaveBeenCalledWith(expect.stringContaining('Done'));
  });

  it('syncs live terminal input, resize, option updates, and raw output', async () => {
    const { rerender } = render(<TerminalPaneHarness mode="live" isRunning />);

    await waitFor(() => {
      expect(terminalInstances[0]?.open).toHaveBeenCalled();
    });
    act(() => triggerResize());
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('instant:shell-resize', {
        threadId: 'thread-1',
        cols: 80,
        rows: 24,
      });
    });

    triggerTerminalData('ls\n');
    expect(invokeMock).toHaveBeenCalledWith('instant:shell-input', {
      threadId: 'thread-1',
      data: 'ls\n',
    });

    useAppStore.setState({
      canonicalTerminalStream: {
        'thread-1': [makeRecord('raw-1', { kind: 'raw', content: 'raw bytes' })],
      },
    } as never);
    await waitFor(() => {
      expect(terminalInstances[0].write).toHaveBeenCalledWith('raw bytes');
    });

    rerender(<TerminalPaneHarness mode="live" isRunning={false} />);
    expect(terminalInstances[0].options.disableStdin).toBe(true);
    expect(terminalInstances[0].options.cursorBlink).toBe(false);

    fitInstances[0].fit.mockImplementationOnce(() => {
      throw new Error('layout gone');
    });
    triggerResize();
    expect(fitInstances[0].fit).toHaveBeenCalled();
  });

  it('updates terminal theme when the document theme changes and disposes on unmount', async () => {
    const { unmount } = render(<TerminalPaneHarness />);

    await waitFor(() => {
      expect(terminalInstances[0]?.open).toHaveBeenCalled();
    });
    document.documentElement.dataset.theme = 'light';
    document.documentElement.setAttribute('data-theme', 'light');

    await waitFor(() => {
      expect(terminalInstances[0].options.theme).toBeTruthy();
    });

    unmount();
    expect(terminalInstances[0].dispose).toHaveBeenCalled();
  });
});
