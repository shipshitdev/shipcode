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

export interface VerificationPromptOptions {
  contextFiles?: string;
}

export function buildVerificationPrompt(
  plan: ShipCodePlan,
  diff: string,
  acceptanceCriteria: string[],
  context: VerificationPromptContext,
  deps: VerificationPromptDeps,
  testOutput?: string | null,
  opts: VerificationPromptOptions = {},
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
  const slots = [
    { key: 'PLAN_JSON', value: JSON.stringify(plan, null, 2) },
    { key: 'DIFF', value: diff },
    { key: 'ACCEPTANCE_CRITERIA', value: numbered },
    { key: 'CONTEXT_FILES', value: opts.contextFiles ?? 'No extra files provided.' },
    { key: 'OUTPUT_SCHEMA', value: VERIFICATION_OUTPUT_SCHEMA },
  ];
  const result = interpolateSkill(skill.content, slots);
  if (testOutput) {
    return `${result}\n\n<test_results>\n${testOutput}\n</test_results>\n\nIf test results above show failures, treat them as blockers. A clean test run is strong evidence that behavioral acceptance criteria are satisfied.`;
  }
  return result;
}
