import type { ExecutorModel, PipelineSpeedProfile, ReasoningEffort, ShipCodePlan } from './types';

export type TaskGraphMode = 'direct' | 'internal' | 'github-subissues';
export type TaskGraphStatus = 'active' | 'superseded' | 'completed' | 'failed';
export type TaskNodeStatus = 'ready' | 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
export type TaskEdgeType = 'depends_on' | 'blocks' | 'relates_to';
export type TaskSurface =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'security'
  | 'infra'
  | 'docs'
  | 'tests'
  | 'general';
export type TaskAgentRole = TaskSurface;

export interface TaskGraphAssessment {
  mode: TaskGraphMode;
  shouldDecompose: boolean;
  riskScore: number;
  reasons: string[];
  suggestedNodeCount: number;
  surfaces: TaskSurface[];
}

export interface TaskGraphAssessmentOptions {
  speedProfile?: PipelineSpeedProfile;
}

export interface TaskGraphBuildOptions extends TaskGraphAssessmentOptions {}

export interface TaskGraphDraft {
  assessment: TaskGraphAssessment;
  nodes: TaskNodeDraft[];
  edges: TaskEdgeDraft[];
}

export interface TaskNodeDraft {
  stableKey: string;
  order: number;
  title: string;
  description: string;
  status: TaskNodeStatus;
  files: string[];
  acceptanceCriteria: string[];
  surfaces: TaskSurface[];
  agentRole: TaskAgentRole;
  suggestedExecutorModel: ExecutorModel | null;
  suggestedReasoningEffort: ReasoningEffort;
  githubIssueNumber: number | null;
}

export interface TaskEdgeDraft {
  sourceStableKey: string;
  targetStableKey: string;
  edgeType: TaskEdgeType;
}

export interface TaskGraphRecord {
  id: string;
  threadId: string;
  planId: string;
  mode: TaskGraphMode;
  status: TaskGraphStatus;
  riskScore: number;
  assessment: TaskGraphAssessment;
  createdAt: string;
  updatedAt: string;
}

