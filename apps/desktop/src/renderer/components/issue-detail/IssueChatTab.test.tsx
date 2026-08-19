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
let issueChatSession: unknown = null;

function renderWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <IssueChatTab
        threadId="thread-1"
        projectId="project-1"
        issueNumber={196}
        issueTitle="Add issue Chat tab"
      />
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
    issueChatSession = null;
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'terminal:list') return [];
      if (channel === 'agent-conversations:list-by-thread') return conversations;
      if (channel === 'issue-chat:get-session') return issueChatSession;
      if (channel === 'issue-chat:start') {
        issueChatSession = {
          threadId: 'thread-1',
          provider: 'claude',
          sessionId: 'claude-session-1',
          modelId: null,
          reasoningEffort: 'medium',
          worktreePath: '/tmp/worktree',
        };
        return {
          threadId: 'thread-1',
          provider: 'claude',
          modelId: null,
          sessionId: 'claude-session-1',
          reasoningEffort: 'medium',
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
    useAppStore.setState({ activeIssue: null, activeThreadId: null, terminalThreadId: null });
  });

  it('starts the issue chat session on the first turn and reuses it for follow-ups', async () => {
    renderWithClient();

    expect(screen.getByText('Explain this issue.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Message Claude, Codex, or Grok…'), {
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

    fireEvent.change(screen.getByPlaceholderText('Message Claude, Codex, or Grok…'), {
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

  it('hydrates a resumable provider session and starts it without sending a turn', async () => {
    issueChatSession = {
      threadId: 'thread-1',
      provider: 'codex',
      sessionId: 'codex-thread-1',
      modelId: 'gpt-5.5',
      reasoningEffort: 'high',
      worktreePath: '/tmp/worktree',
    };

    renderWithClient();

    expect(await screen.findByText('Resumable')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Resume'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('issue-chat:start', {
        threadId: 'thread-1',
        provider: 'codex',
        modelId: 'gpt-5.5',
        reasoningEffort: 'high',
      });
    });
    expect(invokeMock).not.toHaveBeenCalledWith('issue-chat:turn', expect.anything());
  });

  it('creates an issue thread on the first send when none is linked', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
    useAppStore.setState({
      activeIssue: {
        id: 'issue-196',
        projectId: 'project-1',
        issueNumber: 196,
        title: 'Add issue Chat tab',
        threadId: null,
      } as never,
      activeThreadId: null,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <IssueChatTab
          threadId={null}
          projectId="project-1"
          issueNumber={196}
          issueTitle="Add issue Chat tab"
        />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('conversation-surface')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Message Claude, Codex, or Grok…'), {
      target: { value: 'Draft a plan' },
    });
    fireEvent.click(screen.getByTitle('Send'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('issue-chat:start', {
        projectId: 'project-1',
        issueNumber: 196,
        provider: 'claude',
        reasoningEffort: 'medium',
      });
      expect(invokeMock).toHaveBeenCalledWith('issue-chat:turn', {
        threadId: 'thread-1',
        text: 'Draft a plan',
      });
    });
    expect(useAppStore.getState().activeThreadId).toBe('thread-1');
  });
});
