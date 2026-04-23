import type { IssueEdgeQueries } from '@shipcode/db';
import { buildIssueGroupExecutionPreview, createIssueGroupRunState } from '@shipcode/pipeline';
import type { GitHubIssueCacheRecord, PipelinePhase, ProjectIssueGraph } from '@shipcode/shared';
import { parseIssueBodyDependencyEdges } from '@shipcode/shared';
import { PipelineScheduler } from '../pipeline-scheduler';
import { sendGithubIssuesUpdated } from './helpers';
import type { IpcHandlerDeps } from './types';

interface ActiveIssueGroupRun {
  projectId: string;
  selectedIssueIds: string[];
  runState: ReturnType<typeof createIssueGroupRunState>;
  startedIssueIds: Set<string>;
}

let runtimeDeps: {
  queries: IpcHandlerDeps['queries'];
  scheduler: PipelineScheduler;
} | null = null;

const activeGroupedRuns = new Map<string, ActiveIssueGroupRun>();

export function registerIssueGraphHandlers({
  ipcMain,
  mainWindow,
  queries,
  pipeline,
  emitter,
}: IpcHandlerDeps): void {
  const scheduler = new PipelineScheduler({
    queries,
    pipeline,
    emitter,
    getMainWindow: () => mainWindow,
  });
  runtimeDeps = { queries, scheduler };

  ipcMain.handle('issue-graph:get', (_event, { projectId }: { projectId: string }) => {
    return queries.issueEdges.loadProjectGraph(projectId);
  });

  ipcMain.handle(
    'issue-graph:create-edge',
    (
      _event,
      {
        projectId,
        sourceIssueId,
        targetIssueId,
        edgeType = 'blocks',
      }: {
        projectId: string;
        sourceIssueId: string;
        targetIssueId: string;
        edgeType?: 'blocks' | 'depends_on' | 'reference';
      },
    ) => {
      if (sourceIssueId === targetIssueId) {
        throw new Error('Cannot create a self edge');
      }

      queries.issueEdges.createManualEdge({
        projectId,
        sourceIssueId,
        targetIssueId,
        edgeType,
      });

      return queries.issueEdges.loadProjectGraph(projectId);
    },
  );

  ipcMain.handle(
    'issue-graph:delete-edge',
    (_event, { projectId, edgeId }: { projectId: string; edgeId: string }) => {
      queries.issueEdges.deleteEdge(edgeId);
      return queries.issueEdges.loadProjectGraph(projectId);
    },
  );

  ipcMain.handle(
    'issue-graph:preview-run',
    (_event, { projectId, selectedIssueIds }: { projectId: string; selectedIssueIds: string[] }) =>
      buildPreview(queries.issueEdges.loadProjectGraph(projectId), selectedIssueIds),
  );

  ipcMain.handle(
    'issue-graph:confirm-run',
    async (
      _event,
      { projectId, selectedIssueIds }: { projectId: string; selectedIssueIds: string[] },
    ) => {
      if (selectedIssueIds.length === 0) {
        throw new Error('Select at least one issue to run');
      }

      const graph = queries.issueEdges.loadProjectGraph(projectId);
      const preview = buildPreview(graph, selectedIssueIds);
      const runState = createIssueGroupRunState({
        selectedIssueIds: preview.issueOrder,
        nodes: graph.nodes.map((node) => ({
          issueId: node.issueId,
          issueNumber: node.issueNumber,
        })),
        edges: graph.edges.map((edge) => ({
          sourceIssueId: edge.sourceIssueId,
          targetIssueId: edge.targetIssueId,
          edgeType: edge.edgeType,
        })),
      });
      const runId = `group-${Date.now()}-${preview.issueOrder.join('-')}`;
      const startedIssueIds = new Set<string>();
      const issuesById = new Map(
        queries.githubIssues.list(projectId).map((issue) => [issue.id, issue] as const),
      );

      activeGroupedRuns.set(runId, {
        projectId,
        selectedIssueIds: preview.issueOrder,
        runState,
        startedIssueIds,
      });

      for (const issueId of runState.getReadyIssueIds()) {
        const issue = issuesById.get(issueId);
        if (!issue) continue;
        startedIssueIds.add(issueId);
        await scheduler.startOrQueue(projectId, issue.issueNumber);
      }

      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return { runId, preview };
    },
  );
}

export function notifyIssueGraphPipelinePhaseChange(input: {
  threadId: string;
  phase: PipelinePhase;
}): void {
  if (!runtimeDeps || (input.phase !== 'completed' && input.phase !== 'failed')) {
    return;
  }
  const deps = runtimeDeps;

  const completedIssue = deps.queries.githubIssues.getByThreadId(input.threadId);
  if (!completedIssue) return;

  for (const [runId, run] of activeGroupedRuns) {
    if (
      run.projectId !== completedIssue.projectId ||
      !run.selectedIssueIds.includes(completedIssue.id)
    ) {
      continue;
    }

    const newlyReadyIssueIds = run.runState.markIssueCompleted(
      completedIssue.id,
      input.phase === 'completed',
    );

    for (const issueId of newlyReadyIssueIds) {
      if (run.startedIssueIds.has(issueId)) continue;
      const issue = deps.queries.githubIssues
        .list(run.projectId)
        .find((entry) => entry.id === issueId);
      if (!issue) continue;
      run.startedIssueIds.add(issueId);
      deps.scheduler.startOrQueue(run.projectId, issue.issueNumber).catch(() => {});
    }

    if (
      run.selectedIssueIds.every((issueId) => {
        const issue = deps.queries.githubIssues
          .list(run.projectId)
          .find((entry) => entry.id === issueId);
        return issue ? ['completed', 'done', 'failed'].includes(issue.pipelineStatus) : true;
      })
    ) {
      activeGroupedRuns.delete(runId);
    }
  }
}

export function refreshIssueBodyEdges(
  issueEdges: IssueEdgeQueries,
  issue: Pick<GitHubIssueCacheRecord, 'id' | 'projectId' | 'issueNumber' | 'body'>,
  issuesByNumber: Map<number, Pick<GitHubIssueCacheRecord, 'id'>>,
): void {
  const parsedEdges = parseIssueBodyDependencyEdges(issue.issueNumber, issue.body);

  issueEdges.replaceBodyEdges(
    issue.projectId,
    issue.id,
    parsedEdges.flatMap((edge) => {
      const sourceIssue = issuesByNumber.get(edge.sourceIssueNumber);
      const targetIssue = issuesByNumber.get(edge.targetIssueNumber);
      if (!sourceIssue || !targetIssue) return [];
      return [
        {
          sourceIssueId: sourceIssue.id,
          targetIssueId: targetIssue.id,
          edgeType: edge.edgeType,
        },
      ];
    }),
  );
}

function buildPreview(graph: ProjectIssueGraph, selectedIssueIds: string[]) {
  return buildIssueGroupExecutionPreview({
    selectedIssueIds,
    nodes: graph.nodes.map((node) => ({ issueId: node.issueId, issueNumber: node.issueNumber })),
    edges: graph.edges.map((edge) => ({
      sourceIssueId: edge.sourceIssueId,
      targetIssueId: edge.targetIssueId,
      edgeType: edge.edgeType,
    })),
  });
}
