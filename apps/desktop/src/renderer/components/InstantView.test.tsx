// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { InstantView } from './InstantView';

vi.mock('./instant-terminal/InstantTerminalPane', () => ({
  InstantTerminalPane: ({
    title,
    onClose,
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
    </div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('InstantView', () => {
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
      instantPaneThreadIds: ['thread-live'],
      instantPaneMetaByThread: {
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
      instantPaneThreadIds: [],
      instantPaneMetaByThread: {},
      canonicalTerminalStream: {},
    } as never);

    invokeMock.mockResolvedValueOnce({ threadId: 'thread-shell-1' });

    render(<InstantView />);

    fireEvent.click(screen.getByTitle('Open Terminal'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('instant:bare-shell', {
        projectId: 'project-1',
      });
    });

    const state = useAppStore.getState();
    expect(state.instantPaneThreadIds).toContain('thread-shell-1');
    expect(state.instantPaneMetaByThread['thread-shell-1']).toEqual({
      mode: 'live',
      title: 'Terminal',
      cli: 'shell',
    });
  });

  it('keeps existing session panes visible', () => {
    render(<InstantView />);

    expect(screen.getByText('Claude shell')).toBeInTheDocument();
    expect(screen.getByTitle('Open Terminal')).toBeInTheDocument();
  });

  it('does not rerender the sessions grid when unrelated terminal streams update', () => {
    const onRender = vi.fn();
    render(
      <Profiler id="instant-view" onRender={onRender}>
        <InstantView />
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
