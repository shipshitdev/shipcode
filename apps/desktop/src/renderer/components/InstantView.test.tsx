// @vitest-environment jsdom

import { DEFAULT_SETTINGS, type Thread } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { InstantView } from './InstantView';

vi.mock('./instant-terminal/InstantTerminalPane', () => ({
  InstantTerminalPane: ({
    threadId,
    title,
    mode,
    paneState,
    restartPending,
    restartError,
    onRestart,
  }: {
    threadId: string;
    title: string;
    mode: 'live' | 'replay';
    paneState?: string;
    restartPending: boolean;
    restartError: string | null;
    onRestart: (threadId: string) => void;
  }) => {
    const canRestart = mode === 'live' && paneState === 'exited';
    return (
      <div>
        <span>{title}</span>
        {canRestart ? (
          <button type="button" onClick={() => void onRestart(threadId)} disabled={restartPending}>
            Restart shell
          </button>
        ) : null}
        {restartError ? <span>{restartError}</span> : null}
      </div>
    );
  },
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

    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'thread:get') {
        return {
          id: 'thread-live',
          projectId: 'project-1',
          prompt: 'Pick up where we left off',
        } satisfies Partial<Thread>;
      }
      if (channel === 'instant:shell-start') {
        return { threadId: 'thread-restarted' };
      }
      return null;
    });

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

  it('starts Claude and Codex shells directly from the empty state', async () => {
    invokeMock.mockImplementation(async (channel: string, args?: unknown) => {
      if (channel === 'settings:get') return DEFAULT_SETTINGS;
      if (channel === 'project:get') return null;
      if (channel === 'instant:shell-start') {
        const cli = (args as { cli: 'claude' | 'codex' }).cli;
        return { threadId: `thread-${cli}` };
      }
      return null;
    });
    useAppStore.setState({
      activeProjectId: 'project-1',
      instantPaneThreadIds: [],
      instantPaneMetaByThread: {},
      canonicalTerminalStream: {},
    } as never);

    render(<InstantView />);

    expect(screen.queryByText('New Terminal Session')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Claude CLI/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('instant:shell-start', {
        projectId: 'project-1',
        cli: 'claude',
        modelId: null,
        reasoningEffort: 'medium',
      });
    });
    expect(useAppStore.getState().instantPaneThreadIds).toEqual(['thread-claude']);

    fireEvent.click(screen.getByRole('button', { name: /Codex/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('instant:shell-start', {
        projectId: 'project-1',
        cli: 'codex',
        modelId: null,
        reasoningEffort: 'high',
      });
    });
    expect(useAppStore.getState().instantPaneThreadIds).toEqual(['thread-claude', 'thread-codex']);
  });

  it('restarts a finished live shell into a fresh pane', async () => {
    render(<InstantView />);

    fireEvent.click(screen.getByRole('button', { name: /restart shell/i }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('thread:get', { threadId: 'thread-live' });
      expect(invokeMock).toHaveBeenCalledWith('instant:shell-start', {
        projectId: 'project-1',
        cli: 'claude',
        initialPrompt: 'Pick up where we left off',
      });
    });

    expect(useAppStore.getState().instantPaneThreadIds).toEqual(['thread-restarted']);
    expect(useAppStore.getState().instantPaneMetaByThread['thread-live']).toBeUndefined();
    expect(useAppStore.getState().instantPaneMetaByThread['thread-restarted']).toEqual({
      mode: 'live',
      cli: 'claude',
      title: 'Claude • Pick up where we left off',
      state: 'running',
    });
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
