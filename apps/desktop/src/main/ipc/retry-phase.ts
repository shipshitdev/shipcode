import type { PlanRecord, Thread, VerificationRecord } from '@shipcode/shared';

export type RetryAction = 'plan' | 'review' | 'execute' | 'verify' | 'commit_and_push';

export function getRetryAction(
  thread: Thread,
  latestPlan: PlanRecord | null,
  latestVerification: VerificationRecord | null,
): RetryAction {
  const structuredPlan = latestPlan?.structured ?? null;
  if (!structuredPlan) {
    return 'plan';
  }

  if (!thread.worktreePath) {
    return 'review';
  }

  const verification = latestVerification;
  if (verification && verification.planId === latestPlan?.id) {
    if (verification.result === 'failed' && verification.structured) {
      return 'execute';
    }
    if (verification.result === 'failed') {
      return 'verify';
    }
    if (verification.result === 'passed') {
      return 'commit_and_push';
    }
  }

  return 'execute';
}
