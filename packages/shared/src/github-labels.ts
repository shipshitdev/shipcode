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

export const SHIPCODE_STATUS_LABELS: readonly GitHubLabelDefinition[] = [] as const;

export const SHIPCODE_DEFAULT_LABELS: readonly GitHubLabelDefinition[] = [
  ...SHIPCODE_CLASSIFICATION_LABELS,
  ...SHIPCODE_AGENT_LABELS,
  ...SHIPCODE_METADATA_LABELS,
] as const;
