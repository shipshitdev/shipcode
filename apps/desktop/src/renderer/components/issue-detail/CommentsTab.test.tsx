// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { GitHubIssueComment } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentsTab } from './CommentsTab';

function renderWithClient(focusComposerRequestId?: number | null) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CommentsTab
        projectId="project-1"
        issueNumber={42}
        focusComposerRequestId={focusComposerRequestId}
      />
    </QueryClientProvider>,
  );
}

function makeComment(overrides: Partial<GitHubIssueComment> = {}): GitHubIssueComment {
  return {
    id: 1,
    author: 'octocat',
    body: '**Ship it**',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    url: 'https://github.test/comment/1',
    ...overrides,
  };
}

describe('CommentsTab', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    vi.clearAllMocks();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders empty comments, focuses the composer, and refreshes from GitHub', async () => {
    invokeMock.mockImplementation(async (channel: string, args?: unknown) => {
      if (channel === 'github:list-comments') {
        return (args as { force?: boolean } | undefined)?.force ? [makeComment()] : [];
      }
      return null;
    });

    renderWithClient(1);

    expect(await screen.findByText('No comments yet.')).toBeInTheDocument();
    const composer = screen.getByPlaceholderText('Write a comment…');
    expect(composer).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh comments' }));
    expect(await screen.findByText('octocat')).toBeInTheDocument();
    expect(screen.getByText('Ship it')).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('github:list-comments', {
      projectId: 'project-1',
      issueNumber: 42,
      force: true,
    });
  });

  it('posts trimmed comments and disables blank submissions', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'github:list-comments') return [makeComment({ author: null, body: 'hello' })];
      if (channel === 'github:add-comment') return { ok: true };
      return null;
    });

    renderWithClient();

    expect(await screen.findByText('unknown')).toBeInTheDocument();
    const postButton = screen.getByRole('button', { name: 'Post Comment' });
    expect(postButton).toBeDisabled();

    const composer = screen.getByPlaceholderText('Write a comment…');
    fireEvent.change(composer, { target: { value: '   ' } });
    expect(postButton).toBeDisabled();

    fireEvent.change(composer, { target: { value: '  new comment  ' } });
    expect(postButton).toBeEnabled();
    fireEvent.click(postButton);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('github:add-comment', {
        projectId: 'project-1',
        issueNumber: 42,
        body: 'new comment',
      }),
    );
    await waitFor(() => expect(composer).toHaveValue(''));
  });
});
