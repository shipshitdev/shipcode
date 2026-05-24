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
