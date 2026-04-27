// @vitest-environment jsdom

import { DndContext } from '@dnd-kit/core';
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  type GitHubIssueCacheRecord,
  type Project,
} from '@shipcode/shared';
import { act, type ComponentProps, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivePipelineCard } from '../ActivePipelineCard';
import { KanbanBoard } from '../KanbanBoard';
import { DroppableColumn, StackedColumn } from './BoardColumns';
import { COLUMNS } from './constants';
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
    requireApprovalOverride: null,
    linkedPrNumber: 91,
    linkedPrUrl: 'https://github.com/acme/repo/pull/91',
    linkedPrIsDraft: true,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: new Date('2026-04-14T00:00:00.000Z').toISOString(),
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    ...overrides,
  };
}

const SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  requireApproval: false,
};

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
    gitRemote: 'git@github.com:shipshitdev/shipcode.git',
    githubRepoId: null,
    githubRepoFullName: null,
    starterIssueNumber: null,
    starterIssueCreatedAt: null,
    githubProjectUrl: null,
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
    requireApprovalOverride: null,
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: '2026-04-14T00:00:00.000Z',
    updatedAt: '2026-04-14T00:00:00.000Z',
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

function expectBadgeGeometry(element: HTMLElement) {
  expect(element.className).toContain('rounded-md');
  expect(element.className).toContain('border');
  expect(element.className).toContain('px-1.5');
  expect(element.className).toContain('py-0.5');
  expect(element.className).toContain('text-[10px]');
  expect(element.className).toContain('font-medium');
  expect(element.className).toContain('uppercase');
  expect(element.className).toContain('tracking-wide');
}

afterEach(() => {
  vi.restoreAllMocks();
});

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
          issueRevisionBadgeById={new Map()}
          issueApprovalBadgeById={new Map()}
          issuePriorityBadgeById={new Map()}
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

  it('opens issue detail from the card surface and dedicated action', () => {
    const onClick = vi.fn();

    const view = renderIntoDom(
      <DndContext>
        <DraggableCard issue={makeIssue()} onClick={onClick} readOnly />
      </DndContext>,
    );

    const title = Array.from(view.container.querySelectorAll('div')).find((element) =>
      element.textContent?.includes('Add demo pipeline task'),
    );
    if (!(title instanceof HTMLDivElement)) {
      throw new Error('Expected issue title block');
    }

    act(() => {
      title.click();
    });

    expect(onClick).toHaveBeenCalledTimes(1);

    const button = view.container.querySelector('button[title="Open issue detail"]');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected issue detail button');
    }

    act(() => {
      button.click();
    });

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
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected list-row detail button');
    }

    act(() => {
      button.click();
    });

    expect(onIssueClick).toHaveBeenCalledTimes(2);
    view.cleanup();
  });

  it('styles hover actions with the same badge geometry as status chips', () => {
    const todoView = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({ pipelineStatus: 'todo' })}
          onClick={vi.fn()}
          onStartPipeline={vi.fn()}
        />
      </DndContext>,
    );

    const planButton = todoView.container.querySelector('button[title="Start planning"]');
    if (!(planButton instanceof HTMLButtonElement)) {
      throw new Error('Expected plan action button');
    }

    expectBadgeGeometry(planButton);
    expect(planButton.className).toContain('border-agent/25');
    todoView.cleanup();

    const failedView = renderIntoDom(
      <DndContext>
        <DraggableCard
          issue={makeIssue({
            pipelineStatus: 'failed',
            linkedPrNumber: null,
            linkedPrUrl: null,
          })}
          onClick={vi.fn()}
          onRerun={vi.fn()}
        />
      </DndContext>,
    );

    const retryButton = failedView.container.querySelector('button[title="Retry pipeline"]');
    if (!(retryButton instanceof HTMLButtonElement)) {
      throw new Error('Expected retry action button');
    }

    expectBadgeGeometry(retryButton);
    expect(retryButton.className).toContain('border-danger/30');
    failedView.cleanup();
  });

  it('renders an approval badge on cards with a source tooltip', () => {
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

    const badge = Array.from(view.container.querySelectorAll('[title]')).find(
      (element) => element.getAttribute('title') === 'Approval required via project override',
    );
    expect(badge?.textContent).toContain('Approval');
    view.cleanup();
  });

  it('renders approved slot waiters in the agent loop instead of approval-needed UI', () => {
    const issue = makeIssue({
      id: 'issue-slot-waiter',
      issueNumber: 95,
      title: 'Approved and waiting for execution',
      pipelineStatus: 'awaiting_approval',
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

    expect(view.container.textContent).toContain('Waiting For Execution');
    expect(view.container.textContent).toContain('Approved');
    expect(view.container.textContent).toContain('Waiting for slot');
    view.cleanup();
  });

  it('renders an approval badge in list rows with a source tooltip', () => {
    const issue = makeIssue({ pipelineStatus: 'awaiting_approval' });

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

    const button = Array.from(view.container.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Needs approval'),
    );
    if (!(button instanceof HTMLButtonElement)) {
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
      pipelineStatus: 'awaiting_approval',
      linkedPrNumber: null,
      linkedPrUrl: null,
      requireApprovalOverride: true,
    });
    const approvedWaiter = makeIssue({
      id: 'issue-slot-waiter',
      issueNumber: 112,
      title: 'Approved and waiting for slot',
      pipelineStatus: 'awaiting_approval',
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

    const button = Array.from(view.container.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Needs approval'),
    );
    if (!(button instanceof HTMLButtonElement)) {
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

    expect(executingHeader.className).toContain('sticky');
    expect(executingHeader.className).toContain('top-0');
    expect(executingHeader.className).toContain('bg-agent');
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
    const startedAt = Date.now() - 5_000;

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
              lastPhaseUpdate: new Date(startedAt).toISOString(),
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
                pipelineStatus: 'awaiting_approval',
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
      element.textContent?.includes('Needs Approval'),
    );
    if (!(awaitingHeader instanceof HTMLButtonElement)) {
      throw new Error('Expected Needs Approval section header');
    }

    expect(awaitingHeader.className).toContain('text-left');
    expect(awaitingHeader.firstElementChild?.className).toContain('flex-1');
    expect(awaitingHeader.firstElementChild?.className).toContain('text-left');
    expect(awaitingHeader.firstElementChild?.lastElementChild?.className).toContain('truncate');
    view.cleanup();
  });

  it('keeps the active model badge on one line even with the issue-detail action present', () => {
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
    if (!(modelBadge instanceof HTMLSpanElement)) {
      throw new Error('Expected active model badge');
    }

    expect(modelBadge.className).toContain('whitespace-nowrap');
    expect(modelBadge.getAttribute('title')).toBe('executor model: GPT-5.4 · medium');
    expect(view.container.querySelector('button[title="Open issue detail"]')).toBeTruthy();
    expect(view.container.querySelector('.pr-7')).toBeTruthy();
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
});

describe('priority badge rendering', () => {
  it('DraggableCard renders P0 badge with warning variant', () => {
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

    const badges = Array.from(view.container.querySelectorAll('span'));
    const p0Badge = badges.find((el) => el.textContent === 'P0');
    expect(p0Badge).toBeTruthy();
    expect(p0Badge?.getAttribute('title')).toContain('P0');
    view.cleanup();
  });

  it('DraggableCard renders unknown raw priority with accent variant', () => {
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

    const badges = Array.from(view.container.querySelectorAll('span'));
    const icebox = badges.find((el) => el.textContent === 'Icebox');
    expect(icebox).toBeTruthy();
    expect(icebox?.getAttribute('title')).toContain('uncategorized');
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
