// @ts-expect-error dagre does not ship types in this workspace.

import type { IssuePipelineStatus, ProjectIssueGraph } from '@shipcode/shared';
import type { Edge, Node } from '@xyflow/react';
import dagre from 'dagre';

export interface IssueGraphNodeData extends Record<string, unknown> {
  issueId: string;
  issueNumber: number;
  title: string;
  pipelineStatus: IssuePipelineStatus;
  state: string;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 88;
const ACTIVE_PIPELINE_STATUSES = new Set<IssuePipelineStatus>([
  'planning',
  'reviewing',
  'revising',
  'executing',
  'testing',
  'verifying',
  'shipping',
]);
const EDGE_STYLES = {
  blocks: { stroke: 'rgba(37, 99, 235, 0.85)', strokeWidth: 1.6 },
  depends_on: { stroke: 'rgba(217, 119, 6, 0.85)', strokeWidth: 1.6 },
  reference: { stroke: 'rgba(148, 163, 184, 0.9)', strokeDasharray: '6 4', opacity: 0.55 },
} as const;

export function buildIssueFlowGraph(graph: ProjectIssueGraph): {
  nodes: Array<Node<IssueGraphNodeData>>;
  edges: Edge[];
} {
  const nodes: Array<Node<IssueGraphNodeData>> = graph.nodes.map((issue) => ({
    id: issue.issueId,
    type: 'issueGraphNode',
    position: { x: 0, y: 0 },
    data: {
      issueId: issue.issueId,
      issueNumber: issue.issueNumber,
      title: issue.title,
      pipelineStatus: issue.pipelineStatus,
      state: issue.state,
    },
  }));

  const nodeById = new Map(graph.nodes.map((node) => [node.issueId, node] as const));
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceIssueId,
    target: edge.targetIssueId,
    label: edge.edgeType.replace('_', ' '),
    animated:
      ACTIVE_PIPELINE_STATUSES.has(nodeById.get(edge.sourceIssueId)?.pipelineStatus ?? 'todo') ||
      ACTIVE_PIPELINE_STATUSES.has(nodeById.get(edge.targetIssueId)?.pipelineStatus ?? 'todo'),
    style: EDGE_STYLES[edge.edgeType],
  }));

  return {
    nodes: layoutGraph(nodes, edges),
    edges,
  };
}

export function formatPreviewGroups(graph: ProjectIssueGraph, groups: string[][]): string[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.issueId, node] as const));
  return groups.map((group, index) => {
    const label = group
      .map((issueId) => {
        const issue = nodeById.get(issueId);
        return issue ? `#${issue.issueNumber} ${issue.title}` : issueId;
      })
      .join(', ');
    return `Wave ${index + 1}: ${label}`;
  });
}

function layoutGraph(nodes: Array<Node<IssueGraphNodeData>>, edges: Edge[]) {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: 'TB',
    ranksep: 72,
    nodesep: 44,
    marginx: 24,
    marginy: 24,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  return nodes.map((node) => {
    const position = graph.node(node.id);
    return {
      ...node,
      position: {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - NODE_HEIGHT / 2,
      },
    };
  });
}
