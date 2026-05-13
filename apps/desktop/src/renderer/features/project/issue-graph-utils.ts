import type { IssuePipelineStatus, ProjectIssueGraph } from '@shipcode/shared';
import { ISSUE_PIPELINE_STATUS } from '@shipcode/shared';
import type { Edge, Node } from '@xyflow/react';
// @ts-expect-error dagre does not ship types in this workspace.
import dagre from 'dagre';

export interface IssueGraphNodeData extends Record<string, unknown> {
  issueId: string;
  issueNumber: number;
  title: string;
  pipelineStatus: IssuePipelineStatus;
  state: string;
}

const NODE_WIDTH = 288;
const NODE_HEIGHT = 112;
const COMPONENT_GAP_X = 80;
const COMPONENT_GAP_Y = 80;
const MAX_LAYOUT_ROW_WIDTH = 1180;
const ACTIVE_PIPELINE_STATUSES = new Set<IssuePipelineStatus>([
  ISSUE_PIPELINE_STATUS.planning,
  ISSUE_PIPELINE_STATUS.reviewing,
  ISSUE_PIPELINE_STATUS.revising,
  ISSUE_PIPELINE_STATUS.executing,
  ISSUE_PIPELINE_STATUS.testing,
  ISSUE_PIPELINE_STATUS.verifying,
  ISSUE_PIPELINE_STATUS.shipping,
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
  const components = connectedComponents(nodes, edges);
  if (components.length > 1) {
    return layoutComponents(nodes, edges, components);
  }

  return layoutComponent(nodes, edges);
}

function connectedComponents(nodes: Array<Node<IssueGraphNodeData>>, edges: Edge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()] as const));

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;

    const stack = [node.id];
    const component: string[] = [];
    visited.add(node.id);

    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }

    components.push(component);
  }

  return components.sort((a, b) => b.length - a.length);
}

function layoutComponents(
  nodes: Array<Node<IssueGraphNodeData>>,
  edges: Edge[],
  components: string[][],
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const componentLayouts = components.map((component) => {
    const componentIds = new Set(component);
    const componentNodes = component.map((id) => nodeById.get(id)!);
    const componentEdges = edges.filter(
      (edge) => componentIds.has(edge.source) && componentIds.has(edge.target),
    );
    const laidOutNodes = layoutComponent(componentNodes, componentEdges);
    const bounds = layoutBounds(laidOutNodes);
    return { nodes: laidOutNodes, bounds };
  });

  const positioned = new Map<string, Node<IssueGraphNodeData>>();
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const component of componentLayouts) {
    const width = component.bounds.width;
    const height = component.bounds.height;
    if (cursorX > 0 && cursorX + width > MAX_LAYOUT_ROW_WIDTH) {
      cursorX = 0;
      cursorY += rowHeight + COMPONENT_GAP_Y;
      rowHeight = 0;
    }

    for (const node of component.nodes) {
      positioned.set(node.id, {
        ...node,
        position: {
          x: cursorX + node.position.x - component.bounds.minX,
          y: cursorY + node.position.y - component.bounds.minY,
        },
      });
    }

    cursorX += width + COMPONENT_GAP_X;
    rowHeight = Math.max(rowHeight, height);
  }

  return nodes.map((node) => positioned.get(node.id)!);
}

function layoutComponent(nodes: Array<Node<IssueGraphNodeData>>, edges: Edge[]) {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: 'TB',
    ranksep: 96,
    nodesep: 56,
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

function layoutBounds(nodes: Array<Node<IssueGraphNodeData>>) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + NODE_WIDTH);
    maxY = Math.max(maxY, node.position.y + NODE_HEIGHT);
  }

  return {
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
