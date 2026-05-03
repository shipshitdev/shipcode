// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
});
