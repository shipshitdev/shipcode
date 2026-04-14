import {
  type AppSettings,
  type ExecutorModel,
  type Project,
  resolvePhaseModel,
  resolvePhaseModelId,
  resolvePhaseReasoningEffort,
} from '@shipcode/shared';
import { PROVIDER_DISPLAY } from '../model-provider-options';

export const INHERIT_VALUE = '__inherit__';
export const PROJECT_TABS = ['general', 'models', 'context'] as const;
export const PHASES = ['planner', 'reviewer', 'executor', 'verifier'] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number];
export type PhaseKey = (typeof PHASES)[number];
export type ContextGeneratorCli = 'claude' | 'codex';
export type ProjectOverrideState = Pick<
  Project,
  | 'plannerModelOverride'
  | 'reviewerModelOverride'
  | 'executorModelOverride'
  | 'verifierModelOverride'
  | 'plannerModelIdOverride'
  | 'reviewerModelIdOverride'
  | 'executorModelIdOverride'
  | 'verifierModelIdOverride'
  | 'plannerReasoningEffortOverride'
  | 'reviewerReasoningEffortOverride'
  | 'executorReasoningEffortOverride'
  | 'verifierReasoningEffortOverride'
  | 'discordRouting'
  | 'discordWebhookUrlOverride'
  | 'telegramRouting'
  | 'telegramChatIdOverride'
>;

export const EMPTY_OVERRIDES: ProjectOverrideState = {
  plannerModelOverride: null,
  reviewerModelOverride: null,
  executorModelOverride: null,
  verifierModelOverride: null,
  plannerModelIdOverride: null,
  reviewerModelIdOverride: null,
  executorModelIdOverride: null,
  verifierModelIdOverride: null,
  plannerReasoningEffortOverride: null,
  reviewerReasoningEffortOverride: null,
  executorReasoningEffortOverride: null,
  verifierReasoningEffortOverride: null,
  discordRouting: 'inherit',
  discordWebhookUrlOverride: null,
  telegramRouting: 'inherit',
  telegramChatIdOverride: null,
};

export const PROVIDER_OVERRIDE_KEYS = {
  planner: 'plannerModelOverride',
  reviewer: 'reviewerModelOverride',
  executor: 'executorModelOverride',
  verifier: 'verifierModelOverride',
} as const;

export const MODEL_ID_OVERRIDE_KEYS = {
  planner: 'plannerModelIdOverride',
  reviewer: 'reviewerModelIdOverride',
  executor: 'executorModelIdOverride',
  verifier: 'verifierModelIdOverride',
} as const;

export const EFFORT_OVERRIDE_KEYS = {
  planner: 'plannerReasoningEffortOverride',
  reviewer: 'reviewerReasoningEffortOverride',
  executor: 'executorReasoningEffortOverride',
  verifier: 'verifierReasoningEffortOverride',
} as const;

export const CONTEXT_GENERATOR_OPTIONS: Array<{
  value: ContextGeneratorCli;
  label: string;
}> = [
  { value: 'claude', label: 'Claude CLI' },
  { value: 'codex', label: 'Codex CLI' },
] as const;

export const PHASE_META: Array<{
  key: PhaseKey;
  label: string;
  validProviders: ExecutorModel[];
}> = [
  { key: 'planner', label: 'Planner', validProviders: ['claude', 'codex', 'openrouter'] },
  { key: 'reviewer', label: 'Reviewer', validProviders: ['claude', 'codex', 'openrouter'] },
  { key: 'executor', label: 'Executor', validProviders: ['claude', 'codex', 'openrouter'] },
  { key: 'verifier', label: 'Verifier', validProviders: ['claude', 'codex', 'openrouter'] },
];

export function buildProjectDraft(
  project: Project | null | undefined,
  overrides: ProjectOverrideState,
): Project | null {
  if (!project) return null;
  return { ...project, ...overrides };
}

export function formatInheritedSummary(
  settings: AppSettings,
  projectDraft: Project,
  phase: PhaseKey,
): string {
  const provider = resolvePhaseModel(settings, projectDraft, phase);
  const model = resolvePhaseModelId(settings, projectDraft, phase);
  const effort = resolvePhaseReasoningEffort(settings, projectDraft, phase);
  return `${PROVIDER_DISPLAY[provider]}${model ? ` / ${model}` : ''} / ${effort}`;
}
