// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BoardToolbar } from './BoardToolbar';
import { renderIntoDom } from './test-helpers';

function renderToolbar(props: Partial<ComponentProps<typeof BoardToolbar>> = {}) {
  return renderIntoDom(
    <BoardToolbar
      refreshingBranches={false}
      sortOrder="priority"
      onSortOrderChange={vi.fn()}
      view="kanban"
      onViewChange={vi.fn()}
      approvalFilter="all"
      onApprovalFilterChange={vi.fn()}
      stalenessFilter="all"
      onStalenessFilterChange={vi.fn()}
      refreshing={false}
      onRefresh={vi.fn()}
      {...props}
    />,
  );
}

function clickButton(container: ParentNode, title: string) {
  const button = container.querySelector(`button[title="${title}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected button: ${title}`);
  }
  act(() => button.click());
  return button;
}

function openMenu(container: ParentNode, title: string) {
  const button = container.querySelector(`button[title="${title}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected menu trigger: ${title}`);
  }
  act(() => {
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    button.click();
  });
}

function menuItem(label: string) {
  const item = Array.from(
    document.body.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]'),
  ).find((element) => element.textContent?.includes(label));
  if (!(item instanceof HTMLElement)) {
    throw new Error(`Expected menu item: ${label}`);
  }
  return item;
}

function openSortSelect(container: ParentNode) {
  HTMLElement.prototype.hasPointerCapture ??= vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture ??= vi.fn();
  HTMLElement.prototype.releasePointerCapture ??= vi.fn();
  HTMLElement.prototype.scrollIntoView ??= vi.fn();
  const trigger = Array.from(container.querySelectorAll('[role="combobox"]')).find((element) =>
    element.textContent?.includes('Priority'),
  );
  if (!(trigger instanceof HTMLElement)) {
    throw new Error('Expected sort select trigger');
  }
  act(() => {
    trigger.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: false,
        pointerId: 1,
        pointerType: 'mouse',
      }),
    );
  });
}

function selectOption(label: string) {
  const item = Array.from(document.body.querySelectorAll('[role="option"]')).find((element) =>
    element.textContent?.includes(label),
  );
  if (!(item instanceof HTMLElement)) {
    throw new Error(`Expected select option: ${label}`);
  }
  act(() => {
    item.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    item.click();
  });
}

