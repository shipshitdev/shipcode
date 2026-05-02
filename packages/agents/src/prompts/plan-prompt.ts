import type { ClarificationAnswer, ClarificationRequest, ShipCodePlan } from '@shipcode/shared';
import { CLARIFICATION_FENCE_TAG, PLAN_FENCE_TAG } from '@shipcode/shared';
import { buildScopedContext, type PromptMaterial } from '../prompt-scope';
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
    { "order": 1, "description": "System/spec foundation phase", "files": ["src/file.ts"], "rationale": "Why this phase comes first" },
    { "order": 2, "description": "Primary feature implementation phase", "files": ["src/file.ts"], "rationale": "Why this phase comes second" },
    { "order": 3, "description": "Hardening and verification phase", "files": ["src/file.ts"], "rationale": "Why this phase completes the work" }
  ],
  "acceptanceCriteria": ["Criteria 1", "Criteria 2"],
  "outOfScope": ["What this does NOT do"],
  "estimatedComplexity": "low|medium|high",
  "dependencies": ["files/packages that must exist"]
}`;

const PLAN_OUTPUT_SCHEMA = `\`\`\`${PLAN_FENCE_TAG}\n${PLAN_SCHEMA_DESCRIPTION}\n\`\`\``;

const CLARIFICATION_SCHEMA_DESCRIPTION = `{
  "id": "clarify-<timestamp>-<shortid>",
  "threadId": "<thread-id>",
  "phase": "plan|revision",
  "summary": "Why the missing information blocks a safe plan",
  "questions": [
    {
      "id": "question-1",
      "title": "Short heading",
      "prompt": "The concrete thing the user needs to choose or clarify",
      "description": "Optional extra context for the question",
      "choices": [
        {
          "id": "option-a",
          "label": "Short option label",
          "description": "What happens if this option is chosen",
          "recommended": true
        },
        {
          "id": "option-b",
          "label": "Alternative label",
          "description": "Tradeoff or effect of the alternative"
        }
      ],
      "allowFreeform": true,
      "freeformPlaceholder": "Optional extra constraint or note"
    }
  ]
}`;

const CLARIFICATION_OUTPUT_SCHEMA = `\`\`\`${CLARIFICATION_FENCE_TAG}\n${CLARIFICATION_SCHEMA_DESCRIPTION}\n\`\`\``;

const PLAN_OR_CLARIFICATION_SCHEMA = `${PLAN_OUTPUT_SCHEMA}

OR, if critical information is missing and you cannot produce a safe plan yet:

${CLARIFICATION_OUTPUT_SCHEMA}`;

/**
 * Appended to the end of every plan prompt to reinforce fence format.
 * Models (especially GPT-5.x via Codex) sometimes ignore mid-prompt format
 * instructions. End-of-prompt reminders are more reliably followed.
 */
const FORMAT_REINFORCEMENT = `

<!-- FORMAT REMINDER — this takes priority over any conflicting instruction above -->
Return exactly one fenced JSON block and nothing else.
If you can plan safely, use exactly \`\`\`${PLAN_FENCE_TAG}.
Clarification is a last resort. If you need user clarification first for a truly blocking product/security/destructive-data/billing/external-provider decision, use exactly \`\`\`${CLARIFICATION_FENCE_TAG}.
If clarification_context is present, treat those answers as final user input and emit a \`\`\`${PLAN_FENCE_TAG} plan unless planning is impossible without another user-owned decision.
Do NOT use \`\`\`json or \`\`\`typescript.
Never output both fence types in one response.
The JSON inside the fence must validate against the matching schema shown above.
Any response without a valid \`\`\`${PLAN_FENCE_TAG} or \`\`\`${CLARIFICATION_FENCE_TAG} fence will be rejected and retried.`;

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
outOfScope, estimatedComplexity, dependencies) are present. The plan must contain exactly
three steps ordered 1, 2, 3; every step must reference declared files; every declared file
must appear in at least one step.
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
  clarificationContext?: string;
  promptMaterials?: PromptMaterial[];
}

