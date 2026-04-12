import type { ShipCodePlan } from '@shipcode/shared';
import { VERIFICATION_FENCE_TAG } from '@shipcode/shared';
import {
  resolveSkill,
  interpolateSkill,
  type SkillsRowSource,
  type SkillValidationError,
} from '../skills';

const VERIFICATION_SCHEMA_DESCRIPTION = `{
  "threadId": "<thread-id>",
  "planId": "<plan-id>",
  "result": "passed|failed",
  "summary": "Overall assessment of implementation quality",
  "criteriaResults": [
    {
      "criterion": "The acceptance criterion text",
      "passed": true,
      "evidence": "What was found in the diff that satisfies or fails this criterion"
    }
  ],
  "issues": [
    {
      "severity": "blocker|warning",
      "description": "What is wrong",
      "filePath": "optional/file/path.ts"
    }
  ]
}`;

const VERIFICATION_OUTPUT_SCHEMA = `\`\`\`${VERIFICATION_FENCE_TAG}\n${VERIFICATION_SCHEMA_DESCRIPTION}\n\`\`\``;

export interface VerificationPromptContext {
  projectId: string | null;
}

export interface VerificationPromptDeps {
  skills: SkillsRowSource;
  onFallback?: (phase: 'plan-verification', error: SkillValidationError | undefined) => void;
}

export function buildVerificationPrompt(
  plan: ShipCodePlan,
  diff: string,
  acceptanceCriteria: string[],
  context: VerificationPromptContext,
  deps: VerificationPromptDeps,
): string {
  const { skill, fallbackUsed, error } = resolveSkill(
    'plan-verification',
    context.projectId,
    deps,
  );
  if (fallbackUsed) {
    deps.onFallback?.('plan-verification', error);
  }
  const numbered = acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n');
  return interpolateSkill(skill.content, [
    { key: 'PLAN_JSON', value: JSON.stringify(plan, null, 2) },
    { key: 'DIFF', value: diff },
    { key: 'ACCEPTANCE_CRITERIA', value: numbered },
    { key: 'OUTPUT_SCHEMA', value: VERIFICATION_OUTPUT_SCHEMA },
  ]);
}
