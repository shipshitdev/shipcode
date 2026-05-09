import type { PlanRecord, ReviewRecord } from '@shipcode/shared';
import { clampTextBlock } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import {
  diagnosePlanParseFailure,
  getFailurePresentation,
  getPlanStatusPresentation,
  resolveClientSidePlan,
  resolveFailingPhaseOutput,
} from './helpers';

const VALID_PLAN_JSON = JSON.stringify({
  id: 'plan-1',
  threadId: 'thread-1',
  version: 1,
  objective: 'Add feature',
  files: [{ path: 'src/foo.ts', action: 'modify', description: 'Update foo' }],
  steps: [
    {
      order: 1,
      description: 'Inspect current behavior',
      files: ['src/foo.ts'],
      rationale: 'Baseline',
    },
    { order: 2, description: 'Do the thing', files: ['src/foo.ts'], rationale: 'Needed' },
    {
      order: 3,
      description: 'Verify behavior',
      files: ['src/foo.ts'],
      rationale: 'Regression coverage',
    },
  ],
  acceptanceCriteria: ['Tests pass'],
  outOfScope: ['Unrelated refactors'],
  estimatedComplexity: 'low',
  dependencies: [],
});

function wrapInFence(json: string) {
  return `Here is the plan:\n\`\`\`shipcode-plan\n${json}\n\`\`\`\nDone.`;
}

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

  it('uses needs-approval copy for approval-gated plans', () => {
    expect(getPlanStatusPresentation(makePlan({ status: 'approval' }))).toEqual({
      label: 'Needs approval',
      phaseStatus: 'reviewing',
      style: 'phase-chip',
    });
  });
});

describe('diagnosePlanParseFailure', () => {
  it('returns no-fence message for empty input', () => {
    expect(diagnosePlanParseFailure('')).toContain('no shipcode-plan fence');
  });

  it('returns no-fence message when output has no fence', () => {
    expect(diagnosePlanParseFailure('Here is some output without a fence')).toContain(
      'no shipcode-plan fence',
    );
  });

  it('returns no-fence message for Claude NDJSON without a plan fence', () => {
    const ndjson = JSON.stringify({ type: 'result', result: 'No fence here, sorry.' });
    expect(diagnosePlanParseFailure(ndjson)).toContain('no shipcode-plan fence');
  });

  it('returns invalid-json message when fence content is malformed', () => {
    const raw = wrapInFence('{ not valid json ,,, }');
    expect(diagnosePlanParseFailure(raw)).toContain('not valid JSON');
  });

  it('uses the last matching fence when earlier fences are invalid', () => {
    const raw = [wrapInFence('{ not valid json ,,, }'), wrapInFence(VALID_PLAN_JSON)].join('\n\n');
    expect(resolveClientSidePlan(raw)?.objective).toBe('Add feature');
  });

  it('returns schema-validation message with field detail for wrong enum', () => {
    const badPlan = JSON.parse(VALID_PLAN_JSON);
    badPlan.files[0].action = 'update'; // invalid — must be create|modify|delete|rename
    const raw = wrapInFence(JSON.stringify(badPlan));
    const result = diagnosePlanParseFailure(raw);
    expect(result).toContain('schema validation failed');
  });

  it('returns schema-validation message when required field is missing', () => {
    const badPlan = JSON.parse(VALID_PLAN_JSON);
    delete badPlan.objective;
    const raw = wrapInFence(JSON.stringify(badPlan));
    expect(diagnosePlanParseFailure(raw)).toContain('schema validation failed');
  });
});

describe('getFailurePresentation', () => {
  it('classifies verification retries as target-project failures', () => {
    expect(
      getFailurePresentation(
        'Verification commands failed after 2 attempt(s). See terminal output.',
      ),
    ).toEqual({
      label: 'Target project verification failed',
      detail:
        'The failing command ran inside the issue worktree, not inside the ShipCode desktop app.',
    });
  });

  it('classifies execution/setup failures as worktree execution failures', () => {
    expect(getFailurePresentation('Setup failed: command failed (1): bun run build')).toEqual({
      label: 'Target project verification failed',
      detail:
        'The failing command ran inside the issue worktree, not inside the ShipCode desktop app.',
    });
  });
});

describe('resolveFailingPhaseOutput', () => {
  it('prefers plan output for planning failures even if older verification output exists', () => {
    expect(
      resolveFailingPhaseOutput({
        thread: { status: 'failed', failurePhase: 'planning' },
        latestPlanRawOutput: 'planner transcript',
        latestReviewRawOutput: 'review transcript',
        latestVerificationRawOutput: 'verification transcript',
      }),
    ).toBe('planner transcript');
  });

  it('prefers verification output for verification failures', () => {
    expect(
      resolveFailingPhaseOutput({
        thread: { status: 'failed', failurePhase: 'verifying' },
        latestPlanRawOutput: 'planner transcript',
        latestReviewRawOutput: 'review transcript',
        latestVerificationRawOutput: 'verification transcript',
      }),
    ).toBe('verification transcript');
  });

  it('returns null for executing failures so the planner JSON is not dumped on the failure panel', () => {
    expect(
      resolveFailingPhaseOutput({
        thread: { status: 'failed', failurePhase: 'executing' },
        latestPlanRawOutput: '```shipcode-plan\n{"id":"plan-1"}\n```',
        latestReviewRawOutput: 'review transcript',
        latestVerificationRawOutput: null,
      }),
    ).toBeNull();
  });
});

describe('clampTextBlock', () => {
  it('preserves both the head and tail of oversized output', () => {
    const raw = `authentication failed\n${'x'.repeat(20_000)}\nfinal tail`;
    const clamped = clampTextBlock(raw, 280);

    expect(clamped.length).toBeLessThanOrEqual(280);
    expect(clamped).toContain('authentication failed');
    expect(clamped).toContain('final tail');
    expect(clamped).toContain('[truncated ');
  });
});
