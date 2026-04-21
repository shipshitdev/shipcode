// @vitest-environment jsdom

import { DndContext } from '@dnd-kit/core';
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  type GitHubIssueCacheRecord,
  type Project,
} from '@shipcode/shared';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { KanbanBoard } from '../KanbanBoard';
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
          issueApprovalBadgeById={new Map()}
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

  it('renders an approval badge in list rows with a source tooltip', () => {
    const issue = makeIssue({ pipelineStatus: 'awaiting_approval' });

    const view = renderIntoDom(
      <DndContext>
        <IssueListView
          issues={[issue]}
          activeId={null}
          issueRevisionLabelById={new Map()}
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
});
