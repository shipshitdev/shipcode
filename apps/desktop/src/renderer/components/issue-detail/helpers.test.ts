import type { PlanRecord, ReviewRecord } from '@shipcode/shared';
import { clampTextBlock, PIPELINE_EXECUTOR_PROVIDERS } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import {
  decodePhaseOption,
  diagnosePlanParseFailure,
  encodePhaseOption,
  getFailurePresentation,
  getPlanStatusPresentation,
  getTriageFailurePresentation,
  resolveClientSidePlan,
  resolveFailingPhaseOutput,
  safeErrorMessage,
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

  it('covers rejected, pending review, and draft plan presentation fallbacks', () => {
    expect(getPlanStatusPresentation(makePlan({ status: 'rejected' }))).toEqual({
      label: 'AI rejected',
      phaseStatus: 'failed',
      style: 'phase-chip',
    });
    expect(getPlanStatusPresentation(makePlan({ status: 'pending_review' }))).toEqual({
      label: 'AI reviewing',
      phaseStatus: 'reviewing',
      style: 'phase-chip',
    });
    expect(getPlanStatusPresentation(makePlan({ status: 'draft' }))).toEqual({
      label: 'Plan drafted',
      phaseStatus: 'planning',
      style: 'phase-chip',
    });
  });
});

describe('phase option helpers', () => {
  it('round-trips provider and model choices with safe provider fallback', () => {
    expect(encodePhaseOption('openrouter', null)).toBe('openrouter::__default__');
    expect(decodePhaseOption('openrouter::__default__')).toEqual({
      provider: 'openrouter',
      modelId: null,
    });
    expect(decodePhaseOption('codex::gpt-5.2')).toEqual({
      provider: 'codex',
      modelId: 'gpt-5.2',
    });
    expect(decodePhaseOption('unknown::model-x')).toEqual({
      provider: 'claude',
      modelId: 'model-x',
    });
  });

  it('decodes every shipped executor provider, including grok', () => {
    // Guards against the whitelist drifting out of sync with
    // PIPELINE_EXECUTOR_PROVIDERS when a new provider ships (PR #327: grok).
    for (const provider of PIPELINE_EXECUTOR_PROVIDERS) {
      expect(decodePhaseOption(`${provider}::some-model`)).toEqual({
        provider,
        modelId: 'some-model',
      });
    }
    expect(decodePhaseOption('grok::grok-4.5')).toEqual({
      provider: 'grok',
      modelId: 'grok-4.5',
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

  it('extracts plan fences from Claude result arrays and Codex agent messages', () => {
    const claudeResult = JSON.stringify({
      type: 'result',
      result: [
        { type: 'tool_use', text: 'ignored' },
        { type: 'text', text: wrapInFence(VALID_PLAN_JSON) },
      ],
    });
    expect(resolveClientSidePlan(claudeResult)?.objective).toBe('Add feature');

    const codexResult = [
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: wrapInFence(VALID_PLAN_JSON) },
      }),
      'not json',
    ].join('\n');
    expect(resolveClientSidePlan(codexResult)?.objective).toBe('Add feature');
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

  it('returns the generic parse failure when a valid plan still cannot be extracted', () => {
    expect(diagnosePlanParseFailure(wrapInFence(VALID_PLAN_JSON))).toBe(
      'Plan output could not be parsed. Check devtools console for the full trace.',
    );
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
    expect(getFailurePresentation('Execution failed: setup failed before agent run')).toEqual({
      label: 'Worktree execution failed',
      detail:
        'This error came from the target project/worktree or the executor run, not from Electron itself.',
    });
  });

  it('adds attempt counts and falls back to phase labels for generic failures', () => {
    expect(
      getFailurePresentation('command failed (1): bun test', {
        failurePhase: 'verifying',
        failureCount: 3,
      }),
    ).toEqual({
      label: 'Target project verification failed (attempt 3)',
      detail:
        'The failing command ran inside the issue worktree, not inside the ShipCode desktop app.',
    });

    expect(
      getFailurePresentation('unexpected crash', {
        failurePhase: 'reviewing',
        failureCount: 2,
      }),
    ).toEqual({
      label: 'Review failed (attempt 2)',
      detail: null,
    });

    expect(getFailurePresentation('unexpected crash')).toEqual({
      label: 'Pipeline error',
      detail: null,
    });
  });
});

describe('getTriageFailurePresentation', () => {
  it('returns null when there is no reason', () => {
    expect(getTriageFailurePresentation(null)).toBeNull();
    expect(getTriageFailurePresentation(undefined)).toBeNull();
    expect(getTriageFailurePresentation('   ')).toBeNull();
  });

  it('surfaces a label and the clamped reason as detail', () => {
    expect(getTriageFailurePresentation('  gh: label not found  ')).toEqual({
      label: 'Triage rule failed',
      detail: 'gh: label not found',
    });
  });
});

describe('safeErrorMessage', () => {
  it('returns plain text errors directly', () => {
    expect(safeErrorMessage('  plain failure  ')).toBe('plain failure');
  });

  it('extracts clamped result and error messages from JSONL output', () => {
    expect(safeErrorMessage(JSON.stringify({ type: 'result', result: 'x'.repeat(300) }))).toBe(
      'x'.repeat(280),
    );
    expect(safeErrorMessage(JSON.stringify({ error: 'fatal error' }))).toBe('fatal error');
    expect(
      safeErrorMessage(
        [
          JSON.stringify({ type: 'event', ignored: true }),
          JSON.stringify({ type: 'result', errors: ['first structured error'] }),
        ].join('\n'),
      ),
    ).toBe('first structured error');
  });

  it('falls back to generic copy when structured output has no usable error', () => {
    expect(safeErrorMessage(JSON.stringify({ type: 'event', ignored: true }))).toBe(
      'Pipeline failed in the target project/worktree. See terminal output for details.',
    );
  });
});

describe('resolveClientSidePlan', () => {
  it('returns null when all discovered plan fences are invalid', () => {
    expect(resolveClientSidePlan(wrapInFence('{ "objective": 42 }'))).toBeNull();
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

  it('uses non-failed plan output and review/default fallbacks for failed threads', () => {
    expect(
      resolveFailingPhaseOutput({
        thread: { status: 'planning', failurePhase: null },
        latestPlanRawOutput: 'planner transcript',
        latestReviewRawOutput: 'review transcript',
        latestVerificationRawOutput: 'verification transcript',
      }),
    ).toBe('planner transcript');

    expect(
      resolveFailingPhaseOutput({
        thread: { status: 'failed', failurePhase: 'reviewing' },
        latestPlanRawOutput: 'planner transcript',
        latestReviewRawOutput: null,
        latestVerificationRawOutput: null,
      }),
    ).toBe('planner transcript');

    expect(
      resolveFailingPhaseOutput({
        thread: { status: 'failed', failurePhase: 'shipping' },
        latestPlanRawOutput: 'planner transcript',
        latestReviewRawOutput: 'review transcript',
        latestVerificationRawOutput: 'verification transcript',
      }),
    ).toBe('verification transcript');
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