describe('BoardToolbar', () => {
  it('renders optional links, branch refresh, view, triage, and refresh controls', () => {
    const onRepoClick = vi.fn((event) => event.preventDefault());
    const onProjectsClick = vi.fn((event) => event.preventDefault());
    const onRefreshBranches = vi.fn();
    const onViewChange = vi.fn();
    const onTriageIssues = vi.fn();
    const onRefresh = vi.fn();
    const view = renderToolbar({
      projectName: 'ShipCode',
      repoUrl: 'https://github.com/acme/repo',
      projectsUrl: 'https://github.com/orgs/acme/projects/1',
      onRepoClick,
      onProjectsClick,
      baseBranch: 'main',
      branches: ['main', 'origin/main'],
      onBaseBranchChange: vi.fn(),
      onRefreshBranches,
      graphEnabled: true,
      view: 'list',
      onViewChange,
      onTriageIssues,
      triageCandidateCount: 2,
      onRefresh,
    });

    expect(view.container.textContent).toContain('ShipCode');

    const repo = view.container.querySelector('a[href="https://github.com/acme/repo"]');
    const board = view.container.querySelector('a[href="https://github.com/orgs/acme/projects/1"]');
    if (!(repo instanceof HTMLAnchorElement) || !(board instanceof HTMLAnchorElement)) {
      throw new Error('Expected repository and project links');
    }
    act(() => {
      repo.click();
      board.click();
    });
    expect(onRepoClick).toHaveBeenCalledTimes(1);
    expect(onProjectsClick).toHaveBeenCalledTimes(1);

    clickButton(view.container, 'Refresh branches');
    expect(onRefreshBranches).toHaveBeenCalledTimes(1);

    clickButton(view.container, 'List view');
    clickButton(view.container, 'Graph view');
    clickButton(view.container, 'Board view');
    expect(onViewChange).toHaveBeenNthCalledWith(1, 'list');
    expect(onViewChange).toHaveBeenNthCalledWith(2, 'graph');
    expect(onViewChange).toHaveBeenNthCalledWith(3, 'kanban');

    clickButton(view.container, 'Review and align 2 Backlog issues');
    expect(onTriageIssues).toHaveBeenCalledTimes(1);

    clickButton(view.container, 'Refresh board');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    view.cleanup();
  });

  it('changes filters and auto-run priority selections from menus', () => {
    const onApprovalFilterChange = vi.fn();
    const onStalenessFilterChange = vi.fn();
    const onAutoRun = vi.fn();
    const onAutoRunPrioritiesChange = vi.fn();
    const view = renderToolbar({
      approvalFilter: 'all',
      stalenessFilter: 'all',
      onApprovalFilterChange,
      onStalenessFilterChange,
      autoRunCount: 2,
      autoRunPriorities: ['p0'],
      onAutoRun,
      onAutoRunPrioritiesChange,
    });

    clickButton(view.container, 'Start 2 issues through the pipeline');
    expect(onAutoRun).toHaveBeenCalledTimes(1);

    openMenu(view.container, 'Filter issues');
    act(() => menuItem('Needs approval').click());
    expect(onApprovalFilterChange).toHaveBeenCalledWith('needs-approval');
    openMenu(view.container, 'Filter issues');
    act(() => menuItem('Stale').click());
    expect(onStalenessFilterChange).toHaveBeenCalledWith('stale');

    openMenu(view.container, 'Filter auto-run by priority');
    act(() => menuItem('Select all').click());
    expect(onAutoRunPrioritiesChange).toHaveBeenCalledWith(['p0', 'p1', 'p2', 'p3']);
    view.cleanup();
  });

  it('renders active filters, disabled loading states, and auto-run controls', () => {
    const onAutoRun = vi.fn();
    const onAutoRunPrioritiesChange = vi.fn();
    const onApprovalFilterChange = vi.fn();
    const onStalenessFilterChange = vi.fn();
    const view = renderToolbar({
      refreshingBranches: true,
      baseBranch: 'main',
      branches: ['main'],
      onBaseBranchChange: vi.fn(),
      onRefreshBranches: vi.fn(),
      approvalFilter: 'needs-approval',
      onApprovalFilterChange,
      stalenessFilter: 'stale',
      onStalenessFilterChange,
      refreshing: true,
      triagingIssues: true,
      triageCandidateCount: 0,
      onTriageIssues: vi.fn(),
      autoRunCount: 0,
      autoRunPriorities: ['p0', 'p1', 'p2', 'p3'],
      onAutoRun,
      onAutoRunPrioritiesChange,
      autoRunning: true,
    });

    expect(view.container.textContent).toContain('GitHub Issues');
    expect(view.container.textContent).toContain('Filters2');
    expect(view.container.querySelectorAll('.animate-spin').length).toBeGreaterThan(0);
    expect(view.container.querySelector('.animate-pulse')).not.toBeNull();

    const run = view.container.querySelector('button[title="No eligible backlog issues"]');
    if (!(run instanceof HTMLButtonElement)) throw new Error('Expected disabled run button');
    expect(run.disabled).toBe(true);
    act(() => run.click());
    expect(onAutoRun).not.toHaveBeenCalled();

    const triage = view.container.querySelector(
      'button[title="No unclaimed Backlog issues to review"]',
    );
    if (!(triage instanceof HTMLButtonElement)) throw new Error('Expected disabled triage button');
    expect(triage.disabled).toBe(true);

    openMenu(view.container, 'Filter issues');
    act(() => menuItem('Needs approval').click());
    expect(onApprovalFilterChange).toHaveBeenCalledWith('all');
    openMenu(view.container, 'Filter issues');
    act(() => menuItem('Stale').click());
    expect(onStalenessFilterChange).toHaveBeenCalledWith('all');
    view.cleanup();
  });

  it('changes the board sort order from the selector', () => {
    const onSortOrderChange = vi.fn();
    const view = renderToolbar({ onSortOrderChange });

    openSortSelect(view.container);
    selectOption('Newest ID');

    expect(onSortOrderChange).toHaveBeenCalledWith('id-desc');
    view.cleanup();
  });

  it('uses singular triage copy for one candidate', () => {
    const onTriageIssues = vi.fn();
    const view = renderToolbar({
      onTriageIssues,
      triageCandidateCount: 1,
    });

    clickButton(view.container, 'Review and align 1 Backlog issue');
    expect(onTriageIssues).toHaveBeenCalledTimes(1);
    view.cleanup();
  });

  it('hides optional controls when their handlers or data are absent', () => {
    const view = renderToolbar({
      baseBranch: undefined,
      branches: [],
      onBaseBranchChange: undefined,
      onAutoRun: undefined,
      onTriageIssues: undefined,
      repoUrl: null,
      projectsUrl: null,
    });

    expect(view.container.textContent).toContain('GitHub Issues');
    expect(view.container.textContent).not.toContain('Run (');
    expect(view.container.querySelector('a')).toBeNull();
    expect(
      view.container.querySelector('button[aria-label="Review and align board issues"]'),
    ).toBeNull();
    view.cleanup();
  });
});
