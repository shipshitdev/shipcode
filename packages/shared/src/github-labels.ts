import { type GhMacroColumn, ISSUE_PIPELINE_STATUS, type IssuePipelineStatus } from './types';

export interface GitHubLabelDefinition {
  name: string;
  color: string;
  description: string;
}

export const SHIPCODE_AGENT_LABELS: readonly GitHubLabelDefinition[] = [
  {
    name: 'agent:claude',
    color: '1f6feb',
    description: 'Route this issue to Claude Code.',
  },
  {
    name: 'agent:codex',
    color: '2da44e',
    description: 'Route this issue to Codex.',
  },
  {
    name: 'agent:openrouter',
    color: 'd97706',
    description: 'Route this issue to the default OpenRouter executor.',
  },
  {
    name: 'agent:openrouter/auto',
    color: '0ea5e9',
    description: 'Route this issue to OpenRouter auto routing.',
  },
  {
    name: 'agent:openrouter/free',
    color: '65a30d',
    description: 'Route this issue to OpenRouter free-tier routing.',
  },
] as const;

export const SHIPCODE_CLASSIFICATION_LABELS: readonly GitHubLabelDefinition[] = [
  {
    name: 'bug',
    color: 'd73a4a',
    description: 'Something is broken.',
  },
  {
    name: 'deferred',
    color: '6e7781',
    description: 'Intentionally postponed work.',
  },
] as const;

export const SHIPCODE_METADATA_LABELS: readonly GitHubLabelDefinition[] = [
  {
    name: 'blocked:ci',
    color: 'cf222e',
    description: 'Linked PR has failing CI checks and needs follow-up.',
  },
] as const;

// ---------------------------------------------------------------------------
// Pipeline labels — represent transient agent-loop sub-states on GitHub issues.
// These are NOT board columns; board columns come from the GH Projects v2
// Status single-select field.
// ---------------------------------------------------------------------------

export const SHIPCODE_PIPELINE_LABELS: readonly GitHubLabelDefinition[] = [
  {
    name: 'pipeline:queued',
    color: '6e7781',
    description: 'Issue is queued for agent loop.',
  },
  {
    name: 'pipeline:planning',
    color: '0075ca',
    description: 'Agent is generating a plan.',
  },
  {
    name: 'pipeline:reviewing',
    color: '0075ca',
    description: 'Agent is reviewing the plan.',
  },
  {
    name: 'pipeline:revising',
    color: '0075ca',
    description: 'Agent is revising the plan.',
  },
  {
    name: 'pipeline:clarifying',
    color: 'e4e669',
    description: 'Agent is requesting clarification.',
  },
  {
    name: 'pipeline:executing',
    color: 'd93f0b',
    description: 'Agent is executing changes.',
  },
  {
    name: 'pipeline:testing',
    color: 'd93f0b',
    description: 'Agent is running tests.',
  },
  {
    name: 'pipeline:verifying',
    color: 'd93f0b',
    description: 'Agent is verifying the result.',
  },
  {
    name: 'pipeline:shipping',
    color: '0e8a16',
    description: 'Agent is opening or merging a PR.',
  },
  {
    name: 'pipeline:failed',
    color: 'b60205',
    description: 'Pipeline encountered an error.',
  },
] as const;

/** @deprecated Use SHIPCODE_PIPELINE_LABELS */
export const SHIPCODE_STATUS_LABELS: readonly GitHubLabelDefinition[] = SHIPCODE_PIPELINE_LABELS;

export const PIPELINE_LABEL_PREFIX = 'pipeline:' as const;

export const SHIPCODE_DEFAULT_LABELS: readonly GitHubLabelDefinition[] = [
  ...SHIPCODE_CLASSIFICATION_LABELS,
  ...SHIPCODE_AGENT_LABELS,
  ...SHIPCODE_METADATA_LABELS,
  ...SHIPCODE_PIPELINE_LABELS,
] as const;

// ---------------------------------------------------------------------------
// Helpers — map IssuePipelineStatus to macro column / pipeline label
// ---------------------------------------------------------------------------

const AGENT_LOOP_STATUSES = new Set<IssuePipelineStatus>([
  ISSUE_PIPELINE_STATUS.queued,
  ISSUE_PIPELINE_STATUS.planning,
  ISSUE_PIPELINE_STATUS.reviewing,
  ISSUE_PIPELINE_STATUS.revising,
  ISSUE_PIPELINE_STATUS.executing,
  ISSUE_PIPELINE_STATUS.testing,
  ISSUE_PIPELINE_STATUS.verifying,
  ISSUE_PIPELINE_STATUS.shipping,
]);

const HUMAN_STATUSES = new Set<IssuePipelineStatus>([
  ISSUE_PIPELINE_STATUS.clarifying,
  ISSUE_PIPELINE_STATUS.awaitingApproval,
  ISSUE_PIPELINE_STATUS.failed,
]);

const DONE_STATUSES = new Set<IssuePipelineStatus>([
  ISSUE_PIPELINE_STATUS.completed,
  ISSUE_PIPELINE_STATUS.done,
]);

/**
 * Maps an IssuePipelineStatus to the corresponding macro column on the
 * GH Projects v2 Status field.
 */
export function macroColumnForStatus(status: IssuePipelineStatus): GhMacroColumn {
  if (status === ISSUE_PIPELINE_STATUS.todo) return 'todo';
  if (AGENT_LOOP_STATUSES.has(status)) return 'in_progress';
  if (HUMAN_STATUSES.has(status)) return 'human_review';
  if (DONE_STATUSES.has(status)) return 'done';
  // Fallback — shouldn't happen with typed status
  return 'todo';
}

/**
 * Maps an IssuePipelineStatus to the `pipeline:<state>` label that should be
 * set on the GitHub issue, or null if no pipeline label applies (todo, done,
 * awaiting_approval, completed).
 */
export function pipelineLabelForStatus(status: IssuePipelineStatus): `pipeline:${string}` | null {
  switch (status) {
    case ISSUE_PIPELINE_STATUS.queued:
      return 'pipeline:queued';
    case ISSUE_PIPELINE_STATUS.planning:
      return 'pipeline:planning';
    case ISSUE_PIPELINE_STATUS.reviewing:
      return 'pipeline:reviewing';
    case ISSUE_PIPELINE_STATUS.revising:
      return 'pipeline:revising';
    case ISSUE_PIPELINE_STATUS.clarifying:
      return 'pipeline:clarifying';
    case ISSUE_PIPELINE_STATUS.executing:
      return 'pipeline:executing';
    case ISSUE_PIPELINE_STATUS.testing:
      return 'pipeline:testing';
    case ISSUE_PIPELINE_STATUS.verifying:
      return 'pipeline:verifying';
    case ISSUE_PIPELINE_STATUS.shipping:
      return 'pipeline:shipping';
    case ISSUE_PIPELINE_STATUS.failed:
      return 'pipeline:failed';
    default:
      return null;
  }
}
