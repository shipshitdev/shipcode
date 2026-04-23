import type { ReasoningEffort } from '@shipcode/shared';
import type { PromptMaterial, PromptMaterialKind, PromptPhase } from '../prompt-scope';

const MATERIAL_ORDER: PromptMaterialKind[] = [
  'issue_prompt',
  'plan_output',
  'review_feedback',
  'repo_file_context',
  'testing_context',
  'diff_summary',
  'verification_output',
  'execution_notes',
];

export type PhasePromptContextSlice = 'repoContextFiles' | 'testingContext';

export interface PhasePromptPolicy {
  phase: PromptPhase;
  allowedMaterialKinds: readonly PromptMaterialKind[];
  allowedContextSlices: readonly PhasePromptContextSlice[];
  defaultReasoningEffort: ReasoningEffort;
}

export const PHASE_PROMPT_POLICY: Record<PromptPhase, PhasePromptPolicy> = {
  plan: {
    phase: 'plan',
    allowedMaterialKinds: [
      'issue_prompt',
      'repo_file_context',
      'testing_context',
      'execution_notes',
      'verification_output',
    ],
    allowedContextSlices: ['repoContextFiles', 'testingContext'],
    defaultReasoningEffort: 'high',
  },
  review: {
    phase: 'review',
    allowedMaterialKinds: ['issue_prompt', 'plan_output', 'review_feedback', 'testing_context'],
    allowedContextSlices: ['testingContext'],
    defaultReasoningEffort: 'low',
  },
  revision: {
    phase: 'revision',
    allowedMaterialKinds: ['issue_prompt', 'plan_output', 'review_feedback', 'testing_context'],
    allowedContextSlices: ['testingContext'],
    defaultReasoningEffort: 'low',
  },
  verify: {
    phase: 'verify',
    allowedMaterialKinds: [
      'plan_output',
      'testing_context',
      'diff_summary',
      'verification_output',
    ],
    allowedContextSlices: ['testingContext'],
    defaultReasoningEffort: 'low',
  },
  execute: {
    phase: 'execute',
    allowedMaterialKinds: ['issue_prompt', 'plan_output', 'review_feedback', 'testing_context'],
    allowedContextSlices: ['testingContext'],
    defaultReasoningEffort: 'medium',
  },
};

export function getPhasePromptPolicy(phase: PromptPhase): PhasePromptPolicy {
  return PHASE_PROMPT_POLICY[phase];
}

export function isPromptMaterialAllowed(
  phase: PromptPhase,
  kind: PromptMaterialKind,
): boolean {
  return getPhasePromptPolicy(phase).allowedMaterialKinds.includes(kind);
}

export function selectPhasePromptMaterials(
  phase: PromptPhase,
  materials: readonly PromptMaterial[],
): PromptMaterial[] {
  return materials
    .filter((material) => isPromptMaterialAllowed(phase, material.kind) && material.content.trim())
    .sort((left, right) => {
      const kindDelta = MATERIAL_ORDER.indexOf(left.kind) - MATERIAL_ORDER.indexOf(right.kind);
      return kindDelta || left.label.localeCompare(right.label);
    });
}

export function resolvePhaseReasoningEffort(
  phase: PromptPhase,
  explicit?: ReasoningEffort | null,
): ReasoningEffort {
  return explicit ?? getPhasePromptPolicy(phase).defaultReasoningEffort;
}
