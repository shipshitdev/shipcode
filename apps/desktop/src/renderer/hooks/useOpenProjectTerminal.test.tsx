// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { useOpenProjectTerminal } from './useOpenProjectTerminal';

function TerminalHarness({ onError }: { onError: (error: unknown) => void }) {
  const { openProjectTerminal } = useOpenProjectTerminal();
  return (
    <button type="button" onClick={() => void openProjectTerminal().catch(onError)}>
      Open terminal
    </button>
  );
}

describe('useOpenProjectTerminal', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };
    invokeMock.mockResolvedValue({ threadId: 'thread-shell-1' });
    useAppStore.setState({
      activeProjectId: 'project-1',
      terminalPaneThreadIds: [],
      terminalPaneMetaByThread: {},
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('opens a bare shell when there is pane capacity', async () => {
    const onError = vi.fn();
    render(<TerminalHarness onError={onError} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('instant:bare-shell', {
        projectId: 'project-1',
      });
    });
    expect(onError).not.toHaveBeenCalled();
    expect(useAppStore.getState().terminalPaneThreadIds).toContain('thread-shell-1');
  });

  it('rejects before spawning when the terminal pane cap is reached', async () => {
    const onError = vi.fn();
    useAppStore.setState({
      terminalPaneThreadIds: ['thread-1', 'thread-2', 'thread-3', 'thread-4'],
      terminalPaneMetaByThread: {},
    } as never);

    render(<TerminalHarness onError={onError} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe(
      'Close a terminal pane before opening another one',
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
