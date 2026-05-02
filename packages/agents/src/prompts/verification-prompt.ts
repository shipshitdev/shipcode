import type { FeatureQaState, ShipCodePlan } from '@shipcode/shared';
import { VERIFICATION_FENCE_TAG } from '@shipcode/shared';
import { buildScopedContext, type PromptMaterial } from '../prompt-scope';
import {
  interpolateSkill,
  resolveSkill,
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
  promptMaterials?: PromptMaterial[];
  qaState?: FeatureQaState;
}

function withRepoContext(prompt: string, contextFiles: string, include: boolean): string {
  if (!include || !contextFiles || prompt.includes(contextFiles)) return prompt;
  return `${prompt}\n\n<repo_context>\n${contextFiles}\n</repo_context>`;
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
  const { skill, fallbackUsed, error } = resolveSkill('plan-verification', context.projectId, deps);
  if (fallbackUsed) {
    deps.onFallback?.('plan-verification', error);
  }
  const semanticMaterials: PromptMaterial[] = [...(opts.promptMaterials ?? [])];
  const scoped = buildScopedContext('verify', semanticMaterials, opts.contextFiles);
  const numbered = acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const slots = [
    { key: 'PLAN_JSON', value: JSON.stringify(plan, null, 2) },
    { key: 'DIFF', value: diff },
    { key: 'ACCEPTANCE_CRITERIA', value: numbered },
    { key: 'CONTEXT_FILES', value: scoped.contextFiles },
    { key: 'OUTPUT_SCHEMA', value: VERIFICATION_OUTPUT_SCHEMA },
  ];
  const result = withRepoContext(
    interpolateSkill(skill.content, slots),
    scoped.contextFiles,
    Boolean(opts.promptMaterials?.length || opts.contextFiles),
  );
  let prompt = result;
  if (testOutput) {
    prompt = `${prompt}\n\n<test_results>\n${testOutput}\n</test_results>\n\nIf test results above show failures, treat them as blockers. A clean test run is strong evidence that behavioral acceptance criteria are satisfied.`;
  }
  if (opts.qaState) {
    const flowList = opts.qaState.criticalFlows
      .map((f) => `- ${f.name}: ${f.successCriteria}`)
      .join('\n');
    prompt += `\n\n<qa_contract>\nFeature: ${opts.qaState.featureId}\nRoutes: ${opts.qaState.routes.join(', ')}\n\nCritical flows to evaluate:\n${flowList}\n\nAfter your verification output, also evaluate each critical flow against the implementation diff and output:\n<qa_results>\n[\n  { "flowName": "...", "passed": true|false, "failureReason": "..." }\n]\n</qa_results>\n</qa_contract>`;
  }
  return prompt;
}
