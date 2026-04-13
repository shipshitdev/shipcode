import { DEFAULT_STATUS_LABEL_MAPPINGS } from './constants';

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
    name: 'enhancement',
    color: 'a2eeef',
    description: 'Feature or product improvement.',
  },
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
    name: 'complexity:low',
    color: '1a7f37',
    description: 'Low-complexity task.',
  },
  {
    name: 'complexity:medium',
    color: 'bf8700',
    description: 'Medium-complexity task.',
  },
  {
    name: 'complexity:high',
    color: 'cf222e',
    description: 'High-complexity task.',
  },
  {
    name: 'blast:contained',
    color: '1a7f37',
    description: 'Changes stay within a contained surface area.',
  },
  {
    name: 'blast:cross-package',
    color: '1f6feb',
    description: 'Changes cross package boundaries.',
  },
  {
    name: 'blast:cross-app',
    color: 'd97706',
    description: 'Changes cross app boundaries.',
  },
  {
    name: 'blast:infra',
    color: 'cf222e',
    description: 'Changes touch infrastructure or platform concerns.',
  },
  {
    name: 'blocked:ci',
    color: 'cf222e',
    description: 'Linked PR has failing CI checks and needs follow-up.',
  },
] as const;

const STATUS_LABEL_DEFINITIONS: Record<string, GitHubLabelDefinition> = {
  'status:queued': {
    name: 'status:queued',
    color: '6e7781',
    description: 'Queued for the pipeline.',
  },
  'status:in-progress': {
    name: 'status:in-progress',
    color: 'fb8c00',
    description: 'Currently active in the pipeline.',
  },
  'status:done': {
    name: 'status:done',
    color: '1a7f37',
    description: 'Pipeline completed successfully.',
  },
  'status:failed': {
    name: 'status:failed',
    color: 'cf222e',
    description: 'Pipeline failed and needs attention.',
  },
};

export const SHIPCODE_STATUS_LABELS: readonly GitHubLabelDefinition[] = [
  ...new Set(Object.values(DEFAULT_STATUS_LABEL_MAPPINGS).filter(Boolean)),
]
  .map((name) => STATUS_LABEL_DEFINITIONS[name])
  .filter((label): label is GitHubLabelDefinition => !!label);

export const SHIPCODE_DEFAULT_LABELS: readonly GitHubLabelDefinition[] = [
  ...SHIPCODE_CLASSIFICATION_LABELS,
  ...SHIPCODE_AGENT_LABELS,
  ...SHIPCODE_STATUS_LABELS,
  ...SHIPCODE_METADATA_LABELS,
] as const;
