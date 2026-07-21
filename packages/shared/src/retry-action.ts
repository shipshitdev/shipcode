import type { PlanRecord, Thread, VerificationRecord } from './types';

export type RetryAction = 'plan' | 'review' | 'execute' | 'verify' | 'commit_and_push';

export function getRetryAction(
  thread: Thread,
  latestPlan: PlanRecord | null,
  latestVerification: VerificationRecord | null,
): RetryAction {
  if (/no code changes/i.test(thread.lastError ?? '')) {
    return 'plan';
  }

  const structuredPlan = latestPlan?.structured ?? null;
  if (!structuredPlan) {
    return 'plan';
  }

  if (!thread.worktreePath) {
    return 'review';
  }

  if (latestVerification?.planId === latestPlan?.id) {
    if (latestVerification.result === 'failed' && latestVerification.structured) {
      return 'execute';
    }
    if (latestVerification.result === 'failed') {
      return 'verify';
    }
    if (latestVerification.result === 'passed') {
      return 'commit_and_push';
    }
  }

  return 'execute';
}
