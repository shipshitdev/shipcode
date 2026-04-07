import type { ShipCodePlan, PlanReview, VerificationResult } from '@shipcode/shared'

export function buildPRBody(
  plan: ShipCodePlan,
  reviews: PlanReview[],
  verification: VerificationResult | null,
  issueNumber: number
): string {
  const sections: string[] = []

  sections.push(`## Summary`)
  sections.push(plan.objective)
  sections.push('')

  // Plan details (collapsed)
  sections.push(`<details>`)
  sections.push(`<summary>Implementation Plan (v${plan.version})</summary>`)
  sections.push('')
  sections.push(`**Steps:**`)
  for (const step of plan.steps) {
    sections.push(`${step.order}. ${step.description}`)
    sections.push(`   Files: ${step.files.join(', ')}`)
  }
  sections.push('')
  sections.push(`**Acceptance Criteria:**`)
  for (const criterion of plan.acceptanceCriteria) {
    sections.push(`- [ ] ${criterion}`)
  }
  sections.push(`</details>`)
  sections.push('')

  // Review log (collapsed)
  if (reviews.length > 0) {
    sections.push(`<details>`)
    sections.push(`<summary>Review Log (${reviews.length} round${reviews.length > 1 ? 's' : ''})</summary>`)
    sections.push('')
    for (const review of reviews) {
      sections.push(`**Decision:** ${review.decision} (${review.confidence} confidence)`)
      sections.push(`> ${review.summary}`)
      if (review.findings.length > 0) {
        sections.push(`**Findings:** ${review.findings.length}`)
        for (const f of review.findings) {
          sections.push(`- [${f.severity}] ${f.description}`)
        }
      }
      sections.push('')
    }
    sections.push(`</details>`)
    sections.push('')
  }

  // Verification status
  if (verification) {
    const icon = verification.result === 'passed' ? 'Passed' : 'Failed'
    sections.push(`## Verification: ${icon}`)
    sections.push(verification.summary)
    sections.push('')
  }

  sections.push(`Closes #${issueNumber}`)
  sections.push('')
  sections.push(`---`)
  sections.push(`*Autonomous implementation by ShipCode*`)

  return sections.join('\n')
}
