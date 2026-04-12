import type { ShipCodePlan } from '@shipcode/shared';
import {
  resolveSkill,
  interpolateSkill,
  type SkillsRowSource,
  type SkillValidationError,
} from '../skills';

export interface ExecutePromptContext {
  projectId: string | null;
}

export interface ExecutePromptDeps {
  skills: SkillsRowSource;
  onFallback?: (phase: 'plan-execution', error: SkillValidationError | undefined) => void;
}

export interface ExecutePromptOptions {
  contextFiles?: string;
  testingContext?: string | null;
}

export function buildExecutionPrompt(
  plan: ShipCodePlan,
  context: ExecutePromptContext,
  deps: ExecutePromptDeps,
  opts: ExecutePromptOptions = {},
): string {
  const { skill, fallbackUsed, error } = resolveSkill('plan-execution', context.projectId, deps);
  if (fallbackUsed) {
    deps.onFallback?.('plan-execution', error);
  }
  return interpolateSkill(skill.content, [
    { key: 'APPROVED_PLAN', value: JSON.stringify(plan, null, 2) },
    { key: 'TESTING_CONTEXT', value: opts.testingContext ?? '' },
    { key: 'CONTEXT_FILES', value: opts.contextFiles ?? 'No extra files provided.' },
  ]);
}