export interface TaskNodeRecord {
  id: string;
  graphId: string;
  stableKey: string;
  order: number;
  title: string;
  description: string;
  status: TaskNodeStatus;
  files: string[];
  acceptanceCriteria: string[];
  surfaces: TaskSurface[];
  agentRole: TaskAgentRole;
  suggestedExecutorModel: ExecutorModel | null;
  suggestedReasoningEffort: ReasoningEffort;
  githubIssueNumber: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEdgeRecord {
  id: string;
  graphId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: TaskEdgeType;
  createdAt: string;
}

export interface TaskGraphWithNodes extends TaskGraphRecord {
  nodes: TaskNodeRecord[];
  edges: TaskEdgeRecord[];
}

export const TASK_GRAPH_COMMENT_MARKER = '## ShipCode Task Graph';

/**
 * Patterns that mark an acceptance criterion as requiring an *external side
 * effect* — a GitHub write, a network call, a comment/PR post — rather than a
 * workspace-verifiable artifact (code, tests, files, build output).
 *
 * Executors run in a network-disabled sandbox and cannot reach GitHub or any
 * remote, so these criteria are structurally unsatisfiable from the workspace.
 * The pipeline main process owns all such writes (see the Workpad updater), so
 * they must never gate node execution or node verification. See #394.
 */
const EXTERNAL_SIDE_EFFECT_CRITERION_PATTERNS: RegExp[] = [
  // The pipeline's own canonical state-of-work comment.
  /workpad/i,
  // `gh` CLI reads/writes and network git.
  /\bgh\s+(?:issue|pr|api|repo|release|comment|auth|search)\b/i,
  /\bgit\s+(?:push|fetch|pull)\b/i,
  /api\.github\.com/i,
  /github\.com/i,
  // Issue / PR comment writes. Qualified with an issue/PR/GitHub token so this
  // never trips on a *code* comment ("update the code comment in src/a.ts").
  /\b(?:issue|pull request|\bpr\b|github)\b[^.\n]*\bcomment\b/i,
  /\bcomment\b[^.\n]*\bon\s+(?:the\s+|a\s+|an\s+)?(?:issue|pull request|\bpr\b|github)\b/i,
  // Issue / PR lifecycle writes that only make sense against GitHub.
  /\b(?:close|reopen|merge|label|assign)\b[^.\n]*\b(?:issue|pull request|\bpr\b)\b/i,
  /\b(?:open|create)\b[^.\n]*\bgithub\s+(?:issue|pull request|\bpr\b)\b/i,
];

/**
 * A criterion naming a concrete workspace artifact — a backticked identifier, a
 * source-file path, or a well-known root file. In a repo that itself builds GitHub
 * tooling, such criteria ("the `gh issue view` wrapper returns typed data", "the
 * README links to github.com/org/repo") are diff-verifiable even though they mention
 * gh/github/comment, so they must not be treated as external side effects.
 */
const CODE_ARTIFACT_SIGNAL =
  /`[^`]+`|\b[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|md|mdx|json|ya?ml|toml|css|scss|html|sh)\b|\b(?:README|CHANGELOG|LICENSE|Dockerfile|Makefile|tsconfig)\b/;

/**
 * Verbs denoting an actual GitHub write / network / command-execution action. When
 * present, the criterion really does require performing an external side effect
 * (e.g. "Run `gh issue view 42`"), so the code-artifact exemption above does not
 * apply. Kept deliberately broad: extra matches only *disable* the exemption, and a
 * criterion is still classified external only if it also matches a pattern below —
 * so this can never cause a false negative, only forgo a rescue.
 */
const EXTERNAL_ACTION_VERB =
  /\b(?:post|push|publish|open|creat|clos|merg|reopen|label|assign|upload|run|execute|invoke|call|fetch|send|sync)\w*/i;

/**
 * True when an acceptance criterion depends on an external side effect the
 * sandboxed executor cannot perform or the diff-only verifier cannot observe
 * (GitHub writes, network calls, issue/PR comment updates). Such criteria are
 * owned by the pipeline, not the executor, and must be excluded from node
 * verification.
 */
export function isExternalSideEffectCriterion(criterion: string): boolean {
  // Keep criteria that describe a concrete workspace artifact and don't call for a
  // GitHub write — they're verifiable from the diff even when they mention GitHub.
  // This narrows false positives without loosening detection of true external writes.
  if (CODE_ARTIFACT_SIGNAL.test(criterion) && !EXTERNAL_ACTION_VERB.test(criterion)) {
    return false;
  }
  return EXTERNAL_SIDE_EFFECT_CRITERION_PATTERNS.some((pattern) => pattern.test(criterion));
}

/**
 * Keep only workspace-verifiable acceptance criteria — the ones a verifier can
 * confirm from the diff alone. Returns the filtered list, or, when every
 * criterion was an external side effect, a single generic fallback so node
 * verification still has something meaningful to check.
 */
export function workspaceVerifiableCriteria(criteria: string[], nodeTitle: string): string[] {
  const kept = criteria.filter((criterion) => !isExternalSideEffectCriterion(criterion));
  if (kept.length > 0) return kept;
  return [`The diff implements the node's described change: ${nodeTitle}`];
}

export interface TaskGraphExecutionContractOptions {
  activeNode?: TaskNodeRecord | null;
}

export interface TaskNodeIssueBodyOptions {
  parentIssueNumber: number;
  graph: TaskGraphWithNodes;
  node: TaskNodeRecord;
}

const SURFACE_ORDER: TaskSurface[] = [
  'security',
  'database',
  'backend',
  'frontend',
  'infra',
  'tests',
  'docs',
  'general',
];

const FRONTEND_PATTERN =
  /(^|\/)(app|apps\/web|renderer|components|ui|pages|routes|styles?)\/|\.tsx$|\.jsx$|\.css$|\.scss$|tailwind/i;
