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
        issues={[makeIssue({ issueNumber: 80, title: 'Copy branch name action' })]}
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
