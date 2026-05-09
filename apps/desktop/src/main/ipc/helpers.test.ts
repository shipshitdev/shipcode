import type { PipelineEmitter } from '@shipcode/pipeline';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachIssueToConfiguredProjectBoard,
  sendGithubIssuesUpdated,
  transitionThreadPhase,
} from './helpers';
import type { Queries } from './types';

describe('transitionThreadPhase', () => {
  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    },
  } as const;

  const threadQueries = {
    updateStatus: vi.fn(),
    getById: vi.fn(),
    recordFailure: vi.fn(),
  };
  const githubIssueQueries = {
    getByThreadId: vi.fn(),
    getByNumber: vi.fn(),
    updatePipelineStatus: vi.fn(),
    list: vi.fn(),
  };
  const queries = {
    threads: {
      updateStatus: threadQueries.updateStatus,
      getById: threadQueries.getById,
      recordFailure: threadQueries.recordFailure,
    },
    githubIssues: {
      getByThreadId: githubIssueQueries.getByThreadId,
      getByNumber: githubIssueQueries.getByNumber,
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
    threadQueries.getById.mockReturnValue({
      id: 'thread-1',
      projectId: 'project-1',
      githubIssueNumber: 42,
      status: 'planning',
    });
    githubIssueQueries.getByThreadId.mockReturnValue({
      id: 'issue-1',
      projectId: 'project-1',
    });
    githubIssueQueries.getByNumber.mockReturnValue({
      id: 'issue-1',
      projectId: 'project-1',
    });
    githubIssueQueries.list.mockReturnValue([{ id: 'issue-1' }]);

    transitionThreadPhase(mainWindow as never, queries, emitter, {
      threadId: 'thread-1',
      phase: 'approval',
    });

    expect(threadQueries.updateStatus).toHaveBeenCalledWith('thread-1', 'approval');
    expect(githubIssueQueries.updatePipelineStatus).toHaveBeenCalledWith('issue-1', 'approval');
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [{ id: 'issue-1' }],
    });
    expect(emitter.emit).toHaveBeenCalledWith({
      type: 'pipeline:phase',
      threadId: 'thread-1',
      phase: 'approval',
    });
  });

  it('records the error message for failed transitions even without a linked issue', () => {
    threadQueries.getById
      .mockReturnValueOnce({
        id: 'thread-2',
        projectId: 'project-1',
        githubIssueNumber: null,
        status: 'executing',
      })
      .mockReturnValueOnce({
        id: 'thread-2',
        projectId: 'project-1',
        githubIssueNumber: null,
        status: 'executing',
      });
    githubIssueQueries.getByThreadId.mockReturnValue(null);

    transitionThreadPhase(mainWindow as never, queries, emitter, {
      threadId: 'thread-2',
      phase: 'failed',
      errorMessage: 'boom',
    });

    expect(threadQueries.recordFailure).toHaveBeenCalledWith('thread-2', 'executing', 'boom');
    expect(threadQueries.updateStatus).not.toHaveBeenCalled();
    expect(githubIssueQueries.updatePipelineStatus).not.toHaveBeenCalled();
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith({
      type: 'pipeline:phase',
      threadId: 'thread-2',
      phase: 'failed',
    });
  });
});

describe('sendGithubIssuesUpdated', () => {
  const githubIssueQueries = {
    list: vi.fn(() => [{ id: 'issue-1' }]),
  };
  const queries = {
    githubIssues: githubIssueQueries,
  } as unknown as Queries;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends the latest project issue list when the window is live', () => {
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
      },
    };

    sendGithubIssuesUpdated(mainWindow as never, queries, 'project-1');

    expect(githubIssueQueries.list).toHaveBeenCalledWith('project-1');
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [{ id: 'issue-1' }],
    });
  });

  it('skips DB work for destroyed windows and swallows renderer-disposal sends', () => {
    const destroyedWindow = {
      isDestroyed: vi.fn(() => true),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
      },
    };

    sendGithubIssuesUpdated(destroyedWindow as never, queries, 'project-1');

    expect(githubIssueQueries.list).not.toHaveBeenCalled();
    expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();

    const disposedWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(() => {
          throw new Error('Render frame disposed');
        }),
      },
    };

    expect(() =>
      sendGithubIssuesUpdated(disposedWindow as never, queries, 'project-1'),
    ).not.toThrow();
    expect(githubIssueQueries.list).toHaveBeenCalledWith('project-1');
  });
});

describe('attachIssueToConfiguredProjectBoard', () => {
  const project = {
    githubProjectUrl: 'https://github.com/users/decod3rs/projects/7',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null without calling GitHub when project URL or issue URL is missing', async () => {
    const ghCli = {
      addIssueToProject: vi.fn(),
    };

    await expect(
      attachIssueToConfiguredProjectBoard(
        { githubProjectUrl: null } as never,
        ghCli as never,
        42,
        'https://github.com/shipshitdev/shipcode/issues/42',
        'test',
      ),
    ).resolves.toBeNull();
    await expect(
      attachIssueToConfiguredProjectBoard(project as never, ghCli as never, 42, null, 'test'),
    ).resolves.toBeNull();

    expect(ghCli.addIssueToProject).not.toHaveBeenCalled();
  });

  it('attaches issues to the configured GitHub project and clamps attach failures', async () => {
    const ghCli = {
      addIssueToProject: vi.fn().mockResolvedValueOnce(undefined),
    };

    await expect(
      attachIssueToConfiguredProjectBoard(
        project as never,
        ghCli as never,
        42,
        'https://github.com/shipshitdev/shipcode/issues/42',
        'test',
      ),
    ).resolves.toBeNull();
    expect(ghCli.addIssueToProject).toHaveBeenCalledWith({
      owner: 'decod3rs',
      projectNumber: 7,
      issueUrl: 'https://github.com/shipshitdev/shipcode/issues/42',
    });

    ghCli.addIssueToProject.mockRejectedValueOnce(new Error('attach failed\nmore detail'));

    await expect(
      attachIssueToConfiguredProjectBoard(
        project as never,
        ghCli as never,
        42,
        'https://github.com/shipshitdev/shipcode/issues/42',
        'test',
      ),
    ).resolves.toBe('attach failed');
  });
});
