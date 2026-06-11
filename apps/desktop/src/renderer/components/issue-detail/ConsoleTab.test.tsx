// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleTab } from './ConsoleTab';

vi.mock('../terminal-transcript/ThreadConsoleTranscript', () => ({
  ThreadConsoleTranscript: () => <div data-testid="thread-console-transcript" />,
}));

const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

beforeEach(() => {
  window.shipcode ??= {} as typeof window.shipcode;
  window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
  invokeMock.mockResolvedValue({
    threadId: 'thread-1',
    status: 'delivered',
    message: 'Instruction delivered to the running executor transport.',
    processId: 'proc-1',
  });
});

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

describe('ConsoleTab steering', () => {
  it('shows the steering input only while the thread is executing', () => {
    const { rerender } = render(
      <ConsoleTab
        activeThreadId="thread-1"
        approvedAwaitingExecution={false}
        threadPhase="reviewing"
      />,
    );

    expect(screen.queryByRole('textbox', { name: 'Steer executor' })).not.toBeInTheDocument();

    rerender(
      <ConsoleTab
        activeThreadId="thread-1"
        approvedAwaitingExecution={false}
        threadPhase="executing"
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Steer executor' })).toBeInTheDocument();
  });

  it('sends steering instructions to the running executor', async () => {
    render(
      <ConsoleTab
        activeThreadId="thread-1"
        approvedAwaitingExecution={false}
        threadPhase="executing"
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Steer executor' }), {
      target: { value: 'Focus on the IPC receipt state.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send steering instruction' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('pipeline:steer-execution', {
        threadId: 'thread-1',
        instruction: 'Focus on the IPC receipt state.',
      });
    });
  });
});
