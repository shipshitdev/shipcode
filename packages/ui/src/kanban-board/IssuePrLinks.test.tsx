// @vitest-environment jsdom

import { DndContext } from '@dnd-kit/core';
import { type AppSettings, DEFAULT_SETTINGS, type GitHubIssueCacheRecord } from '@shipcode/shared';
import { act, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivePipelineCard } from '@/ActivePipelineCard';
import { KanbanBoard } from '@/KanbanBoard';
import { DroppableColumn, StackedColumn } from '@/kanban-board/BoardColumns';
import {
  DraggableCard,
  DragOverlayCard,
  IssueExternalBlockers,
} from '@/kanban-board/IssueCardParts';
import { IssueListView } from '@/kanban-board/IssueListView';
import { COLUMNS } from './constants';
import { makeIssue as makeBaseIssue, makeProject, renderIntoDom } from './test-helpers';

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return makeBaseIssue({
    issueNumber: 38,
    title: 'Add demo pipeline task',
    pipelineStatus: 'completed',
    linkedPrNumber: 91,
    linkedPrUrl: 'https://github.com/acme/repo/pull/91',
    linkedPrIsDraft: true,
    fetchedAt: new Date('2026-04-14T00:00:00.000Z').toISOString(),
    ...overrides,
  });
}

const SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  requireApproval: false,
};

function openMoreActions(container: HTMLElement) {
  const trigger = container.querySelector('button[title="More actions"]');
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new Error('Expected more actions button');
  }

  act(() => {
    trigger.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
    );
    trigger.click();
  });
}

