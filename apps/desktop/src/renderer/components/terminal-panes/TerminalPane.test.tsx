// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { TerminalPane } from './TerminalPane';

vi.mock('./useTerminalPane', () => ({
  useTerminalPane: () => ({
    containerRef: { current: null },
  }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TerminalPane', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T21:54:07.000Z'));
    useAppStore.setState({
      canonicalTerminalStream: {},
      lastActivityByThread: {},
    } as never);
  });

  it('renders a live pane without crashing when the thread has no stream yet', () => {
    render(
      <TerminalPane
        threadId="thread-live"
        title="Codex shell"
        mode="live"
        paneState="running"
        onClose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Codex shell')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByTitle('Close pane')).toBeInTheDocument();
  });

  it('surfaces quiet and stale running sessions so they do not look frozen', () => {
    useAppStore.setState({
      canonicalTerminalStream: {
        'thread-live': [
          {
            id: 'event-1',
            threadId: 'thread-live',
            createdAt: '2026-04-22T21:52:32.000Z',
            event: { kind: 'lifecycle', message: 'Codex CLI process started' },
          },
        ],
      },
      lastActivityByThread: {
        'thread-live': Date.parse('2026-04-22T21:52:32.000Z'),
      },
    } as never);

    render(
      <TerminalPane
        threadId="thread-live"
        title="Codex shell"
        mode="live"
        paneState="running"
        onClose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('No output 1m 35s')).toBeInTheDocument();
    expect(
      screen.getByText(/The CLI may be thinking or waiting on a slow tool call/i),
    ).toBeInTheDocument();
  });

  it('renders replay panes as done when the stream has completed', () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    useAppStore.setState({
      canonicalTerminalStream: {
        'thread-replay': [
          {
            id: 'event-1',
            threadId: 'thread-replay',
            createdAt: '2026-04-22T21:54:00.000Z',
            event: { kind: 'raw', content: 'All checks passed\n' },
          },
          {
            id: 'event-2',
            threadId: 'thread-replay',
            createdAt: '2026-04-22T21:54:02.000Z',
            event: { kind: 'done', exitCode: 0 },
          },
        ],
      },
      lastActivityByThread: {},
    } as never);

    render(
      <TerminalPane
        threadId="thread-replay"
        title="Verifier"
        mode="replay"
        onClose={onClose}
        onCancel={onCancel}
      />,
    );

    expect(screen.getAllByText('Done')).not.toHaveLength(0);
    expect(screen.queryByTitle('Stop')).not.toBeInTheDocument();
    expect(screen.getByText('All checks passed')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Close pane'));
    expect(onClose).toHaveBeenCalledWith('thread-replay', false);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('derives quiet running state from the latest replay record when no activity timestamp exists', () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    useAppStore.setState({
      canonicalTerminalStream: {
        'thread-replay': [
          {
            id: 'event-1',
            threadId: 'thread-replay',
            createdAt: '2026-04-22T21:53:47.000Z',
            event: { kind: 'lifecycle', message: 'Codex CLI process started' },
          },
        ],
      },
      lastActivityByThread: {},
    } as never);

    render(
      <TerminalPane
        threadId="thread-replay"
        title="Executor"
        mode="replay"
        onClose={onClose}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Quiet 20s')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Stop'));
    expect(onCancel).toHaveBeenCalledWith('thread-replay');

    fireEvent.click(screen.getByTitle('Close pane'));
    expect(onClose).toHaveBeenCalledWith('thread-replay', true);
  });

  it('treats process-exited lifecycle records as finished', () => {
    useAppStore.setState({
      canonicalTerminalStream: {
        'thread-exited': [
          {
            id: 'event-1',
            threadId: 'thread-exited',
            createdAt: '2026-04-22T21:54:00.000Z',
            event: { kind: 'lifecycle', message: 'Codex CLI process exited with code 0' },
          },
        ],
      },
      lastActivityByThread: {},
    } as never);

    render(
      <TerminalPane
        threadId="thread-exited"
        title="Exited"
        mode="replay"
        onClose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Done')).not.toHaveLength(0);
    expect(screen.queryByText(/Quiet|No output/)).not.toBeInTheDocument();
  });

  it('hides agent controls for bare shell panes while preserving close behavior', () => {
    const onClose = vi.fn();

    render(
      <TerminalPane
        threadId="thread-shell"
        title="Terminal"
        mode="live"
        paneState="running"
        isBareShell
        onClose={onClose}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByText('Running')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Stop')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Close pane'));
    expect(onClose).toHaveBeenCalledWith('thread-shell', true);
  });
});
