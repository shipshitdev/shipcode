import type { ShipCodePlan } from '@shipcode/shared';
import { buildScopedContext, type PromptMaterial } from '../prompt-scope';
import {
  interpolateSkill,
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
}

export interface ExecutePromptOptions {
  contextFiles?: string;
  promptMaterials?: PromptMaterial[];
  testingContext?: string | null;
}

function withRepoContext(
  prompt: string,
  contextFiles: string,
  include: boolean,
): string {
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

  return prompt;
}