const BACKEND_PATTERN =
  /(^|\/)(api|server|main|ipc|pipeline|agents|providers|commands|routes|controllers|services)\//i;
const DATABASE_PATTERN = /(^|\/)(db|database|migrations|queries|schema)\//i;
const SECURITY_PATTERN =
  /\b(auth|oauth|token|secret|credential|permission|permissions|rbac|csrf|xss|sql injection|injection|sanitize|encrypt|decrypt|signature|webhook)\b/i;
const INFRA_PATTERN = /(^|\/)(\.github|scripts|docker|infra|config)\//i;
const INFRA_FILE_PATTERN =
  /(^|\/)(package\.json|bun\.lock|turbo\.json|tsconfig[^/]*\.json|vite\.config|vitest\.config|biome\.json|Dockerfile|docker-compose\.ya?ml)$/i;
const DOCS_PATTERN = /(^|\/)(docs|README|CHANGELOG)|\.(md|mdx)$/i;
const TEST_PATTERN = /(\.|\/)(test|spec)\.[cm]?[tj]sx?$|(^|\/)(__tests__|tests)\//i;

function uniqueSorted<T extends string>(values: Iterable<T>, order?: readonly T[]): T[] {
  const set = new Set(values);
  const items = [...set];
  if (!order) return items.sort();
  return items.sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return ai - bi;
  });
}

function clampTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 80) return normalized;
  return `${normalized.slice(0, 77).trimEnd()}...`;
}

function riskClamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

export function inferTaskSurfaces(input: {
  files?: readonly string[];
  text?: string | null;
}): TaskSurface[] {
  const surfaces = new Set<TaskSurface>();
  const files = input.files ?? [];
  const text = input.text ?? '';
  const searchable = `${files.join('\n')}\n${text}`;

  if (files.some((file) => FRONTEND_PATTERN.test(file)) || FRONTEND_PATTERN.test(text)) {
    surfaces.add('frontend');
  }
  if (files.some((file) => BACKEND_PATTERN.test(file)) || BACKEND_PATTERN.test(text)) {
    surfaces.add('backend');
  }
  if (files.some((file) => DATABASE_PATTERN.test(file)) || DATABASE_PATTERN.test(text)) {
    surfaces.add('database');
  }
  if (SECURITY_PATTERN.test(searchable)) {
    surfaces.add('security');
  }
  if (
    files.some((file) => INFRA_PATTERN.test(file) || INFRA_FILE_PATTERN.test(file)) ||
    INFRA_PATTERN.test(text) ||
    INFRA_FILE_PATTERN.test(text)
  ) {
    surfaces.add('infra');
  }
  if (files.some((file) => DOCS_PATTERN.test(file)) || DOCS_PATTERN.test(text)) {
    surfaces.add('docs');
  }
  if (files.some((file) => TEST_PATTERN.test(file)) || TEST_PATTERN.test(text)) {
    surfaces.add('tests');
  }

  if (surfaces.size === 0) surfaces.add('general');
  return uniqueSorted(surfaces, SURFACE_ORDER);
}

export function pickTaskAgentRole(surfaces: readonly TaskSurface[]): TaskAgentRole {
  for (const surface of SURFACE_ORDER) {
    if (surfaces.includes(surface)) return surface;
  }
  return 'general';
}

export function suggestedReasoningForTask(
  surfaces: readonly TaskSurface[],
  riskScore: number,
): ReasoningEffort {
  if (riskScore >= 0.75 || surfaces.includes('security') || surfaces.includes('database')) {
    return 'high';
  }
  if (riskScore >= 0.45 || surfaces.includes('backend') || surfaces.includes('infra')) {
    return 'medium';
  }
  if (surfaces.every((surface) => surface === 'docs' || surface === 'tests')) {
    return 'low';
  }
  return 'medium';
}

