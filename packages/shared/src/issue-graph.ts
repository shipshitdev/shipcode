import type { IssuePipelineStatus } from './types';

export type IssueGraphEdgeType = 'blocks' | 'depends_on' | 'reference';
export type IssueGraphEdgeOrigin = 'body' | 'manual';

export interface ParsedIssueDependencyInput {
  issueNumber: number;
  relatedIssueNumber: number;
  edgeType: Exclude<IssueGraphEdgeType, 'reference'>;
}

export interface ParsedIssueDependencyEdge {
  sourceIssueNumber: number;
  targetIssueNumber: number;
  edgeType: IssueGraphEdgeType;
}

export interface IssueGraphNodeRecord {
  issueId: string;
  projectId: string;
  issueNumber: number;
  title: string;
  state: string;
  pipelineStatus: IssuePipelineStatus;
  threadId: string | null;
}

export interface IssueGraphEdgeRecord {
  id: string;
  projectId: string;
  sourceIssueId: string;
  targetIssueId: string;
  sourceIssueNumber: number;
  targetIssueNumber: number;
  edgeType: IssueGraphEdgeType;
  origin: IssueGraphEdgeOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectIssueGraph {
  projectId: string;
  nodes: IssueGraphNodeRecord[];
  edges: IssueGraphEdgeRecord[];
}

const DEPENDS_ON_PATTERN = /\bdepends\s+on\b[\s:]*#(\d+)\b/gi;
const BLOCKS_PATTERN = /\bblocks\b[\s:]*#(\d+)\b/gi;
const ISSUE_REFERENCE_PATTERN = /(^|[^\w])#(\d+)\b/g;

export function normalizeIssueDependencyEdge(
  input: ParsedIssueDependencyInput,
): ParsedIssueDependencyEdge {
  if (input.edgeType === 'depends_on') {
    return {
      sourceIssueNumber: input.relatedIssueNumber,
      targetIssueNumber: input.issueNumber,
      edgeType: 'depends_on',
    };
  }

  return {
    sourceIssueNumber: input.issueNumber,
    targetIssueNumber: input.relatedIssueNumber,
    edgeType: 'blocks',
  };
}

export function parseIssueBodyDependencyEdges(
  issueNumber: number,
  body: string | null | undefined,
): ParsedIssueDependencyEdge[] {
  if (!body) return [];

  const edges = new Map<string, ParsedIssueDependencyEdge>();
  const hardTargets = new Set<number>();

  const pushHardEdge = (relatedIssueNumber: number, edgeType: 'blocks' | 'depends_on') => {
    const edge = normalizeIssueDependencyEdge({ issueNumber, relatedIssueNumber, edgeType });
    if (
      edge.sourceIssueNumber === edge.targetIssueNumber ||
      edge.sourceIssueNumber === issueNumber && edge.targetIssueNumber === issueNumber
    ) {
      return;
    }
    hardTargets.add(relatedIssueNumber);
    edges.set(`${edge.edgeType}:${edge.sourceIssueNumber}:${edge.targetIssueNumber}`, edge);
  };

  for (const match of body.matchAll(DEPENDS_ON_PATTERN)) {
    pushHardEdge(Number.parseInt(match[1] ?? '', 10), 'depends_on');
  }
  for (const match of body.matchAll(BLOCKS_PATTERN)) {
    pushHardEdge(Number.parseInt(match[1] ?? '', 10), 'blocks');
  }

  for (const match of body.matchAll(ISSUE_REFERENCE_PATTERN)) {
    const referencedIssueNumber = Number.parseInt(match[2] ?? '', 10);
    if (!Number.isFinite(referencedIssueNumber) || referencedIssueNumber === issueNumber) {
      continue;
    }
    if (hardTargets.has(referencedIssueNumber)) continue;

    const edge: ParsedIssueDependencyEdge = {
      sourceIssueNumber: issueNumber,
      targetIssueNumber: referencedIssueNumber,
      edgeType: 'reference',
    };
    edges.set(`${edge.edgeType}:${edge.sourceIssueNumber}:${edge.targetIssueNumber}`, edge);
  }

  return [...edges.values()].sort((a, b) => {
    if (a.sourceIssueNumber !== b.sourceIssueNumber) {
      return a.sourceIssueNumber - b.sourceIssueNumber;
    }
    if (a.targetIssueNumber !== b.targetIssueNumber) {
      return a.targetIssueNumber - b.targetIssueNumber;
    }
    return a.edgeType.localeCompare(b.edgeType);
  });
}
