// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { AgentConversationRecord } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationsTab } from './ConversationsTab';

function renderWithClient(threadId = 'thread-1') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ConversationsTab threadId={threadId} projectId="project-1" issueNumber={42} />
    </QueryClientProvider>,
  );
}

function makeConversation(
  overrides: Partial<AgentConversationRecord> = {},
): AgentConversationRecord {
  return {
    id: 'conversation-1',
    threadId: 'thread-1',
    phase: 'plan',
    round: 1,
    speaker: 'claude',
    role: 'prompt',
    parentId: null,
    provider: 'claude',
    model: 'claude-sonnet-4',
    content: 'Short prompt',
    tokensIn: 1200,
    tokensOut: 300,
    costUsd: 0.0123,
    createdAt: '2026-05-08T10:00:00.000Z',
    ...overrides,
  };
}

describe('ConversationsTab', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
    window.confirm = vi.fn(() => true);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders empty and loading states from the conversation query', async () => {
    invokeMock.mockResolvedValueOnce([]);

    renderWithClient();

    expect(await screen.findByText(/No conversation turns recorded yet/)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('agent-conversations:list-by-thread', {
      threadId: 'thread-1',
    });
  });

  it('filters phases, expands long turns, and copies one turn or all visible turns', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const longContent = Array.from({ length: 35 }, (_, index) => `line ${index + 1}`).join('\n');
    invokeMock.mockResolvedValueOnce([
      makeConversation({
        id: 'plan-1',
        phase: 'plan',
        speaker: 'claude',
        provider: 'claude',
        content: longContent,
      }),
      makeConversation({
        id: 'execute-1',
        phase: 'execute',
        speaker: 'custom-agent',
        provider: 'codex',
        role: 'response',
        model: null,
        tokensIn: null,
        tokensOut: null,
        costUsd: 0,
        content: 'Execution response',
      }),
      makeConversation({
        id: 'execute-2',
        phase: 'execute',
        speaker: 'unknown-agent',
        provider: null,
        role: 'response',
        model: null,
        tokensIn: 10,
        tokensOut: null,
        costUsd: null,
        content: 'Second execution response',
      }),
    ]);

    renderWithClient();

    expect(await screen.findByText('plan (1)')).toBeInTheDocument();
    expect(screen.getByText('execute (2)')).toBeInTheDocument();
    expect(screen.getByText('Show full (35 lines)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'execute' }));
    expect(screen.queryByText('execute (2)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'execute' }));
    expect(screen.getByText('execute (2)')).toBeInTheDocument();
    expect(screen.getByText('10→0 tok')).toBeInTheDocument();
    expect(screen.getByText('unknown-agent')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Copy all/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('### claude'),
      );
    });
    expect(screen.getByRole('button', { name: /Copy all/i })).toBeInTheDocument();
    vi.advanceTimersByTime(1500);
    expect(screen.getByRole('button', { name: /Copy all/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show full (35 lines)' }));
    expect(screen.getByText('Show less')).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('line 35'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.getByText('Show full (35 lines)')).toBeInTheDocument();

    const copyButtons = screen.getAllByRole('button').filter((button) => button.textContent === '');
    fireEvent.click(copyButtons.at(-1) as HTMLButtonElement);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('**unknown-agent** (execute, response)'),
      );
    });
    vi.advanceTimersByTime(1500);
    vi.useRealTimers();
  });

  it('posts issue chat response turns to GitHub after confirmation', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'agent-conversations:list-by-thread') {
        return [
          makeConversation({
            id: 'chat-response-1',
            phase: 'issue_chat',
            speaker: 'claude',
            role: 'response',
            content: 'Here is the answer.',
          }),
        ];
      }
      if (channel === 'github:add-comment') return { ok: true };
      return null;
    });

    renderWithClient();

    fireEvent.click(await screen.findByRole('button', { name: /Post/i }));

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith('Post this issue chat reply to GitHub?');
      expect(invokeMock).toHaveBeenCalledWith('github:add-comment', {
        projectId: 'project-1',
        issueNumber: 42,
        body: '### ShipCode issue chat reply\n\nHere is the answer.',
      });
    });
  });
});
