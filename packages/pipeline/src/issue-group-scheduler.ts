import type { IssueGraphEdgeType } from '@shipcode/shared';

type SchedulerNode = {
  issueId: string;
  issueNumber: number;
};

type SchedulerEdge = {
  sourceIssueId: string;
  targetIssueId: string;
  edgeType: IssueGraphEdgeType;
};

interface BuildPreviewInput {
  selectedIssueIds: string[];
  nodes: readonly SchedulerNode[];
  edges: readonly SchedulerEdge[];
}

interface RunStateInput extends BuildPreviewInput {}

export interface IssueGroupExecutionPreview {
  issueOrder: string[];
  groups: string[][];
}

export interface IssueGroupRunState {
  getReadyIssueIds(): string[];
  getBlockedIssueIds(): string[];
  /** Issues that can never launch because a hard prerequisite failed. */
  getAbandonedIssueIds(): string[];
  /**
   * True once no selected issue can still start or finish — every issue has
   * either reported a terminal phase or been parked behind a failed
   * prerequisite. Callers use this to drop the run from their active map;
   * without it a group containing a failure stays resident forever, and a
   * later re-run of the failed issue would silently resume the group.
   */
  isSettled(): boolean;
  /** Returns the issues released by this completion, in preview order. */
  markIssueCompleted(issueId: string, succeeded: boolean): string[];
}

const HARD_EDGE_TYPES = new Set<IssueGraphEdgeType>(['blocks', 'depends_on']);

export class IssueGroupSchedulerError extends Error {}

export function buildIssueGroupExecutionPreview(
  input: BuildPreviewInput,
): IssueGroupExecutionPreview {
  const selection = normalizeSelectedIssueIds(input.selectedIssueIds, input.nodes);
  const hardEdges = filterRelevantHardEdges(selection, input.edges);
  assertNoExternalHardDependencies(selection, input.edges);

  const { orderedIssueIds, groups } = topologicallyGroupSelection(
    selection,
    hardEdges,
    input.nodes,
  );
  return { issueOrder: orderedIssueIds, groups };
}

export function createIssueGroupRunState(input: RunStateInput): IssueGroupRunState {
  const preview = buildIssueGroupExecutionPreview(input);
  const selection = new Set(preview.issueOrder);
  const previewIndexByIssueId = new Map(
    preview.issueOrder.map((issueId, index) => [issueId, index] as const),
  );
  const hardEdges = filterRelevantHardEdges(selection, input.edges);
  const pendingPrerequisiteCounts = new Map<string, number>();
  const dependentsByIssueId = new Map<string, string[]>();
  /**
   * Issues whose first terminal result has already been accounted for. This is
   * the idempotency key for `markIssueCompleted` — see the comment there.
   */
  const settledIssueIds = new Set<string>();
  /** Issues parked behind a failed prerequisite; they can never become ready. */
  const abandonedIssueIds = new Set<string>();
  const ready = new Set(preview.groups[0] ?? []);

  for (const issueId of selection) {
    pendingPrerequisiteCounts.set(issueId, 0);
    dependentsByIssueId.set(issueId, []);
  }

  for (const edge of hardEdges) {
    pendingPrerequisiteCounts.set(
      edge.targetIssueId,
      (pendingPrerequisiteCounts.get(edge.targetIssueId) as number) + 1,
    );
    (dependentsByIssueId.get(edge.sourceIssueId) as string[]).push(edge.targetIssueId);
  }

  const sortByPreviewOrder = (issueIds: Iterable<string>) =>
    [...issueIds].sort(
      (a, b) => (previewIndexByIssueId.get(a) as number) - (previewIndexByIssueId.get(b) as number),
    );

  /**
   * A failed issue never decrements its dependents' pending counts, so every
   * issue downstream of it is unreachable — including dependents whose other
   * prerequisites did succeed. Park the whole subtree so the run can settle
   * instead of waiting forever on issues that will never start.
   */
  const abandonDependentsOf = (rootIssueId: string): void => {
    const queue = [...(dependentsByIssueId.get(rootIssueId) as string[])];

    while (queue.length > 0) {
      const issueId = queue.pop() as string;
      if (settledIssueIds.has(issueId) || abandonedIssueIds.has(issueId)) continue;
      abandonedIssueIds.add(issueId);
      ready.delete(issueId);
      queue.push(...(dependentsByIssueId.get(issueId) as string[]));
    }
  };

  return {
    getReadyIssueIds(): string[] {
      return sortByPreviewOrder(ready);
    },
    getBlockedIssueIds(): string[] {
      return sortByPreviewOrder(
        [...selection].filter(
          (issueId) =>
            !ready.has(issueId) && !settledIssueIds.has(issueId) && !abandonedIssueIds.has(issueId),
        ),
      );
    },
    getAbandonedIssueIds(): string[] {
      return sortByPreviewOrder(abandonedIssueIds);
    },
    isSettled(): boolean {
      return [...selection].every(
        (issueId) => settledIssueIds.has(issueId) || abandonedIssueIds.has(issueId),
      );
    },
    markIssueCompleted(issueId: string, succeeded: boolean): string[] {
      if (!selection.has(issueId)) return [];
      // Completion notifications fire on every qualifying terminal phase event,
      // and a failed issue's thread is reusable — so the same issue can report
      // a terminal phase more than once. Counting it twice would decrement its
      // dependents' pending counts twice and launch them while a sibling
      // prerequisite is still executing. Only the first terminal result for an
      // issue moves the run forward.
      if (settledIssueIds.has(issueId) || abandonedIssueIds.has(issueId)) return [];

      ready.delete(issueId);
      settledIssueIds.add(issueId);

      if (!succeeded) {
        abandonDependentsOf(issueId);
        return [];
      }

      const newlyReady: string[] = [];
      for (const dependentIssueId of dependentsByIssueId.get(issueId) as string[]) {
        const nextPendingCount = (pendingPrerequisiteCounts.get(dependentIssueId) as number) - 1;
        pendingPrerequisiteCounts.set(dependentIssueId, nextPendingCount);
        if (nextPendingCount === 0) {
          ready.add(dependentIssueId);
          newlyReady.push(dependentIssueId);
        }
      }

      return sortByPreviewOrder(newlyReady);
    },
  };
}

