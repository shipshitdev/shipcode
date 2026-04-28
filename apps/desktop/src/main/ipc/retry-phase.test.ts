import type { PlanRecord, Thread, VerificationRecord } from '@shipcode/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getRetryAction } from './retry-phase';

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Test thread',
    prompt: 'Prompt',
    status: 'failed',
    kind: 'pipeline' as const,
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
    ...overrides,
  };
}

function makePlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 'plan-1',
    threadId: 'thread-1',
    version: 1,
    rawOutput: 'raw',
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
    status: 'approved',
    createdAt: '2026-04-14T00:00:00.000Z',
    ...overrides,
  };
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

describe('getRetryAction', () => {
  let thread: Thread;

  beforeEach(() => {
    thread = makeThread();
  });

  it('restarts planning when no structured plan exists', () => {
    expect(getRetryAction(thread, null, null)).toBe('plan');
    expect(getRetryAction(thread, makePlan({ structured: null }), null)).toBe('plan');
  });

  it('restarts review when there is a plan but no worktree yet', () => {
    expect(getRetryAction(thread, makePlan(), null)).toBe('review');
  });

  it('restarts execution when the worktree exists and verification has not run for the latest plan', () => {
    thread = makeThread({ worktreePath: '/tmp/project', worktreeBranch: 'ship/1-test' });
    expect(getRetryAction(thread, makePlan(), null)).toBe('execute');
    expect(
      getRetryAction(
        thread,
        makePlan(),
        makeVerification({ planId: 'older-plan', result: 'failed' }),
      ),
    ).toBe('execute');
  });

  it('restarts execution when the latest verification failed with structured findings for the current plan', () => {
    thread = makeThread({ worktreePath: '/tmp/project', worktreeBranch: 'ship/1-test' });
    expect(
      getRetryAction(
        thread,
        makePlan(),
        makeVerification({
          result: 'failed',
          structured: {
            threadId: 'thread-1',
            planId: 'plan-1',
            result: 'failed',
            summary: 'Not OK',
            criteriaResults: [],
            issues: [],
          },
        }),
      ),
    ).toBe('execute');
  });

  it('restarts verification when the latest verification failed without structured findings for the current plan', () => {
    thread = makeThread({ worktreePath: '/tmp/project', worktreeBranch: 'ship/1-test' });
    expect(getRetryAction(thread, makePlan(), makeVerification({ result: 'failed' }))).toBe(
      'verify',
    );
  });

  it('restarts commit and push when the latest verification passed for the current plan', () => {
    thread = makeThread({ worktreePath: '/tmp/project', worktreeBranch: 'ship/1-test' });
    expect(getRetryAction(thread, makePlan(), makeVerification({ result: 'passed' }))).toBe(
      'commit_and_push',
    );
  });
});
