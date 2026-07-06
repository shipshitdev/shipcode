// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleTab } from './ConsoleTab';

vi.mock('../terminal-transcript/ThreadConsoleTranscript', () => ({
  ThreadConsoleTranscript: () => <div data-testid="thread-console-transcript" />,
}));

const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

function renderConsoleTab(props: ComponentProps<typeof ConsoleTab>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <ConsoleTab {...props} />
    </QueryClientProvider>,
  );

  return {
    ...view,
    rerenderConsoleTab: (nextProps: ComponentProps<typeof ConsoleTab>) =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <ConsoleTab {...nextProps} />
        </QueryClientProvider>,
      ),
  };
}

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
  it('shows the steering input while the workflow can receive steering', () => {
    const { rerenderConsoleTab } = renderConsoleTab({
      activeThreadId: 'thread-1',
      approvedAwaitingExecution: false,
      threadPhase: 'reviewing',
    });

    expect(screen.getByRole('textbox', { name: 'Steer workflow' })).toBeInTheDocument();

    rerenderConsoleTab({
      activeThreadId: 'thread-1',
      approvedAwaitingExecution: false,
      threadPhase: 'completed',
    });

    expect(screen.queryByRole('textbox', { name: 'Steer workflow' })).not.toBeInTheDocument();

    rerenderConsoleTab({
      activeThreadId: 'thread-1',
      approvedAwaitingExecution: false,
      threadPhase: 'executing',
    });

    expect(screen.getByRole('textbox', { name: 'Steer workflow' })).toBeInTheDocument();
  });

  it('sends steering instructions to the running executor', async () => {
    renderConsoleTab({
      activeThreadId: 'thread-1',
      approvedAwaitingExecution: false,
      threadPhase: 'executing',
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Steer workflow' }), {
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
