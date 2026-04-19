import type { ShipCodePlan } from '@shipcode/shared';
import { PLAN_FENCE_TAG } from '@shipcode/shared';
import {
  interpolateSkill,
  type PhaseSkillKey,
  resolveSkill,
  type SkillsRowSource,
  type SkillValidationError,
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

/**
 * Appended to the end of every plan prompt to reinforce fence format.
 * Models (especially GPT-5.x via Codex) sometimes ignore mid-prompt format
 * instructions. End-of-prompt reminders are more reliably followed.
 */
const FORMAT_REINFORCEMENT = `

<!-- FORMAT REMINDER — this takes priority over any conflicting instruction above -->
Your response MUST contain exactly one code fence tagged \`${PLAN_FENCE_TAG}\`.
Do NOT use \`\`\`json or \`\`\`typescript — use exactly: \`\`\`${PLAN_FENCE_TAG}
The JSON inside the fence must validate against the ShipCodePlan schema shown above.
Any response without a valid \`\`\`${PLAN_FENCE_TAG} fence will be rejected and retried.`;

/**
 * Build a context block from a previous failed plan attempt, telling the model
 * what went wrong and asking it to produce correct output this time.
 */
export function buildPreviousAttemptContext(previousRawOutput: string): string {
  // Truncate to avoid blowing up context — keep the last 2000 chars which
  // are most likely to contain the model's actual plan attempt.
  const truncated =
    previousRawOutput.length > 2000
      ? `[…truncated…]\n${previousRawOutput.slice(-2000)}`
      : previousRawOutput;

  return `

<previous_attempt_failed>
A previous planning attempt produced output but it could NOT be parsed.
The most likely reason: the output was missing the required \`\`\`${PLAN_FENCE_TAG} code fence,
or the JSON inside the fence did not match the ShipCodePlan schema.

Here is a snippet of the previous output for reference — do NOT repeat the same mistake:
<previous_output>
${truncated}
</previous_output>

Fix the format: wrap your plan JSON in exactly \`\`\`${PLAN_FENCE_TAG} ... \`\`\` and ensure
all required fields (id, threadId, version, objective, files, steps, acceptanceCriteria,
outOfScope, estimatedComplexity, dependencies) are present.
</previous_attempt_failed>`;
}

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
  testCommand?: string | null,
): string {
  const { skill, fallbackUsed, error } = resolveSkill('plan-generation', context.projectId, deps);
  if (fallbackUsed) {
    deps.onFallback?.('plan-generation', error);
  }
  const base = interpolateSkill(skill.content, [
    { key: 'USER_PROMPT', value: userPrompt },
    { key: 'THREAD_ID', value: threadId },
    { key: 'CONTEXT_FILES', value: opts.contextFiles ?? 'No extra files provided.' },
    { key: 'OUTPUT_SCHEMA', value: PLAN_OUTPUT_SCHEMA },
  ]);
  const note = testCommand
    ? `\n\n<!-- auto-injected: test command configured -->\nNote: This project runs \`${testCommand}\` after execution. The plan MUST include an acceptance criterion: "Test suite passes (\`${testCommand}\`)."`
    : '';
  return base + note + FORMAT_REINFORCEMENT;
}

export function buildRevisionPrompt(
  originalPlan: ShipCodePlan,
  reviewFeedback: string,
  threadId: string,
  context: PlanPromptContext,
  deps: PlanPromptDeps,
  testCommand?: string | null,
): string {
  const { skill, fallbackUsed, error } = resolveSkill('plan-revision', context.projectId, deps);
  if (fallbackUsed) {
    deps.onFallback?.('plan-revision', error);
  }
  const base = interpolateSkill(skill.content, [
    { key: 'ORIGINAL_PLAN', value: JSON.stringify(originalPlan, null, 2) },
    { key: 'REVIEW_FEEDBACK', value: reviewFeedback },
    { key: 'THREAD_ID', value: threadId },
    { key: 'NEW_VERSION', value: String(originalPlan.version + 1) },
    { key: 'OUTPUT_SCHEMA', value: PLAN_OUTPUT_SCHEMA },
  ]);
  const note = testCommand
    ? `\n\n<!-- auto-injected: test command configured -->\nNote: This project runs \`${testCommand}\` after execution. The plan MUST include an acceptance criterion: "Test suite passes (\`${testCommand}\`)."`
    : '';
  return base + note + FORMAT_REINFORCEMENT;
}
