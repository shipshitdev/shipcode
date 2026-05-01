import { describe, expect, it } from 'vitest';
import {
  normalizeIssueDependencyEdge,
  type ParsedIssueDependencyEdge,
  parseIssueBodyDependencyEdges,
} from './issue-graph';

describe('normalizeIssueDependencyEdge', () => {
  it('normalizes depends_on edges into prerequisite to dependent direction', () => {
    expect(
      normalizeIssueDependencyEdge({
        issueNumber: 42,
        relatedIssueNumber: 7,
        edgeType: 'depends_on',
      }),
    ).toEqual({
      sourceIssueNumber: 7,
      targetIssueNumber: 42,
      edgeType: 'depends_on',
    });
  });

  it('keeps blocks edges in source issue to blocked issue direction', () => {
    expect(
      normalizeIssueDependencyEdge({
        issueNumber: 42,
        relatedIssueNumber: 7,
        edgeType: 'blocks',
      }),
    ).toEqual({
      sourceIssueNumber: 42,
      targetIssueNumber: 7,
      edgeType: 'blocks',
    });
  });
});

describe('parseIssueBodyDependencyEdges', () => {
  it('parses explicit blocks references', () => {
    expect(parseIssueBodyDependencyEdges(42, 'This blocks #7 and blocks: #8.')).toEqual([
      { sourceIssueNumber: 42, targetIssueNumber: 7, edgeType: 'blocks' },
      { sourceIssueNumber: 42, targetIssueNumber: 8, edgeType: 'blocks' },
    ]);
  });

  it('parses explicit depends on references', () => {
    expect(parseIssueBodyDependencyEdges(42, 'Depends on #7.\n- depends on: #8')).toEqual([
      { sourceIssueNumber: 7, targetIssueNumber: 42, edgeType: 'depends_on' },
      { sourceIssueNumber: 8, targetIssueNumber: 42, edgeType: 'depends_on' },
    ]);
  });

  it('parses multiple issue references inside one explicit dependency clause', () => {
    expect(
      parseIssueBodyDependencyEdges(42, 'Depends on #7, #8 and #9.\nBlocks #10, #11.'),
    ).toEqual([
      { sourceIssueNumber: 7, targetIssueNumber: 42, edgeType: 'depends_on' },
      { sourceIssueNumber: 8, targetIssueNumber: 42, edgeType: 'depends_on' },
      { sourceIssueNumber: 9, targetIssueNumber: 42, edgeType: 'depends_on' },
      { sourceIssueNumber: 42, targetIssueNumber: 10, edgeType: 'blocks' },
      { sourceIssueNumber: 42, targetIssueNumber: 11, edgeType: 'blocks' },
    ]);
  });

  it('keeps adjacent dependency clauses scoped to their own keyword', () => {
    expect(parseIssueBodyDependencyEdges(42, 'Depends on #7 and blocks #8.')).toEqual([
      { sourceIssueNumber: 7, targetIssueNumber: 42, edgeType: 'depends_on' },
      { sourceIssueNumber: 42, targetIssueNumber: 8, edgeType: 'blocks' },
    ]);
  });

  it('parses bare references as visualization-only edges', () => {
    expect(parseIssueBodyDependencyEdges(42, 'Related: #7 and see #8 for context.')).toEqual([
      { sourceIssueNumber: 42, targetIssueNumber: 7, edgeType: 'reference' },
      { sourceIssueNumber: 42, targetIssueNumber: 8, edgeType: 'reference' },
    ]);
  });

  it('suppresses self-references', () => {
    expect(parseIssueBodyDependencyEdges(42, 'Depends on #42 and blocks #42 and refs #42')).toEqual(
      [],
    );
  });

  it('dedupes duplicate references and skips redundant bare references when a hard edge exists', () => {
    const edges = parseIssueBodyDependencyEdges(
      42,
      'Depends on #7.\nDepends on #7.\nSee #7 for more.\nAlso #8 and #8.',
    );

    expect(edges).toEqual<ParsedIssueDependencyEdge[]>([
      { sourceIssueNumber: 7, targetIssueNumber: 42, edgeType: 'depends_on' },
      { sourceIssueNumber: 42, targetIssueNumber: 8, edgeType: 'reference' },
    ]);
  });

  it('does not emit duplicate bare references when a multi-reference hard clause already covers them', () => {
    expect(
      parseIssueBodyDependencyEdges(42, 'Blocks #7, #8 and see #7 plus #8 for context.'),
    ).toEqual([
      { sourceIssueNumber: 42, targetIssueNumber: 7, edgeType: 'blocks' },
      { sourceIssueNumber: 42, targetIssueNumber: 8, edgeType: 'blocks' },
    ]);
  });
});
