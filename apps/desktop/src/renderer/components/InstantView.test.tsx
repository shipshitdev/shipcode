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

  it('opens the configured terminal from the empty state', async () => {
    useAppStore.setState({
      activeProjectId: 'project-1',
      instantPaneThreadIds: [],
      instantPaneMetaByThread: {},
      canonicalTerminalStream: {},
    } as never);

    render(<InstantView />);

    expect(screen.queryByRole('button', { name: /Claude CLI/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Codex CLI/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Terminal' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('project:open-path', {
        projectId: 'project-1',
        target: 'default-terminal',
      });
    });
    expect(invokeMock).not.toHaveBeenCalledWith('instant:shell-start', expect.anything());
  });

  it('keeps existing session panes visible', () => {
    render(<InstantView />);

    expect(screen.getByText('Claude shell')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Terminal' })).toBeInTheDocument();
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