export function assessPlanScope(
  plan: ShipCodePlan,
  options: TaskGraphAssessmentOptions = {},
): TaskGraphAssessment {
  const speedProfile = options.speedProfile ?? 'smart_fast';
  const thorough = speedProfile === 'thorough';
  const stepCount = plan.steps.length;
  const files = uniqueSorted([
    ...plan.files.map((file) => file.path),
    ...plan.steps.flatMap((step) => step.files),
  ]);
  const fileCount = files.length;
  const surfaces = inferTaskSurfaces({
    files,
    text: `${plan.objective}\n${plan.steps.map((step) => step.description).join('\n')}`,
  });
  const reasons: string[] = [];
  let risk = 0;

  if (plan.estimatedComplexity === 'medium') {
    risk += 0.15;
    reasons.push('Planner estimated medium complexity');
  } else if (plan.estimatedComplexity === 'high') {
    risk += 0.3;
    reasons.push('Planner estimated high complexity');
  }

  if (thorough && stepCount > 2) {
    risk += Math.min(0.25, (stepCount - 2) * 0.05);
    reasons.push(`${stepCount} planned steps`);
  }
  if (fileCount > 3) {
    risk += Math.min(0.25, (fileCount - 3) * 0.035);
    reasons.push(`${fileCount} touched files`);
  }
  if (surfaces.length > 1) {
    risk += Math.min(0.2, (surfaces.length - 1) * 0.08);
    reasons.push(`Cross-surface task: ${surfaces.join(', ')}`);
  }
  if (surfaces.includes('security')) {
    risk += 0.2;
    reasons.push('Security-sensitive surface');
  }
  if (surfaces.includes('database')) {
    risk += 0.15;
    reasons.push('Database/schema surface');
  }
  if (surfaces.includes('infra')) {
    risk += 0.1;
    reasons.push('Build or infrastructure surface');
  }

  const riskScore = riskClamp(risk);
  let mode: TaskGraphMode = 'direct';
  if (thorough) {
    if (riskScore >= 0.75 || stepCount >= 7 || fileCount >= 10 || surfaces.length >= 4) {
      mode = 'github-subissues';
    } else if (riskScore >= 0.35 || stepCount > 2 || fileCount > 3 || surfaces.length > 1) {
      mode = 'internal';
    }
  } else if (riskScore >= 0.75 || fileCount >= 10 || surfaces.length >= 4) {
    mode = 'github-subissues';
  } else if (
    riskScore >= 0.35 ||
    plan.estimatedComplexity === 'high' ||
    fileCount > 3 ||
    surfaces.length > 1 ||
    surfaces.includes('security') ||
    surfaces.includes('database') ||
    surfaces.includes('infra')
  ) {
    mode = 'internal';
  }

  if (reasons.length === 0) {
    reasons.push('Contained plan with one low-risk execution surface');
  }

  return {
    mode,
    shouldDecompose: mode !== 'direct',
    riskScore,
    reasons,
    suggestedNodeCount: mode === 'direct' ? 1 : Math.max(1, stepCount),
    surfaces,
  };
}

