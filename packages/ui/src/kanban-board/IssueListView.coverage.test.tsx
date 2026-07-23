// @vitest-environment jsdom

import { DndContext } from '@dnd-kit/core';
import type { ComponentProps } from 'react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { IssueListView } from '@/kanban-board/IssueListView';
import { makeIssue, renderIntoDom } from './test-helpers';
import type { IssueApprovalBadge, IssuePriorityBadge, IssueRevisionBadge } from './types';

function renderList(
  props: Partial<ComponentProps<typeof IssueListView>> & {
    issues?: ComponentProps<typeof IssueListView>['issues'];
  } = {},
) {
  return renderIntoDom(
    <DndContext>
      <IssueListView
        issues={props.issues ?? []}
        activeId={props.activeId ?? null}
        issueRevisionBadgeById={props.issueRevisionBadgeById ?? new Map()}
        issueApprovalBadgeById={props.issueApprovalBadgeById ?? new Map()}
        issuePriorityBadgeById={props.issuePriorityBadgeById ?? new Map()}
        onIssueClick={props.onIssueClick ?? vi.fn()}
        {...props}
      />
    </DndContext>,
  );
}

describe('IssueListView coverage states', () => {
  it('opens GitHub issue links, row details, and keyboard activation without double-selecting', () => {
    const issue = makeIssue({
      id: 'issue-github',
      issueNumber: 44,
      title: 'Open GitHub issue',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });
    const onIssueClick = vi.fn();
    const onOpenPullRequest = vi.fn();
    const view = renderList({
      issues: [issue],
      repoUrl: 'https://github.com/acme/repo',
      onIssueClick,
      onOpenPullRequest,
    });

    const issueLink = view.container.querySelector('button[title="Open issue on GitHub"]');
    if (!(issueLink instanceof HTMLButtonElement)) throw new Error('Expected issue link');
    act(() => {
      issueLink.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      issueLink.click();
    });
    expect(onOpenPullRequest).toHaveBeenCalledWith('https://github.com/acme/repo/issues/44');
    expect(onIssueClick).not.toHaveBeenCalled();

    const row = view.container.querySelector('[role="button"]');
    if (!(row instanceof HTMLElement)) throw new Error('Expected list row');
    act(() => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(onIssueClick).toHaveBeenCalledTimes(2);

    const detail = view.container.querySelector('button[title="Open issue detail"]');
    if (!(detail instanceof HTMLButtonElement)) throw new Error('Expected detail button');
    act(() => {
      detail.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      detail.click();
    });
    expect(onIssueClick).toHaveBeenCalledTimes(3);
    view.cleanup();
  });

  it('renders non-linked PR badges and archives closed non-automation rows', () => {
    const issue = makeIssue({
      id: 'closed',
      issueNumber: 45,
      title: 'Closed issue',
      pipelineStatus: 'closed',
      linkedPrNumber: 45,
      linkedPrUrl: null,
    });
    const onArchiveIssue = vi.fn();
    const view = renderList({
      issues: [issue],
      onArchiveIssue,
      selectedIssueNumber: 45,
    });

    expect(view.container.textContent).toContain('PR #45');
    const archive = view.container.querySelector('button[title="Archive issue"]');
    if (!(archive instanceof HTMLButtonElement)) throw new Error('Expected archive button');
    act(() => {
      archive.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      archive.click();
    });
    expect(onArchiveIssue).toHaveBeenCalledWith(issue);
    view.cleanup();
  });

  it('renders active rows, tone variants, linked PR actions, and guarded keyboard events', () => {
    const executing = makeIssue({
      id: 'executing',
      issueNumber: 48,
      title: 'Executing row',
      pipelineStatus: 'executing',
      linkedPrNumber: 120,
      linkedPrUrl: 'https://github.com/acme/repo/pull/120',
      assignee: null,
    });
    const completed = makeIssue({
      id: 'completed-selected',
      issueNumber: 49,
      title: 'Completed selected row',
      pipelineStatus: 'completed',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });
    const failed = makeIssue({
      id: 'failed-selected',
      issueNumber: 50,
      title: 'Failed selected row',
      pipelineStatus: 'failed',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });
    const paused = makeIssue({
      id: 'paused-selected',
      issueNumber: 51,
      title: 'Paused selected row',
      pipelineStatus: 'paused',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });
    const closedUnselected = makeIssue({
      id: 'closed-unselected',
      issueNumber: 52,
      title: 'Closed unselected row',
      pipelineStatus: 'closed',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });
    const onIssueClick = vi.fn();
    const onOpenPullRequest = vi.fn();
    const view = renderList({
      issues: [executing, completed, failed, paused, closedUnselected],
      selectedIssueNumber: 49,
      activeId: 'executing',
      onIssueClick,
      onOpenPullRequest,
      issueApprovalBadgeById: new Map([
        [
          paused.id,
          {
            label: 'Needs approval',
            title: 'Human approval required',
            source: 'issue',
          },
        ],
      ]),
    });

    expect(view.container.textContent).toContain('Executing row');
    expect(view.container.textContent).toContain('PR #120');
    expect(view.container.textContent).toContain('—');
    expect(view.container.textContent).toContain('Needs approval');

    const rows = Array.from(view.container.querySelectorAll('[role="button"]'));
    const executingRow = rows.find((row) => row.textContent?.includes('Executing row'));
    const completedRow = rows.find((row) => row.textContent?.includes('Completed selected row'));
    const failedRow = rows.find((row) => row.textContent?.includes('Failed selected row'));
    const pausedRow = rows.find((row) => row.textContent?.includes('Paused selected row'));
    const closedRow = rows.find((row) => row.textContent?.includes('Closed unselected row'));
    if (
      !(executingRow instanceof HTMLElement) ||
      !(completedRow instanceof HTMLElement) ||
      !(failedRow instanceof HTMLElement) ||
      !(pausedRow instanceof HTMLElement) ||
      !(closedRow instanceof HTMLElement)
    ) {
      throw new Error('Expected list rows for tone coverage');
    }

    expect(executingRow.querySelector('.animate-ping')).not.toBeNull();
    expect(completedRow.className).toContain('border-success');
    expect(failedRow.className).toContain('pointer-events-none');
    expect(pausedRow.className).toContain('pointer-events-none');
    expect(closedRow.className).toContain('pointer-events-none');

    const prButton = view.container.querySelector('button[title="Open pull request on GitHub"]');
    if (!(prButton instanceof HTMLButtonElement)) throw new Error('Expected linked PR button');
    act(() => {
      prButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      prButton.click();
      executingRow.click();
      const nestedKey = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      executingRow.querySelector('span')?.dispatchEvent(nestedKey);
      const prevented = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      prevented.preventDefault();
      executingRow.dispatchEvent(prevented);
      executingRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onOpenPullRequest).toHaveBeenCalledWith('https://github.com/acme/repo/pull/120');
    expect(onIssueClick).toHaveBeenCalledWith(executing);
    expect(onIssueClick).toHaveBeenCalledTimes(1);
    view.cleanup();
  });

  it('applies selected row tone classes across list statuses', () => {
    const cases = [
      {
        issue: makeIssue({
          id: 'selected-todo',
          issueNumber: 60,
          title: 'Selected todo',
          pipelineStatus: 'todo',
          linkedPrNumber: null,
          linkedPrUrl: null,
        }),
        expectedClass: 'bg-accent/10',
      },
      {
        issue: makeIssue({
          id: 'unselected-completed',
          issueNumber: 61,
          title: 'Unselected completed',
          pipelineStatus: 'completed',
          linkedPrNumber: null,
          linkedPrUrl: null,
        }),
        selectedIssueNumber: 999,
        expectedClass: 'border-success/60',
      },
      {
        issue: makeIssue({
          id: 'selected-executing',
          issueNumber: 62,
          title: 'Selected executing',
          pipelineStatus: 'executing',
          linkedPrNumber: null,
          linkedPrUrl: null,
        }),
        expectedClass: 'border-agent bg-agent',
      },
      {
        issue: makeIssue({
          id: 'selected-failed',
          issueNumber: 63,
          title: 'Selected failed',
          pipelineStatus: 'failed',
          linkedPrNumber: null,
          linkedPrUrl: null,
        }),
        expectedClass: 'border-danger bg-[color-mix',
      },
      {
        issue: makeIssue({
          id: 'selected-paused',
          issueNumber: 64,
          title: 'Selected paused',
          pipelineStatus: 'paused',
          linkedPrNumber: null,
          linkedPrUrl: null,
        }),
        expectedClass: 'border-warning bg-warning/[0.08]',
      },
    ];

    for (const { issue, selectedIssueNumber, expectedClass } of cases) {
      const view = renderList({
        issues: [issue],
        selectedIssueNumber: selectedIssueNumber ?? issue.issueNumber,
      });
      const row = view.container.querySelector('[role="button"]');
      expect(row?.className).toContain(expectedClass);
      view.cleanup();
    }
  });

  it('renders creating, quick, and automation reference labels with badges', () => {
    const creating = makeIssue({
      id: 'creating',
      title: 'Creating row',
      syncState: 'creating',
      issueNumber: 46,
    });
    const quick = makeIssue({
      id: 'quick',
      title: 'Quick row',
      issueNumber: -1,
      isQuickMode: true,
    });
    const automation = makeIssue({
      id: 'automation',
      title: 'Automation row',
      issueNumber: -1_000_001,
      isQuickMode: false,
    });
    const onIssueClick = vi.fn();
    const view = renderList({ issues: [creating, quick, automation], onIssueClick });

    expect(view.container.textContent).toContain('Creating');
    expect(view.container.textContent).toContain('Quick');
    expect(view.container.textContent).toContain('Auto');

    const creatingRow = Array.from(view.container.querySelectorAll('[role="button"]')).find((row) =>
      row.textContent?.includes('Creating row'),
    );
    if (!(creatingRow instanceof HTMLElement)) throw new Error('Expected creating row');
    act(() => {
      creatingRow.click();
      creatingRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onIssueClick).not.toHaveBeenCalledWith(creating);
    view.cleanup();
  });

  it('renders approval, priority, revision, staleness, and approved-waiting badges', () => {
    const issue = makeIssue({
      id: 'badged',
      issueNumber: 47,
      title: 'Badged row',
      pipelineStatus: 'approval',
      failingChecks: [
        {
          name: 'test',
          status: 'failed',
          conclusion: 'failure',
          detailsUrl: null,
          workflowName: null,
        },
      ],
      unresolvedReviewCommentCount: 2,
    });
    const revisionBadge: IssueRevisionBadge = {
      label: 'v2',
      title: 'Plan version 2',
      variant: 'warning',
    };
    const approvalBadge: IssueApprovalBadge = {
      label: 'Approval',
      title: 'Approval required',
      source: 'issue',
    };
    const priorityBadge: IssuePriorityBadge = {
      label: 'P0',
      title: 'Priority P0',
      variant: 'warning',
      rank: 'p0',
    };
    const view = renderList({
      issues: [issue],
      issueRevisionBadgeById: new Map([[issue.id, revisionBadge]]),
      issueApprovalBadgeById: new Map([[issue.id, approvalBadge]]),
      issuePriorityBadgeById: new Map([[issue.id, priorityBadge]]),
      issueStalenessById: new Map([
        [
          issue.id,
          {
            isStale: true,
            reason: 'status-stale',
            title: 'Issue changed after pipeline update',
            ageMs: 86_400_000,
            since: '2026-05-01T00:00:00.000Z',
            thresholdMs: 86_400_000,
          },
        ],
      ]),
      approvedAwaitingExecutionIssueIds: new Set([issue.id]),
    });

    expect(view.container.textContent).toContain('P0');
    expect(view.container.textContent).toContain('v2');
    expect(view.container.textContent).toContain('Approved');
    expect(view.container.textContent).toContain('Waiting for slot');
    expect(view.container.textContent).not.toContain('Approval required');
    view.cleanup();
  });

  it('collapses columns, renders custom dot colors, and shows empty column copy', () => {
    const view = renderList({
      columnDotColors: { todo: '#123456' },
    });

    const emptyCountBefore = view.container.textContent?.match(/No issues/g)?.length ?? 0;
    expect(emptyCountBefore).toBeGreaterThan(0);
    const todoDot = view.container.querySelector('[style*="color: rgb(18, 52, 86)"]');
    expect(todoDot).not.toBeNull();

    const todoToggle = Array.from(view.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Backlog'),
    );
    if (!(todoToggle instanceof HTMLButtonElement)) throw new Error('Expected Todo toggle');
    const todoHeader = todoToggle.querySelector('[data-slot="kanban-column-header"]');
    expect(todoHeader?.textContent).toContain('Backlog');
    expect(todoHeader?.textContent).toContain('(0)');
    expect(todoHeader?.querySelector('button')).toBeNull();
    act(() => todoToggle.click());
    const emptyCountAfter = view.container.textContent?.match(/No issues/g)?.length ?? 0;
    expect(emptyCountAfter).toBe(emptyCountBefore - 1);
    view.cleanup();
  });
});
