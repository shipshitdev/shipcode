import type { ShipCodePlan } from '@shipcode/shared'
import { REVIEW_FENCE_TAG } from '@shipcode/shared'

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
}`

export function buildReviewPrompt(plan: ShipCodePlan, contextFiles?: string, autonomous?: boolean): string {
  let prompt = `You are a senior code reviewer evaluating an implementation plan for correctness, security, performance, and design quality.

## Plan to Review
\`\`\`json
${JSON.stringify(plan, null, 2)}
\`\`\`

## Review Criteria
1. **Correctness**: Will this plan actually achieve the stated objective? Are there logical errors?
2. **Security**: Are there potential security vulnerabilities (injection, XSS, auth bypass, etc.)?
3. **Performance**: Will the implementation be efficient? Any N+1 queries, unnecessary re-renders, etc.?
4. **Design**: Does the plan follow good architecture? Is the approach maintainable?
5. **Missing**: Is anything missing that should be included? Edge cases? Error handling?

## Severity Guide
- **critical**: Will cause bugs, security issues, or data loss
- **major**: Significant design issue or missing functionality
- **minor**: Improvement that would enhance quality
- **nit**: Style or preference suggestion

## Output Format
Your review MUST be valid JSON inside a \`\`\`${REVIEW_FENCE_TAG} code fence:

\`\`\`${REVIEW_FENCE_TAG}
${REVIEW_SCHEMA_DESCRIPTION}
\`\`\`

## Decision Guide
- **approve**: Plan is solid, no critical or major findings
- **request_changes**: Has critical or major findings that must be addressed
- **reject**: Plan is fundamentally flawed and needs complete rethinking`

  if (autonomous) {
    prompt += `\n\n## Autonomous Mode
This review is the sole quality gate before autonomous execution. No human will review this plan before it is implemented. Be thorough — you must catch any issues a human reviewer would catch. When in doubt, request_changes.`
  }

  if (contextFiles) {
    prompt += `\n\n## Relevant Files for Context\n${contextFiles}`
  }

  return prompt
}
