// @vitest-environment jsdom

import type { AppSettings, GitHubIssueCacheRecord } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { act, type ReactNode } from 'react';
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

import { KanbanBoard } from '@/KanbanBoard';
import { makeIssue as makeBaseIssue, makeProject, renderIntoDom } from './test-helpers';

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return makeBaseIssue({
    issueNumber: 1,
    title: 'Stale queued issue',
    pipelineStatus: 'queued',
    lastPhaseUpdate: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    fetchedAt: '2000-01-01T00:00:00.000Z',
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KanbanBoard staleness flags', () => {
  it('renders a stale red dot with a reason title on stale cards', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[makeIssue()]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const dot = view.container.querySelector('[data-staleness-dot="true"]');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute('title')).toContain('Queued');
    expect(dot?.getAttribute('title')).toContain('no updates');
    view.cleanup();
  });

  it('filters the board to stale cards only', () => {
    const staleIssue = makeIssue({ id: 'stale', issueNumber: 1, title: 'Stale queued issue' });
    const freshIssue = makeIssue({
      id: 'fresh',
      issueNumber: 2,
      title: 'Fresh queued issue',
      lastPhaseUpdate: '2999-01-01T00:00:00.000Z',
      updatedAt: '2999-01-01T00:00:00.000Z',
      fetchedAt: '2999-01-01T00:00:00.000Z',
    });

    const view = renderIntoDom(
      <KanbanBoard
        issues={[staleIssue, freshIssue]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(view.container.textContent).toContain('Stale queued issue');
    expect(view.container.textContent).toContain('Fresh queued issue');

    const filtersButton = view.container.querySelector('button[title="Filter issues"]');
    if (!(filtersButton instanceof HTMLButtonElement)) {
      throw new Error('Expected filters button');
    }

    act(() => {
      filtersButton.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
      filtersButton.click();
    });

    const staleButton = Array.from(
      document.body.querySelectorAll('[role="menuitemcheckbox"]'),
    ).find((element) => element.textContent?.includes('Stale'));
    if (!(staleButton instanceof HTMLElement)) {
      throw new Error('Expected stale filter menu item');
    }

    act(() => {
      staleButton.click();
    });

    expect(view.container.textContent).toContain('Stale queued issue');
    expect(view.container.textContent).not.toContain('Fresh queued issue');
    view.cleanup();
  });
});
