// @vitest-environment jsdom

import type { AppSettings } from '@shipcode/shared';
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
import { makeIssue, makeProject, renderIntoDom } from './test-helpers';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function openMoreActions(container: HTMLElement) {
  const trigger = container.querySelector('button[title="More actions"]');
  expect(trigger).not.toBeNull();
  act(() => {
    trigger?.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
    );
    trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function copyBranchItem() {
  const item = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((element) =>
    element.textContent?.includes('Copy branch'),
  );
  expect(item).not.toBeNull();
  return item as HTMLElement;
}

function menuItem(label: string) {
  const item = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((element) =>
    element.textContent?.includes(label),
  );
  expect(item).not.toBeNull();
  return item as HTMLElement;
}

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
        issues={[makeIssue({ issueNumber: 80, title: 'Copy branch name action' })]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={onIssueClick}
        onRefresh={vi.fn()}
      />,
    );

    openMoreActions(view.container);

    await act(async () => {
      copyBranchItem().dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

    openMoreActions(view.container);

    await act(async () => {
      copyBranchItem().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeText).toHaveBeenCalledWith('feat/7-add-foo-bar');

    view.cleanup();
  });

  it('shows and clears clipboard failure feedback', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const view = renderIntoDom(
      <KanbanBoard
        issues={[makeIssue({ issueNumber: 81, title: 'Copy branch failure' })]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    openMoreActions(view.container);

    await act(async () => {
      copyBranchItem().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(view.container.textContent).toContain('Clipboard write failed');

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(view.container.textContent).not.toContain('Clipboard write failed');
    vi.useRealTimers();
    view.cleanup();
  });

  it('forwards pause, cancel, and resume actions from board card menus', () => {
    const activeIssue = makeIssue({
      id: 'active',
      issueNumber: 82,
      title: 'Active issue',
      pipelineStatus: 'executing',
    });
    const pausedIssue = makeIssue({
      id: 'paused',
      issueNumber: 83,
      title: 'Paused issue',
      pipelineStatus: 'paused',
    });
    const onPause = vi.fn();
    const onCancel = vi.fn();
    const onResume = vi.fn();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[activeIssue, pausedIssue]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
        onPause={onPause}
        onCancel={onCancel}
        onResume={onResume}
      />,
    );

    openMoreActions(view.container);
    act(() => menuItem('Pause').click());
    openMoreActions(view.container);
    act(() => menuItem('Cancel').click());

    const pausedCard = view.container.querySelector('[data-issue-card-id="paused"]');
    if (!(pausedCard instanceof HTMLElement)) throw new Error('Expected paused issue card');
    const pausedMenu = pausedCard.querySelector('button[title="More actions"]');
    if (!(pausedMenu instanceof HTMLElement)) throw new Error('Expected paused issue menu');
    act(() => {
      pausedMenu.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      pausedMenu.click();
    });
    act(() => menuItem('Resume').click());

    expect(onPause).toHaveBeenCalledWith(activeIssue);
    expect(onCancel).toHaveBeenCalledWith(activeIssue);
    expect(onResume).toHaveBeenCalledWith(pausedIssue);
    view.cleanup();
  });
});
