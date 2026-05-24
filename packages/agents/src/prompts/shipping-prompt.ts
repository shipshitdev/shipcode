import type {
  FeatureQaResult,
  PlanReview,
  ShipCodePlan,
  VerificationResult,
} from '@shipcode/shared';
import { interpolateSkill, resolveSkill, type SkillsRowSource } from '../skills/skill-loader';

/* v8 ignore next -- fallback skill source is only used by direct runtime calls without a project skill store */
const noopMarkQuarantined = () => {};

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
    featureQaResults?: FeatureQaResult[];
  },
): string {
  const { skill } = resolveSkill('pr-generation', opts?.projectId ?? null, {
    skills: opts?.skills ?? { get: () => null, markQuarantined: noopMarkQuarantined },
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

  if (opts?.featureQaResults?.length) {
    body += `\n\n${formatFeatureQaEvidence(opts.featureQaResults)}`;
  }

  return body;
}

function formatFeatureQaEvidence(results: FeatureQaResult[]): string {
  const lines = ['## QA Evidence'];
  for (const result of results.slice(0, 5)) {
    lines.push('');
    lines.push(`- **${result.featureId}**: ${result.status} — ${result.summary}`);
    for (const flow of result.flowResults.slice(0, 5)) {
      lines.push(
        `  - ${flow.passed ? 'Passed' : 'Failed'}: ${flow.flowName}${flow.failureReason ? ` — ${flow.failureReason}` : ''}`,
      );
      for (const assertion of flow.assertions?.slice(0, 3) ?? []) {
        lines.push(
          `    - ${assertion.passed ? 'Passed' : 'Failed'}: ${assertion.name}; expected ${assertion.expected}; actual ${assertion.actual}`,
        );
      }
    }
    const evidencePaths = new Set<string>(result.evidencePaths ?? []);
    for (const flow of result.flowResults) {
      for (const path of flow.evidencePaths ?? []) evidencePaths.add(path);
      for (const assertion of flow.assertions ?? []) {
        if (assertion.evidencePath) evidencePaths.add(assertion.evidencePath);
      }
    }
    if (evidencePaths.size > 0) {
      lines.push('  - Local artifacts:');
      for (const path of [...evidencePaths].slice(0, 5)) {
        lines.push(`    - \`${path}\``);
      }
    }
  }
  return lines.join('\n');
}
