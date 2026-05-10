// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: ReactNode }) => (
    <div data-testid="dnd-context">{children}</div>
  ),
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    isDragging: true,
  }),
  useDroppable: ({ disabled }: { disabled?: boolean }) => ({
    setNodeRef: () => {},
    isOver: !disabled,
  }),
}));

import { DndContext } from '@dnd-kit/core';
import { IssueListView } from '@/kanban-board/IssueListView';
import { makeIssue, renderIntoDom } from './test-helpers';

function renderList(props: Partial<ComponentProps<typeof IssueListView>> = {}) {
  return renderIntoDom(
    <DndContext>
      <IssueListView
        issues={props.issues ?? []}
        activeId={props.activeId ?? null}
        issueRevisionBadgeById={props.issueRevisionBadgeById ?? new Map()}
        issueApprovalBadgeById={props.issueApprovalBadgeById ?? new Map()}
        issuePriorityBadgeById={props.issuePriorityBadgeById ?? new Map()}
        onIssueClick={props.onIssueClick ?? vi.fn()}
        {...props}
      />
    </DndContext>,
  );
}

describe('IssueListView drag state coverage', () => {
  it('renders dragging rows and active droppable list groups', () => {
    const issue = makeIssue({
      id: 'dragging-todo',
      issueNumber: 71,
      title: 'Dragging todo',
      pipelineStatus: 'todo',
    });

    const view = renderList({ issues: [issue] });

    const row = Array.from(view.container.querySelectorAll('[role="button"]')).find((element) =>
      element.textContent?.includes('Dragging todo'),
    );
    if (!(row instanceof HTMLElement)) throw new Error('Expected dragging list row');

    expect(row.className).toContain('opacity-40');
    expect(view.container.querySelector('.bg-accent\\/5')).not.toBeNull();
    view.cleanup();
  });
});