export function buildTaskGraphDraftFromPlan(
  plan: ShipCodePlan,
  options: TaskGraphBuildOptions = {},
): TaskGraphDraft {
  const assessment = assessPlanScope(plan, options);
  const planFiles = uniqueSorted(plan.files.map((file) => file.path));
  // Drop external-side-effect criteria (GitHub writes, Workpad, network) before
  // they can be baked into a node — the sandboxed executor can never satisfy
  // them and the diff-only verifier can never observe them (#394). The pipeline
  // owns those writes.
  const workspaceCriteria = plan.acceptanceCriteria.filter(
    (criterion) => !isExternalSideEffectCriterion(criterion),
  );
  const allCriteria = workspaceCriteria.length
    ? workspaceCriteria
    : [`Plan objective is satisfied: ${plan.objective}`];

  const nodes: TaskNodeDraft[] =
    assessment.mode === 'direct'
      ? [
          buildNodeDraft({
            stableKey: 'task-1',
            order: 1,
            title: plan.objective,
            description: plan.steps.map((step) => step.description).join('\n') || plan.objective,
            files: planFiles,
            acceptanceCriteria: allCriteria,
            planRisk: assessment.riskScore,
          }),
        ]
      : plan.steps.map((step) =>
          buildNodeDraft({
            stableKey: `step-${step.order}`,
            order: step.order,
            title: step.description,
            description: step.rationale
              ? `${step.description}\n\nRationale: ${step.rationale}`
              : step.description,
            files: step.files.length ? uniqueSorted(step.files) : planFiles,
            acceptanceCriteria: [
              `Step ${step.order} completed: ${step.description}`,
              ...allCriteria.filter((criterion) =>
                step.files.some((file) => criterion.toLowerCase().includes(file.toLowerCase())),
              ),
            ],
            planRisk: assessment.riskScore,
          }),
        );

  const sortedNodes = [...nodes].sort((a, b) => a.order - b.order);
  const edges: TaskEdgeDraft[] = [];
  for (let index = 1; index < sortedNodes.length; index++) {
    edges.push({
      sourceStableKey: sortedNodes[index - 1].stableKey,
      targetStableKey: sortedNodes[index].stableKey,
      edgeType: 'depends_on',
    });
  }

  return {
    assessment,
    nodes: sortedNodes.map((node, index) => ({
      ...node,
      status: index === 0 ? 'ready' : 'pending',
    })),
    edges,
  };
}

function buildNodeDraft(input: {
  stableKey: string;
  order: number;
  title: string;
  description: string;
  files: string[];
  acceptanceCriteria: string[];
  planRisk: number;
}): TaskNodeDraft {
  const surfaces = inferTaskSurfaces({
    files: input.files,
    text: `${input.title}\n${input.description}`,
  });
  const agentRole = pickTaskAgentRole(surfaces);

  return {
    stableKey: input.stableKey,
    order: input.order,
    title: clampTitle(input.title),
    description: input.description,
    status: 'pending',
    files: input.files,
    acceptanceCriteria: input.acceptanceCriteria,
    surfaces,
    agentRole,
    suggestedExecutorModel: null,
    suggestedReasoningEffort: suggestedReasoningForTask(surfaces, input.planRisk),
    githubIssueNumber: null,
  };
}

export function buildTaskNodePlan(parentPlan: ShipCodePlan, node: TaskNodeRecord): ShipCodePlan {
  const fileByPath = new Map(parentPlan.files.map((file) => [file.path, file] as const));
  const files = node.files.map((path) => {
    const existing = fileByPath.get(path);
    return (
      existing ?? {
        path,
        action: 'modify' as const,
        description: `File touched by task node ${node.stableKey}: ${node.title}`,
      }
    );
  });

  return {
    ...parentPlan,
    id: `${parentPlan.id}:${node.stableKey}`,
    objective: `${node.title}`,
    files,
    steps: [
      {
        order: 1,
        description: node.title,
        files: node.files,
        rationale: node.description,
      },
    ],
    acceptanceCriteria: node.acceptanceCriteria,
    outOfScope: uniqueSorted([
      ...parentPlan.outOfScope,
      'Other task graph nodes are out of scope for this executor pass.',
    ]),
  };
}

