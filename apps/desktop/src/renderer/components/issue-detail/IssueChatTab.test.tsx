// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { TerminalEventRecord } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { IssueChatTab } from './IssueChatTab';

const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();
let conversations: unknown[] = [];

function renderWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <IssueChatTab threadId="thread-1" issueNumber={196} issueTitle="Add issue Chat tab" />
    </QueryClientProvider>,
  );
}

function makeTerminalEvent(overrides: Partial<TerminalEventRecord> = {}): TerminalEventRecord {
  return {
    id: 'event-1',
    threadId: 'thread-1',
    runId: null,
    event: { kind: 'text', content: 'Agent response' },
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('IssueChatTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversations = [];
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'terminal:list') return [];
      if (channel === 'agent-conversations:list-by-thread') return conversations;
      if (channel === 'issue-chat:start') {
        return {
          threadId: 'thread-1',
          provider: 'claude',
          modelId: null,
          worktreePath: '/tmp/worktree',
          reattached: false,
          activeProcessId: null,
        };
      }
      if (channel === 'issue-chat:turn') {
        conversations = [
          {
            id: 'prompt-1',
            threadId: 'thread-1',
            phase: 'issue_chat',
            round: 1,
            speaker: 'user',
            role: 'prompt',
            parentId: null,
            provider: 'claude-cli',
            model: null,
            content: 'Draft a plan',
            tokensIn: null,
            tokensOut: null,
            costUsd: null,
            createdAt: '2026-06-01T00:00:00.000Z',
          },
          {
            id: 'response-1',
            threadId: 'thread-1',
            phase: 'issue_chat',
            round: 1,
            speaker: 'claude',
            role: 'response',
            parentId: 'prompt-1',
            provider: 'claude-cli',
            model: null,
            content: 'done',
            tokensIn: null,
            tokensOut: null,
            costUsd: null,
            createdAt: '2026-06-01T00:00:01.000Z',
          },
        ];
        return {
          threadId: 'thread-1',
          promptId: 'prompt-1',
          responseId: 'response-1',
          round: 1,
          exitCode: 0,
          content: 'done',
        };
      }
      if (channel === 'issue-chat:stop') return { threadId: 'thread-1', stopped: true };
      return null;
    });
    useAppStore.setState({ canonicalTerminalStream: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it('starts the issue chat session on the first turn and reuses it for follow-ups', async () => {
    renderWithClient();

    expect(screen.getByText('Explain this issue.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Ask the issue agent...'), {
      target: { value: 'Draft a plan' },
    });
    fireEvent.click(screen.getByTitle('Send'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('issue-chat:start', {
        threadId: 'thread-1',
        provider: 'claude',
        reasoningEffort: 'medium',
      });
      expect(invokeMock).toHaveBeenCalledWith('issue-chat:turn', {
        threadId: 'thread-1',
        text: 'Draft a plan',
      });
    });
    expect(await screen.findByText('Draft a plan')).toBeInTheDocument();
    expect(await screen.findByText('done')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Ask the issue agent...'), {
      target: { value: 'Now list files' },
    });
    fireEvent.click(screen.getByTitle('Send'));

    await waitFor(() => {
      expect(
        invokeMock.mock.calls.filter(([channel]) => channel === 'issue-chat:start'),
      ).toHaveLength(1);
      expect(invokeMock).toHaveBeenCalledWith('issue-chat:turn', {
        threadId: 'thread-1',
        text: 'Now list files',
      });
    });
  });

  it('renders only the active issue thread stream and stops a running turn', async () => {
    useAppStore.setState({
      canonicalTerminalStream: {
        'thread-1': [
          makeTerminalEvent({
            id: 'thread-1-raw',
            event: { kind: 'raw', content: 'active thread output' },
          }),
        ],
        'thread-2': [
          makeTerminalEvent({
            id: 'thread-2-text',
            threadId: 'thread-2',
            event: { kind: 'text', content: 'other thread output' },
          }),
        ],
      },
    });

    renderWithClient();

    expect(screen.getByText('active thread output')).toBeInTheDocument();
    expect(screen.queryByText('other thread output')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Stop'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('issue-chat:stop', { threadId: 'thread-1' });
    });
  });
});
