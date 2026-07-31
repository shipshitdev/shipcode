import type {
  PipelineCheckpoint,
  PlanRecord,
  ReviewRecord,
  Thread,
  VerificationRecord,
} from '@shipcode/shared';
import { clampTextBlock, PIPELINE_EXECUTOR_PROVIDERS } from '@shipcode/shared';
import { describe, expect, it } from 'vitest';
import {
  buildRestoreCheckpointConfirmMessage,
  decodePhaseOption,
  diagnosePlanParseFailure,
  encodePhaseOption,
  getFailurePresentation,
  getPlanStatusPresentation,
  getTriageFailurePresentation,
  resolveClientSidePlan,
  resolveFailingPhaseOutput,
  resolveIssueRetryPresentation,
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

function makeRetryThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Test thread',
    prompt: 'Prompt',
    status: 'failed',
    kind: 'pipeline',
    worktreeBranch: null,
    worktreePath: null,
    plannerModel: 'claude',
    reviewerModel: 'codex',
    verifierModel: 'claude',
    executorModel: 'claude',
    reviewRound: 0,
    clarificationRound: 0,
    clarificationRequest: null,
    clarificationAnswers: [],
    answeredClarification: null,
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: true,
    baseBranch: 'main',
    forkPointSha: 'abc123',
    githubIssueNumber: 42,
    githubPrNumber: null,
    githubRepo: 'shipshitdev/shipcode',
    automationId: null,
    lastError: null,
    failurePhase: null,
    failureCount: 0,
    pausedPhase: null,
    pausedAt: null,
    createdAt: '2026-04-14T00:00:00.000Z',
    updatedAt: '2026-04-14T00:00:00.000Z',
    plannerResolvedModel: null,
    reviewerResolvedModel: null,
    revisorResolvedModel: null,
    executorResolvedModel: null,
    verifierResolvedModel: null,
    totalTokensPrompt: 0,
    totalTokensCompletion: 0,
    totalCostUsd: 0,
    doneAt: null,
    ...overrides,
  };
}

function makeRetryPlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return makePlan({
    status: 'approved',
    structured: {
      id: 'plan-1',
      threadId: 'thread-1',
      version: 1,
      objective: 'Do thing',
      files: [],
      steps: [],
      acceptanceCriteria: [],
      outOfScope: [],
      estimatedComplexity: 'low',
      dependencies: [],
    },
    ...overrides,
  });
}

