import { describe, expect, it } from 'vitest';
import {
  assessPlanScope,
  buildTaskGraphDraftFromPlan,
  buildTaskNodePlan,
  formatTaskGraphChecklist,
  formatTaskNodeIssueBody,
  inferTaskSurfaces,
  TASK_GRAPH_COMMENT_MARKER,
  type TaskGraphMode,
  type TaskGraphWithNodes,
} from './task-graph';
import type { ShipCodePlan } from './types';

function plan(overrides: Partial<ShipCodePlan> = {}): ShipCodePlan {
  return {
    id: 'plan-1',
    threadId: 'thread-1',
    version: 1,
    objective: 'Fix settings copy',
    files: [
      {
        path: 'apps/desktop/src/renderer/components/Settings.tsx',
        action: 'modify',
        description: 'copy',
      },
    ],
    steps: [
      {
        order: 1,
        description: 'Update settings copy',
        files: ['apps/desktop/src/renderer/components/Settings.tsx'],
        rationale: 'Matches the issue request',
      },
    ],
    acceptanceCriteria: ['Settings copy is updated'],
    outOfScope: [],
    estimatedComplexity: 'low',
    dependencies: [],
    ...overrides,
  };
}

describe('inferTaskSurfaces', () => {
  it('classifies common implementation surfaces from files and text', () => {
    expect(
      inferTaskSurfaces({
        files: [
          'packages/db/src/schema.ts',
          'apps/desktop/src/renderer/App.tsx',
          '.github/workflows/ci.yml',
        ],
        text: 'Validate token permissions',
      }),
    ).toEqual(['security', 'database', 'frontend', 'infra']);
  });

  it('falls back to general when no specific surface matches', () => {
    expect(
      inferTaskSurfaces({ files: ['packages/shared/src/foo.ts'], text: 'rename helper' }),
    ).toEqual(['general']);
  });
});

describe('assessPlanScope', () => {
  it.each<[TaskGraphMode, ShipCodePlan]>([
    ['direct', plan()],
    [
      'internal',
      plan({
        files: [
          { path: 'packages/pipeline/src/pipeline.ts', action: 'modify', description: 'flow' },
          { path: 'packages/db/src/schema.ts', action: 'modify', description: 'schema' },
          { path: 'packages/shared/src/types.ts', action: 'modify', description: 'types' },
          {
            path: 'packages/pipeline/src/pipeline.test.ts',
            action: 'modify',
            description: 'tests',
          },
        ],
        steps: [
          {
            order: 1,
            description: 'Add schema',
            files: ['packages/db/src/schema.ts'],
            rationale: 'persist',
          },
          {
            order: 2,
            description: 'Add shared types',
            files: ['packages/shared/src/types.ts'],
            rationale: 'contract',
          },
          {
            order: 3,
            description: 'Wire pipeline',
            files: ['packages/pipeline/src/pipeline.ts'],
            rationale: 'runtime',
          },
        ],
        estimatedComplexity: 'medium',
      }),
    ],
    [
      'github-subissues',
      plan({
        objective: 'Add auth-backed billing portal with migrations and CI',
        files: [
          { path: 'packages/db/src/schema.ts', action: 'modify', description: 'schema' },
          { path: 'packages/agents/src/providers/auth.ts', action: 'create', description: 'auth' },
          { path: 'apps/desktop/src/renderer/Billing.tsx', action: 'create', description: 'ui' },
          {
            path: 'apps/desktop/src/main/ipc/register-billing.ts',
            action: 'create',
            description: 'ipc',
          },
          { path: '.github/workflows/ci.yml', action: 'modify', description: 'ci' },
          { path: 'docs/billing.mdx', action: 'create', description: 'docs' },
          { path: 'packages/shared/src/billing.test.ts', action: 'create', description: 'tests' },
        ],
        steps: Array.from({ length: 7 }, (_, index) => ({
          order: index + 1,
          description: `Step ${index + 1} handles token auth and billing surface`,
          files: ['packages/db/src/schema.ts'],
          rationale: 'Large feature',
        })),
        estimatedComplexity: 'high',
      }),
    ],
  ])('selects %s mode from plan shape', (expectedMode, input) => {
    expect(assessPlanScope(input).mode).toBe(expectedMode);
  });
});

describe('buildTaskGraphDraftFromPlan', () => {
  it('turns decomposed plan steps into ordered task nodes and dependency edges', () => {
    const draft = buildTaskGraphDraftFromPlan(
      plan({
        files: [
          { path: 'packages/db/src/schema.ts', action: 'modify', description: 'schema' },
          { path: 'packages/pipeline/src/pipeline.ts', action: 'modify', description: 'pipeline' },
          {
            path: 'packages/pipeline/src/pipeline.test.ts',
            action: 'modify',
            description: 'tests',
          },
          { path: 'packages/shared/src/types.ts', action: 'modify', description: 'types' },
        ],
        steps: [
          {
            order: 1,
            description: 'Create tables',
            files: ['packages/db/src/schema.ts'],
            rationale: 'Persist graph',
          },
          {
            order: 2,
            description: 'Wire pipeline',
            files: ['packages/pipeline/src/pipeline.ts'],
            rationale: 'Use graph',
          },
          {
            order: 3,
            description: 'Cover behavior',
            files: ['packages/pipeline/src/pipeline.test.ts'],
            rationale: 'Regression',
          },
        ],
        estimatedComplexity: 'medium',
      }),
    );

    expect(draft.assessment.mode).toBe('internal');
    expect(draft.nodes.map((node) => [node.stableKey, node.status])).toEqual([
      ['step-1', 'ready'],
      ['step-2', 'pending'],
      ['step-3', 'pending'],
    ]);
    expect(draft.edges.map((edge) => [edge.sourceStableKey, edge.targetStableKey])).toEqual([
      ['step-1', 'step-2'],
      ['step-2', 'step-3'],
    ]);
  });
});

