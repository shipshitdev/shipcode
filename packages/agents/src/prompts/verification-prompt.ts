import type { CrossCodePlan } from '@crosscode/shared'
import { VERIFICATION_FENCE_TAG } from '@crosscode/shared'

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
}`

export function buildVerificationPrompt(
  plan: CrossCodePlan,
  diff: string,
  acceptanceCriteria: string[]
): string {
  return `You are a senior engineer verifying that an implementation matches its plan and acceptance criteria.

## Implementation Plan
\`\`\`json
${JSON.stringify(plan, null, 2)}
\`\`\`

## Git Diff (changes made)
\`\`\`diff
${diff}
\`\`\`

## Acceptance Criteria to Verify
${acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Instructions
1. Read the diff carefully against the plan's file list and steps
2. Check each acceptance criterion — does the diff satisfy it?
3. Flag any missing implementations, regressions, or incomplete work
4. Flag if there are uncommitted changes (dirty worktree = failure)

## Severity Guide
- **blocker**: Implementation is incomplete, broken, or missing critical functionality
- **warning**: Minor issue that doesn't block but should be noted

## Result Guide
- **passed**: All acceptance criteria are met, no blockers found
- **failed**: One or more acceptance criteria are NOT met, or blockers found

## Output Format
Your verification MUST be valid JSON inside a \`\`\`${VERIFICATION_FENCE_TAG} code fence:

\`\`\`${VERIFICATION_FENCE_TAG}
${VERIFICATION_SCHEMA_DESCRIPTION}
\`\`\``
}
