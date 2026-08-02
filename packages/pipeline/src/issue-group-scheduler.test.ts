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
    expect(preview.groups).toEqual([['issue-1', 'issue-2'], ['issue-3'], ['issue-4']]);
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

  it('drops unknown selected issues and ignores soft edges', () => {
    const preview = buildIssueGroupExecutionPreview({
      selectedIssueIds: ['missing', 'issue-2', 'issue-1'],
      nodes,
      edges: [
        { sourceIssueId: 'issue-1', targetIssueId: 'issue-2', edgeType: 'reference' },
        { sourceIssueId: 'missing', targetIssueId: 'issue-2', edgeType: 'reference' },
      ],
    });

    expect(preview.issueOrder).toEqual(['issue-1', 'issue-2']);
    expect(preview.groups).toEqual([['issue-1', 'issue-2']]);
  });
});

describe('createIssueGroupRunState', () => {
  it('releases downstream issues only after every selected prerequisite completes successfully', () => {
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
    expect(state.getBlockedIssueIds()).toEqual(['issue-3']);
    expect(state.isSettled()).toBe(false);

    expect(state.markIssueCompleted('issue-2', true)).toEqual(['issue-3']);
    expect(state.markIssueCompleted('issue-3', true)).toEqual([]);
    expect(state.isSettled()).toBe(true);
  });

  it('counts only the first terminal result per issue', () => {
    const state = createIssueGroupRunState({
      selectedIssueIds: ['issue-1', 'issue-2', 'issue-3'],
      nodes,
      edges: [
        { sourceIssueId: 'issue-1', targetIssueId: 'issue-3', edgeType: 'blocks' },
        { sourceIssueId: 'issue-2', targetIssueId: 'issue-3', edgeType: 'depends_on' },
      ],
    });

    expect(state.markIssueCompleted('issue-1', true)).toEqual([]);
    // Re-running issue-1 while issue-2 is still executing must not release
    // issue-3: its second completion is a no-op, not a second decrement.
    expect(state.markIssueCompleted('issue-1', true)).toEqual([]);
    expect(state.markIssueCompleted('issue-1', true)).toEqual([]);
    expect(state.getBlockedIssueIds()).toEqual(['issue-3']);
    expect(state.getReadyIssueIds()).toEqual(['issue-2']);

    expect(state.markIssueCompleted('issue-2', true)).toEqual(['issue-3']);
  });

  it('parks dependents of a failed prerequisite and settles the run', () => {
    const state = createIssueGroupRunState({
      selectedIssueIds: ['issue-1', 'issue-2', 'issue-3'],
      nodes,
      edges: [
        { sourceIssueId: 'issue-1', targetIssueId: 'issue-3', edgeType: 'blocks' },
        { sourceIssueId: 'issue-2', targetIssueId: 'issue-3', edgeType: 'depends_on' },
      ],
    });

    expect(state.markIssueCompleted('issue-1', false)).toEqual([]);
    expect(state.getAbandonedIssueIds()).toEqual(['issue-3']);
    expect(state.getBlockedIssueIds()).toEqual([]);
    expect(state.isSettled()).toBe(false);

    // issue-3 is parked, so the run settles once the last live issue reports.
    expect(state.markIssueCompleted('issue-2', true)).toEqual([]);
    expect(state.isSettled()).toBe(true);
  });

  it('parks the whole downstream subtree of a failure', () => {
    const state = createIssueGroupRunState({
      selectedIssueIds: ['issue-1', 'issue-3', 'issue-4'],
      nodes,
      edges: [
        { sourceIssueId: 'issue-1', targetIssueId: 'issue-3', edgeType: 'blocks' },
        { sourceIssueId: 'issue-3', targetIssueId: 'issue-4', edgeType: 'depends_on' },
      ],
    });

    expect(state.markIssueCompleted('issue-1', false)).toEqual([]);
    expect(state.getAbandonedIssueIds()).toEqual(['issue-3', 'issue-4']);
    expect(state.getReadyIssueIds()).toEqual([]);
    expect(state.isSettled()).toBe(true);
  });

  it('does not resume a settled group when a failed issue is re-run successfully', () => {
    const state = createIssueGroupRunState({
      selectedIssueIds: ['issue-1', 'issue-3'],
      nodes,
      edges: [{ sourceIssueId: 'issue-1', targetIssueId: 'issue-3', edgeType: 'blocks' }],
    });

    expect(state.markIssueCompleted('issue-1', false)).toEqual([]);
    expect(state.isSettled()).toBe(true);

    // The user re-runs issue-1 on its own. That is a fresh single-issue run —
    // it must not silently relaunch issue-3 on behalf of the dead group.
    expect(state.markIssueCompleted('issue-1', true)).toEqual([]);
    expect(state.getReadyIssueIds()).toEqual([]);
    expect(state.getAbandonedIssueIds()).toEqual(['issue-3']);
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

  it('sorts multiple newly ready downstream issues by preview order', () => {
    const state = createIssueGroupRunState({
      selectedIssueIds: ['issue-4', 'issue-3', 'issue-2', 'issue-1'],
      nodes,
      edges: [
        { sourceIssueId: 'issue-1', targetIssueId: 'issue-4', edgeType: 'blocks' },
        { sourceIssueId: 'issue-1', targetIssueId: 'issue-3', edgeType: 'blocks' },
      ],
    });

    expect(state.getReadyIssueIds()).toEqual(['issue-1', 'issue-2']);
    expect(state.markIssueCompleted('issue-1', true)).toEqual(['issue-3', 'issue-4']);
  });

  it('does not release dependents twice when the same success is reported again', () => {
    const state = createIssueGroupRunState({
      selectedIssueIds: ['issue-1', 'issue-2', 'issue-3'],
      nodes,
      edges: [
        { sourceIssueId: 'issue-1', targetIssueId: 'issue-3', edgeType: 'blocks' },
        { sourceIssueId: 'issue-2', targetIssueId: 'issue-3', edgeType: 'depends_on' },
      ],
    });

    expect(state.markIssueCompleted('issue-1', true)).toEqual([]);
    expect(state.markIssueCompleted('issue-1', true)).toEqual([]);
    expect(state.getBlockedIssueIds()).toEqual(['issue-3']);
    expect(state.markIssueCompleted('issue-2', true)).toEqual(['issue-3']);
  });

  it('settles the run when an unsuccessful prerequisite strands its dependents', () => {
    const state = createIssueGroupRunState({
      selectedIssueIds: ['issue-1', 'issue-3', 'issue-4'],
      nodes,
      edges: [
        { sourceIssueId: 'issue-1', targetIssueId: 'issue-3', edgeType: 'blocks' },
        { sourceIssueId: 'issue-3', targetIssueId: 'issue-4', edgeType: 'blocks' },
      ],
    });

    expect(state.isSettled()).toBe(false);
    expect(state.markIssueCompleted('issue-1', false)).toEqual([]);

    expect(state.getAbandonedIssueIds()).toEqual(['issue-3', 'issue-4']);
    expect(state.isSettled()).toBe(true);
  });

  it('ignores a later success for an issue that already settled as failed', () => {
    const state = createIssueGroupRunState({
      selectedIssueIds: ['issue-1', 'issue-3'],
      nodes,
      edges: [{ sourceIssueId: 'issue-1', targetIssueId: 'issue-3', edgeType: 'blocks' }],
    });

    state.markIssueCompleted('issue-1', false);
    expect(state.isSettled()).toBe(true);

    // First terminal result wins: a retry succeeding later must not resurrect a
    // settled run or auto-launch abandoned dependents — the user relaunches the
    // group explicitly instead.
    expect(state.markIssueCompleted('issue-1', true)).toEqual([]);
    expect(state.getAbandonedIssueIds()).toEqual(['issue-3']);
    expect(state.isSettled()).toBe(true);
  });

  it('settles once every selected issue completes successfully', () => {
    const state = createIssueGroupRunState({
      selectedIssueIds: ['issue-1', 'issue-3'],
      nodes,
      edges: [{ sourceIssueId: 'issue-1', targetIssueId: 'issue-3', edgeType: 'blocks' }],
    });

    state.markIssueCompleted('issue-1', true);
    expect(state.isSettled()).toBe(false);

    state.markIssueCompleted('issue-3', true);
    expect(state.isSettled()).toBe(true);
    expect(state.getAbandonedIssueIds()).toEqual([]);
  });

  it('handles empty selections and unknown completions', () => {
    const state = createIssueGroupRunState({
      selectedIssueIds: ['missing'],
      nodes,
      edges: [],
    });

    expect(state.getReadyIssueIds()).toEqual([]);
    expect(state.getBlockedIssueIds()).toEqual([]);
    expect(state.getAbandonedIssueIds()).toEqual([]);
    expect(state.markIssueCompleted('missing', true)).toEqual([]);
    expect(state.isSettled()).toBe(true);
  });
});
