import type { ShipCodePlan } from '@shipcode/shared';
import { PLAN_FENCE_TAG } from '@shipcode/shared';
import {
  resolveSkill,
  interpolateSkill,
  type SkillsRowSource,
  type SkillValidationError,
  type PhaseSkillKey,
} from '../skills';

const PLAN_SCHEMA_DESCRIPTION = `{
  "id": "plan-<timestamp>-<shortid>",
  "threadId": "<thread-id>",
  "version": 1,
  "objective": "What this plan achieves",
  "files": [
    { "path": "src/file.ts", "action": "create|modify|delete|rename", "description": "What changes" }
  ],
  "steps": [
    { "order": 1, "description": "Step description", "files": ["src/file.ts"], "rationale": "Why this step" }
  ],
  "acceptanceCriteria": ["Criteria 1", "Criteria 2"],
  "outOfScope": ["What this does NOT do"],
  "estimatedComplexity": "low|medium|high",
  "dependencies": ["files/packages that must exist"]
}`;

const PLAN_OUTPUT_SCHEMA = `\`\`\`${PLAN_FENCE_TAG}\n${PLAN_SCHEMA_DESCRIPTION}\n\`\`\``;

export interface PlanPromptContext {
  projectId: string | null;
}

export interface PlanPromptDeps {
  skills: SkillsRowSource;
  onFallback?: (phase: PhaseSkillKey, error: SkillValidationError | undefined) => void;
}

export interface PlanPromptOptions {
  contextFiles?: string;
}

export function buildPlanPrompt(
  userPrompt: string,
  threadId: string,
  context: PlanPromptContext,
  deps: PlanPromptDeps,
  opts: PlanPromptOptions = {},
): string {
  const { skill, fallbackUsed, error } = resolveSkill(
    'plan-generation',
    context.projectId,
    deps,
  );
  if (fallbackUsed) {
    deps.onFallback?.('plan-generation', error);
  }
  return interpolateSkill(skill.content, [
    { key: 'USER_PROMPT', value: userPrompt },
    { key: 'THREAD_ID', value: threadId },
    { key: 'CONTEXT_FILES', value: opts.contextFiles ?? 'No extra files provided.' },
    { key: 'OUTPUT_SCHEMA', value: PLAN_OUTPUT_SCHEMA },
  ]);
}

export function buildRevisionPrompt(
  originalPlan: ShipCodePlan,
  reviewFeedback: string,
  threadId: string,
  context: PlanPromptContext,
  deps: PlanPromptDeps,
): string {
  const { skill, fallbackUsed, error } = resolveSkill('plan-revision', context.projectId, deps);
  if (fallbackUsed) {
    deps.onFallback?.('plan-revision', error);
  }
  return interpolateSkill(skill.content, [
    { key: 'ORIGINAL_PLAN', value: JSON.stringify(originalPlan, null, 2) },
    { key: 'REVIEW_FEEDBACK', value: reviewFeedback },
    { key: 'THREAD_ID', value: threadId },
    { key: 'NEW_VERSION', value: String(originalPlan.version + 1) },
    { key: 'OUTPUT_SCHEMA', value: PLAN_OUTPUT_SCHEMA },
  ]);
}
