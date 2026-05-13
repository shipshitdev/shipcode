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

function clickControl(container: HTMLElement, selector: string) {
  const control = container.querySelector(selector);
  expect(control).not.toBeNull();
  act(() => {
    control?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function openMenuControl(container: HTMLElement, selector: string) {
  const control = container.querySelector(selector);
  if (!(control instanceof HTMLElement)) {
    throw new Error(`Expected menu control: ${selector}`);
  }

  act(() => {
    control.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    control.click();
  });
}

function menuItem(label: string) {
  const item = Array.from(document.body.querySelectorAll('[role^="menuitem"]')).find((element) =>
    element.textContent?.includes(label),
  );
  if (!(item instanceof HTMLElement)) {
    throw new Error(`Expected menu item: ${label}`);
  }
  return item;
}

describe('KanbanBoard toolbar', () => {
  it('renders project links and intercepts external navigation through the board handler', () => {
    const onOpenExternal = vi.fn();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[makeIssue({ title: 'Toolbar issue' })]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
        projectName="ShipCode board"
        repoUrl="https://github.com/shipshitdev/shipcode"
        projectsUrl="https://github.com/orgs/shipshitdev/projects/1"
        onOpenExternal={onOpenExternal}
      />,
    );

    expect(view.container.textContent).toContain('ShipCode board');
    expect(view.container.textContent).toContain('repo');
    expect(view.container.textContent).toContain('board');

    clickControl(view.container, 'a[title="Open repository on github.com"]');
    clickControl(view.container, 'a[title="Open Projects board on github.com"]');

    expect(onOpenExternal).toHaveBeenNthCalledWith(1, 'https://github.com/shipshitdev/shipcode');
    expect(onOpenExternal).toHaveBeenNthCalledWith(
      2,
      'https://github.com/orgs/shipshitdev/projects/1',
    );

    view.cleanup();
  });

  it('leaves project links as normal anchors when no external opener is provided', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[makeIssue({ title: 'Plain link issue' })]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
        repoUrl="https://github.com/shipshitdev/shipcode"
      />,
    );

    const link = view.container.querySelector('a[title="Open repository on github.com"]');
    if (!(link instanceof HTMLAnchorElement)) throw new Error('Expected repository link');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    view.cleanup();
  });

  it('wires refresh, branch refresh, triage, and auto-run controls', () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const onRefreshBranches = vi.fn();
    const onTriageIssues = vi.fn();
    const onAutoRun = vi.fn();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[makeIssue({ title: 'Runnable issue', priorityRank: 'p1' })]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={onRefresh}
        baseBranch="main"
        branches={['main', 'develop', 'origin/main']}
        onBaseBranchChange={vi.fn()}
        onRefreshBranches={onRefreshBranches}
        refreshingBranches={false}
        onTriageIssues={onTriageIssues}
        triageCandidateCount={2}
        autoRunCount={1}
        onAutoRun={onAutoRun}
      />,
    );

    expect(view.container.textContent).toContain('main');
    expect(view.container.textContent).toContain('Run (1)');

    clickControl(view.container, 'button[title="Refresh branches"]');
    clickControl(view.container, 'button[aria-label="Review and align board issues"]');
    clickControl(view.container, 'button[title="Start 1 issue through the pipeline"]');
    clickControl(view.container, 'button[title="Refresh board"]');

    expect(onRefreshBranches).toHaveBeenCalledTimes(1);
    expect(onTriageIssues).toHaveBeenCalledTimes(1);
    expect(onAutoRun).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain('Board refreshed');
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(view.container.textContent).not.toContain('Board refreshed');
    vi.useRealTimers();

    view.cleanup();
  });

  it('filters auto-run candidates by priority from the toolbar menu', () => {
    const onAutoRunPrioritiesChange = vi.fn();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[makeIssue({ title: 'Runnable issue', priorityRank: 'p1' })]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
        autoRunCount={1}
        onAutoRun={vi.fn()}
        autoRunPriorities={['p1']}
        onAutoRunPrioritiesChange={onAutoRunPrioritiesChange}
      />,
    );

    openMenuControl(view.container, 'button[title="Filter auto-run by priority"]');

    act(() => {
      menuItem('Select all').click();
      menuItem('P0').click();
      menuItem('P1').click();
    });

    expect(onAutoRunPrioritiesChange).toHaveBeenNthCalledWith(1, ['p0', 'p1', 'p2', 'p3']);
    expect(onAutoRunPrioritiesChange).toHaveBeenNthCalledWith(2, ['p1', 'p0']);
    expect(onAutoRunPrioritiesChange).toHaveBeenNthCalledWith(3, []);

    view.cleanup();
  });

  it('clears all auto-run priority filters when every priority is selected', () => {
    const onAutoRunPrioritiesChange = vi.fn();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[makeIssue({ title: 'Runnable issue', priorityRank: 'p1' })]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
        autoRunCount={1}
        onAutoRun={vi.fn()}
        autoRunPriorities={['p0', 'p1', 'p2', 'p3']}
        onAutoRunPrioritiesChange={onAutoRunPrioritiesChange}
      />,
    );

    openMenuControl(view.container, 'button[title="Filter auto-run by priority"]');

    act(() => {
      menuItem('Clear filter').click();
    });

    expect(onAutoRunPrioritiesChange).toHaveBeenCalledWith([]);

    view.cleanup();
  });

  it('switches between kanban, list, and graph views from the toolbar', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[makeIssue({ issueNumber: 42, title: 'View switch issue' })]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
        graphContent={<div>Graph body</div>}
      />,
    );

    expect(view.container.querySelector('[data-testid="dnd-context"]')).not.toBeNull();
    expect(view.container.textContent).not.toContain('Graph body');
    expect(
      Array.from(view.container.querySelectorAll('button[title$=" view"]')).map((button) =>
        button.getAttribute('title'),
      ),
    ).toEqual(['Board view', 'List view', 'Graph view']);

    clickControl(view.container, 'button[title="List view"]');
    expect(view.container.querySelector('[data-testid="dnd-context"]')).not.toBeNull();
    expect(view.container.textContent).toContain('View switch issue');

    clickControl(view.container, 'button[title="Graph view"]');
    expect(view.container.textContent).toContain('Graph body');
    expect(view.container.querySelector('[data-testid="dnd-context"]')).toBeNull();

    clickControl(view.container, 'button[title="Board view"]');
    expect(view.container.querySelector('[data-testid="dnd-context"]')).not.toBeNull();
    expect(view.container.textContent).not.toContain('Graph body');

    view.cleanup();
  });

  it('uses compact horizontal constraints in compact presentation mode', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[makeIssue({ issueNumber: 43, title: 'Compact issue' })]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        presentationMode="compact"
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const boardScroll = view.container.querySelector('.kanban-board-scroll');
    expect(boardScroll?.className).toContain('overflow-x-hidden');
    expect(boardScroll?.className).not.toContain('overflow-x-auto');

    view.cleanup();
  });
});
