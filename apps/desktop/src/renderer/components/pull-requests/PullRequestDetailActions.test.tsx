// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../stores/app-store';
import { PullRequestDetailActions } from './PullRequestDetailActions';

function renderActions({
  prState = 'OPEN',
  hasUnresolvedComments = false,
}: {
  prState?: 'OPEN' | 'CLOSED' | 'MERGED';
  hasUnresolvedComments?: boolean;
} = {}) {
  return render(
    <PullRequestDetailActions
      prNumber={77}
      prUrl="https://github.com/acme/repo/pull/77"
      prState={prState}
      hasUnresolvedComments={hasUnresolvedComments}
    />,
  );
}

describe('PullRequestDetailActions', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();
  const setProjectTabMock = vi.fn();
  const addTerminalPaneMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (window as typeof window & { shipcode: typeof window.shipcode }).shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as typeof window.shipcode.on,
    };
    useAppStore.setState({
      activeProjectId: 'project-1',
      setProjectTab: setProjectTabMock,
      addTerminalPane: addTerminalPaneMock,
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('starts an AI review with the review-pr skill and opens the terminal tab', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'skills:load-content') return 'review checklist';
      if (channel === 'instant:run') return { threadId: 'review-thread' };
      return null;
    });

    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('skills:load-content', { name: 'review-pr' });
    });
    expect(invokeMock).toHaveBeenCalledWith('instant:run', {
      projectId: 'project-1',
      prompt:
        'Review PR #77 at https://github.com/acme/repo/pull/77. Perform a thorough code review following the checklist in your system instructions.',
      scope: 'project',
      cli: 'claude',
      customSystemPrompt: 'review checklist',
    });
    expect(addTerminalPaneMock).toHaveBeenCalledWith('review-thread', {
      mode: 'replay',
      cli: 'claude',
      title: 'Review PR #77',
      state: 'running',
    });
    expect(setProjectTabMock).toHaveBeenCalledWith('terminal');
  });

  it('starts an address-comments run only when open PRs have unresolved comments', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'skills:load-content') return 'address workflow';
      if (channel === 'instant:run') return { threadId: 'address-thread' };
      return null;
    });

    renderActions({ hasUnresolvedComments: true });

    fireEvent.click(screen.getByRole('button', { name: 'Address Comments' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('skills:load-content', {
        name: 'gh-address-comments',
      });
    });
    expect(invokeMock).toHaveBeenCalledWith('instant:run', {
      projectId: 'project-1',
      prompt:
        'Address the review comments on PR #77 at https://github.com/acme/repo/pull/77. Follow the workflow in your system instructions to fetch, fix, and respond to each comment.',
      scope: 'project',
      cli: 'claude',
      customSystemPrompt: 'address workflow',
    });
    expect(addTerminalPaneMock).toHaveBeenCalledWith('address-thread', {
      mode: 'replay',
      cli: 'claude',
      title: 'Address PR #77',
      state: 'running',
    });
    expect(setProjectTabMock).toHaveBeenCalledWith('terminal');
  });

  it('hides actions for closed PRs and does nothing without an active project', async () => {
    const { rerender } = renderActions({ prState: 'CLOSED', hasUnresolvedComments: true });

    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Address Comments' })).not.toBeInTheDocument();

    useAppStore.setState({ activeProjectId: null } as never);
    rerender(
      <PullRequestDetailActions
        prNumber={77}
        prUrl="https://github.com/acme/repo/pull/77"
        prState="OPEN"
        hasUnresolvedComments={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(invokeMock).not.toHaveBeenCalled();
    expect(addTerminalPaneMock).not.toHaveBeenCalled();
    expect(setProjectTabMock).not.toHaveBeenCalled();
  });
});
