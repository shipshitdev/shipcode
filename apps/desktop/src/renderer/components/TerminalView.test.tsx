// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { TerminalView } from './TerminalView';

vi.mock('./terminal-panes/TerminalPane', () => ({
  TerminalPane: ({
    threadId,
    title,
    onClose,
    onCancel,
  }: {
    threadId: string;
    title: string;
    mode: 'live' | 'replay';
    paneState?: string;
    onClose: (threadId: string, isRunning: boolean) => void;
    onCancel: (threadId: string) => void;
  }) => (
    <div>
      <span>{title}</span>
      <button type="button" onClick={() => onClose('thread-live', false)}>
        Close pane
      </button>
      <button type="button" onClick={() => onClose(threadId, true)}>
        Close running pane
      </button>
      <button type="button" onClick={() => onCancel(threadId)}>
        Cancel pane
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('TerminalView', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();

    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    invokeMock.mockResolvedValue(null);

    useAppStore.setState({
      activeProjectId: 'project-1',
      terminalPaneThreadIds: ['thread-live'],
      terminalPaneMetaByThread: {
        'thread-live': {
          mode: 'live',
          cli: 'claude',
          title: 'Claude shell',
          state: 'exited',
        },
      },
      canonicalTerminalStream: {},
    } as never);
  });

  it('opens an embedded bare shell from the empty state', async () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      terminalPaneThreadIds: [],
      terminalPaneMetaByThread: {},
      canonicalTerminalStream: {},
    } as never);

    invokeMock.mockResolvedValueOnce({ threadId: 'thread-shell-1' });

    render(<TerminalView />);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('instant:bare-shell', {
        projectId: 'project-1',
      });
    });

    const state = useAppStore.getState();
    expect(state.terminalPaneThreadIds).toContain('thread-shell-1');
    expect(state.terminalPaneMetaByThread['thread-shell-1']).toEqual({
      mode: 'live',
      title: 'Terminal',
      cli: 'shell',
    });
  });

  it('keeps existing session panes visible', () => {
    render(<TerminalView />);

    expect(screen.getByText('Claude shell')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('cancels and removes running live panes from pane callbacks', async () => {
    render(<TerminalView />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel pane' }));
    expect(invokeMock).toHaveBeenCalledWith('instant:cancel', { threadId: 'thread-live' });

    fireEvent.click(screen.getByRole('button', { name: 'Close running pane' }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('instant:cancel', { threadId: 'thread-live' });
      expect(useAppStore.getState().terminalPaneThreadIds).not.toContain('thread-live');
    });
  });

  it('renders fallback pane titles and alternate split directions', () => {
    useAppStore.setState({
      terminalPaneThreadIds: ['thread-live', 'thread-without-title', 'thread-replay'],
      terminalSplitDirection: 'vertical',
      terminalPaneMetaByThread: {
        'thread-live': {
          mode: 'live',
          cli: 'shell',
          title: 'Terminal',
          state: 'running',
        },
        'thread-without-title': {
          mode: 'replay',
          cli: 'claude',
          state: 'exited',
        },
        'thread-replay': {
          mode: 'replay',
          cli: 'codex',
          title: 'Replay',
          state: 'exited',
        },
      },
    } as never);

    const { rerender } = render(<TerminalView />);

    expect(screen.getByText('thread-w')).toBeInTheDocument();
    expect(screen.getByText('Replay')).toBeInTheDocument();

    useAppStore.setState({
      terminalPaneThreadIds: ['thread-live', 'thread-without-title'],
      terminalSplitDirection: 'horizontal',
    } as never);
    rerender(<TerminalView />);

    expect(screen.getByText('thread-w')).toBeInTheDocument();
  });

  it('filters assistant panes out of the terminal page', () => {
    useAppStore.setState({
      assistantThreadId: 'assistant-thread-1',
      terminalPaneThreadIds: ['assistant-thread-1', 'thread-live'],
      terminalPaneMetaByThread: {
        'assistant-thread-1': {
          mode: 'replay',
          cli: 'claude',
          title: 'ShipCode Assistant',
          state: 'exited',
        },
        'thread-live': {
          mode: 'live',
          cli: 'shell',
          title: 'Terminal',
          state: 'running',
        },
      },
    } as never);

    render(<TerminalView />);

    expect(screen.queryByText('ShipCode Assistant')).not.toBeInTheDocument();
    expect(screen.getAllByText('Terminal').length).toBeGreaterThan(0);
  });

  it('cancels running live panes when leaving the terminal page', () => {
    useAppStore.setState({
      terminalPaneThreadIds: ['thread-live', 'thread-replay'],
      terminalPaneMetaByThread: {
        'thread-live': {
          mode: 'live',
          cli: 'shell',
          title: 'Terminal',
          state: 'running',
        },
        'thread-replay': {
          mode: 'replay',
          cli: 'claude',
          title: 'Old run',
          state: 'running',
        },
      },
    } as never);

    const view = render(<TerminalView />);
    view.unmount();

    expect(invokeMock).toHaveBeenCalledWith('instant:cancel', { threadId: 'thread-live' });
    expect(invokeMock).not.toHaveBeenCalledWith('instant:cancel', {
      threadId: 'thread-replay',
    });
  });

  it('does not rerender the terminal grid when unrelated terminal streams update', () => {
    const onRender = vi.fn();
    render(
      <Profiler id="terminal-view" onRender={onRender}>
        <TerminalView />
      </Profiler>,
    );
    onRender.mockClear();

    useAppStore.setState({
      canonicalTerminalStream: {
        'other-thread': [
          {
            id: 'event-1',
            threadId: 'other-thread',
            createdAt: '2026-04-23T09:00:00.000Z',
            event: { kind: 'text', content: 'unrelated output' },
          },
        ],
      },
    } as never);

    expect(onRender).not.toHaveBeenCalled();
  });
});
