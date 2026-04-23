import { describe, expect, it } from 'vitest';
import type { ProjectIssueGraph } from '@shipcode/shared';
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
});

describe('formatPreviewGroups', () => {
  it('formats grouped execution order for the confirmation UI', () => {
    expect(
      formatPreviewGroups(graph, [
        ['issue-1'],
        ['issue-2'],
      ]),
    ).toEqual(['Wave 1: #1 First', 'Wave 2: #2 Second']);
  });
});
