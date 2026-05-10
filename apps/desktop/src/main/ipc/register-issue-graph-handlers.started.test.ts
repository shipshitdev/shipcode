import { ISSUE_PIPELINE_STATUS, PIPELINE_PHASE } from '@shipcode/shared';
import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const { startOrQueueMock } = vi.hoisted(() => ({
  startOrQueueMock: vi.fn(async () => undefined),
}));

vi.mock('@shipcode/pipeline', () => ({
  buildIssueGroupExecutionPreview: vi.fn(({ selectedIssueIds }) => ({
    issueOrder: selectedIssueIds,
    groups: [selectedIssueIds],
  })),
  createIssueGroupRunState: vi.fn(() => ({
    getReadyIssueIds: () => ['issue-1', 'issue-2'],
    markIssueCompleted: () => ['issue-2'],
  })),
}));

vi.mock('../pipeline-scheduler', () => ({
  PipelineScheduler: vi.fn().mockImplementation(function MockPipelineScheduler() {
    return {
      startOrQueue: startOrQueueMock,
    };
  } as never),
}));

const { notifyIssueGraphPipelinePhaseChange, registerIssueGraphHandlers } = await import(
  './register-issue-graph-handlers'
);

function makeDeps() {
  const issues = [
    {
      id: 'issue-1',
      projectId: 'project-1',
      issueNumber: 1,
      pipelineStatus: ISSUE_PIPELINE_STATUS.completed,
      threadId: 'thread-1',
    },
    {
      id: 'issue-2',
      projectId: 'project-1',
      issueNumber: 2,
      pipelineStatus: ISSUE_PIPELINE_STATUS.todo,
      threadId: 'thread-2',
    },
  ];

  return {
    ipcMain: {
      handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
        handlers.set(channel, listener);
      }),
    } as unknown as IpcMain,
    mainWindow: {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(),
      },
    },
    queries: {
      issueEdges: {
        loadProjectGraph: vi.fn(() => ({
          projectId: 'project-1',
          nodes: issues.map((issue) => ({
            issueId: issue.id,
            projectId: issue.projectId,
            issueNumber: issue.issueNumber,
            title: issue.id,
            state: 'open',
            pipelineStatus: issue.pipelineStatus,
            threadId: issue.threadId,
          })),
          edges: [],
        })),
      },
      githubIssues: {
        list: vi.fn(() => issues),
        getByThreadId: vi.fn(
          (threadId: string) => issues.find((issue) => issue.threadId === threadId) ?? null,
        ),
      },
    },
    pipeline: {},
    emitter: {},
  };
}

describe('registerIssueGraphHandlers duplicate ready issue guard', () => {
  beforeEach(() => {
    handlers.clear();
    startOrQueueMock.mockClear();
  });

  it('does not start an issue twice when the run state reports it ready again', async () => {
    const deps = makeDeps();
    registerIssueGraphHandlers(deps as never);

    const confirm = handlers.get('issue-graph:confirm-run');
    if (!confirm) throw new Error('issue-graph:confirm-run handler missing');

    await confirm(undefined, { projectId: 'project-1', selectedIssueIds: ['issue-1', 'issue-2'] });
    expect(startOrQueueMock).toHaveBeenCalledWith('project-1', 2);

    startOrQueueMock.mockClear();
    notifyIssueGraphPipelinePhaseChange({
      threadId: 'thread-1',
      phase: PIPELINE_PHASE.completed,
    });

    expect(startOrQueueMock).not.toHaveBeenCalled();
  });
});