function withRepoContext(prompt: string, contextFiles: string, include: boolean): string {
  if (!include || !contextFiles || prompt.includes(contextFiles)) return prompt;
  return `${prompt}\n\n<repo_context>\n${contextFiles}\n</repo_context>`;
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
  const scoped = buildScopedContext('plan', opts.promptMaterials, opts.contextFiles);
  const base = interpolateSkill(skill.content, [
    { key: 'USER_PROMPT', value: userPrompt },
    { key: 'THREAD_ID', value: threadId },
    { key: 'CONTEXT_FILES', value: scoped.contextFiles },
    { key: 'OUTPUT_SCHEMA', value: PLAN_OR_CLARIFICATION_SCHEMA },
  ]);
  const note = testCommand
    ? `\n\n<!-- auto-injected: test command configured -->\nNote: This project runs \`${testCommand}\` after execution. The plan MUST include an acceptance criterion: "Test suite passes (\`${testCommand}\`)."`
    : '';
  const clarificationContext = opts.clarificationContext
    ? `\n\n<clarification_context>\n${opts.clarificationContext}\n</clarification_context>`
    : '';
  return (
    withRepoContext(
      base,
      scoped.contextFiles,
      Boolean(opts.promptMaterials?.length || opts.contextFiles),
    ) +
    note +
    clarificationContext +
    FORMAT_REINFORCEMENT
  );
}

export interface RevisionPromptOptions {
  contextFiles?: string;
  promptMaterials?: PromptMaterial[];
}

export function buildRevisionPrompt(
  originalPlan: ShipCodePlan,
  reviewFeedback: string,
  threadId: string,
  context: PlanPromptContext,
  deps: PlanPromptDeps,
  testCommand?: string | null,
  opts: RevisionPromptOptions = {},
): string {
  const { skill, fallbackUsed, error } = resolveSkill('plan-revision', context.projectId, deps);
  if (fallbackUsed) {
    deps.onFallback?.('plan-revision', error);
  }
  const semanticMaterials: PromptMaterial[] = [...(opts.promptMaterials ?? [])];
  const scoped = buildScopedContext('revision', semanticMaterials);
  const base = interpolateSkill(skill.content, [
    { key: 'ORIGINAL_PLAN', value: JSON.stringify(originalPlan, null, 2) },
    { key: 'REVIEW_FEEDBACK', value: reviewFeedback },
    { key: 'THREAD_ID', value: threadId },
    { key: 'NEW_VERSION', value: String(originalPlan.version + 1) },
    { key: 'CONTEXT_FILES', value: scoped.contextFiles },
    { key: 'OUTPUT_SCHEMA', value: PLAN_OR_CLARIFICATION_SCHEMA },
  ]);
  const note = testCommand
    ? `\n\n<!-- auto-injected: test command configured -->\nNote: This project runs \`${testCommand}\` after execution. The plan MUST include an acceptance criterion: "Test suite passes (\`${testCommand}\`)."`
    : '';
  return (
    withRepoContext(
      base,
      scoped.contextFiles,
      Boolean(opts.promptMaterials?.length || opts.contextFiles),
    ) +
    note +
    FORMAT_REINFORCEMENT
  );
}

export function formatClarificationContext(
  request: ClarificationRequest | null,
  answers: ClarificationAnswer[],
): string | null {
  if (!request || answers.length === 0) return null;

  const answerByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]));
  const lines = [
    `Clarification request: ${request.summary}`,
    'Use the answers below as hard requirements while planning.',
    'Do not ask follow-up clarification for routine implementation choices; resolve remaining ambiguity from repository patterns and state assumptions in the plan.',
  ];

  for (const question of request.questions) {
    const answer = answerByQuestionId.get(question.id);
    if (!answer) continue;

    const selectedChoice =
      question.choices.find((choice) => choice.id === answer.selectedChoiceId) ?? null;
    lines.push('', `${question.title}: ${question.prompt}`);
    if (selectedChoice) {
      lines.push(`Selected option: ${selectedChoice.label}`);
      lines.push(`Option detail: ${selectedChoice.description}`);
    }
    if (answer.freeformText?.trim()) {
      lines.push(`Extra note: ${answer.freeformText.trim()}`);
    }
  }

  return lines.join('\n');
}
