import {
  isRealGithubIssueNumber,
  type ShipCodePlan,
  type TaskGraphWithNodes,
  type TaskNodeStatus,
} from '@shipcode/shared';

/** Literal first line of the canonical state-of-work comment. */
export const WORKPAD_MARKER = '## ShipCode Workpad';

export const WORKPAD_SECTIONS = ['Plan', 'Acceptance Criteria', 'Validation', 'Notes'] as const;

export interface WorkpadCommentContext {
  issueNumber: number | null | undefined;
  plan: ShipCodePlan;
  /** Latest task graph, if execution has begun. Drives the Validation section. */
  graph?: TaskGraphWithNodes | null;
  /** `<host>:<abs-cwd>@<short-sha>` environment stamp, computed by the pipeline. */
  envStamp?: string | null;
}

const NODE_STATUS_ICON: Record<TaskNodeStatus, string> = {
  completed: '✅',
  running: '🔄',
  ready: '⏳',
  pending: '⏳',
  blocked: '🚧',
  failed: '❌',
};

/**
 * Build the body of the single canonical ShipCode Workpad comment for a GitHub
 * issue. This is written by the pipeline **main process** — which has network
 * access and `gh` auth — never by the sandboxed executor (#394). Returns an
 * empty string for quick-task / non-real issue numbers so callers can skip
 * posting.
 */
export function formatWorkpadComment({
  issueNumber,
  plan,
  graph,
  envStamp,
}: WorkpadCommentContext): string {
  if (!isRealGithubIssueNumber(issueNumber)) return '';

  const graphCompleted = graph?.status === 'completed';
  const sections: string[] = [];

  sections.push(WORKPAD_MARKER);
  sections.push(`\`${envStamp?.trim() || '(environment stamp pending)'}\``);
  sections.push('');

  // ── Plan ──
  sections.push('### Plan');
  sections.push('');
  sections.push(`**Objective:** ${plan.objective}`);
  sections.push('');
  for (const step of plan.steps) {
    sections.push(`${step.order}. ${step.description}`);
  }
  sections.push('');

  // ── Acceptance Criteria ──
  sections.push('### Acceptance Criteria');
  sections.push('');
  for (const criterion of plan.acceptanceCriteria) {
    sections.push(`- [${graphCompleted ? 'x' : ' '}] ${criterion}`);
  }
  sections.push('');

  // ── Validation ──
  sections.push('### Validation');
  sections.push('');
  if (graph && graph.nodes.length > 0) {
    for (const node of [...graph.nodes].sort((a, b) => a.order - b.order)) {
      const icon = NODE_STATUS_ICON[node.status] ?? '⏳';
      sections.push(`- ${icon} \`${node.stableKey}\` — ${node.title} (${node.status})`);
    }
  } else {
    sections.push('_Awaiting execution._');
  }
  sections.push('');

  // ── Notes ──
  sections.push('### Notes');
  sections.push('');
  sections.push('_Maintained automatically by the ShipCode pipeline. Do not edit by hand._');

  let body = sections.join('\n');

  // GitHub rejects comment bodies over 65_536 bytes. The plan/graph are small,
  // but a pathological plan with huge step text could overflow — truncate the
  // Plan section first, mirroring the plan-comment guard.
  if (Buffer.byteLength(body, 'utf8') > 60_000) {
    const planStart = body.indexOf('### Plan');
    const acceptanceStart = body.indexOf('### Acceptance Criteria');
    if (planStart !== -1 && acceptanceStart > planStart) {
      body = `${body.slice(0, planStart)}### Plan\n\n_(Truncated — view the full plan in the ShipCode UI.)_\n\n${body.slice(acceptanceStart)}`;
    }
  }

  return body;
}
