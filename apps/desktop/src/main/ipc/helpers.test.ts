import type { PipelineEmitter } from '@shipcode/pipeline';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transitionThreadPhase } from './helpers';
import type { Queries } from './types';

describe('transitionThreadPhase', () => {
  const mainWindow = {
    webContents: {
      send: vi.fn(),
    },
  } as const;

  const threadQueries = {
    updateStatus: vi.fn(),
  };
  const githubIssueQueries = {
    getByThreadId: vi.fn(),
    updatePipelineStatus: vi.fn(),
    list: vi.fn(),
  };
  const queries = {
    threads: {
      updateStatus: threadQueries.updateStatus,
    },
    githubIssues: {
      getByThreadId: githubIssueQueries.getByThreadId,
      updatePipelineStatus: githubIssueQueries.updatePipelineStatus,
      list: githubIssueQueries.list,
    },
  } as unknown as Queries;

  const emitter = {
    emit: vi.fn(),
  } as unknown as PipelineEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates thread and linked issue state before emitting the canonical phase event', () => {
    githubIssueQueries.getByThreadId.mockReturnValue({
      id: 'issue-1',
      projectId: 'project-1',
    });
    githubIssueQueries.list.mockReturnValue([{ id: 'issue-1' }]);

    transitionThreadPhase(mainWindow as never, queries, emitter, {
      threadId: 'thread-1',
      phase: 'awaiting_approval',
    });

    expect(threadQueries.updateStatus).toHaveBeenCalledWith(
      'thread-1',
      'awaiting_approval',
      undefined,
    );
    expect(githubIssueQueries.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-1',
      'awaiting_approval',
    );
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [{ id: 'issue-1' }],
    });
    expect(emitter.emit).toHaveBeenCalledWith({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'awaiting_approval',
    });
  });

  it('records the error message for failed transitions even without a linked issue', () => {
    githubIssueQueries.getByThreadId.mockReturnValue(null);

    transitionThreadPhase(mainWindow as never, queries, emitter, {
      threadId: 'thread-2',
      phase: 'failed',
      errorMessage: 'boom',
    });

    expect(threadQueries.updateStatus).toHaveBeenCalledWith('thread-2', 'failed', 'boom');
    expect(githubIssueQueries.updatePipelineStatus).not.toHaveBeenCalled();
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith({
      type: 'pipeline:phase',
      threadId: 'thread-2',
      phase: 'failed',
    });
  });
});
