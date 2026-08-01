import { execFileSync } from 'node:child_process';
import { buildPRBody, GhCli, type PrReviewEvent } from '@shipcode/agents';
import {
  clampError,
  type GitHubPrCheckSummary,
  type GitHubPrReviewCommentSummary,
  isRealGithubIssueNumber,
} from '@shipcode/shared';

import { resetPhaseState } from './context';
import { normalizeFeatureQaResults, resolveWorktreeDiffBase } from './execution-phase-utils';
import {
  formatReviewFindingsPrComment,
  REVIEW_FINDINGS_PR_COMMENT_MARKER,
} from './review-findings';
import type { PhaseOutcome, PipelineHelperEnv } from './shared';
import { assertPersistedWorktreeTarget } from './worktree-target-guard';

export function resolveFormalPrReviewEvent(
  decision: 'approve' | 'request_changes' | 'reject' | null,
  findings: Array<{ status: string; severity: string }>,
): PrReviewEvent {
  if (decision === 'request_changes' || decision === 'reject') return 'request-changes';
  const hasOpenSevereFinding = findings.some(
    (finding) =>
      finding.status === 'open' && ['critical', 'major', 'blocker'].includes(finding.severity),
  );
  return hasOpenSevereFinding ? 'request-changes' : 'approve';
}

