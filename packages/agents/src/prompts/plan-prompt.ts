import type { ShipCodePlan } from '@shipcode/shared';
import { PLAN_FENCE_TAG } from '@shipcode/shared';

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

export function buildPlanPrompt(
  userPrompt: string,
  threadId: string,
  contextFiles?: string,
): string {
  let prompt = `You are a senior software architect generating an implementation plan.

## Task
${userPrompt}

## Instructions
1. Analyze the task and the codebase
2. Create a detailed, step-by-step implementation plan
3. Output the plan inside a fenced code block tagged \`${PLAN_FENCE_TAG}\`

## Output Format
Your plan MUST be valid JSON inside a \`\`\`${PLAN_FENCE_TAG} code fence:

\`\`\`${PLAN_FENCE_TAG}
${PLAN_SCHEMA_DESCRIPTION}
\`\`\`

Use thread ID: "${threadId}"

## Requirements
- Each step must be atomic and independently verifiable
- List ALL files that will be created, modified, or deleted
- Include clear acceptance criteria
- Explicitly state what is out of scope
- Be specific about dependencies`;

  if (contextFiles) {
    prompt += `\n\n## Relevant Files\n${contextFiles}`;
  }

  return prompt;
}

export function buildRevisionPrompt(
  originalPlan: ShipCodePlan,
  reviewFeedback: string,
  threadId: string,
): string {
  return `You are revising an implementation plan based on review feedback.

## Original Plan
\`\`\`json
${JSON.stringify(originalPlan, null, 2)}
\`\`\`

## Review Feedback
${reviewFeedback}

## Instructions
1. Address each piece of feedback from the review
2. Update the plan accordingly
3. Increment the version number to ${originalPlan.version + 1}
4. Output the revised plan in a \`\`\`${PLAN_FENCE_TAG} code fence

Use thread ID: "${threadId}"

Output the complete revised plan as JSON inside a \`\`\`${PLAN_FENCE_TAG} block.`;
}
