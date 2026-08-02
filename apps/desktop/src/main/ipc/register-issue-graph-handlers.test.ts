import type { ProjectIssueGraph } from '@shipcode/shared';
import { ISSUE_PIPELINE_STATUS, PIPELINE_PHASE } from '@shipcode/shared';
import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const { schedulerOptions, startOrQueueMock } = vi.hoisted(() => ({
  schedulerOptions: [] as Array<{ getMainWindow: () => unknown }>,
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
  PipelineScheduler: vi.fn().mockImplementation(function MockPipelineScheduler(options: {
    getMainWindow: () => unknown;
  }) {
    schedulerOptions.push(options);
    return {
      startOrQueue: startOrQueueMock,
    };
  } as never),
}));

const { notifyIssueGraphPipelinePhaseChange, refreshIssueBodyEdges, registerIssueGraphHandlers } =
  await import('./register-issue-graph-handlers');

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
        pipelineStatus: ISSUE_PIPELINE_STATUS.todo,
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

function makeDeps(graph = makeGraph()) {
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
        loadProjectGraph: vi.fn(() => graph),
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

describe('registerIssueGraphHandlers', () => {
  beforeEach(() => {
    handlers.clear();
    schedulerOptions.length = 0;
    startOrQueueMock.mockClear();
  });

  it('registers graph CRUD and preview handlers', async () => {
    const deps = makeDeps();
    registerIssueGraphHandlers(deps as never);
    expect(schedulerOptions[0]?.getMainWindow()).toBe(deps.mainWindow);

    expect(handlers.get('issue-graph:get')?.(undefined, { projectId: 'project-1' })).toEqual(
      makeGraph(),
    );

    expect(() =>
      handlers.get('issue-graph:create-edge')?.(undefined, {
        projectId: 'project-1',
        sourceIssueId: 'issue-1',
        targetIssueId: 'issue-1',
      }),
    ).toThrow('Cannot create a self edge');

    handlers.get('issue-graph:create-edge')?.(undefined, {
      projectId: 'project-1',
      sourceIssueId: 'issue-1',
      targetIssueId: 'issue-2',
      edgeType: 'reference',
    });
    expect(deps.queries.issueEdges.createManualEdge).toHaveBeenCalledWith({
      projectId: 'project-1',
      sourceIssueId: 'issue-1',
      targetIssueId: 'issue-2',
      edgeType: 'reference',
    });

    handlers.get('issue-graph:delete-edge')?.(undefined, {
      projectId: 'project-1',
      edgeId: 'edge-1',
    });
    expect(deps.queries.issueEdges.deleteEdge).toHaveBeenCalledWith('edge-1');

    expect(
      handlers.get('issue-graph:preview-run')?.(undefined, {
        projectId: 'project-1',
        selectedIssueIds: ['issue-1', 'issue-2'],
      }),
    ).toMatchObject({ issueOrder: ['issue-1', 'issue-2'] });
  });

  it('confirms grouped runs and starts newly unblocked issues on phase changes', async () => {
    const deps = makeDeps();
    registerIssueGraphHandlers(deps as never);

    const confirm = handlers.get('issue-graph:confirm-run');
    if (!confirm) throw new Error('issue-graph:confirm-run handler missing');

    await expect(
      confirm(undefined, { projectId: 'project-1', selectedIssueIds: [] }),
    ).rejects.toThrow('Select at least one issue');

    await expect(
      confirm(undefined, { projectId: 'project-1', selectedIssueIds: ['issue-1', 'issue-2'] }),
    ).resolves.toMatchObject({
      preview: { issueOrder: ['issue-1', 'issue-2'] },
    });
    expect(startOrQueueMock).toHaveBeenCalledWith('project-1', 1);

    notifyIssueGraphPipelinePhaseChange({
      threadId: 'thread-1',
      phase: PIPELINE_PHASE.completed,
    });
    expect(startOrQueueMock).toHaveBeenCalledWith('project-1', 2);

    notifyIssueGraphPipelinePhaseChange({
      threadId: 'thread-2',
      phase: PIPELINE_PHASE.failed,
    });
    notifyIssueGraphPipelinePhaseChange({ threadId: 'thread-3', phase: PIPELINE_PHASE.planning });
  });

  it('skips missing ready issues when confirming grouped runs', async () => {
    const deps = makeDeps();
    vi.mocked(deps.queries.githubIssues.list).mockReturnValue([
      {
        id: 'issue-2',
        projectId: 'project-1',
        issueNumber: 2,
        pipelineStatus: ISSUE_PIPELINE_STATUS.todo,
        threadId: 'thread-2',
      },
    ]);
    registerIssueGraphHandlers(deps as never);

    const confirm = handlers.get('issue-graph:confirm-run');
    if (!confirm) throw new Error('issue-graph:confirm-run handler missing');

    await confirm(undefined, { projectId: 'project-1', selectedIssueIds: ['issue-1', 'issue-2'] });

    expect(deps.queries.githubIssues.list).toHaveBeenCalledWith('project-1');
  });

  it('ignores unrelated phase changes and missing newly ready issues', async () => {
    const deps = makeDeps();
    registerIssueGraphHandlers(deps as never);

    const confirm = handlers.get('issue-graph:confirm-run');
    if (!confirm) throw new Error('issue-graph:confirm-run handler missing');

    await confirm(undefined, { projectId: 'project-1', selectedIssueIds: ['issue-1', 'issue-2'] });
    startOrQueueMock.mockClear();

    notifyIssueGraphPipelinePhaseChange({
      threadId: 'missing-thread',
      phase: PIPELINE_PHASE.completed,
    });
    vi.mocked(deps.queries.githubIssues.getByThreadId).mockReturnValueOnce({
      id: 'foreign-issue',
      projectId: 'other-project',
      issueNumber: 9,
      pipelineStatus: ISSUE_PIPELINE_STATUS.completed,
      threadId: 'thread-foreign',
    });
    notifyIssueGraphPipelinePhaseChange({
      threadId: 'thread-foreign',
      phase: PIPELINE_PHASE.completed,
    });

    vi.mocked(deps.queries.githubIssues.list).mockReturnValue([
      {
        id: 'issue-1',
        projectId: 'project-1',
        issueNumber: 1,
        pipelineStatus: ISSUE_PIPELINE_STATUS.completed,
        threadId: 'thread-1',
      },
    ]);
    notifyIssueGraphPipelinePhaseChange({
      threadId: 'thread-1',
      phase: PIPELINE_PHASE.completed,
    });

    expect(deps.queries.githubIssues.list).toHaveBeenCalledWith('project-1');
  });

  it('continues grouped runs when a newly ready issue was already started or fails to start', async () => {
    const noDependencyGraph: ProjectIssueGraph = {
      ...makeGraph(),
      edges: [],
    };
    const deps = makeDeps(noDependencyGraph);
    registerIssueGraphHandlers(deps as never);

    const confirm = handlers.get('issue-graph:confirm-run');
    if (!confirm) throw new Error('issue-graph:confirm-run handler missing');

    await confirm(undefined, { projectId: 'project-1', selectedIssueIds: ['issue-1', 'issue-2'] });
    startOrQueueMock.mockClear();

    notifyIssueGraphPipelinePhaseChange({
      threadId: 'thread-1',
      phase: PIPELINE_PHASE.completed,
    });

    expect(startOrQueueMock).not.toHaveBeenCalled();

    const dependentDeps = makeDeps();
    registerIssueGraphHandlers(dependentDeps as never);
    const dependentConfirm = handlers.get('issue-graph:confirm-run');
    if (!dependentConfirm) throw new Error('issue-graph:confirm-run handler missing');

    await dependentConfirm(undefined, {
      projectId: 'project-1',
      selectedIssueIds: ['issue-1', 'issue-2'],
    });
    startOrQueueMock.mockClear();
    startOrQueueMock.mockRejectedValueOnce(new Error('queue failed'));

    notifyIssueGraphPipelinePhaseChange({
      threadId: 'thread-1',
      phase: PIPELINE_PHASE.completed,
    });

    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(startOrQueueMock).toHaveBeenCalledWith('project-1', 2);
  });

  it('deletes grouped runs once selected issues are terminal', async () => {
    const deps = makeDeps();
    registerIssueGraphHandlers(deps as never);

    const confirm = handlers.get('issue-graph:confirm-run');
    if (!confirm) throw new Error('issue-graph:confirm-run handler missing');

    await confirm(undefined, { projectId: 'project-1', selectedIssueIds: ['issue-1', 'issue-2'] });
    vi.mocked(deps.queries.githubIssues.list).mockReturnValue([
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
        pipelineStatus: ISSUE_PIPELINE_STATUS.failed,
        threadId: 'thread-2',
      },
    ] as never);

    notifyIssueGraphPipelinePhaseChange({
      threadId: 'thread-1',
      phase: PIPELINE_PHASE.completed,
    });
    notifyIssueGraphPipelinePhaseChange({
      threadId: 'thread-1',
      phase: PIPELINE_PHASE.completed,
    });

    expect(startOrQueueMock).toHaveBeenCalledWith('project-1', 2);
  });

  it('drops a grouped run whose dependents were parked by a failure', async () => {
    // Scoped to its own project so grouped runs left behind by the tests above
    // cannot match these notifications and mask a leak.
    const graph = makeGraph();
    const deps = makeDeps({
      ...graph,
      projectId: 'project-2',
      nodes: graph.nodes.map((node) => ({ ...node, projectId: 'project-2' })),
      edges: graph.edges.map((edge) => ({ ...edge, projectId: 'project-2' })),
    });
    vi.mocked(deps.queries.githubIssues.list).mockReturnValue([
      {
        id: 'issue-1',
        projectId: 'project-2',
        issueNumber: 1,
        pipelineStatus: ISSUE_PIPELINE_STATUS.failed,
        threadId: 'thread-1',
      },
      {
        id: 'issue-2',
        projectId: 'project-2',
        issueNumber: 2,
        // Parked, never launched — this status never becomes terminal, which is
        // exactly what used to pin the run in the active map forever.
        pipelineStatus: ISSUE_PIPELINE_STATUS.todo,
        threadId: 'thread-2',
      },
    ] as never);
    vi.mocked(deps.queries.githubIssues.getByThreadId).mockImplementation((threadId: string) =>
      threadId === 'thread-1'
        ? ({
            id: 'issue-1',
            projectId: 'project-2',
            issueNumber: 1,
            pipelineStatus: ISSUE_PIPELINE_STATUS.failed,
            threadId: 'thread-1',
          } as never)
        : null,
    );
    registerIssueGraphHandlers(deps as never);

    const confirm = handlers.get('issue-graph:confirm-run');
    if (!confirm) throw new Error('issue-graph:confirm-run handler missing');

    // issue-1 blocks issue-2, so only issue-1 starts.
    await confirm(undefined, { projectId: 'project-2', selectedIssueIds: ['issue-1', 'issue-2'] });
    startOrQueueMock.mockClear();

    notifyIssueGraphPipelinePhaseChange({ threadId: 'thread-1', phase: PIPELINE_PHASE.failed });
    expect(startOrQueueMock).not.toHaveBeenCalled();

    // The run is looked up per notification, and `list` is only reached once a
    // run matches — so no call here means no entry survived in the active map.
    vi.mocked(deps.queries.githubIssues.list).mockClear();
    // The user fixes and re-runs issue-1 by itself. The group is gone, so its
    // dependent must not be launched off the back of that single-issue run.
    notifyIssueGraphPipelinePhaseChange({ threadId: 'thread-1', phase: PIPELINE_PHASE.completed });

    expect(deps.queries.githubIssues.list).not.toHaveBeenCalled();
    expect(startOrQueueMock).not.toHaveBeenCalled();
  });

  it('refreshes body-derived dependency edges and skips unknown issue references', () => {
    const issueEdges = {
      replaceBodyEdges: vi.fn(),
    };
    const issuesByNumber = new Map([
      [1, { id: 'issue-1' }],
      [2, { id: 'issue-2' }],
    ]);

    refreshIssueBodyEdges(
      issueEdges as never,
      {
        id: 'issue-1',
        projectId: 'project-1',
        issueNumber: 1,
        body: 'Depends on #2 and blocks #99.',
      },
      issuesByNumber,
    );

    expect(issueEdges.replaceBodyEdges).toHaveBeenCalledWith('project-1', 'issue-1', [
      { sourceIssueId: 'issue-2', targetIssueId: 'issue-1', edgeType: 'depends_on' },
    ]);
  });
});
