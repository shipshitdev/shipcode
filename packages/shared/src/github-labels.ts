import { type GhMacroColumn, ISSUE_PIPELINE_STATUS, type IssuePipelineStatus } from './types';

export interface GitHubLabelDefinition {
  name: string;
  color: string;
  description: string;
}

export const SHIPCODE_LABEL_PREFIX = 'shipcode:' as const;
export const SHIPCODE_AGENT_LABEL_PREFIX = `${SHIPCODE_LABEL_PREFIX}agent:` as const;
export const LEGACY_AGENT_LABEL_PREFIX = 'agent:' as const;
export const PIPELINE_LABEL_PREFIX = `${SHIPCODE_LABEL_PREFIX}pipeline:` as const;
export const SHIPCODE_CI_BLOCKED_LABEL = `${SHIPCODE_LABEL_PREFIX}blocked:ci` as const;

export function isShipCodeAgentLabel(label: string): boolean {
  return label.startsWith(SHIPCODE_AGENT_LABEL_PREFIX);
}

export function isLegacyAgentLabel(label: string): boolean {
  return label.startsWith(LEGACY_AGENT_LABEL_PREFIX);
}

export function isAgentRoutingLabel(label: string): boolean {
  return isShipCodeAgentLabel(label) || isLegacyAgentLabel(label);
}

export function normalizeAgentRoutingLabel(label: string): string {
  if (isShipCodeAgentLabel(label)) return label;
  if (isLegacyAgentLabel(label)) {
    return `${SHIPCODE_AGENT_LABEL_PREFIX}${label.slice(LEGACY_AGENT_LABEL_PREFIX.length)}`;
  }
  return label;
}

export function isPipelineStateLabel(label: string): boolean {
  return label.startsWith(PIPELINE_LABEL_PREFIX);
}

export function agentLabelForExecutor(
  executor: string,
): `${typeof SHIPCODE_AGENT_LABEL_PREFIX}${string}` {
  return `${SHIPCODE_AGENT_LABEL_PREFIX}${executor}`;
}

export function displayAgentLabel(label: string): string {
  if (label.startsWith(SHIPCODE_AGENT_LABEL_PREFIX)) {
    return label.slice(SHIPCODE_AGENT_LABEL_PREFIX.length);
  }
  if (label.startsWith(LEGACY_AGENT_LABEL_PREFIX)) {
    return label.slice(LEGACY_AGENT_LABEL_PREFIX.length);
  }
  return label;
}

export const SHIPCODE_AGENT_LABELS: readonly GitHubLabelDefinition[] = [
  {
    name: 'shipcode:agent:claude',
    color: '1f6feb',
    description: 'Route this issue to Claude Code.',
  },
  {
    name: 'shipcode:agent:codex',
    color: '2da44e',
    description: 'Route this issue to Codex.',
  },
  {
    name: 'shipcode:agent:openrouter',
    color: 'd97706',
    description: 'Route this issue to the default OpenRouter executor.',
  },
  {
    name: 'shipcode:agent:openrouter/auto',
    color: '0ea5e9',
    description: 'Route this issue to OpenRouter auto routing.',
  },
  {
    name: 'shipcode:agent:openrouter/free',
    color: '65a30d',
    description: 'Route this issue to OpenRouter free-tier routing.',
  },
] as const;

export const LEGACY_AGENT_LABELS: readonly string[] = SHIPCODE_AGENT_LABELS.map((label) =>
  label.name.replace(SHIPCODE_AGENT_LABEL_PREFIX, LEGACY_AGENT_LABEL_PREFIX),
);

export const SHIPCODE_CLASSIFICATION_LABELS: readonly GitHubLabelDefinition[] = [
  {
    name: 'shipcode:bug',
    color: 'd73a4a',
    description: 'Something is broken.',
  },
  {
    name: 'shipcode:deferred',
    color: '6e7781',
    description: 'Intentionally postponed work.',
  },
] as const;

export const SHIPCODE_METADATA_LABELS: readonly GitHubLabelDefinition[] = [
  {
    name: SHIPCODE_CI_BLOCKED_LABEL,
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
    name: 'shipcode:pipeline:queued',
    color: '6e7781',
    description: 'Issue is queued for agent loop.',
  },
  {
    name: 'shipcode:pipeline:planning',
    color: '0075ca',
    description: 'Agent is generating a plan.',
  },
  {
    name: 'shipcode:pipeline:reviewing',
    color: '0075ca',
    description: 'Agent is reviewing the plan.',
  },
  {
    name: 'shipcode:pipeline:revising',
    color: '0075ca',
    description: 'Agent is revising the plan.',
  },
  {
    name: 'shipcode:pipeline:clarifying',
    color: 'e4e669',
    description: 'Agent is requesting clarification.',
  },
  {
    name: 'shipcode:pipeline:executing',
    color: 'd93f0b',
    description: 'Agent is executing changes.',
  },
  {
    name: 'shipcode:pipeline:testing',
    color: 'd93f0b',
    description: 'Agent is running tests.',
  },
  {
    name: 'shipcode:pipeline:verifying',
    color: 'd93f0b',
    description: 'Agent is verifying the result.',
  },
  {
    name: 'shipcode:pipeline:shipping',
    color: '0e8a16',
    description: 'Agent is opening or merging a PR.',
  },
  {
    name: 'shipcode:pipeline:failed',
    color: 'b60205',
    description: 'Pipeline encountered an error.',
  },
] as const;

/** @deprecated Use SHIPCODE_PIPELINE_LABELS */
export const SHIPCODE_STATUS_LABELS: readonly GitHubLabelDefinition[] = SHIPCODE_PIPELINE_LABELS;

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
  if (status === ISSUE_PIPELINE_STATUS.deferred) return 'deferred';
  if (DONE_STATUSES.has(status)) return 'done';
  // Fallback — shouldn't happen with typed status
  return 'todo';
}

/**
 * Maps an IssuePipelineStatus to the `shipcode:pipeline:<state>` label that should be
 * set on the GitHub issue, or null if no pipeline label applies (todo, done,
 * deferred, awaiting_approval, completed).
 */
export function pipelineLabelForStatus(
  status: IssuePipelineStatus,
): `${typeof PIPELINE_LABEL_PREFIX}${string}` | null {
  switch (status) {
    case ISSUE_PIPELINE_STATUS.queued:
      return 'shipcode:pipeline:queued';
    case ISSUE_PIPELINE_STATUS.planning:
      return 'shipcode:pipeline:planning';
    case ISSUE_PIPELINE_STATUS.reviewing:
      return 'shipcode:pipeline:reviewing';
    case ISSUE_PIPELINE_STATUS.revising:
      return 'shipcode:pipeline:revising';
    case ISSUE_PIPELINE_STATUS.clarifying:
      return 'shipcode:pipeline:clarifying';
    case ISSUE_PIPELINE_STATUS.executing:
      return 'shipcode:pipeline:executing';
    case ISSUE_PIPELINE_STATUS.testing:
      return 'shipcode:pipeline:testing';
    case ISSUE_PIPELINE_STATUS.verifying:
      return 'shipcode:pipeline:verifying';
    case ISSUE_PIPELINE_STATUS.shipping:
      return 'shipcode:pipeline:shipping';
    case ISSUE_PIPELINE_STATUS.failed:
      return 'shipcode:pipeline:failed';
    default:
      return null;
  }
}
