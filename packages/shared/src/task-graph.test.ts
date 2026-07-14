import { describe, expect, it } from 'vitest';
import {
  assessPlanScope,
  buildTaskGraphDraftFromPlan,
  buildTaskNodePlan,
  formatTaskGraphChecklist,
  formatTaskGraphExecutionContract,
  formatTaskNodeIssueBody,
  inferTaskSurfaces,
  isExternalSideEffectCriterion,
  pickTaskAgentRole,
  suggestedReasoningForTask,
  TASK_GRAPH_COMMENT_MARKER,
  type TaskGraphMode,
  type TaskGraphWithNodes,
  workspaceVerifiableCriteria,
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

  it('handles omitted files and text inputs', () => {
    expect(inferTaskSurfaces({})).toEqual(['general']);
  });

  it('sorts general after known surfaces when mixed with direct helper input', () => {
    expect(
      inferTaskSurfaces({ files: ['README.md', 'unknown.file'], text: 'general docs' }),
    ).toEqual(['docs']);
  });
});

describe('task role and reasoning helpers', () => {
  it('falls back to the general role when no ordered surface is present', () => {
    expect(pickTaskAgentRole([])).toBe('general');
  });

  it('selects reasoning effort from risk and task surfaces', () => {
    expect(suggestedReasoningForTask(['frontend'], 0.8)).toBe('high');
    expect(suggestedReasoningForTask(['backend'], 0.1)).toBe('medium');
    expect(suggestedReasoningForTask(['infra'], 0.1)).toBe('medium');
    expect(suggestedReasoningForTask(['docs', 'tests'], 0.1)).toBe('low');
    expect(suggestedReasoningForTask(['frontend'], 0.1)).toBe('medium');
  });
});

describe('assessPlanScope', () => {
  it('keeps required three-step low-risk plans on the smart fast direct path', () => {
    const threeStepPlan = plan({
      steps: [
        {
          order: 1,
          description: 'Update copy',
          files: ['apps/desktop/src/renderer/components/Settings.tsx'],
          rationale: 'Matches request',
        },
        {
          order: 2,
          description: 'Adjust empty state',
          files: ['apps/desktop/src/renderer/components/Settings.tsx'],
          rationale: 'Same surface',
        },
        {
          order: 3,
          description: 'Run focused test',
          files: ['apps/desktop/src/renderer/components/Settings.tsx'],
          rationale: 'Verify behavior',
        },
      ],
    });

    expect(assessPlanScope(threeStepPlan).mode).toBe('direct');
    expect(assessPlanScope(threeStepPlan, { speedProfile: 'thorough' }).mode).toBe('internal');
    expect(assessPlanScope(plan(), { speedProfile: 'thorough' }).mode).toBe('direct');
  });

  it('still decomposes sensitive surfaces on the smart fast profile', () => {
    expect(
      assessPlanScope(
        plan({
          objective: 'Rotate webhook secret handling',
          files: [
            {
              path: 'packages/db/src/schema.ts',
              action: 'modify',
              description: 'token storage',
            },
          ],
          steps: [
            {
              order: 1,
              description: 'Update encrypted token schema',
              files: ['packages/db/src/schema.ts'],
              rationale: 'Security sensitive',
            },
            {
              order: 2,
              description: 'Wire token migration',
              files: ['packages/db/src/schema.ts'],
              rationale: 'Database change',
            },
            {
              order: 3,
              description: 'Cover token behavior',
              files: ['packages/db/src/schema.ts'],
              rationale: 'Regression coverage',
            },
          ],
        }),
      ).mode,
    ).toBe('internal');
  });

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

  it('uses individual thorough thresholds for subissue and internal decomposition', () => {
    expect(
      assessPlanScope(
        plan({
          files: Array.from({ length: 10 }, (_, index) => ({
            path: `packages/shared/src/file-${index}.ts`,
            action: 'modify' as const,
            description: 'shared',
          })),
          steps: [
            {
              order: 1,
              description: 'Update shared module',
              files: ['packages/shared/src/file-1.ts'],
              rationale: 'Same surface',
            },
          ],
        }),
        { speedProfile: 'thorough' },
      ).mode,
    ).toBe('github-subissues');

    expect(
      assessPlanScope(
        plan({
          files: [
            { path: 'packages/shared/src/a.ts', action: 'modify', description: 'a' },
            { path: 'packages/shared/src/b.ts', action: 'modify', description: 'b' },
            { path: 'packages/shared/src/c.ts', action: 'modify', description: 'c' },
            { path: 'packages/shared/src/d.ts', action: 'modify', description: 'd' },
          ],
          steps: [
            {
              order: 1,
              description: 'Update shared module',
              files: ['packages/shared/src/a.ts'],
              rationale: 'Same surface',
            },
          ],
        }),
        { speedProfile: 'thorough' },
      ).mode,
    ).toBe('internal');

    expect(
      assessPlanScope(
        plan({
          files: [
            { path: 'apps/web/src/page.tsx', action: 'modify', description: 'ui' },
            { path: 'packages/agents/src/api.ts', action: 'modify', description: 'api' },
          ],
          steps: [
            {
              order: 1,
              description: 'Update broad feature',
              files: ['apps/web/src/page.tsx'],
              rationale: 'Multiple surfaces',
            },
          ],
        }),
        { speedProfile: 'thorough' },
      ).mode,
    ).toBe('internal');
  });
});

