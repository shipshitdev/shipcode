// @vitest-environment jsdom

import { DndContext } from '@dnd-kit/core';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IssueListView } from '@/kanban-board/IssueListView';
import { makeIssue, renderIntoDom } from './test-helpers';

// `formatDate` is called exactly once per `DraggableListRow` render and nowhere
// else in IssueListView, so the spy call count is a precise render counter.
vi.mock('@/kanban-board/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/kanban-board/utils')>();
  return { ...actual, formatDate: vi.fn(actual.formatDate) };
});

const { formatDate } = await import('@/kanban-board/utils');
const rowRenders = vi.mocked(formatDate);

const ISSUES = [
  makeIssue({ id: 'issue-a', issueNumber: 1, title: 'Alpha' }),
  makeIssue({ id: 'issue-b', issueNumber: 2, title: 'Bravo' }),
  makeIssue({ id: 'issue-c', issueNumber: 3, title: 'Charlie' }),
];

// Stable references, as the parent supplies them once callbacks are memoized.
const onIssueClick = vi.fn();
const onOpenPullRequest = vi.fn();
const onArchiveIssue = vi.fn();
const revisionBadges = new Map();
const approvalBadges = new Map();
const priorityBadges = new Map();

function listProps(
  overrides: Partial<ComponentProps<typeof IssueListView>> = {},
): ComponentProps<typeof IssueListView> {
  return {
    issues: ISSUES,
    activeId: null,
    issueRevisionBadgeById: revisionBadges,
    issueApprovalBadgeById: approvalBadges,
    issuePriorityBadgeById: priorityBadges,
    repoUrl: 'https://github.com/acme/repo',
    onIssueClick,
    onOpenPullRequest,
    onArchiveIssue,
    ...overrides,
  };
}

function renderList(props: ComponentProps<typeof IssueListView>) {
  return renderIntoDom(
    <DndContext>
      <IssueListView {...props} />
    </DndContext>,
  );
}

function tree(props: ComponentProps<typeof IssueListView>) {
  return (
    <DndContext>
      <IssueListView {...props} />
    </DndContext>
  );
}

describe('DraggableListRow memoization', () => {
  beforeEach(() => {
    rowRenders.mockClear();
  });

  it('does not re-render rows when a poll returns unchanged data', () => {
    const view = renderList(listProps());
    expect(rowRenders).toHaveBeenCalledTimes(ISSUES.length);
    rowRenders.mockClear();

    // A poll settling with identical data: parent re-renders, row props are
    // referentially unchanged.
    view.rerender(tree(listProps()));

    expect(rowRenders).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('re-renders only the row whose issue changed', () => {
    const view = renderList(listProps());
    rowRenders.mockClear();

    const changed = { ...ISSUES[1], title: 'Bravo (updated)' };
    view.rerender(tree(listProps({ issues: [ISSUES[0], changed, ISSUES[2]] })));

    expect(rowRenders).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain('Bravo (updated)');
    view.cleanup();
  });

  it('is defeated by unstable callback props, which is why the parent memoizes them', () => {
    const view = renderList(listProps());
    rowRenders.mockClear();

    // Same data, but a fresh handler identity — what an inline arrow in the
    // parent produces on every render.
    view.rerender(tree(listProps({ onOpenPullRequest: vi.fn() })));

    expect(rowRenders).toHaveBeenCalledTimes(ISSUES.length);
    view.cleanup();
  });
});
