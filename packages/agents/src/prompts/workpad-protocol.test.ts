import type { ShipCodePlan, TaskGraphWithNodes, TaskNodeRecord } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import { formatWorkpadComment, WORKPAD_MARKER, WORKPAD_SECTIONS } from './workpad-protocol';

function makePlan(overrides: Partial<ShipCodePlan> = {}): ShipCodePlan {
  return {
    id: 'plan-1',
    threadId: 'thread-1',
    version: 1,
    objective: 'Ship the thing',
    files: [{ path: 'src/index.ts', action: 'modify', description: 'wire it up' }],
    steps: [
      {
        order: 1,
        description: 'Foundation',
        files: ['src/index.ts'],
        rationale: 'contracts first',
      },
      { order: 2, description: 'Behavior', files: ['src/index.ts'], rationale: 'the feature' },
      { order: 3, description: 'Hardening', files: ['src/index.ts'], rationale: 'tests + polish' },
    ],
    acceptanceCriteria: ['Exports compile', 'Tests exercise the new behavior'],
    outOfScope: ['Unrelated refactors'],
    estimatedComplexity: 'medium',
    dependencies: [],
    ...overrides,
  };
}

function makeNode(overrides: Partial<TaskNodeRecord> = {}): TaskNodeRecord {
  return {
    id: 'node-1',
    graphId: 'graph-1',
    stableKey: 'step-1',
    order: 1,
    title: 'Foundation',
    description: 'Foundation',
    status: 'completed',
    files: ['src/index.ts'],
    acceptanceCriteria: ['Exports compile'],
    surfaces: ['general'],
    agentRole: 'general',
    suggestedExecutorModel: null,
    suggestedReasoningEffort: null,
    githubIssueNumber: null,
    ...overrides,
  } as TaskNodeRecord;
}

function makeGraph(overrides: Partial<TaskGraphWithNodes> = {}): TaskGraphWithNodes {
  return {
    id: 'graph-1',
    threadId: 'thread-1',
    planId: 'plan-1',
    mode: 'internal',
    status: 'active',
    riskScore: 0,
    nodes: [
      makeNode({ id: 'n1', stableKey: 'step-1', order: 1, status: 'completed' }),
      makeNode({ id: 'n2', stableKey: 'step-2', order: 2, status: 'ready', title: 'Behavior' }),
    ],
    edges: [],
    ...overrides,
  } as TaskGraphWithNodes;
}

describe('formatWorkpadComment', () => {
  it('starts with the canonical marker as the first line', () => {
    const body = formatWorkpadComment({ issueNumber: 42, plan: makePlan() });
    expect(body.startsWith(WORKPAD_MARKER)).toBe(true);
  });

  it('lists every required section', () => {
    const body = formatWorkpadComment({ issueNumber: 1, plan: makePlan(), graph: makeGraph() });
    for (const section of WORKPAD_SECTIONS) {
      expect(body).toContain(`### ${section}`);
    }
  });

  it('renders the plan objective and steps', () => {
    const body = formatWorkpadComment({ issueNumber: 1, plan: makePlan() });
    expect(body).toContain('**Objective:** Ship the thing');
    expect(body).toContain('1. Foundation');
    expect(body).toContain('3. Hardening');
  });

  it('renders acceptance criteria as a checklist', () => {
    const body = formatWorkpadComment({ issueNumber: 1, plan: makePlan() });
    expect(body).toContain('- [ ] Exports compile');
  });

  it('checks off criteria once the graph is completed', () => {
    const body = formatWorkpadComment({
      issueNumber: 1,
      plan: makePlan(),
      graph: makeGraph({ status: 'completed' }),
    });
    expect(body).toContain('- [x] Exports compile');
  });

  it('renders per-node validation status from the graph', () => {
    const body = formatWorkpadComment({ issueNumber: 1, plan: makePlan(), graph: makeGraph() });
    expect(body).toContain('`step-1`');
    expect(body).toContain('(completed)');
    expect(body).toContain('`step-2`');
    expect(body).toContain('(ready)');
  });

  it('shows an awaiting-execution note when no graph is provided', () => {
    const body = formatWorkpadComment({ issueNumber: 1, plan: makePlan() });
    expect(body).toContain('_Awaiting execution._');
  });

  it('embeds the environment stamp verbatim', () => {
    const body = formatWorkpadComment({
      issueNumber: 1,
      plan: makePlan(),
      envStamp: 'host:/tmp/wt@abc1234',
    });
    expect(body).toContain('`host:/tmp/wt@abc1234`');
  });

  it('falls back to a placeholder when no env stamp is given', () => {
    const body = formatWorkpadComment({ issueNumber: 1, plan: makePlan() });
    expect(body).toContain('(environment stamp pending)');
  });

  it('marks the workpad as pipeline-maintained', () => {
    const body = formatWorkpadComment({ issueNumber: 1, plan: makePlan() });
    expect(body).toMatch(/Maintained automatically by the ShipCode pipeline/i);
  });

  it('returns empty string when issueNumber is null', () => {
    expect(formatWorkpadComment({ issueNumber: null, plan: makePlan() })).toBe('');
  });

  it('returns empty string when issueNumber is undefined', () => {
    expect(formatWorkpadComment({ issueNumber: undefined, plan: makePlan() })).toBe('');
  });

  it('returns empty string for quick-task sentinels', () => {
    expect(formatWorkpadComment({ issueNumber: 0, plan: makePlan() })).toBe('');
    expect(formatWorkpadComment({ issueNumber: -1, plan: makePlan() })).toBe('');
    expect(formatWorkpadComment({ issueNumber: -42, plan: makePlan() })).toBe('');
  });

  it('truncates an oversized plan section but keeps acceptance criteria', () => {
    const huge = 'x'.repeat(70_000);
    const body = formatWorkpadComment({
      issueNumber: 1,
      plan: makePlan({
        steps: [
          { order: 1, description: huge, files: ['src/index.ts'], rationale: 'r' },
          { order: 2, description: 'Behavior', files: ['src/index.ts'], rationale: 'r' },
          { order: 3, description: 'Hardening', files: ['src/index.ts'], rationale: 'r' },
        ],
      }),
    });
    expect(body).toContain('_(Truncated');
    expect(body).toContain('### Acceptance Criteria');
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(60_000);
  });
});