export function formatTaskGraphExecutionContract(
  graph: TaskGraphWithNodes | null,
  options: TaskGraphExecutionContractOptions = {},
): string {
  if (!graph || graph.nodes.length <= 1) return '';
  const activeNode = options.activeNode ?? null;

  const nodeLines = graph.nodes
    .sort((a, b) => a.order - b.order)
    .map((node) => {
      const active = activeNode?.id === node.id ? ' ACTIVE' : '';
      const files = node.files.length ? ` files=${node.files.join(', ')}` : '';
      const surfaces = node.surfaces.length ? ` surfaces=${node.surfaces.join(',')}` : '';
      return `- ${node.stableKey}: ${node.title} [${node.status}${active}; agent=${node.agentRole}; reasoning=${node.suggestedReasoningEffort}${surfaces}${files}]`;
    })
    .join('\n');

  const nodeKeyById = new Map(graph.nodes.map((node) => [node.id, node.stableKey] as const));
  const edgeLines = graph.edges.length
    ? graph.edges
        .map(
          (edge) =>
            `- ${nodeKeyById.get(edge.sourceNodeId) ?? edge.sourceNodeId} -> ${
              nodeKeyById.get(edge.targetNodeId) ?? edge.targetNodeId
            } (${edge.edgeType})`,
        )
        .join('\n')
    : '- none';

  const activeBlock = activeNode
    ? `

Active node:
- Key: ${activeNode.stableKey}
- Title: ${activeNode.title}
- Specialist role: ${activeNode.agentRole}
- Surfaces: ${activeNode.surfaces.join(', ')}
- Files: ${activeNode.files.join(', ') || 'none listed'}
- Acceptance criteria:
${activeNode.acceptanceCriteria.map((criterion) => `  - ${criterion}`).join('\n')}

You are running as the ${activeNode.agentRole} specialist executor for this node.
Hard rule: execute ONLY the active node in this pass. Do not start later nodes, even if they look easy.`
    : '';

  return `

<task_graph_execution_contract>
ShipCode decomposed this plan into a task graph. Execute nodes in dependency order and keep each node's changes focused.
Mode: ${graph.mode}
Risk score: ${graph.riskScore}
Reasons:
${graph.assessment.reasons.map((reason) => `- ${reason}`).join('\n')}

Nodes:
${nodeLines}

Edges:
${edgeLines}
${activeBlock}

When reporting completion, summarize each node as completed, blocked, or changed with a short reason.
</task_graph_execution_contract>`;
}

export function formatTaskGraphChecklist(graph: TaskGraphWithNodes): string {
  if (graph.nodes.length === 0) return '';

  const lines = [
    TASK_GRAPH_COMMENT_MARKER,
    '',
    `Mode: \`${graph.mode}\` · Risk: \`${graph.riskScore.toFixed(2)}\` · Status: \`${graph.status}\``,
    '',
    ...graph.assessment.reasons.map((reason) => `- ${reason}`),
    '',
    '### Tasks',
    '',
  ];

  for (const node of [...graph.nodes].sort((a, b) => a.order - b.order)) {
    const checked = node.status === 'completed' ? 'x' : ' ';
    const status = node.status === 'running' ? 'running' : node.status;
    const surfaces = node.surfaces.length ? ` · ${node.surfaces.join(', ')}` : '';
    const issue = node.githubIssueNumber ? ` · #${node.githubIssueNumber}` : '';
    lines.push(
      `- [${checked}] ${node.stableKey}: ${node.title} (\`${status}\`${surfaces}${issue})`,
    );
  }

  return lines.join('\n');
}

export function formatTaskNodeIssueBody({
  parentIssueNumber,
  graph,
  node,
}: TaskNodeIssueBodyOptions): string {
  const files = node.files.length ? node.files.map((file) => `- \`${file}\``).join('\n') : '- none';
  const criteria = node.acceptanceCriteria.length
    ? node.acceptanceCriteria.map((criterion) => `- [ ] ${criterion}`).join('\n')
    : '- [ ] Node is complete';

  return [
    `Parent issue: #${parentIssueNumber}`,
    '',
    '<!-- shipcode-task-node: managed tracking issue; execution is coordinated by the parent task graph. -->',
    '',
    `Task graph: \`${graph.id}\``,
    `Node: \`${node.stableKey}\``,
    `Specialist role: \`${node.agentRole}\``,
    `Surfaces: ${node.surfaces.map((surface) => `\`${surface}\``).join(', ') || '`general`'}`,
    '',
    '## Scope',
    '',
    node.description.trim() || node.title,
    '',
    '## Files',
    '',
    files,
    '',
    '## Acceptance Criteria',
    '',
    criteria,
    '',
    '## Execution',
    '',
    'ShipCode executes this task from the parent issue pipeline and checks it off in the parent task graph comment. Do not route this child issue as a separate agent job.',
  ].join('\n');
}
