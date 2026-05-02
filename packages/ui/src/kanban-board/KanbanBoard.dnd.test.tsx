// @vitest-environment jsdom

import type { AppSettings } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const captured: { sensors: unknown } = { sensors: null };

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: ({ children, sensors }: { children: ReactNode; sensors?: unknown }) => {
      captured.sensors = sensors ?? null;
      return <div data-testid="dnd-context">{children}</div>;
    },
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
import { makeIssue, makeProject, renderIntoDom } from './test-helpers';

describe('KanbanBoard drag activation', () => {
  it('uses a pointer distance threshold so draggable cards remain clickable', () => {
    captured.sensors = null;

    const view = renderIntoDom(
      <KanbanBoard
        issues={[
          makeIssue({
            issueNumber: 19,
            title: 'Queued issue',
            pipelineStatus: 'queued',
            threadId: 'thread-1',
            fetchedAt: '2026-04-22T00:00:00.000Z',
          }),
        ]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const sensors = captured.sensors as Array<{ options?: { activationConstraint?: unknown } }>;

    expect(Array.isArray(sensors)).toBe(true);
    expect(sensors[0]?.options?.activationConstraint).toEqual({ distance: 8 });

    view.cleanup();
  });
});