describe('buildTaskGraphDraftFromPlan', () => {
  it('builds a direct single-node graph with default criteria and clamped title', () => {
    const draft = buildTaskGraphDraftFromPlan(
      plan({
        objective:
          'Update the settings language with a very long objective that should be shortened for task display',
        files: [],
        steps: [],
        acceptanceCriteria: [],
      }),
    );

    expect(draft.assessment.mode).toBe('direct');
    expect(draft.nodes).toMatchObject([
      {
        stableKey: 'task-1',
        order: 1,
        status: 'ready',
        description:
          'Update the settings language with a very long objective that should be shortened for task display',
        files: [],
        acceptanceCriteria: [
          'Plan objective is satisfied: Update the settings language with a very long objective that should be shortened for task display',
        ],
      },
    ]);
    expect(draft.nodes[0].title).toBe(
      'Update the settings language with a very long objective that should be shorte...',
    );
    expect(draft.edges).toEqual([]);
  });

  it('uses direct plan step descriptions when a direct graph still has steps', () => {
    const draft = buildTaskGraphDraftFromPlan(
      plan({
        steps: [
          {
            order: 1,
            description: 'Update copy',
            files: ['apps/desktop/src/renderer/components/Settings.tsx'],
            rationale: 'Small copy tweak',
          },
        ],
      }),
    );

    expect(draft.assessment.mode).toBe('direct');
    expect(draft.nodes[0].description).toBe('Update copy');
  });

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

  it('falls back to plan files and per-step criteria for decomposed nodes', () => {
    const draft = buildTaskGraphDraftFromPlan(
      plan({
        files: [
          { path: 'packages/shared/src/types.ts', action: 'modify', description: 'types' },
          { path: 'packages/shared/src/types.test.ts', action: 'modify', description: 'tests' },
          { path: 'packages/shared/src/task-graph.ts', action: 'modify', description: 'graph' },
          { path: 'packages/shared/src/task-graph.test.ts', action: 'modify', description: 'test' },
        ],
        steps: [
          {
            order: 2,
            description: 'Cover graph tests',
            files: [],
            rationale: '',
          },
          {
            order: 1,
            description: 'Update shared types',
            files: ['packages/shared/src/types.ts'],
            rationale: '',
          },
        ],
        acceptanceCriteria: ['packages/shared/src/types.ts handles new task state'],
        estimatedComplexity: 'medium',
      }),
    );

    expect(draft.nodes.map((node) => node.stableKey)).toEqual(['step-1', 'step-2']);
    expect(draft.nodes[0].description).toBe('Update shared types');
    expect(draft.nodes[0].acceptanceCriteria).toEqual([
      'Step 1 completed: Update shared types',
      'packages/shared/src/types.ts handles new task state',
    ]);
    expect(draft.nodes[1].files).toEqual([
      'packages/shared/src/task-graph.test.ts',
      'packages/shared/src/task-graph.ts',
      'packages/shared/src/types.test.ts',
      'packages/shared/src/types.ts',
    ]);
  });

  it('excludes external-side-effect criteria (Workpad / GitHub writes) from node criteria (#394)', () => {
    const draft = buildTaskGraphDraftFromPlan(
      plan({
        objective: 'Add the exporter',
        files: [],
        steps: [],
        acceptanceCriteria: [
          'src/index.ts exports the new function',
          'Update the single GitHub issue #42 ShipCode Workpad comment in place',
        ],
      }),
    );

    expect(draft.assessment.mode).toBe('direct');
    expect(draft.nodes[0].acceptanceCriteria).toEqual(['src/index.ts exports the new function']);
  });

  it('falls back to the objective when every plan criterion is an external side effect', () => {
    const draft = buildTaskGraphDraftFromPlan(
      plan({
        objective: 'Add the exporter',
        files: [],
        steps: [],
        acceptanceCriteria: ['Post a comment on the GitHub issue confirming completion'],
      }),
    );

    expect(draft.nodes[0].acceptanceCriteria).toEqual([
      'Plan objective is satisfied: Add the exporter',
    ]);
  });
});

