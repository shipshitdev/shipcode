// @vitest-environment jsdom

import type {
  AppSettings,
  GitHubIssueCacheRecord,
  IssuePipelineStatus,
  Project,
} from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: ({ children }: { children: ReactNode }) => (
      <div data-testid="dnd-context">{children}</div>
    ),
    DragOverlay: ({ children }: { children?: ReactNode }) => (
      <div data-testid="drag-overlay">{children}</div>
    ),
    useDraggable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      isDragging: false,
    }),
    useDroppable: () => ({
      setNodeRef: () => {},
      isOver: false,
    }),
  };
});

import { KanbanBoard } from '../KanbanBoard';

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 10,
    title: 'Todo top',
    body: null,
    labels: [],
    assignee: null,
    state: 'open',
    pipelineStatus: 'todo',
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
    linkedPrNumber: null,
    linkedPrUrl: null,
    linkedPrIsDraft: false,
    ciBlocked: false,
    failingChecks: [],
    unresolvedReviewComments: [],
    unresolvedReviewCommentCount: 0,
    prLastSyncAt: null,
    fetchedAt: '2026-04-28T00:00:00.000Z',
    priorityRank: null,
    priorityRaw: null,
    priorityFetchedAt: null,
    ...overrides,
  };
}

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
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z',
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

function focusedCard(container: HTMLElement): HTMLElement {
  const card = container.querySelector('[data-keyboard-focused="true"]');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

function pressKey(key: string, target: Window | HTMLElement = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KanbanBoard keyboard navigation', () => {
  it('focuses the first card and moves deterministically with j/k/h/l', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[
          makeIssue({ id: 'todo-bottom', issueNumber: 9, title: 'Todo bottom' }),
          makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' }),
          makeIssue({
            id: 'agent-queued',
            issueNumber: 8,
            title: 'Agent queued',
            pipelineStatus: 'queued',
            threadId: 'thread-8',
          }),
        ]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(focusedCard(view.container).textContent).toContain('Todo top');

    pressKey('j');
    expect(focusedCard(view.container).textContent).toContain('Todo bottom');

    pressKey('k');
    expect(focusedCard(view.container).textContent).toContain('Todo top');

    pressKey('l');
    expect(focusedCard(view.container).textContent).toContain('Agent queued');

    pressKey('h');
    expect(focusedCard(view.container).textContent).toContain('Todo top');
    expect(scrollIntoView).toHaveBeenCalled();

    view.cleanup();
  });

  it('opens, comments, and starts the focused card with keyboard actions', () => {
    const issue = makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' });
    const onIssueClick = vi.fn();
    const onCommentIssue = vi.fn();
    const onStartPipeline = vi.fn();

    const view = renderIntoDom(
      <KanbanBoard
        issues={[issue]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={onIssueClick}
        onCommentIssue={onCommentIssue}
        onStartPipeline={onStartPipeline}
        onRefresh={vi.fn()}
      />,
    );

    pressKey('Enter');
    pressKey('c');
    pressKey('e');

    expect(onIssueClick).toHaveBeenCalledWith(issue);
    expect(onCommentIssue).toHaveBeenCalledWith(issue);
    expect(onStartPipeline).toHaveBeenCalledWith(issue);

    view.cleanup();
  });

  it('does not move board focus while typing in an input', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[
          makeIssue({ id: 'todo-bottom', issueNumber: 9, title: 'Todo bottom' }),
          makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' }),
        ]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    pressKey('j', input);

    expect(focusedCard(view.container).textContent).toContain('Todo top');

    input.remove();
    view.cleanup();
  });

  it('shows feedback instead of starting an ineligible focused card', () => {
    const onStartPipeline = vi.fn();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[
          makeIssue({
            id: 'agent-queued',
            issueNumber: 8,
            title: 'Agent queued',
            pipelineStatus: 'queued' as IssuePipelineStatus,
            threadId: 'thread-8',
          }),
        ]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onStartPipeline={onStartPipeline}
        onRefresh={vi.fn()}
      />,
    );

    pressKey('e');

    expect(onStartPipeline).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('Pipeline can only start from Todo cards.');

    view.cleanup();
  });
});