function menuItem(label: string) {
  const item = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((element) =>
    element.textContent?.includes(label),
  );
  if (!(item instanceof HTMLElement)) {
    throw new Error(`Expected menu item: ${label}`);
  }
  return item;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('linked PR affordances', () => {
  it('renders external blocker badges with singular, plural, and empty states', () => {
    const empty = renderIntoDom(
      <IssueExternalBlockers
        issue={makeIssue({ ciBlocked: false, unresolvedReviewCommentCount: 0 })}
      />,
    );
    expect(empty.container.textContent).toBe('');
    empty.cleanup();

    const singular = renderIntoDom(
      <IssueExternalBlockers
        issue={makeIssue({ ciBlocked: true, unresolvedReviewCommentCount: 1 })}
      />,
    );
    expect(singular.container.textContent).toContain('CI blocked');
    expect(singular.container.textContent).toContain('1 review');
    expect(singular.container.textContent).not.toContain('1 reviews');
    singular.cleanup();

    const plural = renderIntoDom(
      <IssueExternalBlockers
        issue={makeIssue({ ciBlocked: false, unresolvedReviewCommentCount: 3 })}
      />,
    );
    expect(plural.container.textContent).toContain('3 reviews');
    plural.cleanup();
  });

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

  it('labels automation cards, flashes them, and hides GitHub-only actions', () => {
    const view = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            id: 'automation:thread-1',
            issueNumber: -1_000_001,
            title: '[Auto] Nightly cleanup',
            pipelineStatus: 'completed',
            linkedPrNumber: null,
            linkedPrUrl: null,
          })}
          isFlashing
          onClick={vi.fn()}
          onArchiveIssue={vi.fn()}
        />
      </DndContext>,
    );

    expect(view.container.textContent).toContain('Auto');
    const card = view.container.querySelector('[data-issue-card-id="automation:thread-1"]');
    expect(card?.className).toContain('animate-card-flash');
    expect(view.container.querySelector('button[title="Archive issue"]')).toBeNull();
    view.cleanup();
  });

  it('renders creating cards and ignores direct activation while they are staged', () => {
    const onClick = vi.fn();
    const view = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            id: 'creating-issue',
            issueNumber: 0,
            title: 'Creating issue',
            pipelineStatus: 'todo',
            syncState: 'creating',
            linkedPrNumber: null,
            linkedPrUrl: null,
          })}
          onClick={onClick}
        />
      </DndContext>,
    );

    const card = view.container.querySelector('[data-issue-card-id="creating-issue"]');
    if (!(card instanceof HTMLElement)) {
      throw new Error('Expected creating issue card');
    }

    expect(view.container.textContent).toContain('Creating');
    expect(card.className).toContain('opacity-80');
    expect(view.container.querySelector('button[title="More actions"]')).toBeNull();

    act(() => {
      card.click();
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onClick).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('applies selected tone variants for completed and closed cards', () => {
    const completed = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            id: 'selected-completed',
            pipelineStatus: 'completed',
            linkedPrNumber: null,
            linkedPrUrl: null,
          })}
          isSelected
          onClick={vi.fn()}
          readOnly
        />
      </DndContext>,
    );
    expect(
      completed.container.querySelector('[data-issue-card-id="selected-completed"]')?.className,
    ).toContain('ring-1 ring-border-strong');
    completed.cleanup();

    const closed = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            id: 'selected-closed',
            pipelineStatus: 'closed',
            linkedPrNumber: null,
            linkedPrUrl: null,
          })}
          isSelected
          onClick={vi.fn()}
          readOnly
        />
      </DndContext>,
    );
    expect(
      closed.container.querySelector('[data-issue-card-id="selected-closed"]')?.className,
    ).toContain('ring-1 ring-border-strong');
    closed.cleanup();

    const selectedTodo = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            id: 'selected-todo',
            pipelineStatus: 'todo',
            linkedPrNumber: null,
            linkedPrUrl: null,
          })}
          isSelected
          onClick={vi.fn()}
          readOnly
        />
      </DndContext>,
    );
    const selectedTodoCard = selectedTodo.container.querySelector(
      '[data-issue-card-id="selected-todo"]',
    );
    expect(selectedTodoCard?.className).toContain('ring-1 ring-border-strong');
    selectedTodo.cleanup();

    const keyboardFocused = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            id: 'keyboard-focused',
            pipelineStatus: 'todo',
            linkedPrNumber: null,
            linkedPrUrl: null,
          })}
          isKeyboardFocused
          onClick={vi.fn()}
          readOnly
        />
      </DndContext>,
    );
    const keyboardFocusedCard = keyboardFocused.container.querySelector(
      '[data-issue-card-id="keyboard-focused"]',
    );
    expect(keyboardFocusedCard?.className).toContain('border-accent/80');
    expect(keyboardFocusedCard?.getAttribute('data-keyboard-focused')).toBe('true');
    keyboardFocused.cleanup();
  });

  it('renders copied branch menu state', () => {
    const onCopyBranchName = vi.fn();
    const view = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            id: 'issue-branch-copied',
            issueNumber: 208,
            title: 'Issue with copied branch',
            pipelineStatus: 'approval',
            linkedPrNumber: null,
            linkedPrUrl: null,
          })}
          branchName="shipcode/issue-208"
          branchCopyState="copied"
          onClick={vi.fn()}
          onCopyBranchName={onCopyBranchName}
        />
      </DndContext>,
    );

    openMoreActions(view.container);
    const menu = document.body.querySelector('[role="menu"]');
    if (!(menu instanceof HTMLElement)) {
      throw new Error('Expected actions menu');
    }
    act(() => {
      menu.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      menu.click();
    });
    act(() => menuItem('Copied!').click());
    expect(onCopyBranchName).toHaveBeenCalledWith(expect.anything(), 'shipcode/issue-208');
    view.cleanup();
  });

  it('ignores card keyboard activation when the event is already handled by a child', () => {
    const onClick = vi.fn();
    const view = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            id: 'keyboard-child',
            pipelineStatus: 'todo',
            linkedPrNumber: null,
            linkedPrUrl: null,
          })}
          onClick={onClick}
          readOnly
        />
      </DndContext>,
    );

    const card = view.container.querySelector('[data-issue-card-id="keyboard-child"]');
    const title = view.container.querySelector('.line-clamp-2');
    if (!(card instanceof HTMLElement) || !(title instanceof HTMLElement)) {
      throw new Error('Expected card and nested title');
    }

    act(() => {
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const prevented = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      prevented.preventDefault();
      card.dispatchEvent(prevented);
    });

    expect(onClick).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('opens the linked PR from a closed card without triggering card selection', () => {
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
    if (!(button instanceof HTMLElement)) {
      throw new Error('Expected PR button');
    }

    act(() => {
      button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
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
          issueRevisionBadgeById={new Map()}
          issueApprovalBadgeById={new Map()}
          issuePriorityBadgeById={new Map()}
          onIssueClick={onIssueClick}
          onOpenPullRequest={onOpenPullRequest}
        />
      </DndContext>,
    );

    const button = view.container.querySelector('button[title="Open pull request on GitHub"]');
    if (!(button instanceof HTMLElement)) {
      throw new Error('Expected PR button');
    }

    act(() => {
      button.click();
    });

    expect(onOpenPullRequest).toHaveBeenCalledWith('https://github.com/acme/repo/pull/91');
    expect(onIssueClick).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('opens issue detail from the card surface and dedicated action', () => {
    const onClick = vi.fn();

    const view = renderIntoDom(
      <DndContext>
        <DraggableCard issue={makeIssue()} onClick={onClick} readOnly />
      </DndContext>,
    );

    const card = view.container.querySelector('[data-issue-card-id]');
    if (!(card instanceof HTMLDivElement)) {
      throw new Error('Expected issue card');
    }

    act(() => {
      card.click();
    });

    expect(onClick).toHaveBeenCalledTimes(1);

    expect(view.container.querySelector('button[title="Open issue detail"]')).toBeNull();
    expect(view.container.querySelector('button[title="More actions"]')).toBeNull();
    view.cleanup();
  });

  it('handles compact card keyboard activation and GitHub issue link guards', () => {
    const onClick = vi.fn();
    const onOpenPullRequest = vi.fn();
    const issue = makeIssue({
      id: 'github-card-link',
      issueNumber: 88,
      title: 'GitHub card link',
      pipelineStatus: 'todo',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });

    const view = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={issue}
          issueGithubUrl="https://github.com/acme/repo/issues/88"
          onClick={onClick}
          onOpenPullRequest={onOpenPullRequest}
        />
      </DndContext>,
    );

    const card = view.container.querySelector('[data-issue-card-id="github-card-link"]');
    if (!(card instanceof HTMLElement)) {
      throw new Error('Expected issue card');
    }

    act(() => {
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClick).toHaveBeenCalledTimes(2);

    const issueLink = view.container.querySelector('button[title="Open issue on GitHub"]');
    if (!(issueLink instanceof HTMLButtonElement)) {
      throw new Error('Expected issue link button');
    }

    act(() => {
      issueLink.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      issueLink.click();
    });

    expect(onOpenPullRequest).toHaveBeenCalledWith('https://github.com/acme/repo/issues/88');
    expect(onClick).toHaveBeenCalledTimes(2);
    view.cleanup();
  });

  it('opens issue detail from the list row surface and dedicated action', () => {
    const onIssueClick = vi.fn();

    const view = renderIntoDom(
      <DndContext>
        <IssueListView
          issues={[makeIssue()]}
          activeId={null}
          issueRevisionBadgeById={new Map()}
          issueApprovalBadgeById={new Map()}
          issuePriorityBadgeById={new Map()}
          onIssueClick={onIssueClick}
        />
      </DndContext>,
    );

    const title = Array.from(view.container.querySelectorAll('span')).find((element) =>
      element.textContent?.includes('Add demo pipeline task'),
    );
    if (!(title instanceof HTMLSpanElement)) {
      throw new Error('Expected row title');
    }

    act(() => {
      title.click();
    });

    expect(onIssueClick).toHaveBeenCalledTimes(1);

    const button = view.container.querySelector('button[title="Open issue detail"]');
    if (!(button instanceof HTMLElement)) {
      throw new Error('Expected list-row detail button');
    }

    act(() => {
      button.click();
    });

    expect(onIssueClick).toHaveBeenCalledTimes(2);
    view.cleanup();
  });

  it('handles list-row keyboard activation and nested button pointer guards', () => {
    const onIssueClick = vi.fn();
    const onOpenPullRequest = vi.fn();
    const onArchiveIssue = vi.fn();
    const closedIssue = makeIssue({
      id: 'closed-keyboard-row',
      issueNumber: 77,
      title: 'Closed keyboard row',
      pipelineStatus: 'closed',
      state: 'closed',
      linkedPrNumber: 78,
      linkedPrUrl: 'https://github.com/acme/repo/pull/78',
    });

    const view = renderIntoDom(
      <DndContext>
        <IssueListView
          issues={[closedIssue]}
          activeId={null}
          repoUrl="https://github.com/acme/repo"
          selectedIssueNumber={77}
          issueRevisionBadgeById={new Map()}
          issueApprovalBadgeById={new Map()}
          issuePriorityBadgeById={new Map()}
          onIssueClick={onIssueClick}
          onOpenPullRequest={onOpenPullRequest}
          onArchiveIssue={onArchiveIssue}
        />
      </DndContext>,
    );

    const row = view.container.querySelector('[data-rfd-draggable-id], [role="button"]');
    const rowButton = Array.from(view.container.querySelectorAll('[role="button"]')).find(
      (element) => element.textContent?.includes('Closed keyboard row'),
    );
    const target = rowButton ?? row;
    if (!(target instanceof HTMLElement)) {
      throw new Error('Expected list row');
    }

    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onIssueClick).toHaveBeenCalledTimes(2);

    for (const title of [
      'Open issue on GitHub',
      'Open pull request on GitHub',
      'Open issue detail',
      'Archive issue',
    ]) {
      const button = view.container.querySelector(`button[title="${title}"]`);
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Expected nested button: ${title}`);
      }
      act(() => {
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      });
    }

    view.cleanup();
  });

  it('renders list-row labels, badges, custom dots, and archive actions across issue types', () => {
    const onIssueClick = vi.fn();
    const onOpenPullRequest = vi.fn();
    const onArchiveIssue = vi.fn();
    const creatingIssue = makeIssue({
      id: 'creating-issue',
      issueNumber: -1,
      title: 'Creating draft issue',
      pipelineStatus: 'todo',
      isQuickMode: true,
    });
    const quickIssue = makeIssue({
      id: 'quick-issue',
      issueNumber: -2,
      title: 'Quick task',
      pipelineStatus: 'todo',
      isQuickMode: true,
    });
    const automationIssue = makeIssue({
      id: 'automation:thread-2',
      issueNumber: -1_000_002,
      title: '[Auto] Sweep inbox',
      pipelineStatus: 'completed',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });
    const closedIssue = makeIssue({
      id: 'closed-issue',
      issueNumber: 99,
      title: 'Closed issue',
      pipelineStatus: 'closed',
      state: 'closed',
      linkedPrNumber: 100,
      linkedPrUrl: null,
      ciBlocked: true,
      unresolvedReviewCommentCount: 2,
    });
    const githubIssue = makeIssue({
      id: 'github-issue',
      issueNumber: 101,
      title: 'Open on GitHub',
      pipelineStatus: 'todo',
      linkedPrNumber: null,
      linkedPrUrl: null,
      assignee: 'octocat',
    });

    const view = renderIntoDom(
      <DndContext>
        <IssueListView
          issues={[creatingIssue, quickIssue, automationIssue, closedIssue, githubIssue]}
          activeId="other-issue"
          columnDotColors={{ todo: '#123456' }}
          selectedIssueNumber={99}
          repoUrl="https://github.com/acme/repo"
          issueRevisionBadgeById={
            new Map([['closed-issue', { label: 'r2', title: 'Revision 2', variant: 'default' }]])
          }
          issueApprovalBadgeById={
            new Map([
              ['closed-issue', { label: 'Approval', title: 'Needs approval', source: 'issue' }],
            ])
          }
          issuePriorityBadgeById={
            new Map([
              [
                'closed-issue',
                { label: 'P0', title: 'Priority P0', variant: 'warning', rank: 'p0' },
              ],
            ])
          }
          issueStalenessById={
            new Map([
              [
                'closed-issue',
                {
                  isStale: true,
                  reason: 'status-stale',
                  title: 'Needs refresh',
                  ageMs: 1_000,
                  since: '2026-04-13T00:00:00.000Z',
                  thresholdMs: 500,
                },
              ],
            ])
          }
          approvedAwaitingExecutionIssueIds={new Set(['creating-issue'])}
          onIssueClick={onIssueClick}
          onOpenPullRequest={onOpenPullRequest}
          onArchiveIssue={onArchiveIssue}
        />
      </DndContext>,
    );

    expect(view.container.textContent).toContain('Creating');
    expect(view.container.textContent).toContain('Quick');
    expect(view.container.textContent).toContain('Auto');
    expect(view.container.textContent).toContain('CI blocked');
    expect(view.container.textContent).toContain('2 reviews');
    expect(view.container.textContent).toContain('P0');
    expect(view.container.textContent).toContain('r2');
    expect(view.container.textContent).toContain('octocat');
    expect(view.container.querySelector('[data-staleness-dot="true"]')).toBeTruthy();

    const issueLink = view.container.querySelector('button[title="Open issue on GitHub"]');
    if (!(issueLink instanceof HTMLButtonElement)) {
      throw new Error('Expected issue link button');
    }

    act(() => {
      issueLink.click();
    });

    expect(onOpenPullRequest).toHaveBeenCalledWith('https://github.com/acme/repo/issues/101');
    expect(onIssueClick).not.toHaveBeenCalled();

    const archiveButton = view.container.querySelector('button[title="Archive issue"]');
    if (!(archiveButton instanceof HTMLButtonElement)) {
      throw new Error('Expected list archive button');
    }

    act(() => {
      archiveButton.click();
    });

    expect(onArchiveIssue).toHaveBeenCalledWith(closedIssue);
    view.cleanup();
  });

  it('renders drag overlay labels for creating, quick, automation, and regular issues', () => {
    const view = renderIntoDom(
      <>
        <DragOverlayCard issue={makeIssue({ syncState: 'creating', title: 'Creating overlay' })} />
        <DragOverlayCard
          issue={makeIssue({ issueNumber: -2, isQuickMode: true, title: 'Quick overlay' })}
        />
        <DragOverlayCard
          issue={makeIssue({
            issueNumber: -1_000_001,
            title: 'Automation overlay',
            pipelineStatus: 'approval',
          })}
          approvedAwaitingExecution
        />
        <DragOverlayCard issue={makeIssue({ issueNumber: 42, title: 'Regular overlay' })} />
      </>,
    );

    expect(view.container.textContent).toContain('Creating');
    expect(view.container.textContent).toContain('Quick');
    expect(view.container.textContent).toContain('Auto');
    expect(view.container.textContent).toContain('#42');
    view.cleanup();
  });

  it('collapses and expands list columns without dropping the issue counts', () => {
    const view = renderIntoDom(
      <DndContext>
        <IssueListView
          issues={[
            makeIssue({
              id: 'todo-list-issue',
              issueNumber: 201,
              title: 'Todo list issue',
              pipelineStatus: 'todo',
              linkedPrNumber: null,
              linkedPrUrl: null,
            }),
          ]}
          activeId={null}
          issueRevisionBadgeById={new Map()}
          issueApprovalBadgeById={new Map()}
          issuePriorityBadgeById={new Map()}
          onIssueClick={vi.fn()}
        />
      </DndContext>,
    );

    expect(view.container.textContent).toContain('Todo list issue');
    const todoToggle = Array.from(view.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Backlog'),
    );
    if (!(todoToggle instanceof HTMLButtonElement)) {
      throw new Error('Expected todo column toggle');
    }

    act(() => {
      todoToggle.click();
    });

    expect(view.container.textContent).toContain('(1)');
    expect(view.container.textContent).not.toContain('Todo list issue');

    act(() => {
      todoToggle.click();
    });

    expect(view.container.textContent).toContain('Todo list issue');
    view.cleanup();
  });

  it('renders card actions in the compact action menu', () => {
    const onStartPipeline = vi.fn();
    const todoView = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({ pipelineStatus: 'todo' })}
          onClick={vi.fn()}
          onStartPipeline={onStartPipeline}
        />
      </DndContext>,
    );

    const startButton = todoView.container.querySelector('button[title="Start planning"]');
    if (!(startButton instanceof HTMLButtonElement))
      throw new Error('Expected start planning button');
    act(() => startButton.click());
    expect(onStartPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineStatus: 'todo' }),
    );
    todoView.cleanup();

    const onRerun = vi.fn();
    const failedView = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            pipelineStatus: 'failed',
            linkedPrNumber: null,
            linkedPrUrl: null,
          })}
          onClick={vi.fn()}
          onRerun={onRerun}
        />
      </DndContext>,
    );

    const retryButton = failedView.container.querySelector('button[title="Retry pipeline"]');
    if (!(retryButton instanceof HTMLButtonElement))
      throw new Error('Expected retry pipeline button');
    act(() => retryButton.click());
    expect(onRerun).toHaveBeenCalledWith(expect.objectContaining({ pipelineStatus: 'failed' }));
    failedView.cleanup();
  });

  it('keeps pending card actions in the compact action menu', () => {
    const retryView = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            pipelineStatus: 'failed',
            linkedPrNumber: null,
            linkedPrUrl: null,
          })}
          onClick={vi.fn()}
          onRerun={vi.fn()}
          isRerunning
        />
      </DndContext>,
    );

    const retryButton = retryView.container.querySelector('button[title="Retrying pipeline"]');
    if (!(retryButton instanceof HTMLButtonElement))
      throw new Error('Expected retrying pipeline button');
    expect(retryButton.disabled).toBe(true);
    retryView.cleanup();

    const doneView = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            pipelineStatus: 'completed',
            linkedPrNumber: null,
            linkedPrUrl: null,
          })}
          onClick={vi.fn()}
          onMarkDone={vi.fn()}
          isMarkingDone
        />
      </DndContext>,
    );

    openMoreActions(doneView.container);
    expect(menuItem('Close Issue').getAttribute('disabled')).toBeNull();
    doneView.cleanup();
  });

  it('routes compact card menu actions for active, paused, completed, and closed issues', () => {
    const activeIssue = makeIssue({
      id: 'issue-active-menu',
      issueNumber: 301,
      title: 'Active menu issue',
      pipelineStatus: 'executing',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });
    const onPause = vi.fn();
    const onCancel = vi.fn();
    const activeView = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={activeIssue}
          onClick={vi.fn()}
          onPause={onPause}
          onCancel={onCancel}
        />
      </DndContext>,
    );

    openMoreActions(activeView.container);
    act(() => menuItem('Pause').click());
    expect(onPause).toHaveBeenCalledWith(activeIssue);
    activeView.cleanup();

    const cancelView = renderIntoDom(
      <DndContext>
        <DraggableCard issue={activeIssue} onClick={vi.fn()} onCancel={onCancel} />
      </DndContext>,
    );

    openMoreActions(cancelView.container);
    act(() => menuItem('Cancel').click());
    expect(onCancel).toHaveBeenCalledWith(activeIssue);
    cancelView.cleanup();

    const pausedIssue = makeIssue({
      id: 'issue-paused-menu',
      issueNumber: 302,
      title: 'Paused menu issue',
      pipelineStatus: 'paused',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });
    const onResume = vi.fn();
    const pausedView = renderIntoDom(
      <DndContext>
        <DraggableCard issue={pausedIssue} onClick={vi.fn()} onResume={onResume} />
      </DndContext>,
    );

    openMoreActions(pausedView.container);
    act(() => menuItem('Resume').click());
    expect(onResume).toHaveBeenCalledWith(pausedIssue);
    pausedView.cleanup();

    const completedIssue = makeIssue({
      id: 'issue-completed-menu',
      issueNumber: 303,
      title: 'Completed menu issue',
      pipelineStatus: 'completed',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });
    const onCreatePr = vi.fn();
    const onMarkDone = vi.fn();
    const completedView = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={completedIssue}
          onClick={vi.fn()}
          onCreatePr={onCreatePr}
          onMarkDone={onMarkDone}
        />
      </DndContext>,
    );

    openMoreActions(completedView.container);
    act(() => menuItem('Create PR').click());
    expect(onCreatePr).toHaveBeenCalledWith(completedIssue);
    completedView.cleanup();

    const closeView = renderIntoDom(
      <DndContext>
        <DraggableCard issue={completedIssue} onClick={vi.fn()} onMarkDone={onMarkDone} />
      </DndContext>,
    );

    openMoreActions(closeView.container);
    act(() => menuItem('Close Issue').click());
    expect(onMarkDone).toHaveBeenCalledWith(completedIssue);
    closeView.cleanup();

    const closedIssue = makeIssue({
      id: 'issue-closed-menu',
      issueNumber: 304,
      title: 'Closed menu issue',
      pipelineStatus: 'closed',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });
    const onArchiveIssue = vi.fn();
    const closedView = renderIntoDom(
      <DndContext>
        <DraggableCard issue={closedIssue} onClick={vi.fn()} onArchiveIssue={onArchiveIssue} />
      </DndContext>,
    );

    openMoreActions(closedView.container);
    act(() => menuItem('Archive').click());
    expect(onArchiveIssue).toHaveBeenCalledWith(closedIssue);
    closedView.cleanup();
  });

  it('shows retry affordance on failed automation cards', () => {
    const onRerun = vi.fn();
    const issue = makeIssue({
      id: 'automation:thread-1',
      issueNumber: -1_000_001,
      title: '[Auto] clean',
      pipelineStatus: 'failed',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });

    const view = renderIntoDom(
      <DndContext>
        <DraggableCard issue={issue} onClick={vi.fn()} onRerun={onRerun} />
      </DndContext>,
    );

    const retryButton = view.container.querySelector('button[title="Retry pipeline"]');
    if (!(retryButton instanceof HTMLButtonElement))
      throw new Error('Expected retry pipeline button');
    act(() => retryButton.click());

    expect(onRerun).toHaveBeenCalledWith(issue);
    view.cleanup();
  });

  it('omits approval badges from compact cards', () => {
    const view = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue()}
          approvalBadge={{
            label: 'Approval',
            title: 'Approval required via project override',
            source: 'project',
          }}
          onClick={vi.fn()}
          readOnly
        />
      </DndContext>,
    );

    expect(view.container.textContent).not.toContain('Approval');
    expect(
      Array.from(view.container.querySelectorAll('[title]')).find(
        (element) => element.getAttribute('title') === 'Approval required via project override',
      ),
    ).toBeUndefined();
    view.cleanup();
  });

  it('renders approved slot waiters in the agent loop instead of approval-needed UI', () => {
    const issue = makeIssue({
      id: 'issue-slot-waiter',
      issueNumber: 95,
      title: 'Approved and waiting for execution',
      pipelineStatus: 'approval',
      linkedPrNumber: null,
      linkedPrUrl: null,
      requireApprovalOverride: true,
    });

    const view = renderIntoDom(
      <KanbanBoard
        issues={[issue]}
        project={makeProject()}
        settings={{ ...SETTINGS, requireApproval: true }}
        approvedAwaitingExecutionIssueIds={new Set([issue.id])}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(view.container.textContent).toContain('Waiting');
    expect(view.container.textContent).toContain('Approved');
    expect(view.container.textContent).toContain('Approved and waiting for execution');
    view.cleanup();
  });

  it('renders an approval badge in list rows with a source tooltip', () => {
    const issue = makeIssue({ pipelineStatus: 'approval' });

    const view = renderIntoDom(
      <DndContext>
        <IssueListView
          issues={[issue]}
          activeId={null}
          issueRevisionBadgeById={new Map()}
          issueApprovalBadgeById={
            new Map([
              [
                issue.id,
                {
                  label: 'Approval',
                  title: 'Approval required via issue override',
                  source: 'issue' as const,
                },
              ],
            ])
          }
          issuePriorityBadgeById={new Map()}
          onIssueClick={vi.fn()}
        />
      </DndContext>,
    );

    const badge = Array.from(view.container.querySelectorAll('[title]')).find(
      (element) => element.getAttribute('title') === 'Approval required via issue override',
    );
    expect(badge?.textContent).toContain('Approval');
    view.cleanup();
  });

  it('filters the board down to approval-gated issues', () => {
    const approvalIssue = makeIssue({
      id: 'issue-approval',
      issueNumber: 101,
      title: 'Needs human approval',
      pipelineStatus: 'todo',
      linkedPrNumber: null,
      linkedPrUrl: null,
      requireApprovalOverride: true,
    });
    const regularIssue = makeIssue({
      id: 'issue-regular',
      issueNumber: 102,
      title: 'Auto-runs normally',
      pipelineStatus: 'todo',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });

    const view = renderIntoDom(
      <KanbanBoard
        issues={[approvalIssue, regularIssue]}
        project={makeProject()}
        settings={SETTINGS}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(view.container.textContent).toContain('Needs human approval');
    expect(view.container.textContent).toContain('Auto-runs normally');

    const filterButton = Array.from(view.container.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Filters'),
    );
    if (!(filterButton instanceof HTMLButtonElement)) {
      throw new Error('Expected filters button');
    }

    act(() => {
      filterButton.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
      filterButton.click();
    });

    const button = Array.from(document.body.querySelectorAll('[role="menuitemcheckbox"]')).find(
      (element) => element.textContent?.includes('Needs approval'),
    );
    if (!(button instanceof HTMLElement)) {
      throw new Error('Expected approval filter button');
    }

    act(() => {
      button.click();
    });

    expect(view.container.textContent).toContain('Needs human approval');
    expect(view.container.textContent).not.toContain('Auto-runs normally');
    view.cleanup();
  });

  it('keeps approved slot waiters out of the needs-approval filter', () => {
    const approvalIssue = makeIssue({
      id: 'issue-approval',
      issueNumber: 111,
      title: 'Still waiting on me',
      pipelineStatus: 'approval',
      linkedPrNumber: null,
      linkedPrUrl: null,
      requireApprovalOverride: true,
    });
    const approvedWaiter = makeIssue({
      id: 'issue-slot-waiter',
      issueNumber: 112,
      title: 'Approved and waiting for slot',
      pipelineStatus: 'approval',
      linkedPrNumber: null,
      linkedPrUrl: null,
      requireApprovalOverride: true,
    });

    const view = renderIntoDom(
      <KanbanBoard
        issues={[approvalIssue, approvedWaiter]}
        project={makeProject()}
        settings={{ ...SETTINGS, requireApproval: true }}
        approvedAwaitingExecutionIssueIds={new Set([approvedWaiter.id])}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const filterButton = Array.from(view.container.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Filters'),
    );
    if (!(filterButton instanceof HTMLButtonElement)) {
      throw new Error('Expected filters button');
    }

    act(() => {
      filterButton.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
      filterButton.click();
    });

    const button = Array.from(document.body.querySelectorAll('[role="menuitemcheckbox"]')).find(
      (element) => element.textContent?.includes('Needs approval'),
    );
    if (!(button instanceof HTMLElement)) {
      throw new Error('Expected approval filter button');
    }

    act(() => {
      button.click();
    });

    expect(view.container.textContent).toContain('Still waiting on me');
    expect(view.container.textContent).not.toContain('Approved and waiting for slot');
    view.cleanup();
  });

  it('deduplicates repeated issues before rendering cards', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[
          makeIssue({
            id: 'issue-duplicate',
            issueNumber: 201,
            title: 'Old queued copy',
            pipelineStatus: 'queued',
            linkedPrNumber: null,
            linkedPrUrl: null,
          }),
          makeIssue({
            id: 'issue-duplicate',
            issueNumber: 201,
            title: 'Latest queued copy',
            pipelineStatus: 'queued',
            linkedPrNumber: null,
            linkedPrUrl: null,
          }),
        ]}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(view.container.textContent).toContain('Latest queued copy');
    expect(view.container.textContent).not.toContain('Old queued copy');
    view.cleanup();
  });

  it('makes stacked section headers sticky and lets them collapse cards', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[
          makeIssue({
            id: 'issue-executing',
            issueNumber: 202,
            title: 'Executing issue',
            pipelineStatus: 'executing',
            linkedPrNumber: null,
            linkedPrUrl: null,
          }),
        ]}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const executingHeader = Array.from(view.container.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Executing'),
    );
    if (!(executingHeader instanceof HTMLButtonElement)) {
      throw new Error('Expected Executing section header');
    }

    const headerRow = executingHeader.parentElement;
    expect(headerRow?.className).toContain('sticky');
    expect(headerRow?.className).toContain('top-0');
    expect(headerRow?.className).toContain('bg-secondary');
    expect(headerRow?.className).toContain('z-20');
    expect(headerRow?.className).not.toContain('opacity');
    expect(executingHeader.className).toContain('text-left');
    expect(headerRow?.nextElementSibling?.className).toContain('p-1.5');
    expect(headerRow?.nextElementSibling?.className).not.toContain('pt-0');
    expect(executingHeader.getAttribute('aria-expanded')).toBe('true');
    expect(view.container.textContent).toContain('Executing issue');

    act(() => {
      executingHeader.click();
    });

    expect(executingHeader.getAttribute('aria-expanded')).toBe('false');
    expect(view.container.textContent).not.toContain('Executing issue');
    view.cleanup();
  });

  it('keeps stacked columns rendering if metadata maps are temporarily missing', () => {
    const agentColumn = COLUMNS.find((column) => column.key === 'agent');
    if (!agentColumn) {
      throw new Error('Expected agent column');
    }

    const view = renderIntoDom(
      <DndContext>
        <StackedColumn
          {...({
            column: agentColumn,
            issues: [
              makeIssue({
                id: 'issue-executing',
                issueNumber: 204,
                title: 'Executing issue',
                pipelineStatus: 'executing',
                linkedPrNumber: null,
                linkedPrUrl: null,
              }),
            ],
            onIssueClick: vi.fn(),
            issuePhaseChipById: undefined,
            issueRevisionBadgeById: undefined,
            issueApprovalBadgeById: undefined,
          } as unknown as ComponentProps<typeof StackedColumn>)}
        />
      </DndContext>,
    );

    expect(view.container.textContent).toContain('Executing issue');
    view.cleanup();
  });

  it('shares one second ticker across multiple elapsed cards', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const startedAt = 1_700_000_000_000;
    const lastPhaseUpdate = new Date(startedAt).toISOString();

    const view = renderIntoDom(
      <>
        <ActivePipelineCard
          projectName="shipcode"
          title="Planning issue"
          phase="planning"
          startedAt={startedAt}
          onClick={vi.fn()}
        />
        <DndContext>
          <DraggableCard
            issue={makeIssue({
              id: 'issue-executing',
              issueNumber: 206,
              title: 'Executing issue',
              pipelineStatus: 'executing',
              linkedPrNumber: null,
              linkedPrUrl: null,
              lastPhaseUpdate,
            })}
            onClick={vi.fn()}
            readOnly
          />
        </DndContext>
      </>,
    );

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    view.cleanup();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('does not run elapsed timers for approval waits', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const startedAt = 1_700_000_000_000;
    const lastPhaseUpdate = new Date(startedAt).toISOString();

    const view = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            id: 'issue-awaiting-approval',
            issueNumber: 207,
            title: 'Needs approval',
            pipelineStatus: 'approval',
            linkedPrNumber: null,
            linkedPrUrl: null,
            lastPhaseUpdate,
          })}
          onClick={vi.fn()}
          readOnly
        />
      </DndContext>,
    );

    expect(view.container.textContent).not.toContain('5s');
    expect(setIntervalSpy).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('left-aligns wrapped stacked section labels', () => {
    const humanColumn = COLUMNS.find((column) => column.key === 'human');
    if (!humanColumn) {
      throw new Error('Expected human column');
    }

    const view = renderIntoDom(
      <DndContext>
        <StackedColumn
          {...({
            column: humanColumn,
            issues: [
              makeIssue({
                id: 'issue-awaiting',
                issueNumber: 205,
                title: 'Awaiting approval issue',
                pipelineStatus: 'approval',
                linkedPrNumber: null,
                linkedPrUrl: null,
              }),
            ],
            onIssueClick: vi.fn(),
          } as unknown as ComponentProps<typeof StackedColumn>)}
        />
      </DndContext>,
    );

    const awaitingHeader = Array.from(view.container.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Approval'),
    );
    if (!(awaitingHeader instanceof HTMLButtonElement)) {
      throw new Error('Expected Approval section header');
    }

    expect(awaitingHeader.className).toContain('text-left');
    expect(awaitingHeader.firstElementChild?.className).toContain('flex-1');
    expect(awaitingHeader.firstElementChild?.className).toContain('text-left');
    expect(awaitingHeader.firstElementChild?.lastElementChild?.className).toContain('truncate');
    view.cleanup();
  });

  it('omits model badge from card (moved to hover card)', () => {
    const view = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            id: 'issue-active',
            issueNumber: 203,
            title: 'Active issue',
            pipelineStatus: 'executing',
            linkedPrNumber: null,
            linkedPrUrl: null,
          })}
          phaseChip={{
            phase: 'executor',
            provider: 'codex',
            model: 'gpt-5.4',
            effort: 'medium',
          }}
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />
      </DndContext>,
    );

    const modelBadge = Array.from(view.container.querySelectorAll('span')).find((element) =>
      element.textContent?.includes('GPT-5.4 · medium'),
    );
    expect(modelBadge).toBeUndefined();
    expect(view.container.querySelector('button[title="More actions"]')).toBeTruthy();
    view.cleanup();
  });

  it('moves branch copy into the compact action menu', () => {
    const onCopyBranchName = vi.fn();
    const lastPhaseUpdate = new Date(1_700_000_000_000).toISOString();
    const view = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            id: 'issue-with-branch',
            issueNumber: 207,
            title: 'Issue with branch actions',
            pipelineStatus: 'approval',
            linkedPrNumber: null,
            linkedPrUrl: null,
            lastPhaseUpdate,
          })}
          branchName="shipcode/issue-207"
          onClick={vi.fn()}
          onCopyBranchName={onCopyBranchName}
        />
      </DndContext>,
    );

    expect(view.container.querySelector('button[title="Open issue detail"]')).toBeNull();
    expect(view.container.querySelector('button[title^="Copy branch name"]')).toBeNull();
    expect(view.container.querySelector('button[title="More actions"]')).toBeTruthy();
    openMoreActions(view.container);
    act(() => menuItem('Copy branch').click());
    expect(onCopyBranchName).toHaveBeenCalledWith(expect.anything(), 'shipcode/issue-207');
    view.cleanup();
  });

  it('keeps todo cards compact with single-line titles and menu actions', () => {
    const view = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            id: 'issue-todo',
            issueNumber: 124,
            title: 'Evaluate Codex app-server as experimental provider transport',
            pipelineStatus: 'todo',
            linkedPrNumber: null,
            linkedPrUrl: null,
          })}
          onClick={vi.fn()}
          onStartPipeline={vi.fn()}
          branchName="ship/124-evaluate-codex"
          onCopyBranchName={vi.fn()}
        />
      </DndContext>,
    );

    const card = view.container.querySelector('[data-issue-card-id="issue-todo"]');
    expect(card?.className).toContain('flex-col');
    expect(view.container.querySelector('.line-clamp-2')).not.toBeNull();
    expect(view.container.textContent).not.toContain('todo');
    expect(view.container.querySelector('button[title="More actions"]')).not.toBeNull();
    view.cleanup();
  });

  it('hides more-actions button for automation cards with no available actions', () => {
    const view = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            id: 'auto-failed',
            issueNumber: -1_000_001,
            title: '[Auto] clean stale branches',
            pipelineStatus: 'failed',
          })}
          onClick={vi.fn()}
        />
      </DndContext>,
    );

    expect(view.container.querySelector('button[title="More actions"]')).toBeNull();
    view.cleanup();
  });

  it('keeps kanban columns wide enough for readable issue cards', () => {
    const todoColumn = COLUMNS.find((column) => column.key === 'todo');
    if (!todoColumn) throw new Error('Expected todo column');

    const view = renderIntoDom(
      <DndContext>
        <DroppableColumn
          id="todo"
          columnKey="todo"
          label="Todo"
          issues={[]}
          droppable
          onIssueClick={vi.fn()}
          issuePhaseChipById={new Map()}
          issueRevisionBadgeById={new Map()}
          issueApprovalBadgeById={new Map()}
          issuePriorityBadgeById={new Map()}
        />
        <StackedColumn
          {...({
            column: COLUMNS.find((column) => column.key === 'agent'),
            issues: [],
            onIssueClick: vi.fn(),
          } as unknown as ComponentProps<typeof StackedColumn>)}
        />
      </DndContext>,
    );

    const columns = Array.from(view.container.children);
    expect(columns[0]?.className).toContain('min-w-[240px]');
    expect(columns[1]?.className).toContain('min-w-[280px]');
    view.cleanup();
  });

  it('passes optional DroppableColumn metadata through card props', () => {
    const issue = makeIssue({
      id: 'metadata-issue',
      issueNumber: -1,
      isQuickMode: true,
      title: 'Metadata issue',
      pipelineStatus: 'todo',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });
    const view = renderIntoDom(
      <DndContext>
        <DroppableColumn
          id="todo"
          columnKey="todo"
          columnDotColor="#654321"
          label="Todo"
          issues={[issue]}
          droppable
          repoUrl="https://github.com/acme/repo"
          issueBranchNameById={new Map([[issue.id, 'shipcode/metadata']])}
          branchCopyIssueId={issue.id}
          branchCopyStatus="error"
          focusedIssueId={issue.id}
          startingPipelineId={issue.id}
          flashingIssueIds={new Set([issue.id])}
          onIssueClick={vi.fn()}
          issuePhaseChipById={new Map()}
          issueRevisionBadgeById={new Map()}
          issueApprovalBadgeById={new Map()}
          issuePriorityBadgeById={new Map()}
          issueStalenessById={new Map()}
          approvedAwaitingExecutionIssueIds={new Set()}
        />
      </DndContext>,
    );

    expect(view.container.querySelector('[style*="color: rgb(101, 67, 33)"]')).not.toBeNull();
    expect(view.container.textContent).toContain('Quick');
    expect(view.container.querySelector('[data-flashing="true"]')).not.toBeNull();
    expect(view.container.querySelector('[data-keyboard-focused="true"]')).not.toBeNull();
    view.cleanup();
  });

  it('keeps Deferred as the final kanban column after Done', () => {
    expect(COLUMNS.map((column) => column.key)).toEqual([
      'todo',
      'agent',
      'human',
      'done',
      'deferred',
    ]);
    expect(COLUMNS.at(-1)).toMatchObject({
      key: 'deferred',
      label: 'Deferred',
      statuses: ['deferred'],
    });
  });

  it('allows compact marketing columns to fit without horizontal scrolling', () => {
    const view = renderIntoDom(
      <DndContext>
        <DroppableColumn
          id="todo"
          columnKey="todo"
          label="Todo"
          issues={[]}
          droppable
          compact
          issueHoverCards={false}
          onIssueClick={vi.fn()}
          issuePhaseChipById={new Map()}
          issueRevisionBadgeById={new Map()}
          issueApprovalBadgeById={new Map()}
          issuePriorityBadgeById={new Map()}
        />
        <StackedColumn
          {...({
            column: COLUMNS.find((column) => column.key === 'human'),
            issues: [],
            compact: true,
            issueHoverCards: false,
            onIssueClick: vi.fn(),
          } as unknown as ComponentProps<typeof StackedColumn>)}
        />
      </DndContext>,
    );

    const columns = Array.from(view.container.children);
    expect(columns[0]?.className).toContain('min-w-0');
    expect(columns[0]?.className).not.toContain('min-w-[240px]');
    expect(columns[1]?.className).toContain('min-w-0');
    expect(columns[1]?.className).not.toContain('min-w-[280px]');
    view.cleanup();
  });

  it('renders stacked columns with custom dots, section metadata, and no-section columns', () => {
    const issue = makeIssue({
      id: 'stacked-metadata',
      issueNumber: 209,
      title: 'Stacked metadata issue',
      pipelineStatus: 'executing',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });
    const onClick = vi.fn();
    const agentColumn = COLUMNS.find((column) => column.key === 'agent');
    if (!agentColumn) throw new Error('Expected agent column');

    const view = renderIntoDom(
      <DndContext>
        <StackedColumn
          column={agentColumn}
          columnDotColor="#abcdef"
          issues={[issue]}
          repoUrl="https://github.com/acme/repo"
          issueBranchNameById={new Map([[issue.id, 'shipcode/stacked']])}
          branchCopyIssueId={issue.id}
          branchCopyStatus="copied"
          focusedIssueId={issue.id}
          rerunningId={issue.id}
          pausingId={issue.id}
          resumingId={issue.id}
          cancellingId={issue.id}
          markingDoneId={issue.id}
          flashingIssueIds={new Set([issue.id])}
          onIssueClick={onClick}
          onRerun={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onCancel={vi.fn()}
          onOpenPullRequest={vi.fn()}
          onCopyBranchName={vi.fn()}
          onMarkDone={vi.fn()}
          onArchiveIssue={vi.fn()}
          onCreatePr={vi.fn()}
          issuePhaseChipById={new Map()}
          issueRevisionBadgeById={new Map()}
          issueApprovalBadgeById={new Map()}
          issuePriorityBadgeById={new Map()}
          issueStalenessById={new Map()}
          approvedAwaitingExecutionIssueIds={new Set()}
        />
        <StackedColumn
          column={{ key: 'todo', label: 'No Sections', statuses: ['todo'] }}
          issues={[makeIssue({ id: 'ignored-no-section', pipelineStatus: 'todo' })]}
          onIssueClick={vi.fn()}
          issuePhaseChipById={new Map()}
          issueRevisionBadgeById={new Map()}
          issueApprovalBadgeById={new Map()}
          issuePriorityBadgeById={new Map()}
        />
      </DndContext>,
    );

    expect(view.container.querySelector('[style*="color: rgb(171, 205, 239)"]')).not.toBeNull();
    expect(view.container.textContent).toContain('Stacked metadata issue');
    expect(view.container.textContent).toContain('No Sections');
    expect(view.container.textContent).not.toContain('ignored-no-section');
    view.cleanup();
  });

  it('renders empty droppable stacked sections and suppresses them in read-only mode', () => {
    const agentColumn = COLUMNS.find((column) => column.key === 'agent');
    if (!agentColumn) throw new Error('Expected agent column');

    const editable = renderIntoDom(
      <DndContext>
        <StackedColumn
          {...({
            column: agentColumn,
            issues: [],
            onIssueClick: vi.fn(),
          } as unknown as ComponentProps<typeof StackedColumn>)}
        />
      </DndContext>,
    );

    expect(editable.container.textContent).toContain('Planning');
    expect(editable.container.querySelector('.border-dashed')).not.toBeNull();
    editable.cleanup();

    const readOnly = renderIntoDom(
      <DndContext>
        <StackedColumn
          {...({
            column: agentColumn,
            issues: [],
            readOnly: true,
            onIssueClick: vi.fn(),
          } as unknown as ComponentProps<typeof StackedColumn>)}
        />
      </DndContext>,
    );

    expect(readOnly.container.querySelector('.border-dashed')).toBeNull();
    readOnly.cleanup();
  });

  it('archives all closed issues from the closed stacked section header', () => {
    const doneColumn = COLUMNS.find((column) => column.key === 'done');
    if (!doneColumn) throw new Error('Expected done column');
    const onArchiveAllDone = vi.fn();

    const view = renderIntoDom(
      <DndContext>
        <StackedColumn
          {...({
            column: doneColumn,
            issues: [
              makeIssue({
                id: 'closed-archive-all',
                issueNumber: 132,
                title: 'Closed archive all',
                pipelineStatus: 'closed',
              }),
            ],
            onIssueClick: vi.fn(),
            onArchiveAllDone,
          } as unknown as ComponentProps<typeof StackedColumn>)}
        />
      </DndContext>,
    );

    const archiveAll = view.container.querySelector('button[title="Archive closed issues"]');
    if (!(archiveAll instanceof HTMLButtonElement)) throw new Error('Expected archive-all button');
    act(() => archiveAll.click());
    expect(onArchiveAllDone).toHaveBeenCalledTimes(1);
    view.cleanup();
  });

  it('renders droppable columns with default metadata maps and issue link fallbacks', () => {
    const issue = makeIssue({
      id: 'todo-default-maps',
      issueNumber: 133,
      title: 'Default metadata maps',
      linkedPrNumber: null,
      linkedPrUrl: null,
    });
    const view = renderIntoDom(
      <DndContext>
        <DroppableColumn
          {...({
            id: 'todo',
            columnKey: 'todo',
            label: 'Todo',
            issues: [issue],
            droppable: true,
            repoUrl: null,
            issuePhaseChipById: undefined,
            issueRevisionBadgeById: undefined,
            issueApprovalBadgeById: undefined,
            issuePriorityBadgeById: undefined,
            onIssueClick: vi.fn(),
          } as unknown as ComponentProps<typeof DroppableColumn>)}
        />
      </DndContext>,
    );

    expect(view.container.textContent).toContain('Default metadata maps');
    expect(view.container.textContent).toContain('#133');
    expect(view.container.querySelector('button[title="Open issue on GitHub"]')).toBeNull();
    view.cleanup();
  });
});

describe('priority badge rendering', () => {
  it('DraggableCard keeps P0 priority out of the compact card body', () => {
    const view = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            priorityRank: 'p0',
            priorityRaw: 'P0',
            priorityFetchedAt: '2026-04-27T00:00:00.000Z',
          })}
          onClick={vi.fn()}
          priorityBadge={{
            label: 'P0',
            title: 'Priority P0 — P0',
            variant: 'warning',
            rank: 'p0',
          }}
          readOnly
        />
      </DndContext>,
    );

    expect(view.container.textContent).not.toContain('P0');
    expect(view.container.querySelector('[title="Priority P0 — P0"]')).toBeNull();
    view.cleanup();
  });

  it('DraggableCard keeps unknown raw priority out of the compact card body', () => {
    const view = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            priorityRank: null,
            priorityRaw: 'Icebox',
            priorityFetchedAt: '2026-04-27T00:00:00.000Z',
          })}
          onClick={vi.fn()}
          priorityBadge={{
            label: 'Icebox',
            title: 'Priority — Icebox (uncategorized)',
            variant: 'accent',
            rank: null,
          }}
          readOnly
        />
      </DndContext>,
    );

    expect(view.container.textContent).not.toContain('Icebox');
    expect(view.container.querySelector('[title="Priority — Icebox (uncategorized)"]')).toBeNull();
    view.cleanup();
  });

  it('DraggableCard does not render a badge when no priority data', () => {
    const view = renderIntoDom(
      <DndContext>
        <DraggableCard issue={makeIssue()} onClick={vi.fn()} readOnly />
      </DndContext>,
    );

    const badges = Array.from(view.container.querySelectorAll('span'));
    const looksLikePriority = badges.find((el) =>
      ['P0', 'P1', 'P2', 'P3', 'Icebox'].includes(el.textContent ?? ''),
    );
    expect(looksLikePriority).toBeUndefined();
    view.cleanup();
  });
});