describe('isExternalSideEffectCriterion', () => {
  it('flags GitHub / network / Workpad criteria', () => {
    for (const criterion of [
      'Update the single GitHub issue #42 ShipCode Workpad comment in place',
      'Post a comment on the pull request',
      'Run `gh issue view 42` and confirm the body',
      'Push the branch to origin via git push',
      'Close the GitHub issue when done',
      'Fetch the release from api.github.com',
    ]) {
      expect(isExternalSideEffectCriterion(criterion)).toBe(true);
    }
  });

  it('leaves workspace-verifiable criteria untouched', () => {
    for (const criterion of [
      'src/index.ts exports parseConfig',
      'Tests in foo.test.ts exercise the empty-input path',
      'The build produces no type errors',
      'A new migration file is added under packages/db/migrations',
    ]) {
      expect(isExternalSideEffectCriterion(criterion)).toBe(false);
    }
  });
});

describe('workspaceVerifiableCriteria', () => {
  it('drops external criteria and keeps workspace ones', () => {
    expect(
      workspaceVerifiableCriteria(
        ['src/a.ts compiles', 'Update the issue Workpad comment'],
        'Node title',
      ),
    ).toEqual(['src/a.ts compiles']);
  });

  it('returns a generic fallback when everything was external', () => {
    expect(workspaceVerifiableCriteria(['Post an issue comment'], 'Implement the exporter')).toEqual(
      ["The diff implements the node's described change: Implement the exporter"],
    );
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

  it('creates placeholder file entries for node files missing from the parent plan', () => {
    const parent = plan({
      files: [{ path: 'packages/db/src/schema.ts', action: 'modify', description: 'schema' }],
      outOfScope: ['Other task graph nodes are out of scope for this executor pass.'],
    });
    const node = {
      id: 'node-2',
      graphId: 'graph-1',
      stableKey: 'step-2',
      order: 2,
      title: 'Wire runtime',
      description: 'Add runtime integration',
      status: 'ready',
      files: ['packages/pipeline/src/pipeline.ts'],
      acceptanceCriteria: ['Runtime is wired'],
      surfaces: ['backend'],
      agentRole: 'backend',
      suggestedExecutorModel: null,
      suggestedReasoningEffort: 'medium',
      githubIssueNumber: null,
      startedAt: null,
      completedAt: null,
      createdAt: '',
      updatedAt: '',
    } satisfies TaskGraphWithNodes['nodes'][number];

    const narrowed = buildTaskNodePlan(parent, node);

    expect(narrowed.files).toEqual([
      {
        path: 'packages/pipeline/src/pipeline.ts',
        action: 'modify',
        description: 'File touched by task node step-2: Wire runtime',
      },
    ]);
    expect(narrowed.outOfScope).toEqual([
      'Other task graph nodes are out of scope for this executor pass.',
    ]);
  });
});

describe('formatTaskGraphChecklist', () => {
  it('returns an empty checklist for graphs without nodes', () => {
    const graph = {
      id: 'graph-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      mode: 'internal',
      status: 'active',
      riskScore: 0,
      assessment: {
        mode: 'internal',
        shouldDecompose: true,
        riskScore: 0,
        reasons: [],
        suggestedNodeCount: 0,
        surfaces: ['general'],
      },
      createdAt: '',
      updatedAt: '',
      nodes: [],
      edges: [],
    } satisfies TaskGraphWithNodes;

    expect(formatTaskGraphChecklist(graph)).toBe('');
  });

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
          id: 'node-2',
          graphId: 'graph-1',
          stableKey: 'step-2',
          order: 2,
          title: 'Second',
          description: 'Second',
          status: 'pending',
          files: [],
          acceptanceCriteria: [],
          surfaces: [],
          agentRole: 'general',
          suggestedExecutorModel: null,
          suggestedReasoningEffort: 'medium',
          githubIssueNumber: null,
          startedAt: null,
          completedAt: null,
          createdAt: '',
          updatedAt: '',
        },
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
    expect(body).toContain('- [ ] step-2: Second');
    expect(body).toContain('`completed`');
    expect(body).toContain('#99');
  });

  it('renders unchecked running checklist rows without optional metadata', () => {
    const graph = {
      id: 'graph-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      mode: 'internal',
      status: 'active',
      riskScore: 0.2,
      assessment: {
        mode: 'internal',
        shouldDecompose: true,
        riskScore: 0.2,
        reasons: [],
        suggestedNodeCount: 1,
        surfaces: ['general'],
      },
      createdAt: '',
      updatedAt: '',
      nodes: [
        {
          id: 'node-1',
          graphId: 'graph-1',
          stableKey: 'step-1',
          order: 1,
          title: 'Run task',
          description: 'Run task',
          status: 'running',
          files: [],
          acceptanceCriteria: [],
          surfaces: [],
          agentRole: 'general',
          suggestedExecutorModel: null,
          suggestedReasoningEffort: 'medium',
          githubIssueNumber: null,
          startedAt: null,
          completedAt: null,
          createdAt: '',
          updatedAt: '',
        },
      ],
      edges: [],
    } satisfies TaskGraphWithNodes;

    expect(formatTaskGraphChecklist(graph)).toContain('- [ ] step-1: Run task (`running`)');
  });
});

