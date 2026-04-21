// @vitest-environment jsdom

import { DndContext } from '@dnd-kit/core';
import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { DraggableCard } from './IssueCardParts';
import { IssueListView } from './IssueListView';

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 38,
    title: 'Add demo pipeline task',
    body: null,
    labels: [],
    assignee: null,
    state: 'open',
    pipelineStatus: 'completed',
    threadId: null,
    claimedAt: null,
    claimedBy: null,
    lastPhaseUpdate: null,
    lastStatusLabel: null,
    plannerModelOverride: null,
    reviewerModelOverride: null,
    executorModelOverride: null,
    verifierModelOverride: null,
    plannerModelIdOverride: null,
    reviewerModelIdOverride: null,
    executorModelIdOverride: null,
    verifierModelIdOverride: null,
    plannerReasoningEffortOverride: null,
    reviewerReasoningEffortOverride: null,
    executorReasoningEffortOverride: null,
    verifierReasoningEffortOverride: null,
    revisionCountOverride: null,
    linkedPrNumber: 91,
    linkedPrUrl: 'https://github.com/acme/repo/pull/91',
    linkedPrIsDraft: true,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: new Date('2026-04-14T00:00:00.000Z').toISOString(),
    ...overrides,
  };
}

function renderIntoDom(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('linked PR affordances', () => {
  it('renders the animated background layer only for active cards', () => {
    const activeView = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({ pipelineStatus: 'executing' })}
          onClick={vi.fn()}
          readOnly
        />
      </DndContext>,
    );

    expect(activeView.container.querySelector('.issue-card-active-bg')).toBeTruthy();
    activeView.cleanup();

    const inactiveView = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({ pipelineStatus: 'completed' })}
          onClick={vi.fn()}
          readOnly
        />
      </DndContext>,
    );

    expect(inactiveView.container.querySelector('.issue-card-active-bg')).toBeNull();
    inactiveView.cleanup();
  });

  it('opens the linked PR from a done card without triggering card selection', () => {
    const onClick = vi.fn();
    const onOpenPullRequest = vi.fn();

    const view = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue()}
          onClick={onClick}
          onOpenPullRequest={onOpenPullRequest}
          readOnly
        />
      </DndContext>,
    );

    const button = view.container.querySelector('button[title="Open pull request on GitHub"]');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected PR button');
    }

    act(() => {
      button.click();
    });

    expect(onOpenPullRequest).toHaveBeenCalledWith('https://github.com/acme/repo/pull/91');
    expect(onClick).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('opens the linked PR from the list row without selecting the issue', () => {
    const onIssueClick = vi.fn();
    const onOpenPullRequest = vi.fn();

    const view = renderIntoDom(
      <DndContext>
        <IssueListView
          issues={[makeIssue()]}
          activeId={null}
          issueRevisionLabelById={new Map()}
          onIssueClick={onIssueClick}
          onOpenPullRequest={onOpenPullRequest}
        />
      </DndContext>,
    );

    const button = view.container.querySelector('button[title="Open pull request on GitHub"]');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected PR button');
    }

    act(() => {
      button.click();
    });

    expect(onOpenPullRequest).toHaveBeenCalledWith('https://github.com/acme/repo/pull/91');
    expect(onIssueClick).not.toHaveBeenCalled();
    view.cleanup();
  });
});