function makeVerification(overrides: Partial<VerificationRecord> = {}): VerificationRecord {
  return {
    id: 'verification-1',
    threadId: 'thread-1',
    planId: 'plan-1',
    rawOutput: 'raw',
    structured: null,
    result: 'failed',
    retryCount: 0,
    createdAt: '2026-04-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveIssueRetryPresentation', () => {
  it('returns no action when the issue has no thread', () => {
    expect(
      resolveIssueRetryPresentation({ thread: null, latestPlan: null, latestVerification: null }),
    ).toEqual({
      retryAction: null,
      retryButtonLabel: 'Re-plan',
      retrySummary: null,
    });
  });

  it.each([
    {
      name: 'planning',
      thread: makeRetryThread(),
      plan: null,
      verification: null,
      retryAction: 'plan',
      retryButtonLabel: 'Re-plan',
      retrySummary:
        'Retry will start a fresh planning pass. This resumes the workflow, not the same live planner session.',
    },
    {
      name: 'review',
      thread: makeRetryThread(),
      plan: makeRetryPlan(),
      verification: null,
      retryAction: 'review',
      retryButtonLabel: 'Resume review',
      retrySummary: 'Retry will resume from review using the latest structured plan.',
    },
    {
      name: 'execution',
      thread: makeRetryThread({ worktreePath: '/tmp/project' }),
      plan: makeRetryPlan(),
      verification: null,
      retryAction: 'execute',
      retryButtonLabel: 'Resume execution',
      retrySummary: 'Retry will resume from execution using the latest structured plan.',
    },
    {
      name: 'verification',
      thread: makeRetryThread({ worktreePath: '/tmp/project' }),
      plan: makeRetryPlan(),
      verification: makeVerification(),
      retryAction: 'verify',
      retryButtonLabel: 'Resume verification',
      retrySummary: 'Retry will resume from verification using the current worktree.',
    },
    {
      name: 'shipping',
      thread: makeRetryThread({ worktreePath: '/tmp/project' }),
      plan: makeRetryPlan(),
      verification: makeVerification({ result: 'passed' }),
      retryAction: 'commit_and_push',
      retryButtonLabel: 'Resume shipping',
      retrySummary: 'Retry will resume from commit and push using the verified worktree.',
    },
  ])('maps the shared $name decision to renderer copy', ({
    thread,
    plan,
    verification,
    retryAction,
    retryButtonLabel,
    retrySummary,
  }) => {
    expect(
      resolveIssueRetryPresentation({
        thread,
        latestPlan: plan,
        latestVerification: verification,
      }),
    ).toEqual({ retryAction, retryButtonLabel, retrySummary });
  });

  it('explains that structured verification failures resume from execution with feedback', () => {
    const latestVerification = makeVerification({
      structured: {
        threadId: 'thread-1',
        planId: 'plan-1',
        result: 'failed',
        summary: 'Not OK',
        criteriaResults: [],
        issues: [],
      },
    });

    expect(
      resolveIssueRetryPresentation({
        thread: makeRetryThread({ worktreePath: '/tmp/project' }),
        latestPlan: makeRetryPlan(),
        latestVerification,
      }),
    ).toEqual({
      retryAction: 'execute',
      retryButtonLabel: 'Resume execution',
      retrySummary:
        'Retry will resume from execution using the current worktree and latest verification feedback.',
    });
  });

  it('preserves the no-code-changes re-plan guidance from the shared decision', () => {
    expect(
      resolveIssueRetryPresentation({
        thread: makeRetryThread({
          lastError: 'Executor exited successfully but produced no code changes',
          worktreePath: '/tmp/project',
        }),
        latestPlan: makeRetryPlan(),
        latestVerification: null,
      }),
    ).toEqual({
      retryAction: 'plan',
      retryButtonLabel: 'Re-plan',
      retrySummary:
        'The executor produced no file changes. Update the issue description with more detail before replanning.',
    });
  });
});

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

describe('PHASE_PROVIDER_OPTIONS', () => {
  it('matches PHASE_DESCRIPTORS validProviders (Cursor/Grok execute-only)', async () => {
    const { PHASE_DESCRIPTORS } = await import('@shipcode/shared');
    const { PHASE_PROVIDER_OPTIONS } = await import('./helpers');

    for (const descriptor of PHASE_DESCRIPTORS) {
      expect(PHASE_PROVIDER_OPTIONS[descriptor.key]).toEqual([...descriptor.validProviders]);
    }
    expect(PHASE_PROVIDER_OPTIONS.planner).not.toContain('cursor');
    expect(PHASE_PROVIDER_OPTIONS.planner).not.toContain('grok');
    expect(PHASE_PROVIDER_OPTIONS.reviewer).not.toContain('cursor');
    expect(PHASE_PROVIDER_OPTIONS.verifier).not.toContain('grok');
    expect(PHASE_PROVIDER_OPTIONS.executor).toContain('cursor');
    expect(PHASE_PROVIDER_OPTIONS.executor).toContain('grok');
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

describe('buildRestoreCheckpointConfirmMessage', () => {
  const baseCheckpoint: PipelineCheckpoint = {
    id: 'checkpoint-1',
    threadId: 'thread-1',
    projectId: 'project-1',
    phase: 'executing',
    reason: 'before_execute',
    label: 'Before execute attempt 1',
    branch: 'shipcode/thread-1',
    commitSha: 'abcdef1234567890',
    refName: 'refs/shipcode/checkpoints/thread-1/turn/2',
    createdAt: '2026-07-10T00:00:00.000Z',
  };

  it('states the full blast radius of restore, not just newly-created files', () => {
    const message = buildRestoreCheckpointConfirmMessage(baseCheckpoint);
    expect(message).toContain('Before execute attempt 1');
    // The whole point of the fix: restore reverts ALL uncommitted work, so the
    // copy must say so and must not imply it only removes new files.
    expect(message).toContain('reverts ALL uncommitted changes');
    expect(message).toContain('manual edits');
    expect(message).not.toMatch(/remove files created after/i);
    // Reassures the user their current state is recoverable.
    expect(message).toContain('Before restore');
    // Ref-backed checkpoints restore the captured dirty snapshot.
    expect(message).toContain('uncommitted changes captured with it');
    expect(message).toContain('does not resume the same planner session');
  });

  it('names the commit for legacy rows that have no checkpoint ref', () => {
    const legacy: PipelineCheckpoint = { ...baseCheckpoint, refName: null };
    const message = buildRestoreCheckpointConfirmMessage(legacy);
    expect(message).toContain('reverts ALL uncommitted changes');
    expect(message).toContain('commit abcdef123456');
    expect(message).toContain('Before restore');
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