describe('formatTaskGraphExecutionContract', () => {
  it('returns an empty contract when there is no multi-node graph', () => {
    expect(formatTaskGraphExecutionContract(null)).toBe('');
    expect(
      formatTaskGraphExecutionContract({
        id: 'graph-1',
        threadId: 'thread-1',
        planId: 'plan-1',
        mode: 'direct',
        status: 'active',
        riskScore: 0,
        assessment: {
          mode: 'direct',
          shouldDecompose: false,
          riskScore: 0,
          reasons: ['Contained'],
          suggestedNodeCount: 1,
          surfaces: ['general'],
        },
        createdAt: '',
        updatedAt: '',
        nodes: [
          {
            id: 'node-1',
            graphId: 'graph-1',
            stableKey: 'task-1',
            order: 1,
            title: 'Only node',
            description: 'Only node',
            status: 'ready',
            files: [],
            acceptanceCriteria: [],
            surfaces: [],
            agentRole: 'general',
            suggestedExecutorModel: null,
            suggestedReasoningEffort: 'medium',
            githubIssueNumber: null,
            startedAt: null,
            completedAt: null,
            createdAt: '',
            updatedAt: '',
          },
        ],
        edges: [],
      }),
    ).toBe('');
  });

  it('renders nodes, edges, fallbacks, and the active-node block', () => {
    const graph = {
      id: 'graph-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      mode: 'internal',
      status: 'active',
      riskScore: 0.5,
      assessment: {
        mode: 'internal',
        shouldDecompose: true,
        riskScore: 0.5,
        reasons: ['Cross-surface task'],
        suggestedNodeCount: 2,
        surfaces: ['backend'],
      },
      createdAt: '',
      updatedAt: '',
      nodes: [
        {
          id: 'node-2',
          graphId: 'graph-1',
          stableKey: 'step-2',
          order: 2,
          title: 'Verify behavior',
          description: 'Run tests',
          status: 'pending',
          files: [],
          acceptanceCriteria: [],
          surfaces: [],
          agentRole: 'tests',
          suggestedExecutorModel: null,
          suggestedReasoningEffort: 'low',
          githubIssueNumber: null,
          startedAt: null,
          completedAt: null,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'node-1',
          graphId: 'graph-1',
          stableKey: 'step-1',
          order: 1,
          title: 'Implement backend',
          description: 'Wire API',
          status: 'ready',
          files: ['packages/agents/src/api.ts'],
          acceptanceCriteria: ['API returns task graph data'],
          surfaces: ['backend'],
          agentRole: 'backend',
          suggestedExecutorModel: null,
          suggestedReasoningEffort: 'medium',
          githubIssueNumber: null,
          startedAt: null,
          completedAt: null,
          createdAt: '',
          updatedAt: '',
        },
      ],
      edges: [
        {
          id: 'edge-1',
          graphId: 'graph-1',
          sourceNodeId: 'missing-source',
          targetNodeId: 'missing-node',
          edgeType: 'depends_on',
          createdAt: '',
        },
      ],
    } satisfies TaskGraphWithNodes;

    const body = formatTaskGraphExecutionContract(graph, { activeNode: graph.nodes[1] });

    expect(body).toContain('<task_graph_execution_contract>');
    expect(body).toContain(
      '- step-1: Implement backend [ready ACTIVE; agent=backend; reasoning=medium surfaces=backend files=packages/agents/src/api.ts]',
    );
    expect(body).toContain('- step-2: Verify behavior [pending; agent=tests; reasoning=low]');
    expect(body).toContain('- missing-source -> missing-node (depends_on)');
    expect(body).toContain('- Files: packages/agents/src/api.ts');
    expect(body).toContain('  - API returns task graph data');
  });

  it('renders no-edge and empty-active-node fallbacks', () => {
    const graph = {
      id: 'graph-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      mode: 'internal',
      status: 'active',
      riskScore: 0.2,
      assessment: {
        mode: 'internal',
        shouldDecompose: true,
        riskScore: 0.2,
        reasons: ['2 planned steps'],
        suggestedNodeCount: 2,
        surfaces: ['docs'],
      },
      createdAt: '',
      updatedAt: '',
      nodes: [
        {
          id: 'node-1',
          graphId: 'graph-1',
          stableKey: 'step-1',
          order: 1,
          title: 'Draft docs',
          description: 'Docs',
          status: 'ready',
          files: [],
          acceptanceCriteria: [],
          surfaces: [],
          agentRole: 'docs',
          suggestedExecutorModel: null,
          suggestedReasoningEffort: 'low',
          githubIssueNumber: null,
          startedAt: null,
          completedAt: null,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'node-2',
          graphId: 'graph-1',
          stableKey: 'step-2',
          order: 2,
          title: 'Review docs',
          description: 'Review',
          status: 'pending',
          files: [],
          acceptanceCriteria: [],
          surfaces: [],
          agentRole: 'docs',
          suggestedExecutorModel: null,
          suggestedReasoningEffort: 'low',
          githubIssueNumber: null,
          startedAt: null,
          completedAt: null,
          createdAt: '',
          updatedAt: '',
        },
      ],
      edges: [],
    } satisfies TaskGraphWithNodes;

    const body = formatTaskGraphExecutionContract(graph, { activeNode: graph.nodes[0] });

    expect(body).toContain('Edges:\n- none');
    expect(body).toContain('- Surfaces: ');
    expect(body).toContain('- Files: none listed');
    expect(body).toContain('- Acceptance criteria:\n');
  });

  it('renders a multi-node contract without an active node block', () => {
    const graph = {
      id: 'graph-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      mode: 'internal',
      status: 'active',
      riskScore: 0.2,
      assessment: {
        mode: 'internal',
        shouldDecompose: true,
        riskScore: 0.2,
        reasons: ['2 planned steps'],
        suggestedNodeCount: 2,
        surfaces: ['general'],
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
          status: 'ready',
          files: [],
          acceptanceCriteria: [],
          surfaces: [],
          agentRole: 'general',
          suggestedExecutorModel: null,
          suggestedReasoningEffort: 'medium',
          githubIssueNumber: null,
          startedAt: null,
          completedAt: null,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'node-2',
          graphId: 'graph-1',
          stableKey: 'step-2',
          order: 2,
          title: 'Second',
          description: 'Second',
          status: 'pending',
          files: [],
          acceptanceCriteria: [],
          surfaces: [],
          agentRole: 'general',
          suggestedExecutorModel: null,
          suggestedReasoningEffort: 'medium',
          githubIssueNumber: null,
          startedAt: null,
          completedAt: null,
          createdAt: '',
          updatedAt: '',
        },
      ],
      edges: [],
    } satisfies TaskGraphWithNodes;

    const body = formatTaskGraphExecutionContract(graph);

    expect(body).toContain('Edges:\n- none');
    expect(body).not.toContain('Active node:');
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

  it('renders issue-body fallbacks for empty node fields', () => {
    const graph = {
      id: 'graph-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      mode: 'github-subissues',
      status: 'active',
      riskScore: 0.1,
      assessment: {
        mode: 'github-subissues',
        shouldDecompose: true,
        riskScore: 0.1,
        reasons: [],
        suggestedNodeCount: 1,
        surfaces: ['general'],
      },
      createdAt: '',
      updatedAt: '',
      nodes: [
        {
          id: 'node-1',
          graphId: 'graph-1',
          stableKey: 'step-1',
          order: 1,
          title: 'Fallback title',
          description: '   ',
          status: 'ready',
          files: [],
          acceptanceCriteria: [],
          surfaces: [],
          agentRole: 'general',
          suggestedExecutorModel: null,
          suggestedReasoningEffort: 'medium',
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

    expect(body).toContain('Surfaces: `general`');
    expect(body).toContain('\nFallback title\n');
    expect(body).toContain('\n- none\n');
    expect(body).toContain('- [ ] Node is complete');
  });
});