export function createShippingPhaseHandlers({ deps, contextHelpers, runtime }: PipelineHelperEnv) {
  const { activePipelines } = contextHelpers;
  const { emitPhase, formatStabilizationFeedback } = runtime;

  async function publishReviewFindingsComment(
    context: NonNullable<ReturnType<typeof activePipelines.get>>,
    prNumber: number,
    decision: 'approve' | 'request_changes' | 'reject' | null,
  ): Promise<void> {
    if (!deps.reviewFindings) return;

    const findings = deps.reviewFindings.listByThread(context.threadId, { includeClosed: true });
    try {
      const ghCli = new GhCli(context.worktreePath ?? context.projectPath);
      const body = formatReviewFindingsPrComment(findings);
      if (deps.settings.get().postFormalPrReviewEnabled) {
        const result = await ghCli.submitPrReview(
          prNumber,
          resolveFormalPrReviewEvent(decision, findings),
          body,
        );
        if (result.downgradedForSelfReview) {
          console.info(
            `[pipeline] Submitted PR #${prNumber} review as a comment because ShipCode authored the PR.`,
          );
        }
      } else {
        await ghCli.upsertIssueCommentByMarker(prNumber, REVIEW_FINDINGS_PR_COMMENT_MARKER, body);
      }
    } catch (error) {
      console.warn(
        `[pipeline] Failed to publish review findings to PR #${prNumber}: ${clampError(error)}`,
      );
    }
  }

  async function startCommitAndPush(threadId: string): Promise<PhaseOutcome> {
    const context = activePipelines.get(threadId);
    if (!context) return { next: 'paused' };

    try {
      await assertPersistedWorktreeTarget(deps, context);
    } catch (error) {
      emitPhase(threadId, 'failed', error instanceof Error ? error.message : String(error));
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }

    const cwd = context.worktreePath ?? context.projectPath;

    // Preflight is fail-closed: HEAD/log/branch errors must never fall through
    // into a push retry (that used to push after a broken preflight).
    let branch: string;
    try {
      const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
      if (context.verifiedSha && context.verifiedSha !== currentHead) {
        emitPhase(
          threadId,
          'failed',
          'Commit aborted: HEAD moved after verification (verifiedSha mismatch).',
        );
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }

      const diffBase = await resolveWorktreeDiffBase(context);
      const ahead = diffBase
        ? execFileSync('git', ['log', `${diffBase}..HEAD`, '--oneline'], {
            cwd,
            encoding: 'utf-8',
          })
        : '';
      if (!ahead.trim()) {
        emitPhase(
          threadId,
          'failed',
          'Commit aborted: no commits ahead of worktree base — nothing to push.',
        );
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }

      branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
    } catch (preflightErr) {
      // Raw git stderr is multiline; keep the full trace in the main-process log
      // and hand the renderer a clamped single line.
      console.error('[pipeline] commit/push preflight failed', preflightErr);
      emitPhase(threadId, 'failed', `Commit aborted during preflight: ${clampError(preflightErr)}`);
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }

    try {
      execFileSync('git', ['push', 'origin', branch, '--set-upstream'], { cwd, encoding: 'utf-8' });
      resetPhaseState(context);
      return { next: 'shipping' };
    } catch (firstErr) {
      try {
        execFileSync('git', ['push', 'origin', branch, '--set-upstream'], {
          cwd,
          encoding: 'utf-8',
        });
        resetPhaseState(context);
        return { next: 'shipping' };
      } catch (secondErr) {
        console.error('[pipeline] push failed on both attempts', firstErr, secondErr);
        emitPhase(
          threadId,
          'failed',
          `Commit and push failed (both attempts). first=${clampError(firstErr, 120)} retry=${clampError(secondErr, 120)}`,
        );
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }
    }
  }

  async function startShipping(threadId: string): Promise<PhaseOutcome> {
    const context = activePipelines.get(threadId);
    if (!context) return { next: 'paused' };

    try {
      await assertPersistedWorktreeTarget(deps, context);
    } catch (error) {
      emitPhase(threadId, 'failed', error instanceof Error ? error.message : String(error));
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }

    emitPhase(threadId, 'shipping');

    if (!isRealGithubIssueNumber(context.githubIssueNumber)) {
      // Quick tasks (negative sentinel) and pipelines without an issue
      // skip PR shipping. Branch is left on disk for manual follow-up.
      emitPhase(threadId, 'completed');
      activePipelines.delete(threadId);
      return { next: 'done' };
    }
    const issueNumber = context.githubIssueNumber;

    const cwd = context.worktreePath ?? context.projectPath;

    try {
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
      const latestPlan = deps.plans.getLatest(threadId);
      const plan = latestPlan?.structured;
      const title = plan?.objective ?? `ShipCode: Issue #${context.githubIssueNumber}`;

      // Collect reviews for the latest plan
      const reviews = latestPlan
        ? (() => {
            const review = deps.reviews.getByPlanId(latestPlan.id);
            return review?.structured ? [review.structured] : [];
          })()
        : [];

      // Get latest verification
      const latestVerification = deps.verifications.getLatest(threadId);
      const featureQaResults = normalizeFeatureQaResults(
        deps.featureQaResults?.listByThread(threadId) ?? [],
      );

      const body = plan
        ? buildPRBody(plan, reviews, latestVerification?.structured ?? null, issueNumber, {
            projectId: context.projectId,
            skills: deps.skills,
            featureQaResults,
          })
        : [
            '## Summary',
            `Closes #${issueNumber}`,
            '',
            '---',
            '*Autonomous implementation by ShipCode*',
          ].join('\n');

      if (!context.baseBranch) {
        throw new Error(`Thread ${threadId}: missing baseBranch at PR creation`);
      }

      const existingPrJson = execFileSync(
        'gh',
        [
          'pr',
          'list',
          '--state',
          'all',
          '--head',
          branch,
          '--json',
          'number,url,isDraft',
          '--limit',
          '1',
        ],
        { cwd, encoding: 'utf-8' },
      );
      const existingPr = (
        JSON.parse(existingPrJson) as Array<{
          number: number;
          url: string;
          isDraft: boolean;
        }>
      )[0];

      let prNumber: number | null = null;
      let prUrl: string | null = null;
      let prIsDraft = true;
      let created = false;

      if (existingPr) {
        prNumber = existingPr.number;
        prUrl = existingPr.url;
        prIsDraft = !!existingPr.isDraft;
        execFileSync(
          'gh',
          ['pr', 'edit', String(existingPr.number), '--title', title, '--body', body],
          { cwd, encoding: 'utf-8' },
        );
      } else {
        const prOutput = execFileSync(
          'gh',
          [
            'pr',
            'create',
            '--draft',
            '--title',
            title,
            '--body',
            body,
            '--head',
            branch,
            '--base',
            context.baseBranch,
          ],
          { cwd, encoding: 'utf-8' },
        );
        const prMatch = prOutput.match(/\/pull\/(\d+)/);
        if (!prMatch) {
          throw new Error(`Failed to parse pull request number from: ${prOutput}`);
        }
        prNumber = Number.parseInt(prMatch[1], 10);
        prUrl = prOutput.trim();
        created = true;
      }

      if (prNumber) {
        deps.threads.setGithubPr(threadId, prNumber);

        if (context.projectId && context.githubIssueNumber) {
          const issue = deps.githubIssues.getByNumber(context.projectId, context.githubIssueNumber);
          if (issue) {
            deps.githubIssues.updatePullRequestFeedback(issue.id, {
              linkedPrNumber: prNumber,
              linkedPrUrl: prUrl,
              linkedPrIsDraft: prIsDraft,
              ciBlocked: issue.ciBlocked,
              failingChecks: issue.failingChecks,
              unresolvedReviewComments: issue.unresolvedReviewComments,
            });
          }
        }

        await publishReviewFindingsComment(context, prNumber, reviews[0]?.decision ?? null);

        if (created) {
          try {
            execFileSync(
              'gh',
              [
                'issue',
                'comment',
                String(context.githubIssueNumber),
                '--body',
                `Draft PR #${prNumber} opened by ShipCode.`,
              ],
              { cwd, encoding: 'utf-8' },
            );
          } catch {
            // best effort comment
          }
        }
      }

      emitPhase(threadId, 'completed');
      activePipelines.delete(threadId);
      return { next: 'done' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitPhase(threadId, 'failed', `Shipping failed: ${message}`);
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }
  }

  async function startStabilization(
    threadId: string,
    inputs: {
      prNumber: number;
      prUrl: string | null;
      failingChecks: GitHubPrCheckSummary[];
      unresolvedReviewComments: GitHubPrReviewCommentSummary[];
    },
  ): Promise<PhaseOutcome> {
    const context = activePipelines.get(threadId);
    if (!context) return { next: 'paused' };

    const latestPlan = deps.plans.getLatest(threadId);
    if (!latestPlan?.structured) {
      throw new Error(`Thread ${threadId}: missing approved plan for stabilization`);
    }

    context.cancelled = false;
    resetPhaseState(context);
    context.verifiedSha = null;
    return {
      next: 'execute',
      plan: latestPlan.structured,
      carry: { stabilizationFeedback: formatStabilizationFeedback(inputs) },
    };
  }

  return {
    startCommitAndPush,
    startShipping,
    startStabilization,
  };
}