describe('buildTaskNodePlan', () => {
  it('narrows a parent plan to the active task node', () => {
    const parent = plan({
      files: [
        { path: 'packages/db/src/schema.ts', action: 'modify', description: 'schema' },
        { path: 'packages/pipeline/src/pipeline.ts', action: 'modify', description: 'runtime' },
      ],
      outOfScope: ['Do not change UI'],
    });
    const node = {
      id: 'node-1',
      graphId: 'graph-1',
      stableKey: 'step-1',
      order: 1,
      title: 'Create tables',
      description: 'Add the task graph schema',
      status: 'ready',
      files: ['packages/db/src/schema.ts'],
      acceptanceCriteria: ['Schema exists'],
      surfaces: ['database'],
      agentRole: 'database',
      suggestedExecutorModel: null,
      suggestedReasoningEffort: 'high',
      githubIssueNumber: null,
      startedAt: null,
      completedAt: null,
      createdAt: '',
      updatedAt: '',
    } satisfies TaskGraphWithNodes['nodes'][number];

    const narrowed = buildTaskNodePlan(parent, node);

    expect(narrowed.id).toBe('plan-1:step-1');
    expect(narrowed.objective).toBe('Create tables');
    expect(narrowed.files.map((file) => file.path)).toEqual(['packages/db/src/schema.ts']);
    expect(narrowed.steps).toHaveLength(1);
    expect(narrowed.acceptanceCriteria).toEqual(['Schema exists']);
    expect(narrowed.outOfScope).toContain(
      'Other task graph nodes are out of scope for this executor pass.',
    );
  });
});

describe('formatTaskGraphChecklist', () => {
  it('renders a managed checklist marker and node statuses', () => {
    const graph = {
      id: 'graph-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      mode: 'internal',
      status: 'active',
      riskScore: 0.42,
      assessment: {
        mode: 'internal',
        shouldDecompose: true,
        riskScore: 0.42,
        reasons: ['3 planned steps'],
        suggestedNodeCount: 3,
        surfaces: ['backend'],
      },
      createdAt: '',
      updatedAt: '',
      nodes: [
        {
          id: 'node-1',
          graphId: 'graph-1',
          stableKey: 'step-1',
          order: 1,
          title: 'First',
          description: 'First',
          status: 'completed',
          files: [],
          acceptanceCriteria: [],
          surfaces: ['backend'],
          agentRole: 'backend',
          suggestedExecutorModel: null,
          suggestedReasoningEffort: 'medium',
          githubIssueNumber: 99,
          startedAt: null,
          completedAt: null,
          createdAt: '',
          updatedAt: '',
        },
      ],
      edges: [],
    } satisfies TaskGraphWithNodes;

    const body = formatTaskGraphChecklist(graph);

    expect(body.startsWith(TASK_GRAPH_COMMENT_MARKER)).toBe(true);
    expect(body).toContain('- [x] step-1: First');
    expect(body).toContain('`completed`');
    expect(body).toContain('#99');
  });
});

describe('formatTaskNodeIssueBody', () => {
  it('renders a managed child issue body linked to the parent issue', () => {
    const graph = {
      id: 'graph-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      mode: 'github-subissues',
      status: 'active',
      riskScore: 0.8,
      assessment: {
        mode: 'github-subissues',
        shouldDecompose: true,
        riskScore: 0.8,
        reasons: ['High risk'],
        suggestedNodeCount: 1,
        surfaces: ['security'],
      },
      createdAt: '',
      updatedAt: '',
      nodes: [
        {
          id: 'node-1',
          graphId: 'graph-1',
          stableKey: 'step-1',
          order: 1,
          title: 'Harden token flow',
          description: 'Validate token permissions',
          status: 'ready',
          files: ['packages/agents/src/auth.ts'],
          acceptanceCriteria: ['Token permissions are validated'],
          surfaces: ['security'],
          agentRole: 'security',
          suggestedExecutorModel: null,
          suggestedReasoningEffort: 'high',
          githubIssueNumber: null,
          startedAt: null,
          completedAt: null,
          createdAt: '',
          updatedAt: '',
        },
      ],
      edges: [],
    } satisfies TaskGraphWithNodes;

    const body = formatTaskNodeIssueBody({
      parentIssueNumber: 42,
      graph,
      node: graph.nodes[0],
    });

    expect(body).toContain('Parent issue: #42');
    expect(body).toContain('<!-- shipcode-task-node: managed tracking issue');
    expect(body).toContain('Specialist role: `security`');
    expect(body).toContain('- [ ] Token permissions are validated');
  });
});
