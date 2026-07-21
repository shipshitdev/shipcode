// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dndState = vi.hoisted(() => ({
  isDragging: false,
}));

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    isDragging: dndState.isDragging,
  }),
  useDroppable: ({ disabled }: { disabled?: boolean }) => ({
    setNodeRef: () => {},
    isOver: !disabled,
  }),
}));

import { DroppableColumn, StackedColumn } from '@/kanban-board/BoardColumns';
import { COLUMNS } from '@/kanban-board/constants';
import { makeIssue, renderIntoDom } from './test-helpers';

const todoColumn = COLUMNS.find((column) => column.key === 'todo');
const doneColumn = COLUMNS.find((column) => column.key === 'done');

if (!todoColumn || !doneColumn) {
  throw new Error('Expected todo and done board columns');
}

const boardColumns = {
  todo: todoColumn,
  done: doneColumn,
};

function renderDroppableColumn(props: Partial<ComponentProps<typeof DroppableColumn>> = {}) {
  return renderIntoDom(
    <DroppableColumn
      id={props.id ?? 'todo'}
      columnKey={props.columnKey ?? 'todo'}
      label={props.label ?? 'Todo'}
      issues={props.issues ?? []}
      droppable={props.droppable ?? true}
      onIssueClick={props.onIssueClick ?? vi.fn()}
      issuePhaseChipById={props.issuePhaseChipById ?? new Map()}
      issueRevisionBadgeById={props.issueRevisionBadgeById ?? new Map()}
      issueApprovalBadgeById={props.issueApprovalBadgeById ?? new Map()}
      issuePriorityBadgeById={props.issuePriorityBadgeById ?? new Map()}
      issueHoverCards={false}
      {...props}
    />,
  );
}

function renderStackedColumn(props: Partial<ComponentProps<typeof StackedColumn>> = {}) {
  return renderIntoDom(
    <StackedColumn
      column={props.column ?? boardColumns.done}
      issues={props.issues ?? []}
      onIssueClick={props.onIssueClick ?? vi.fn()}
      issuePhaseChipById={props.issuePhaseChipById ?? new Map()}
      issueRevisionBadgeById={props.issueRevisionBadgeById ?? new Map()}
      issueApprovalBadgeById={props.issueApprovalBadgeById ?? new Map()}
      issuePriorityBadgeById={props.issuePriorityBadgeById ?? new Map()}
      issueHoverCards={false}
      {...props}
    />,
  );
}

function hasElementClass(container: HTMLElement, className: string) {
  return Array.from(container.querySelectorAll('*')).some((element) => {
    const elementClass = element.getAttribute('class') ?? '';
    return elementClass.includes(className);
  });
}

describe('BoardColumns drag state coverage', () => {
  beforeEach(() => {
    dndState.isDragging = false;
  });

  it('highlights a droppable board column when it is the active target', () => {
    const issue = makeIssue({
      id: 'todo-drag-target',
      issueNumber: 81,
      title: 'Todo drag target',
      pipelineStatus: 'todo',
    });

    const view = renderDroppableColumn({ issues: [issue] });

    expect(hasElementClass(view.container, 'ring-accent')).toBe(true);
    expect(view.container.textContent).toContain('Todo drag target');
    view.cleanup();
  });

  it('shares column header content across flat and stacked board layouts', () => {
    const todoIssue = makeIssue({
      id: 'todo-column-header',
      issueNumber: 84,
      title: 'Todo column header',
      pipelineStatus: 'todo',
    });
    const flat = renderDroppableColumn({
      issues: [todoIssue],
      columnDotColor: '#123456',
      onHideColumn: vi.fn(),
    });
    const flatHeader = flat.container.querySelector('[data-slot="kanban-column-header"]');
    expect(flatHeader?.textContent).toContain('Todo');
    expect(flatHeader?.textContent).toContain('1');
    expect(flatHeader?.querySelector('[style*="color: rgb(18, 52, 86)"]')).not.toBeNull();
    expect(flatHeader?.querySelector('button[aria-label="Hide column"]')).not.toBeNull();
    flat.cleanup();

    const closedIssue = makeIssue({
      id: 'done-column-header',
      issueNumber: 85,
      title: 'Done column header',
      state: 'closed',
      pipelineStatus: 'closed',
    });
    const stacked = renderStackedColumn({
      issues: [closedIssue],
      readOnly: true,
      onHideColumn: vi.fn(),
    });
    const stackedHeader = stacked.container.querySelector('[data-slot="kanban-column-header"]');
    expect(stackedHeader?.textContent).toContain('Done');
    expect(stackedHeader?.textContent).toContain('1');
    expect(stackedHeader?.querySelector('button[aria-label="Hide column"]')).toBeNull();
    stacked.cleanup();
  });

  it('highlights droppable section headers, lists, and empty placeholders', () => {
    const completedIssue = makeIssue({
      id: 'completed-drag-target',
      issueNumber: 82,
      title: 'Completed drag target',
      state: 'closed',
      pipelineStatus: 'closed',
    });

    const populated = renderStackedColumn({ issues: [completedIssue], compact: true });
    expect(populated.container.textContent).toContain('Completed drag target');
    expect(hasElementClass(populated.container, 'bg-tertiary/40')).toBe(true);
    expect(hasElementClass(populated.container, 'border-accent/50')).toBe(true);
    populated.cleanup();

    const empty = renderStackedColumn({ compact: true });
    expect(empty.container.textContent).toContain('Closed');
    expect(hasElementClass(empty.container, 'border-accent bg-tertiary')).toBe(true);
    empty.cleanup();
  });

  it('dims a dragged card and suppresses card activation while dragging', () => {
    dndState.isDragging = true;
    const onIssueClick = vi.fn();
    const issue = makeIssue({
      id: 'dragging-card',
      issueNumber: 83,
      title: 'Dragging card',
      pipelineStatus: 'todo',
    });

    const view = renderDroppableColumn({ issues: [issue], onIssueClick });
    const card = view.container.querySelector('[data-issue-card-id="dragging-card"]');
    if (!(card instanceof HTMLElement)) throw new Error('Expected dragged issue card');

    expect(card.className).toContain('opacity-50');
    card.click();
    expect(onIssueClick).not.toHaveBeenCalled();
    view.cleanup();
  });
});
