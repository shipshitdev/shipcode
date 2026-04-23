import { describe, expect, it } from 'vitest';
import {
  buildIssueGroupExecutionPreview,
  createIssueGroupRunState,
  IssueGroupSchedulerError,
} from './issue-group-scheduler';

const nodes = [
  { issueId: 'issue-1', issueNumber: 1 },
  { issueId: 'issue-2', issueNumber: 2 },
  { issueId: 'issue-3', issueNumber: 3 },
  { issueId: 'issue-4', issueNumber: 4 },
] as const;

describe('buildIssueGroupExecutionPreview', () => {
  it('returns deterministic topological groups', () => {
    const preview = buildIssueGroupExecutionPreview({
      selectedIssueIds: ['issue-4', 'issue-2', 'issue-1', 'issue-3'],
      nodes,
      edges: [
        { sourceIssueId: 'issue-1', targetIssueId: 'issue-3', edgeType: 'blocks' },
        { sourceIssueId: 'issue-2', targetIssueId: 'issue-4', edgeType: 'depends_on' },
        { sourceIssueId: 'issue-3', targetIssueId: 'issue-4', edgeType: 'blocks' },
      ],
    });

    expect(preview.issueOrder).toEqual(['issue-1', 'issue-2', 'issue-3', 'issue-4']);
    expect(preview.groups).toEqual([
      ['issue-1', 'issue-2'],
      ['issue-3'],
      ['issue-4'],
    ]);
  });

  it('rejects cycles', () => {
    expect(() =>
      buildIssueGroupExecutionPreview({
        selectedIssueIds: ['issue-1', 'issue-2'],
        nodes,
        edges: [
          { sourceIssueId: 'issue-1', targetIssueId: 'issue-2', edgeType: 'blocks' },
          { sourceIssueId: 'issue-2', targetIssueId: 'issue-1', edgeType: 'depends_on' },
        ],
      }),
    ).toThrow(IssueGroupSchedulerError);
  });

  it('rejects selected issues with hard inbound dependencies outside the selection', () => {
    expect(() =>
      buildIssueGroupExecutionPreview({
        selectedIssueIds: ['issue-3'],
        nodes,
        edges: [{ sourceIssueId: 'issue-1', targetIssueId: 'issue-3', edgeType: 'blocks' }],
      }),
    ).toThrow(/unresolved dependencies/i);
  });

  it('allows independent parallel roots', () => {
    const preview = buildIssueGroupExecutionPreview({
      selectedIssueIds: ['issue-1', 'issue-2'],
      nodes,
      edges: [],
    });

    expect(preview.groups).toEqual([['issue-1', 'issue-2']]);
  });
});

describe('createIssueGroupRunState', () => {
  it('releases downstream issues only after selected prerequisites complete successfully', () => {
    const state = createIssueGroupRunState({
      selectedIssueIds: ['issue-1', 'issue-2', 'issue-3'],
      nodes,
      edges: [
        { sourceIssueId: 'issue-1', targetIssueId: 'issue-3', edgeType: 'blocks' },
        { sourceIssueId: 'issue-2', targetIssueId: 'issue-3', edgeType: 'depends_on' },
      ],
    });

    expect(state.getReadyIssueIds()).toEqual(['issue-1', 'issue-2']);
    expect(state.markIssueCompleted('issue-1', true)).toEqual([]);
    expect(state.markIssueCompleted('issue-2', false)).toEqual([]);
    expect(state.getBlockedIssueIds()).toEqual(['issue-3']);
    expect(state.markIssueCompleted('issue-2', true)).toEqual(['issue-3']);
  });

  it('preserves preview order when returning ready issues', () => {
    const state = createIssueGroupRunState({
      selectedIssueIds: ['issue-4', 'issue-2', 'issue-1', 'issue-3'],
      nodes,
      edges: [
        { sourceIssueId: 'issue-1', targetIssueId: 'issue-3', edgeType: 'blocks' },
        { sourceIssueId: 'issue-2', targetIssueId: 'issue-4', edgeType: 'depends_on' },
        { sourceIssueId: 'issue-3', targetIssueId: 'issue-4', edgeType: 'blocks' },
      ],
    });

    expect(state.getReadyIssueIds()).toEqual(['issue-1', 'issue-2']);
    expect(state.markIssueCompleted('issue-2', true)).toEqual([]);
    expect(state.markIssueCompleted('issue-1', true)).toEqual(['issue-3']);
  });
});
