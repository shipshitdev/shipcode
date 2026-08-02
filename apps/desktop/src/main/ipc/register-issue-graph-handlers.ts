import type { IssueEdgeQueries } from '@shipcode/db';
import { buildIssueGroupExecutionPreview, createIssueGroupRunState } from '@shipcode/pipeline';
import type {
  GitHubIssueCacheRecord,
  IssuePipelineStatus,
  PipelinePhase,
  ProjectIssueGraph,
} from '@shipcode/shared';
import {
  ISSUE_PIPELINE_STATUS,
  PIPELINE_PHASE,
  parseIssueBodyDependencyEdges,
} from '@shipcode/shared';
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

const ISSUE_GROUP_TERMINAL_STATUSES = new Set<IssuePipelineStatus>([
  ISSUE_PIPELINE_STATUS.completed,
  ISSUE_PIPELINE_STATUS.closed,
  ISSUE_PIPELINE_STATUS.failed,
]);

export function registerIssueGraphHandlers({
  ipcMain,
  mainWindow,
  queries,
  pipeline,
  emitter,
  ghSync,
}: IpcHandlerDeps): void {
  const scheduler = new PipelineScheduler({
    queries,
    pipeline,
    emitter,
    getMainWindow: () => mainWindow,
    ghSync,
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

      await Promise.all(
        runState.getReadyIssueIds().flatMap((issueId) => {
          const issue = issuesById.get(issueId);
          if (!issue) return [];
          startedIssueIds.add(issueId);
          return [scheduler.startOrQueue(projectId, issue.issueNumber)];
        }),
      );

      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return { runId, preview };
    },
  );
}

export function notifyIssueGraphPipelinePhaseChange(input: {
  threadId: string;
  phase: PipelinePhase;
  /**
   * Set when reconciliation cancelled the run (issue closed upstream, or tagged with
   * a terminal label). Cancellation only surfaces as an `idle` phase, which is not
   * terminal on its own — without this flag the issue is never marked done here and
   * the whole group silently stops making progress.
   */
  cancelled?: boolean;
}): void {
  const isTerminal =
    input.cancelled === true ||
    input.phase === PIPELINE_PHASE.completed ||
    input.phase === PIPELINE_PHASE.failed;
  if (!runtimeDeps || !isTerminal) return;
  const deps = runtimeDeps;

  const terminalIssue = deps.queries.githubIssues.getByThreadId(input.threadId);
  if (!terminalIssue) return;

  // A cancelled issue is failed-like: it releases no dependents, but it does close
  // out the issue so the run can settle.
  const succeeded = input.cancelled !== true && input.phase === PIPELINE_PHASE.completed;

  for (const [runId, run] of activeGroupedRuns) {
    const selectedIssueIds = new Set(run.selectedIssueIds);
    if (run.projectId !== terminalIssue.projectId || !selectedIssueIds.has(terminalIssue.id)) {
      continue;
    }

    const newlyReadyIssueIds = run.runState.markIssueCompleted(terminalIssue.id, succeeded);

    const issuesById = new Map(
      deps.queries.githubIssues.list(run.projectId).map((issue) => [issue.id, issue]),
    );

    for (const issueId of newlyReadyIssueIds) {
      if (run.startedIssueIds.has(issueId)) continue;
      const issue = issuesById.get(issueId);
      if (!issue) continue;
      run.startedIssueIds.add(issueId);
      deps.scheduler.startOrQueue(run.projectId, issue.issueNumber).catch(() => {});
    }

    // Retire the run once nothing can still advance it. The run state settles even
    // when stranded dependents never reach a terminal issue status of their own,
    // which is exactly the case after a cancellation.
    const everySelectedIssueTerminal = run.selectedIssueIds.every((issueId) => {
      const issue = issuesById.get(issueId);
      return issue ? ISSUE_GROUP_TERMINAL_STATUSES.has(issue.pipelineStatus) : true;
    });
    if (run.runState.isSettled() || everySelectedIssueTerminal) {
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
