import type { ProjectIssueGraph } from '@shipcode/shared';
import { ISSUE_PIPELINE_STATUS } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import { buildIssueFlowGraph, formatPreviewGroups } from './issue-graph-utils';

const graph: ProjectIssueGraph = {
  projectId: 'project-1',
  nodes: [
    {
      issueId: 'issue-1',
      projectId: 'project-1',
      issueNumber: 1,
      title: 'First',
      state: 'open',
      pipelineStatus: 'todo',
      threadId: null,
    },
    {
      issueId: 'issue-2',
      projectId: 'project-1',
      issueNumber: 2,
      title: 'Second',
      state: 'open',
      pipelineStatus: 'executing',
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
      createdAt: '',
      updatedAt: '',
    },
  ],
};

describe('buildIssueFlowGraph', () => {
  it('maps issue graph records into positioned React Flow nodes and edges', () => {
    const flowGraph = buildIssueFlowGraph(graph);

    expect(flowGraph.nodes).toHaveLength(2);
    expect(flowGraph.edges).toEqual([
      expect.objectContaining({
        id: 'edge-1',
        source: 'issue-1',
        target: 'issue-2',
        animated: true,
      }),
    ]);
    expect(flowGraph.nodes.every((node) => Number.isFinite(node.position.x))).toBe(true);
    expect(flowGraph.nodes.every((node) => Number.isFinite(node.position.y))).toBe(true);
  });

  it('renders reference edges as dashed secondary links', () => {
    const flowGraph = buildIssueFlowGraph({
      ...graph,
      edges: [
        {
          ...graph.edges[0],
          id: 'edge-ref',
          edgeType: 'reference',
        },
      ],
    });

    expect(flowGraph.edges[0]).toEqual(
      expect.objectContaining({
        label: 'reference',
        style: expect.objectContaining({ strokeDasharray: '6 4', opacity: 0.55 }),
      }),
    );
  });

  it('keeps dependency edges static when neither endpoint has an active pipeline', () => {
    const flowGraph = buildIssueFlowGraph({
      ...graph,
      nodes: graph.nodes.map((node) => ({ ...node, pipelineStatus: 'todo' })),
      edges: [
        {
          ...graph.edges[0],
          id: 'edge-depends',
          sourceIssueId: 'issue-1',
          targetIssueId: 'missing-issue',
          edgeType: 'depends_on',
        },
      ],
    });

    expect(flowGraph.edges[0]).toEqual(
      expect.objectContaining({
        animated: false,
        label: 'depends on',
        style: expect.objectContaining({ stroke: 'rgba(217, 119, 6, 0.85)' }),
      }),
    );
  });

  it('animates edges when the source issue has an active pipeline', () => {
    const flowGraph = buildIssueFlowGraph({
      ...graph,
      nodes: [
        { ...graph.nodes[0], pipelineStatus: 'planning' },
        { ...graph.nodes[1], pipelineStatus: 'todo' },
      ],
    });

    expect(flowGraph.edges[0]).toEqual(expect.objectContaining({ animated: true }));
  });

  it('falls back cleanly when the source issue is missing from an edge', () => {
    const flowGraph = buildIssueFlowGraph({
      ...graph,
      edges: [
        {
          ...graph.edges[0],
          sourceIssueId: 'missing-issue',
          targetIssueId: 'issue-2',
        },
      ],
    });

    expect(flowGraph.edges[0]).toEqual(expect.objectContaining({ animated: true }));
  });

  it('packs disconnected issues into readable rows instead of one long line', () => {
    const flowGraph = buildIssueFlowGraph({
      ...graph,
      nodes: Array.from({ length: 8 }, (_, index) => ({
        issueId: `issue-${index + 1}`,
        projectId: 'project-1',
        issueNumber: index + 1,
        title: `Issue ${index + 1}`,
        state: 'open',
        pipelineStatus: 'todo',
        threadId: null,
      })),
      edges: [],
    });

    const uniqueYPositions = new Set(flowGraph.nodes.map((node) => node.position.y));

    expect(uniqueYPositions.size).toBeGreaterThan(1);
    expect(Math.max(...flowGraph.nodes.map((node) => node.position.x))).toBeLessThan(1180);
  });

  it('wraps oversized connected reference graphs instead of shrinking every node', () => {
    const nodes: ProjectIssueGraph['nodes'] = Array.from({ length: 8 }, (_, index) => ({
      issueId: `issue-${index + 1}`,
      projectId: 'project-1',
      issueNumber: index + 1,
      title: `Issue ${index + 1}`,
      state: 'open',
      pipelineStatus: ISSUE_PIPELINE_STATUS.todo,
      threadId: null,
    }));
    const flowGraph = buildIssueFlowGraph({
      ...graph,
      nodes,
      edges: nodes.slice(0, -1).map((node, index) => ({
        id: `edge-${index + 1}`,
        projectId: 'project-1',
        sourceIssueId: node.issueId,
        targetIssueId: nodes[index + 1]?.issueId ?? '',
        sourceIssueNumber: node.issueNumber,
        targetIssueNumber: nodes[index + 1]?.issueNumber ?? 0,
        edgeType: 'reference',
        origin: 'manual',
        createdAt: '',
        updatedAt: '',
      })),
    });

    const uniqueYPositions = new Set(flowGraph.nodes.map((node) => node.position.y));

    expect(uniqueYPositions.size).toBeGreaterThan(1);
    expect(Math.max(...flowGraph.nodes.map((node) => node.position.x))).toBeLessThan(1180);
  });
});

describe('formatPreviewGroups', () => {
  it('formats grouped execution order for the confirmation UI', () => {
    expect(formatPreviewGroups(graph, [['issue-1'], ['issue-2']])).toEqual([
      'Wave 1: #1 First',
      'Wave 2: #2 Second',
    ]);
  });

  it('falls back to the issue id when a preview group references a missing issue', () => {
    expect(formatPreviewGroups(graph, [['issue-1', 'missing-issue']])).toEqual([
      'Wave 1: #1 First, missing-issue',
    ]);
  });
});
