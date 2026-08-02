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

export function createIssueGroupRunState(input: RunStateInput) {
  const preview = buildIssueGroupExecutionPreview(input);
  const selection = new Set(preview.issueOrder);
  const previewIndexByIssueId = new Map(
    preview.issueOrder.map((issueId, index) => [issueId, index] as const),
  );
  const hardEdges = filterRelevantHardEdges(selection, input.edges);
  const pendingPrerequisiteCounts = new Map<string, number>();
  const dependentsByIssueId = new Map<string, string[]>();
  const completedSuccessfully = new Set<string>();
  const completedIssues = new Set<string>();
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

  // Dependents of an issue that finished unsuccessfully (failed or cancelled) can
  // never become ready — nothing is left to decrement their pending-prerequisite
  // count. Derived on demand rather than stored so a retry that later succeeds
  // revives its dependents instead of leaving them permanently written off.
  const collectUnreachableIssueIds = (): Set<string> => {
    const unreachable = new Set<string>();
    const queue = [...completedIssues].filter((issueId) => !completedSuccessfully.has(issueId));

    while (queue.length > 0) {
      const issueId = queue.pop() as string;
      for (const dependentIssueId of dependentsByIssueId.get(issueId) ?? []) {
        if (completedIssues.has(dependentIssueId) || unreachable.has(dependentIssueId)) continue;
        unreachable.add(dependentIssueId);
        queue.push(dependentIssueId);
      }
    }

    return unreachable;
  };

  return {
    getReadyIssueIds(): string[] {
      return sortByPreviewOrder(ready);
    },
    getBlockedIssueIds(): string[] {
      return sortByPreviewOrder(
        [...selection].filter((issueId) => !ready.has(issueId) && !completedIssues.has(issueId)),
      );
    },
    getUnreachableIssueIds(): string[] {
      return sortByPreviewOrder(collectUnreachableIssueIds());
    },
    /**
     * True once no selected issue can still make progress: every one has either
     * finished or been stranded behind an unsuccessful prerequisite. Callers use
     * this to retire the run instead of tracking it forever.
     */
    isSettled(): boolean {
      const unreachable = collectUnreachableIssueIds();
      return [...selection].every(
        (issueId) => completedIssues.has(issueId) || unreachable.has(issueId),
      );
    },
    markIssueCompleted(issueId: string, succeeded: boolean): string[] {
      ready.delete(issueId);
      completedIssues.add(issueId);
      if (!selection.has(issueId) || !succeeded) return [];
      // A repeated success for the same issue must not decrement its dependents
      // twice, which would release them before their other prerequisites land.
      if (completedSuccessfully.has(issueId)) return [];
      completedSuccessfully.add(issueId);

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
