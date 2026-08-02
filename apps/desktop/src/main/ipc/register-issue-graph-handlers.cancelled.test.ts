import type { ProjectIssueGraph } from '@shipcode/shared';
import { ISSUE_PIPELINE_STATUS, PIPELINE_PHASE } from '@shipcode/shared';
import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const { startOrQueueMock } = vi.hoisted(() => ({
  startOrQueueMock: vi.fn(async () => undefined),
}));

vi.mock('../logger.service', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../pipeline-scheduler', () => ({
  PipelineScheduler: vi.fn().mockImplementation(function MockPipelineScheduler() {
    return {
      startOrQueue: startOrQueueMock,
    };
  } as never),
}));

// Own module instance: the grouped-run registry is module state, so a fresh import
// keeps the leftover runs of other suites out of the assertions below.
const { notifyIssueGraphPipelinePhaseChange, registerIssueGraphHandlers } = await import(
  './register-issue-graph-handlers'
);

/** issue-1 blocks issue-2, so issue-2 only starts once issue-1 succeeds. */
function makeGraph(): ProjectIssueGraph {
  return {
    projectId: 'project-1',
    nodes: [
      {
        issueId: 'issue-1',
        projectId: 'project-1',
        issueNumber: 1,
        title: 'One',
        state: 'open',
        pipelineStatus: ISSUE_PIPELINE_STATUS.executing,
        threadId: 'thread-1',
      },
      {
        issueId: 'issue-2',
        projectId: 'project-1',
        issueNumber: 2,
        title: 'Two',
        state: 'open',
        pipelineStatus: ISSUE_PIPELINE_STATUS.todo,
        threadId: 'thread-2',
      },
    ],
    edges: [
      {
        id: 'edge-1',
        projectId: 'project-1',
        sourceIssueId: 'issue-1',
        targetIssueId: 'issue-2',
        sourceIssueNumber: 1,
        targetIssueNumber: 2,
        edgeType: 'blocks',
        origin: 'manual',
        createdAt: '2026-05-08T10:00:00.000Z',
        updatedAt: '2026-05-08T10:00:00.000Z',
      },
    ],
  };
}

function makeDeps() {
  // Neither issue reaches a terminal pipeline status: the cancelled one is still
  // recorded as executing, so only the run state can retire the run.
  const issues = [
    {
      id: 'issue-1',
      projectId: 'project-1',
      issueNumber: 1,
      pipelineStatus: ISSUE_PIPELINE_STATUS.executing,
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
        loadProjectGraph: vi.fn(() => makeGraph()),
        createManualEdge: vi.fn(),
        deleteEdge: vi.fn(),
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

describe('notifyIssueGraphPipelinePhaseChange reconciliation cancel', () => {
  beforeEach(() => {
    handlers.clear();
    startOrQueueMock.mockClear();
  });

  it('retires the grouped run and leaves dependents unstarted when an issue is cancelled', async () => {
    const deps = makeDeps();
    registerIssueGraphHandlers(deps as never);

    const confirm = handlers.get('issue-graph:confirm-run');
    if (!confirm) throw new Error('issue-graph:confirm-run handler missing');

    await confirm(undefined, { projectId: 'project-1', selectedIssueIds: ['issue-1', 'issue-2'] });
    expect(startOrQueueMock).toHaveBeenCalledWith('project-1', 1);
    expect(startOrQueueMock).not.toHaveBeenCalledWith('project-1', 2);

    startOrQueueMock.mockClear();
    deps.queries.githubIssues.list.mockClear();

    notifyIssueGraphPipelinePhaseChange({
      threadId: 'thread-1',
      phase: PIPELINE_PHASE.idle,
      cancelled: true,
    });

    // issue-2 is stranded behind a cancelled prerequisite — it must not auto-launch.
    expect(startOrQueueMock).not.toHaveBeenCalled();
    // The run matched exactly once, so the cancel did reach the tracker.
    expect(deps.queries.githubIssues.list).toHaveBeenCalledTimes(1);

    // …and the run is gone: a later terminal signal finds nothing left to advance.
    deps.queries.githubIssues.list.mockClear();
    notifyIssueGraphPipelinePhaseChange({
      threadId: 'thread-1',
      phase: PIPELINE_PHASE.completed,
    });
    expect(deps.queries.githubIssues.list).not.toHaveBeenCalled();
    expect(startOrQueueMock).not.toHaveBeenCalled();
  });

  it('ignores a plain idle phase so ordinary slot-freed events stay non-terminal', async () => {
    const deps = makeDeps();
    registerIssueGraphHandlers(deps as never);

    const confirm = handlers.get('issue-graph:confirm-run');
    if (!confirm) throw new Error('issue-graph:confirm-run handler missing');

    await confirm(undefined, { projectId: 'project-1', selectedIssueIds: ['issue-1', 'issue-2'] });
    deps.queries.githubIssues.list.mockClear();

    notifyIssueGraphPipelinePhaseChange({ threadId: 'thread-1', phase: PIPELINE_PHASE.idle });

    expect(deps.queries.githubIssues.getByThreadId).not.toHaveBeenCalled();
    expect(deps.queries.githubIssues.list).not.toHaveBeenCalled();
  });
});
