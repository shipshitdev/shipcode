// @vitest-environment jsdom

import type { AppSettings, IssuePipelineStatus } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function focusedCard(container: HTMLElement): HTMLElement {
  const card = container.querySelector('[data-keyboard-focused="true"]');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

function pressKey(key: string, target: Window | HTMLElement = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function pressKeyFromTarget(key: string, target: HTMLElement) {
  act(() => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true });
    Object.defineProperty(event, 'target', { configurable: true, value: target });
    window.dispatchEvent(event);
  });
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KanbanBoard keyboard navigation', () => {
  it('uses thread metadata when deriving issue phase chips', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[
          makeIssue({
            id: 'threaded',
            issueNumber: 11,
            title: 'Threaded issue',
            pipelineStatus: 'executing',
            threadId: 'thread-11',
          }),
        ]}
        threads={[
          {
            id: 'thread-11',
            projectId: 'project-1',
            status: 'executing',
            prompt: 'Do work',
            githubIssueNumber: 11,
            githubPrNumber: null,
            githubPrUrl: null,
            worktreePath: null,
            branch: null,
            autonomous: true,
            currentPhase: 'execute',
            executorModel: 'claude',
            executorModelIdOverride: null,
            executorReasoningEffort: 'high',
            createdAt: '2026-05-08T10:00:00.000Z',
            updatedAt: '2026-05-08T10:01:00.000Z',
          } as never,
        ]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(view.container.textContent).toContain('Threaded issue');
    view.cleanup();
  });

  it('focuses the first card and moves deterministically with j/k/h/l', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[
          makeIssue({ id: 'todo-bottom', issueNumber: 9, title: 'Todo bottom' }),
          makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' }),
          makeIssue({
            id: 'agent-queued',
            issueNumber: 8,
            title: 'Agent queued',
            pipelineStatus: 'queued',
            threadId: 'thread-8',
          }),
        ]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    // No card auto-focused on mount
    expect(view.container.querySelector('[data-keyboard-focused="true"]')).toBeNull();

    // First arrow key press focuses first card
    pressKey('j');
    expect(focusedCard(view.container).textContent).toContain('Todo top');

    pressKey('j');
    expect(focusedCard(view.container).textContent).toContain('Todo bottom');

    pressKey('j');
    expect(focusedCard(view.container).textContent).toContain('Todo bottom');

    pressKey('k');
    expect(focusedCard(view.container).textContent).toContain('Todo top');

    pressKey('l');
    expect(focusedCard(view.container).textContent).toContain('Agent queued');

    pressKey('h');
    expect(focusedCard(view.container).textContent).toContain('Todo top');
    expect(scrollIntoView).toHaveBeenCalled();

    view.cleanup();
  });

  it('skips empty columns and keeps focus at the board edge', () => {
    const todo = makeIssue({ id: 'todo', issueNumber: 10, title: 'Todo only' });
    const done = makeIssue({
      id: 'done',
      issueNumber: 1,
      title: 'Done issue',
      pipelineStatus: 'completed',
    });

    const view = renderIntoDom(
      <KanbanBoard
        issues={[todo, done]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    pressKey('j');
    expect(focusedCard(view.container).textContent).toContain('Todo only');

    pressKey('l');
    expect(focusedCard(view.container).textContent).toContain('Done issue');

    pressKey('l');
    expect(focusedCard(view.container).textContent).toContain('Done issue');

    pressKey('h');
    expect(focusedCard(view.container).textContent).toContain('Todo only');

    view.cleanup();
  });

  it('opens, comments, and starts the focused card with keyboard actions', () => {
    const issue = makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' });
    const onIssueClick = vi.fn();
    const onCommentIssue = vi.fn();
    const onStartPipeline = vi.fn();

    const view = renderIntoDom(
      <KanbanBoard
        issues={[issue]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={onIssueClick}
        onCommentIssue={onCommentIssue}
        onStartPipeline={onStartPipeline}
        onRefresh={vi.fn()}
      />,
    );

    // Activate keyboard focus first
    pressKey('j');

    pressKey('Enter');
    pressKey('c');
    pressKey('e');

    expect(onIssueClick).toHaveBeenCalledWith(issue);
    expect(onCommentIssue).toHaveBeenCalledWith(issue);
    expect(onStartPipeline).toHaveBeenCalledWith(issue);

    view.cleanup();
  });

  it('falls back to opening the issue for keyboard comments and ignores unrelated keys', () => {
    const issue = makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' });
    const onIssueClick = vi.fn();
    const onStartPipeline = vi.fn();

    const view = renderIntoDom(
      <KanbanBoard
        issues={[issue]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={onIssueClick}
        onStartPipeline={onStartPipeline}
        onRefresh={vi.fn()}
      />,
    );

    pressKey('j');
    pressKey('x');
    pressKey('c');

    expect(onStartPipeline).not.toHaveBeenCalled();
    expect(onIssueClick).toHaveBeenCalledWith(issue);

    view.cleanup();
  });

  it('reruns failed cards and resumes paused cards from keyboard execution', () => {
    const failed = makeIssue({
      id: 'failed',
      issueNumber: 20,
      title: 'Failed issue',
      pipelineStatus: 'failed',
    });
    const paused = makeIssue({
      id: 'paused',
      issueNumber: 19,
      title: 'Paused issue',
      pipelineStatus: 'paused',
    });
    const onRerun = vi.fn();
    const onResume = vi.fn();

    const view = renderIntoDom(
      <KanbanBoard
        issues={[failed, paused]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRerun={onRerun}
        onResume={onResume}
        onRefresh={vi.fn()}
      />,
    );

    pressKey('j');
    expect(focusedCard(view.container).textContent).toContain('Paused issue');
    pressKey('e');
    expect(onResume).toHaveBeenCalledWith(paused);

    pressKey('j');
    expect(focusedCard(view.container).textContent).toContain('Failed issue');
    pressKey('e');
    expect(onRerun).toHaveBeenCalledWith(failed);

    view.cleanup();
  });

  it('shows keyboard feedback while GitHub is still creating the issue', () => {
    const creating = makeIssue({
      id: 'creating',
      issueNumber: 30,
      title: 'Creating issue',
      syncState: 'creating',
    });
    const onIssueClick = vi.fn();
    const onCommentIssue = vi.fn();
    const onStartPipeline = vi.fn();

    const view = renderIntoDom(
      <KanbanBoard
        issues={[creating]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={onIssueClick}
        onCommentIssue={onCommentIssue}
        onStartPipeline={onStartPipeline}
        onRefresh={vi.fn()}
      />,
    );

    pressKey('j');
    pressKey('Enter');
    pressKey('c');
    pressKey('e');

    expect(onIssueClick).not.toHaveBeenCalled();
    expect(onCommentIssue).not.toHaveBeenCalled();
    expect(onStartPipeline).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('Issue is still being created on GitHub.');

    view.cleanup();
  });

  it('clears keyboard feedback after the toast timeout', () => {
    vi.useFakeTimers();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[
          makeIssue({
            id: 'agent-queued',
            issueNumber: 8,
            title: 'Agent queued',
            pipelineStatus: 'queued',
          }),
        ]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onStartPipeline={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    pressKey('j');
    pressKey('e');
    expect(view.container.textContent).toContain('Pipeline can only start from Todo cards.');

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(view.container.textContent).not.toContain('Pipeline can only start from Todo cards.');
    vi.useRealTimers();
    view.cleanup();
  });

  it('does not move board focus while typing in an input', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[
          makeIssue({ id: 'todo-bottom', issueNumber: 9, title: 'Todo bottom' }),
          makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' }),
        ]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    // Activate keyboard focus first
    pressKey('j');
    expect(focusedCard(view.container).textContent).toContain('Todo top');

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    pressKey('j', input);

    // Focus should not have moved while input focused
    expect(focusedCard(view.container).textContent).toContain('Todo top');

    input.remove();
    view.cleanup();
  });

  it('ignores keyboard shortcuts from editable textarea, select, and contenteditable targets', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[
          makeIssue({ id: 'todo-bottom', issueNumber: 9, title: 'Todo bottom' }),
          makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' }),
        ]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    pressKey('j');
    expect(focusedCard(view.container).textContent).toContain('Todo top');

    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const editableChild = document.createElement('span');
    editable.append(editableChild);
    document.body.append(textarea, select, editable);

    pressKeyFromTarget('j', textarea);
    pressKeyFromTarget('j', select);
    pressKeyFromTarget('j', editable);
    pressKeyFromTarget('j', editableChild);

    expect(focusedCard(view.container).textContent).toContain('Todo top');
    textarea.remove();
    select.remove();
    editable.remove();
    view.cleanup();
  });

  it('does not start a focused todo card when no start handler is provided', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' })]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    pressKey('j');
    pressKey('e');

    expect(focusedCard(view.container).textContent).toContain('Todo top');
    expect(view.container.textContent).toContain('Pipeline can only start from Todo cards.');
    view.cleanup();
  });

  it('clears pending action timers on unmount', () => {
    vi.useFakeTimers();
    const issue = makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' });
    const onStartPipeline = vi.fn();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[issue]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onStartPipeline={onStartPipeline}
        onRefresh={vi.fn()}
      />,
    );

    pressKey('j');
    pressKey('e');
    view.cleanup();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(onStartPipeline).toHaveBeenCalledWith(issue);
    vi.useRealTimers();
  });

  it('replaces an existing pending action timer when the same issue is started again', async () => {
    vi.useFakeTimers();
    const issue = makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' });
    const onStartPipeline = vi.fn();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[issue]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onStartPipeline={onStartPipeline}
        onRefresh={vi.fn()}
      />,
    );

    pressKey('j');
    pressKey('e');
    await act(async () => {
      await Promise.resolve();
    });
    pressKey('e');

    expect(onStartPipeline).toHaveBeenCalledTimes(2);
    act(() => {
      vi.runOnlyPendingTimers();
    });

    view.cleanup();
    vi.useRealTimers();
  });

  it('shows feedback instead of opening or executing creating issues from the keyboard', () => {
    const issue = makeIssue({
      id: 'creating',
      issueNumber: 0,
      title: 'Creating issue',
      syncState: 'creating',
    });
    const onIssueClick = vi.fn();
    const onStartPipeline = vi.fn();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[issue]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={onIssueClick}
        onStartPipeline={onStartPipeline}
        onRefresh={vi.fn()}
      />,
    );

    pressKey('j');
    pressKey('Enter');
    pressKey('c');
    pressKey('e');
    pressKey('x');

    expect(onIssueClick).not.toHaveBeenCalled();
    expect(onStartPipeline).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('Issue is still being created on GitHub.');
    view.cleanup();
  });

  it('keeps todo card action harmless when no start handler is provided', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' })]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const startButton = view.container.querySelector('button[title="Start planning"]');
    if (!(startButton instanceof HTMLButtonElement))
      throw new Error('Expected start planning button');
    act(() => {
      startButton.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
      startButton.click();
    });

    expect(view.container.textContent).toContain('Todo top');
    view.cleanup();
  });

  it('shows feedback instead of starting an ineligible focused card', () => {
    const onStartPipeline = vi.fn();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[
          makeIssue({
            id: 'agent-queued',
            issueNumber: 8,
            title: 'Agent queued',
            pipelineStatus: 'queued' as IssuePipelineStatus,
            threadId: 'thread-8',
          }),
        ]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onStartPipeline={onStartPipeline}
        onRefresh={vi.fn()}
      />,
    );

    // Activate keyboard focus, then try to start
    pressKey('j');
    pressKey('e');

    expect(onStartPipeline).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('Pipeline can only start from Todo cards.');

    view.cleanup();
  });

  it('keeps focus when the focused card remains visible and resets when it disappears', () => {
    const todoBottom = makeIssue({ id: 'todo-bottom', issueNumber: 9, title: 'Todo bottom' });
    const todoTop = makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' });
    const agentQueued = makeIssue({
      id: 'agent-queued',
      issueNumber: 8,
      title: 'Agent queued',
      pipelineStatus: 'queued',
      threadId: 'thread-8',
    });
    const commonProps = {
      project: makeProject(),
      settings: DEFAULT_SETTINGS as AppSettings,
      onIssueClick: vi.fn(),
      onRefresh: vi.fn(),
    };
    const view = renderIntoDom(
      <KanbanBoard issues={[todoBottom, todoTop, agentQueued]} {...commonProps} />,
    );

    // Activate keyboard focus first
    pressKey('j');
    expect(focusedCard(view.container).textContent).toContain('Todo top');
    pressKey('j');
    expect(focusedCard(view.container).textContent).toContain('Todo bottom');

    view.rerender(<KanbanBoard issues={[todoBottom, agentQueued]} {...commonProps} />);
    expect(focusedCard(view.container).textContent).toContain('Todo bottom');

    view.rerender(<KanbanBoard issues={[agentQueued]} {...commonProps} />);
    expect(focusedCard(view.container).textContent).toContain('Agent queued');

    view.cleanup();
  });

  it('does not move focus or trigger board actions when shortcuts are disabled', () => {
    const issue = makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' });
    const onIssueClick = vi.fn();
    const onCommentIssue = vi.fn();
    const onStartPipeline = vi.fn();
    const view = renderIntoDom(
      <KanbanBoard
        issues={[issue, makeIssue({ id: 'todo-bottom', issueNumber: 9, title: 'Todo bottom' })]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        keyboardShortcutsEnabled={false}
        onIssueClick={onIssueClick}
        onCommentIssue={onCommentIssue}
        onStartPipeline={onStartPipeline}
        onRefresh={vi.fn()}
      />,
    );

    // No card focused on mount
    expect(view.container.querySelector('[data-keyboard-focused="true"]')).toBeNull();

    pressKey('j');
    pressKey('Enter');
    pressKey('c');
    pressKey('e');

    // Still no focus — shortcuts disabled
    expect(view.container.querySelector('[data-keyboard-focused="true"]')).toBeNull();
    expect(onIssueClick).not.toHaveBeenCalled();
    expect(onCommentIssue).not.toHaveBeenCalled();
    expect(onStartPipeline).not.toHaveBeenCalled();

    view.cleanup();
  });

  it('ignores keyboard navigation when the board has no focusable issues', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    pressKey('j');
    pressKey('Enter');

    expect(view.container.querySelector('[data-keyboard-focused="true"]')).toBeNull();
    view.cleanup();
  });

  it('ignores modified key events once board focus is active', () => {
    const view = renderIntoDom(
      <KanbanBoard
        issues={[makeIssue({ id: 'todo-top', issueNumber: 10, title: 'Todo top' })]}
        project={makeProject()}
        settings={DEFAULT_SETTINGS as AppSettings}
        onIssueClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'j', bubbles: true, metaKey: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'j', bubbles: true, ctrlKey: true }),
      );
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, altKey: true }));
    });

    expect(focusedCard(view.container).textContent).toContain('Todo top');

    view.cleanup();
  });
});
