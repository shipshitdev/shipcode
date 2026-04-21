import type { PlanReview, ShipCodePlan, VerificationResult } from '@shipcode/shared';
import { interpolateSkill, resolveSkill, type SkillsRowSource } from '../skills/skill-loader';

/**
 * Build the PR body using the `pr-generation` skill template.
 *
 * When a project-level or global skill override exists, that template is used
 * instead of the bundled default — giving per-project PR body customization.
 */
export function buildPRBody(
  plan: ShipCodePlan,
  reviews: PlanReview[],
  verification: VerificationResult | null,
  issueNumber: number,
  opts?: {
    projectId?: string | null;
    skills?: SkillsRowSource;
  },
): string {
  const { skill } = resolveSkill('pr-generation', opts?.projectId ?? null, {
    skills: opts?.skills ?? { get: () => null, markQuarantined: () => {} },
  });

  const steps = plan.steps
    .map((s) => `${s.order}. ${s.description}\n   Files: ${s.files.join(', ')}`)
    .join('\n');

  const criteria = plan.acceptanceCriteria.map((c) => `- [ ] ${c}`).join('\n');

  let body = interpolateSkill(skill.content, [
    { key: 'PLAN_OBJECTIVE', value: plan.objective },
    { key: 'PLAN_STEPS', value: steps },
    { key: 'ACCEPTANCE_CRITERIA', value: criteria },
    { key: 'ISSUE_NUMBER', value: String(issueNumber) },
  ]);

  // Append review log if available (not part of template — always appended)
  if (reviews.length > 0) {
    const reviewLines: string[] = [
      '',
      '<details>',
      `<summary>Review Log (${reviews.length} round${reviews.length > 1 ? 's' : ''})</summary>`,
      '',
    ];
    for (const review of reviews) {
      reviewLines.push(`**Decision:** ${review.decision} (${review.confidence} confidence)`);
      reviewLines.push(`> ${review.summary}`);
      if (review.findings.length > 0) {
        reviewLines.push(`**Findings:** ${review.findings.length}`);
        for (const f of review.findings) {
          reviewLines.push(`- [${f.severity}] ${f.description}`);
        }
      }
      reviewLines.push('');
    }
    reviewLines.push('</details>');
    body += `\n${reviewLines.join('\n')}`;
  }

  // Append verification status if available
  if (verification) {
    const icon = verification.result === 'passed' ? 'Passed' : 'Failed';
    body += `\n\n## Verification: ${icon}\n${verification.summary}`;
  }

  return body;
}
