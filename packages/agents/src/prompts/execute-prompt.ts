import type { ShipCodePlan } from '@shipcode/shared';
import { buildScopedContext, type PromptMaterial } from '../prompt-scope';
import {
  interpolateSkill,
  type ResolveResult,
  resolveSkill,
  type SkillsRowSource,
  type SkillValidationError,
} from '../skills';

export interface ExecutePromptContext {
  projectId: string | null;
}

export interface ExecutePromptDeps {
  skills: SkillsRowSource;
  onFallback?: (phase: 'plan-execution', error: SkillValidationError | undefined) => void;
  onResolved?: (phase: 'plan-execution', result: ResolveResult) => void;
}

export interface ExecutePromptOptions {
  contextFiles?: string;
  promptMaterials?: PromptMaterial[];
  testingContext?: string | null;
  /**
   * Set when the executor was launched from an automation tick rather
   * than from a planner-produced ShipCodePlan. The synthesized plan has
   * empty `files`/`steps[].files` arrays, so the default "touch every
   * file listed in the plan's files array" directive is moot. Triggers
   * an override block that tells the executor to treat the prompt as
   * the source of truth and discover files itself.
   */
  isAutomationRun?: boolean;
}

/** Automation override — appended when buildExecutionPrompt is called from automation. */
const AUTOMATION_OVERRIDE = `
<automation_override>
This run was triggered by a cron automation. The plan above is a stub — its \`files\` and \`steps[].files\` arrays are intentionally empty, and its single step description is the original automation prompt.

Override the plan's file-restriction directives:
- Treat the step description (in \`steps[0].description\`) as the source of truth for what to do.
- Discover the affected files yourself by exploring the repository — do not skip work because the plan's \`files\` array is empty.
- Apply the same operating stance (no scope creep, match codebase patterns, TDD where tests are configured) as a normal plan.
- Acceptance criteria still apply: implement the automation prompt fully and surface any blockers in your final output.
</automation_override>`;

function withRepoContext(prompt: string, contextFiles: string, include: boolean): string {
  if (!include || !contextFiles || prompt.includes(contextFiles)) return prompt;
  return `${prompt}\n\n<repo_context>\n${contextFiles}\n</repo_context>`;
}

/** TDD protocol block — appended after skill interpolation when testCommand is configured. */
const TDD_PROTOCOL = `
<testing_protocol>
When implementing changes, follow the test-driven development cycle for every behavioral change:

1. RED — Write a failing test first. The test must fail because the feature does not exist yet.
2. GREEN — Write the minimum code to make the test pass.
3. REFACTOR — Clean up while tests stay green.

Bug fixes use the Prove-It Pattern:
1. Write a test that reproduces the bug (it must fail).
2. Fix the code.
3. Confirm the test passes.
4. Run the broader test suite for regressions.

Hard limits:
- Never write more than 100 lines of implementation code without running tests.
- If a test is flaky, investigate immediately — do not skip it.
</testing_protocol>`;

/** Context engineering protocol — appended when CLAUDE.md content is loaded and non-empty. */
const CONTEXT_PROTOCOL = `
<context_protocol>
This repository has a CLAUDE.md that defines conventions and constraints.
- Read CLAUDE.md before modifying any file. Violations of documented conventions are bugs.
- When the plan conflicts with repo conventions, surface the conflict explicitly. Follow the convention unless the plan explicitly overrides it.
- Search for 3+ existing examples of a pattern before writing new code.
</context_protocol>`;

export const EXECUTION_NOTES_FILE = 'implementation-notes.md';

export const EXECUTION_NOTES_PROTOCOL = `
<implementation_notes_protocol>
Keep a running ${EXECUTION_NOTES_FILE} file at the worktree root.

Use the GitHub issue content from the prompt's issue_prompt material as the source request when present. For direct or automation runs without issue_prompt material, use the approved plan or rendered workflow prompt as the source request. Then record only durable implementation facts:
- Decisions you had to make because the issue or approved plan did not specify them.
- Plan discrepancies, including any unplanned files you had to touch and why.
- Tradeoffs, constraints, blocked alternatives, or follow-up risks the reviewer should know.
- Verification commands you ran and their results.

Update the file as you work, not only at the end. If there are no notable decisions or tradeoffs, keep the file with a short "No material implementation notes." entry.
Do not write private reasoning, scratch notes, chain-of-thought, secrets, credentials, or raw command logs into the file.
This file is an expected ShipCode artifact and should be committed with the implementation.
</implementation_notes_protocol>`;

export function appendExecutionNotesProtocol(prompt: string): string {
  if (prompt.includes('<implementation_notes_protocol>')) return prompt;
  return `${prompt}${EXECUTION_NOTES_PROTOCOL}`;
}

export function buildExecutionPrompt(
  plan: ShipCodePlan,
  context: ExecutePromptContext,
  deps: ExecutePromptDeps,
  opts: ExecutePromptOptions = {},
): string {
  const resolution = resolveSkill('plan-execution', context.projectId, deps);
  deps.onResolved?.('plan-execution', resolution);
  const { skill, fallbackUsed, error } = resolution;
  if (fallbackUsed) {
    deps.onFallback?.('plan-execution', error);
  }
  const semanticMaterials: PromptMaterial[] = [...(opts.promptMaterials ?? [])];
  const scoped = buildScopedContext('execute', semanticMaterials, opts.contextFiles);
  let prompt = withRepoContext(
    interpolateSkill(skill.content, [
      { key: 'APPROVED_PLAN', value: JSON.stringify(plan, null, 2) },
      { key: 'TESTING_CONTEXT', value: opts.testingContext ?? '' },
      { key: 'CONTEXT_FILES', value: scoped.contextFiles },
    ]),
    scoped.contextFiles,
    Boolean(opts.promptMaterials?.length || opts.contextFiles),
  );

  // Inject TDD protocol when test command is configured
  if (opts.testingContext) {
    prompt += TDD_PROTOCOL;
  }

  // Inject context protocol when CLAUDE.md content is loaded and non-empty
  const contextFiles = opts.contextFiles ?? '';
  if (contextFiles.includes('CLAUDE.md') && contextFiles.length > 100) {
    prompt += CONTEXT_PROTOCOL;
  }

  // Inject automation override block when launched from a cron tick.
  if (opts.isAutomationRun) {
    prompt += AUTOMATION_OVERRIDE;
  }

  return appendExecutionNotesProtocol(prompt);
}
