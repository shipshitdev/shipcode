// @vitest-environment jsdom

import type { Thread } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { InstantView } from './InstantView';

vi.mock('./instant-terminal/InstantTerminalPane', () => ({
  InstantTerminalPane: ({
    threadId,
    title,
    canRestart,
    restartPending,
    restartError,
    onRestart,
  }: {
    threadId: string;
    title: string;
    canRestart: boolean;
    restartPending: boolean;
    restartError: string | null;
    onRestart: (threadId: string) => void;
  }) => (
    <div>
      <span>{title}</span>
      {canRestart ? (
        <button type="button" onClick={() => void onRestart(threadId)} disabled={restartPending}>
          Restart shell
        </button>
      ) : null}
      {restartError ? <span>{restartError}</span> : null}
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
});