function normalizeSelectedIssueIds(selectedIssueIds: string[], nodes: readonly SchedulerNode[]) {
  const knownIssueIds = new Set(nodes.map((node) => node.issueId));
  return new Set(selectedIssueIds.filter((issueId) => knownIssueIds.has(issueId)));
}

function filterRelevantHardEdges(selection: Set<string>, edges: readonly SchedulerEdge[]) {
  return edges.filter(
    (edge) =>
      HARD_EDGE_TYPES.has(edge.edgeType) &&
      selection.has(edge.sourceIssueId) &&
      selection.has(edge.targetIssueId),
  );
}

function assertNoExternalHardDependencies(
  selection: Set<string>,
  edges: readonly SchedulerEdge[],
): void {
  const unresolved = edges
    .filter(
      (edge) =>
        HARD_EDGE_TYPES.has(edge.edgeType) &&
        !selection.has(edge.sourceIssueId) &&
        selection.has(edge.targetIssueId),
    )
    .map((edge) => `${edge.sourceIssueId}->${edge.targetIssueId}`);

  if (unresolved.length > 0) {
    throw new IssueGroupSchedulerError(
      `Selection has unresolved dependencies outside the group: ${unresolved.join(', ')}`,
    );
  }
}

function topologicallyGroupSelection(
  selection: Set<string>,
  edges: readonly SchedulerEdge[],
  nodes: readonly SchedulerNode[],
) {
  const issueNumberById = new Map(nodes.map((node) => [node.issueId, node.issueNumber]));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const issueId of selection) {
    indegree.set(issueId, 0);
    outgoing.set(issueId, []);
  }

  for (const edge of edges) {
    indegree.set(edge.targetIssueId, (indegree.get(edge.targetIssueId) as number) + 1);
    (outgoing.get(edge.sourceIssueId) as string[]).push(edge.targetIssueId);
  }

  const groups: string[][] = [];
  const orderedIssueIds: string[] = [];
  let frontier = [...selection].filter((issueId) => indegree.get(issueId) === 0);
  frontier.sort((a, b) => (issueNumberById.get(a) as number) - (issueNumberById.get(b) as number));

  while (frontier.length > 0) {
    groups.push(frontier);
    orderedIssueIds.push(...frontier);

    const nextFrontier = new Set<string>();
    for (const issueId of frontier) {
      for (const dependentIssueId of outgoing.get(issueId) as string[]) {
        const nextIndegree = (indegree.get(dependentIssueId) as number) - 1;
        indegree.set(dependentIssueId, nextIndegree);
        if (nextIndegree === 0) {
          nextFrontier.add(dependentIssueId);
        }
      }
    }

    frontier = [...nextFrontier].sort(
      (a, b) => (issueNumberById.get(a) as number) - (issueNumberById.get(b) as number),
    );
  }

  if (orderedIssueIds.length !== selection.size) {
    throw new IssueGroupSchedulerError('Selected issues contain a dependency cycle');
  }

  return { orderedIssueIds, groups };
}
