// @vitest-environment jsdom

import type { AppSettings, GitHubIssueCacheRecord, Project } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    issueNumber: 80,
    title: 'Copy branch name action',
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
    isQuickMode: false,
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KanbanBoard branch-copy affordance', () => {
  it('copies the formatted issue branch name from a card without opening the issue', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onIssueClick = vi.fn();

    const view = renderIntoDom(
      <KanbanBoard
        issues={[makeIssue()]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={onIssueClick}
        onRefresh={vi.fn()}
      />,
    );

    const copyButton = view.container.querySelector(
      'button[aria-label="Copy branch name for issue #80"]',
    ) as HTMLButtonElement | null;
    expect(copyButton?.getAttribute('title')).toBe(
      'Copy branch name (ship/80-copy-branch-name-action)',
    );

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeText).toHaveBeenCalledWith('ship/80-copy-branch-name-action');
    expect(onIssueClick).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('Copied');
    expect(view.container.textContent).toContain('ship/80-copy-branch-name-action');

    view.cleanup();
  });

  it('honors custom branch naming format from settings', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const view = renderIntoDom(
      <KanbanBoard
        issues={[makeIssue({ issueNumber: 7, title: 'Add foo bar' })]}
        project={makeProject()}
        settings={{ ...DEFAULT_SETTINGS, worktreeBranchFormat: 'feat/{id}-{slug}' }}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const copyButton = view.container.querySelector(
      'button[aria-label="Copy branch name for issue #7"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeText).toHaveBeenCalledWith('feat/7-add-foo-bar');

    view.cleanup();
  });
});
