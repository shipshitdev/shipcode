import type { ShipCodePlan } from '@shipcode/shared';
import { nanoid } from 'nanoid';

export type DirectExecutionPlanInput =
  | {
      source: 'quick-task';
      threadId: string;
      title: string;
      text: string;
    }
  | {
      source: 'automation';
      threadId: string;
      name: string;
      prompt: string;
    };

/**
 * Build the approved-plan shape used by entry points that intentionally skip
 * planner/reviewer phases. Keeping both direct-execution paths here prevents
 * their executor-gate contract from drifting independently.
 */
export function synthesizeDirectExecutionPlan(input: DirectExecutionPlanInput): ShipCodePlan {
  const isQuickTask = input.source === 'quick-task';
  const label = isQuickTask ? input.title : input.name;
  const instructions = isQuickTask ? input.text : input.prompt;
  const trimmedInstructions = instructions.trim();

  return {
    id: nanoid(),
    threadId: input.threadId,
    version: 1,
    objective: isQuickTask ? `Quick: ${label}` : `Automation: ${label}`,
    files: [],
    steps: [
      {
        order: 1,
        description: isQuickTask ? `Quick task: ${label}\n\n${instructions}` : instructions,
        files: [],
        rationale: isQuickTask
          ? 'Quick task — executed directly without plan/review.'
          : 'Automation prompt — executed directly without plan/review.',
      },
    ],
    acceptanceCriteria: [
      isQuickTask ? `Implements: ${label}` : `Implements automation: ${label}`,
      ...(trimmedInstructions.length > 20
        ? [
            `${isQuickTask ? 'Satisfies instructions' : 'Satisfies prompt'}: ${trimmedInstructions.slice(0, 200)}`,
          ]
        : []),
    ],
    outOfScope: [],
    estimatedComplexity: isQuickTask ? 'low' : 'medium',
    dependencies: [],
  };
}
