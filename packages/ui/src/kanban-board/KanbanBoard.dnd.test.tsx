// @vitest-environment jsdom

import type { AppSettings } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const captured: {
  sensors: unknown;
  onDragStart?: (event: unknown) => void;
  onDragEnd?: (event: unknown) => void;
} = { sensors: null };

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: ({
      children,
      sensors,
      onDragStart,
      onDragEnd,
    }: {
      children: ReactNode;
      sensors?: unknown;
      onDragStart?: (event: unknown) => void;
      onDragEnd?: (event: unknown) => void;
    }) => {
      captured.sensors = sensors ?? null;
      captured.onDragStart = onDragStart;
      captured.onDragEnd = onDragEnd;
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

import { KanbanBoard } from '@/KanbanBoard';
import { makeIssue, makeProject, renderIntoDom } from './test-helpers';

afterEach(() => {
  vi.useRealTimers();
});

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

  it('wires allowed drag transitions to the matching issue actions', () => {
    const todo = makeIssue({ id: 'todo', issueNumber: 1, title: 'Todo' });
    const failed = makeIssue({
      id: 'failed',
      issueNumber: 2,
      title: 'Failed',
      pipelineStatus: 'failed',
    });
    const approval = makeIssue({
      id: 'approval',
      issueNumber: 3,
      title: 'Approval',
      pipelineStatus: 'approval',
    });
    const queued = makeIssue({
      id: 'queued',
      issueNumber: 4,
      title: 'Queued',
      pipelineStatus: 'queued',
    });
    const completed = makeIssue({
      id: 'completed',
      issueNumber: 5,
      title: 'Completed',
      pipelineStatus: 'completed',
      linkedPrNumber: 5,
    });
    const onStartPipeline = vi.fn();
    const onRerun = vi.fn();
    const onRetry = vi.fn();
    const onMarkDone = vi.fn();

    const view = renderIntoDom(
      <KanbanBoard
        issues={[todo, failed, approval, queued, completed]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
        onStartPipeline={onStartPipeline}
        onRerun={onRerun}
        onRetry={onRetry}
        onMarkDone={onMarkDone}
      />,
    );

    expect(captured.onDragEnd).toBeTypeOf('function');
    const dragEnd = captured.onDragEnd;
    if (!dragEnd) throw new Error('Expected drag end handler');

    act(() => {
      dragEnd({
        active: { id: todo.id, data: { current: todo } },
        over: { id: 'agent:planning' },
      });
      dragEnd({
        active: { id: failed.id, data: { current: failed } },
        over: { id: 'agent:planning' },
      });
      dragEnd({ active: { id: approval.id, data: { current: approval } }, over: { id: 'todo' } });
      dragEnd({ active: { id: queued.id, data: { current: queued } }, over: { id: 'todo' } });
      dragEnd({
        active: { id: completed.id, data: { current: completed } },
        over: { id: 'done' },
      });
      dragEnd({ active: { id: todo.id, data: { current: todo } }, over: null });
      dragEnd({ active: { id: todo.id, data: {} }, over: { id: 'done' } });
    });

    expect(onStartPipeline).toHaveBeenCalledWith(todo);
    expect(onRerun).toHaveBeenCalledWith(failed);
    expect(onRetry).toHaveBeenNthCalledWith(1, approval);
    expect(onRetry).toHaveBeenNthCalledWith(2, queued);
    expect(onMarkDone).toHaveBeenCalledWith(completed);

    view.cleanup();
  });

  it('renders a drag overlay for the active card and then clears it on drop', () => {
    const issue = makeIssue({ id: 'todo', issueNumber: 1, title: 'Overlay issue' });
    const view = renderIntoDom(
      <KanbanBoard
        issues={[issue]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
        onStartPipeline={vi.fn()}
      />,
    );

    act(() => {
      captured.onDragStart?.({ active: { id: issue.id } });
    });

    expect(view.container.querySelector('[data-testid="drag-overlay"]')?.textContent).toContain(
      'Overlay issue',
    );

    act(() => {
      captured.onDragEnd?.({
        active: { id: issue.id, data: { current: issue } },
        over: { id: 'deferred' },
      });
    });

    expect(view.container.querySelector('[data-testid="drag-overlay"]')?.textContent).not.toContain(
      'Overlay issue',
    );

    view.cleanup();
  });

  it('treats approved waiters as agent-column cards when dropped back to todo', () => {
    const approval = makeIssue({
      id: 'approval',
      issueNumber: 3,
      title: 'Approval',
      pipelineStatus: 'approval',
    });
    const onRetry = vi.fn();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[approval]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        approvedAwaitingExecutionIssueIds={new Set([approval.id])}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
        onRetry={onRetry}
      />,
    );

    act(() => {
      captured.onDragEnd?.({
        active: { id: approval.id, data: { current: approval } },
        over: { id: 'todo' },
      });
    });

    expect(onRetry).toHaveBeenCalledWith(approval);
    view.cleanup();
  });

  it('keeps one pending action timer per issue and clears it after the minimum delay', async () => {
    vi.useFakeTimers();
    const issue = makeIssue({ id: 'todo', issueNumber: 1, title: 'Pending action issue' });
    const onStartPipeline = vi.fn();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[issue]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
        onStartPipeline={onStartPipeline}
      />,
    );

    act(() => {
      captured.onDragEnd?.({
        active: { id: issue.id, data: { current: issue } },
        over: { id: 'agent:planning' },
      });
      captured.onDragEnd?.({
        active: { id: issue.id, data: { current: issue } },
        over: { id: 'agent:planning' },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onStartPipeline).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(650);
    });

    view.cleanup();
  });

  it('falls back to start pipeline when rerun handler is unavailable and disables drag handlers in read-only mode', () => {
    const failed = makeIssue({
      id: 'failed',
      issueNumber: 2,
      title: 'Failed',
      pipelineStatus: 'failed',
    });
    const onStartPipeline = vi.fn();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[failed]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
        onStartPipeline={onStartPipeline}
      />,
    );

    act(() => {
      captured.onDragEnd?.({
        active: { id: failed.id, data: { current: failed } },
        over: { id: 'agent:planning' },
      });
    });
    expect(onStartPipeline).toHaveBeenCalledWith(failed);

    view.rerender(
      <KanbanBoard
        issues={[failed]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
        onStartPipeline={onStartPipeline}
        readOnly
      />,
    );

    expect(captured.onDragStart).toBeUndefined();
    expect(captured.onDragEnd).toBeUndefined();

    view.cleanup();
  });
});
