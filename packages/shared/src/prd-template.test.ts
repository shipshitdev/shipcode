import { describe, expect, it } from 'vitest';
import {
  bodyHasRequiredPrdSections,
  getMissingRequiredPrdSections,
  getPrdQualityIssues,
  PRD_TEMPLATE,
} from './prd-template';

const validPrd = PRD_TEMPLATE.replace(
  '- <Observable system behavior, data contracts, permissions, states, and boundaries. No file names.>',
  '- The feature exposes a concrete observable contract with states and permission boundaries.',
)
  .replace(
    '1. <Phase 1: foundation/spec plumbing. Include purpose, scope, and completion signal.>',
    '1. Foundation/spec plumbing - define contracts; completion signal is shared contract coverage.',
  )
  .replace(
    '2. <Phase 2: primary feature behavior. Include purpose, scope, and completion signal.>',
    '2. Primary behavior - implement the capability; completion signal is working user flow.',
  )
  .replace(
    '3. <Phase 3: hardening/verification/shipping polish. Include purpose, scope, and completion signal.>',
    '3. Hardening - add tests and failure handling; completion signal is passing verification.',
  )
  .replace(
    '- <Verifiable without judgement. Becomes plan.acceptanceCriteria.>',
    '- The behavior is verifiable from the diff.',
  )
  .replace('- <Be ruthless. Becomes plan.outOfScope.>', '- Adjacent feature work is excluded.');

describe('PRD section validation', () => {
  it('accepts the full required PRD shape', () => {
    expect(bodyHasRequiredPrdSections(validPrd)).toBe(true);
    expect(getMissingRequiredPrdSections(validPrd)).toEqual([]);
    expect(getPrdQualityIssues(validPrd)).toEqual([]);
  });

  it('ignores headings inside fenced examples', () => {
    const body = '```markdown\n## Executive Summary\n```\n\n## Goals\n- Goal';

    expect(getMissingRequiredPrdSections(body)).toContain('Executive Summary');
  });

  it('returns missing-section issues before content quality checks', () => {
    expect(getPrdQualityIssues('## Executive Summary\nEnough context')).toContain(
      'missing section: Problem Statement',
    );
    expect(bodyHasRequiredPrdSections('## Executive Summary\nEnough context')).toBe(false);
  });

  it('handles empty PRDs and sections at the end of the document', () => {
    expect(getMissingRequiredPrdSections('')).toContain('Executive Summary');
    expect(getMissingRequiredPrdSections('## Executive Summary\nEnough context')).not.toContain(
      'Executive Summary',
    );
  });

  it('flags placeholder system specification content', () => {
    const body = validPrd.replace(
      '- The feature exposes a concrete observable contract with states and permission boundaries.',
      '- <placeholder>',
    );

    expect(getPrdQualityIssues(body)).toContain(
      'System Specification must contain concrete non-placeholder content',
    );
  });

  it('flags blank system specification content', () => {
    const body = validPrd.replace(
      '- The feature exposes a concrete observable contract with states and permission boundaries.',
      '   ',
    );

    expect(getPrdQualityIssues(body)).toContain(
      'System Specification must contain concrete non-placeholder content',
    );
  });

  it('flags missing three-phase breakdown and empty quality sections', () => {
    const body = validPrd
      .replace(
        /## Feature Phase Breakdown[\s\S]*?## Success Criteria/,
        '## Feature Phase Breakdown\n1. Only one phase\n\n## Success Criteria',
      )
      .replace('- The behavior is verifiable from the diff.', '<TODO>')
      .replace('- Adjacent feature work is excluded.', '<TBD>');

    expect(getPrdQualityIssues(body)).toEqual([
      'Feature Phase Breakdown must contain exactly three numbered phases',
      'Success Criteria must contain at least one concrete bullet',
      'Out of Scope must contain at least one concrete bullet',
    ]);
  });

  it('flags a phase breakdown with no numbered items', () => {
    const body = validPrd.replace(
      /## Feature Phase Breakdown[\s\S]*?## Success Criteria/,
      '## Feature Phase Breakdown\n- Foundation\n- Runtime\n- Verification\n\n## Success Criteria',
    );

    expect(getPrdQualityIssues(body)).toContain(
      'Feature Phase Breakdown must contain exactly three numbered phases',
    );
  });
});
