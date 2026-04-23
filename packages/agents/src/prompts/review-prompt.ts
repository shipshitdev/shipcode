import type { ShipCodePlan } from '@shipcode/shared';
import { REVIEW_FENCE_TAG } from '@shipcode/shared';
import { buildScopedContext, type PromptMaterial } from '../prompt-scope';
import {
  interpolateSkill,
  resolveSkill,
  type SkillsRowSource,
  type SkillValidationError,
} from '../skills';

const REVIEW_SCHEMA_DESCRIPTION = `{
  "planId": "<plan-id>",
  "decision": "approve|request_changes|reject",
  "confidence": "high|medium|low",
  "summary": "1-2 sentence overall assessment",
  "findings": [
    {
      "id": "REV-001",
      "severity": "critical|major|minor|nit",
      "category": "correctness|security|performance|design|missing",
      "filePath": "optional/file/path.ts",
      "stepOrder": 1,
      "description": "What the issue is",
      "suggestion": "How to fix it"
    }
  ],
  "suggestedChanges": ["Specific change 1", "Specific change 2"]
}`;

const REVIEW_OUTPUT_SCHEMA = `\`\`\`${REVIEW_FENCE_TAG}\n${REVIEW_SCHEMA_DESCRIPTION}\n\`\`\``;

export interface ReviewPromptContext {
  projectId: string | null;
}

export interface ReviewPromptDeps {
  skills: SkillsRowSource;
  /** Called when the resolver fell back from an override to a lower tier (e.g. user override quarantined). */
  onFallback?: (phase: 'adversarial-review', error: SkillValidationError | undefined) => void;
}

export interface ReviewPromptOptions {
  contextFiles?: string;
  promptMaterials?: PromptMaterial[];
  autonomous?: boolean;
}

function withRepoContext(prompt: string, contextFiles: string): string {
  if (!contextFiles || prompt.includes(contextFiles)) return prompt;
  return `${prompt}\n\n<repo_context>\n${contextFiles}\n</repo_context>`;
}

export function buildReviewPrompt(
  plan: ShipCodePlan,
  context: ReviewPromptContext,
  deps: ReviewPromptDeps,
  opts: ReviewPromptOptions = {},
): string {
  const { skill, fallbackUsed, error } = resolveSkill(
    'adversarial-review',
    context.projectId,
    deps,
  );
  if (fallbackUsed) {
    deps.onFallback?.('adversarial-review', error);
  }
  const semanticMaterials: PromptMaterial[] = [...(opts.promptMaterials ?? [])];
  const scoped = buildScopedContext('review', semanticMaterials, opts.contextFiles);
  const prompt = interpolateSkill(skill.content, [
    { key: 'PLAN_JSON', value: JSON.stringify(plan, null, 2) },
    { key: 'TARGET_LABEL', value: `plan ${plan.id}` },
    { key: 'AUTONOMOUS', value: opts.autonomous ? 'yes' : 'no' },
    { key: 'CONTEXT_FILES', value: scoped.contextFiles },
    { key: 'OUTPUT_SCHEMA', value: REVIEW_OUTPUT_SCHEMA },
  ]);
  return withRepoContext(prompt, opts.contextFiles?.trim() ? opts.contextFiles : scoped.contextFiles);
}
