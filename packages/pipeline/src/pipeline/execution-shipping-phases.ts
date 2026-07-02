import { execFileSync } from 'node:child_process';
import { buildPRBody, GhCli } from '@shipcode/agents';
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

export function createShippingPhaseHandlers({ deps, contextHelpers, runtime }: PipelineHelperEnv) {
  const { activePipelines } = contextHelpers;
  const { emitPhase, formatStabilizationFeedback } = runtime;

  async function publishReviewFindingsComment(
    context: NonNullable<ReturnType<typeof activePipelines.get>>,
    prNumber: number,
  ): Promise<void> {
    if (!deps.reviewFindings) return;

    const findings = deps.reviewFindings.listByThread(context.threadId, { includeClosed: true });
    try {
      const ghCli = new GhCli(context.worktreePath ?? context.projectPath);
      await ghCli.upsertIssueCommentByMarker(
        prNumber,
        REVIEW_FINDINGS_PR_COMMENT_MARKER,
        formatReviewFindingsPrComment(findings),
      );
    } catch (error) {
      console.warn(
        `[pipeline] Failed to publish review findings to PR #${prNumber}: ${clampError(error)}`,
      );
    }
  }

  async function startCommitAndPush(threadId: string): Promise<PhaseOutcome> {
    const context = activePipelines.get(threadId);
    if (!context) return { next: 'paused' };

    const cwd = context.worktreePath ?? context.projectPath;

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

      const diffBase = resolveWorktreeDiffBase(context);
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

      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
      execFileSync('git', ['push', 'origin', branch, '--set-upstream'], { cwd, encoding: 'utf-8' });

      resetPhaseState(context);
      return { next: 'shipping' };
    } catch (firstErr) {
      try {
        const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd,
          encoding: 'utf-8',
        }).trim();
        execFileSync('git', ['push', 'origin', branch, '--set-upstream'], {
          cwd,
          encoding: 'utf-8',
        });
        resetPhaseState(context);
        return { next: 'shipping' };
      } catch (secondErr) {
        const message = secondErr instanceof Error ? secondErr.message : String(secondErr);
        const firstMessage = firstErr instanceof Error ? firstErr.message : String(firstErr);
        emitPhase(
          threadId,
          'failed',
          `Commit and push failed (both attempts). first=${firstMessage.slice(0, 120)} retry=${message.slice(0, 120)}`,
        );
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }
    }
  }

  async function startShipping(threadId: string): Promise<PhaseOutcome> {
    const context = activePipelines.get(threadId);
    if (!context) return { next: 'paused' };

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

        await publishReviewFindingsComment(context, prNumber);

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
