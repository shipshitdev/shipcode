import type { PlanRecord, ReviewRecord } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import { getPlanStatusPresentation } from './helpers';

function makePlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 'plan-1',
    threadId: 'thread-1',
    version: 1,
    rawOutput: '',
    structured: null,
    status: 'pending_review',
    createdAt: '2026-04-17T09:10:11.000Z',
    ...overrides,
  };
}

function makeReview(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'review-1',
    planId: 'plan-1',
    decision: 'request_changes',
    confidence: 'high',
    rawOutput: '',
    structured: null,
    createdAt: '2026-04-17T09:10:11.000Z',
    ...overrides,
  };
}

describe('getPlanStatusPresentation', () => {
  it('renders superseded plans as muted badges', () => {
    expect(getPlanStatusPresentation(makePlan({ status: 'superseded' }))).toEqual({
      label: 'Superseded',
      phaseStatus: 'idle',
      style: 'badge',
      badgeVariant: 'default',
    });
  });

  it('keeps approved plans as the single resolved status even if review data exists', () => {
    expect(
      getPlanStatusPresentation(
        makePlan({ status: 'approved' }),
        makeReview({ decision: 'request_changes' }),
      ),
    ).toEqual({
      label: 'AI approved',
      phaseStatus: 'completed',
      style: 'phase-chip',
    });
  });

  it('uses review data only to clarify rejected plans into requested changes', () => {
    expect(
      getPlanStatusPresentation(
        makePlan({ status: 'rejected' }),
        makeReview({ decision: 'request_changes' }),
      ),
    ).toEqual({
      label: 'AI requested changes',
      phaseStatus: 'revising',
      style: 'phase-chip',
    });
  });
});
