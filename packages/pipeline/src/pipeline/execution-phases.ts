import { execFileSync } from 'node:child_process';
import {
  buildExecutionPrompt,
  buildVerificationPrompt,
  loadRepoContext,
  StreamParser,
} from '@shipcode/agents';
import { WorktreeManager } from '@shipcode/git';
import {
  EXECUTION_PHASES,
  type GitHubPrCheckSummary,
  type GitHubPrReviewCommentSummary,
  MAX_TEST_RETRIES,
  MAX_VERIFICATION_RETRIES,
  type ShipCodePlan,
} from '@shipcode/shared';
import type { PipelineHelperEnv } from './shared';

export function createExecutionPhaseHandlers({
  deps,
  contextHelpers,
  runtime,
  handlers,
}: PipelineHelperEnv) {
  const { activePipelines, skillCallSite } = contextHelpers;
  const {
    emitPhase,
    emitTerminalLifecycle,
    ensureRepoSetupContract,
    formatStabilizationFeedback,
    getTestingContext,
    getVerifyCommands,
    prepareWorktree,
    runProviderPhase,
    runShellCommand,
  } = runtime;

  async function startExecution(threadId: string, plan: ShipCodePlan) {
    const settings = deps.settings.get();
    const executingCount = contextHelpers.listActiveInPhases(EXECUTION_PHASES).length;
    if (executingCount >= settings.maxConcurrentExecutions) {
      // Execution slots full — stay in awaiting_approval until a slot frees
      emitPhase(threadId, 'awaiting_approval');
      return;
    }

    const context = activePipelines.get(threadId);
    if (!context) return;

    if (context.repoContext === null) {
      context.repoContext = loadRepoContext(context.worktreePath ?? context.projectPath);
    }
    try {
      ensureRepoSetupContract(context);
    } catch (error) {
      emitPhase(threadId, 'failed', error instanceof Error ? error.message : String(error));
      activePipelines.delete(threadId);
      return;
    }

    if (!context.worktreePath) {
      try {
        const appSettings = deps.settings.get();
        const worktreeManager = new WorktreeManager(context.projectPath, {
          worktreeRoot: appSettings.worktreeRoot,
          branchFormat: appSettings.worktreeBranchFormat,
        });
        const worktree = context.githubIssueNumber
          ? await worktreeManager.create(
              context.githubIssueNumber,
              context.githubIssueTitle ?? '',
              context.baseBranch || undefined,
            )
          : await worktreeManager.create(threadId, context.baseBranch || undefined);
        context.worktreePath = worktree.worktreePath;
        deps.threads.setWorktree(threadId, worktree.branch, worktree.worktreePath);
      } catch (error) {
        console.error(`[pipeline] worktree creation failed for thread ${threadId}:`, error);
        emitPhase(threadId, 'failed', `Worktree creation failed: ${String(error)}`);
        activePipelines.delete(threadId);
        return;
      }
    }

    emitPhase(threadId, 'executing');

    const preparation = await prepareWorktree(context, 'execute');
    if (!preparation.ok) {
      emitPhase(threadId, 'failed', `Setup failed: ${preparation.error}`);
      activePipelines.delete(threadId);
      return;
    }

    try {
      const cwd = context.worktreePath ?? context.projectPath;
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
      const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
      const latest = deps.checkpoints.getLatest(threadId);
      const retryOrdinal =
        1 + context.reviewRound + context.testRetries + context.verificationRetries;
      const reason = retryOrdinal > 1 ? 'before_retry' : 'before_execute';
      const label =
        retryOrdinal > 1 ? `Before execute retry ${retryOrdinal}` : 'Before execute attempt 1';

      if (
        !latest ||
        latest.commitSha !== commitSha ||
        latest.phase !== 'executing' ||
        latest.reason !== reason
      ) {
        deps.checkpoints.create({
          threadId,
          projectId: context.projectId,
          phase: 'executing',
          reason,
          label,
          branch,
          commitSha,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitPhase(threadId, 'failed', `Checkpoint creation failed: ${message}`);
      activePipelines.delete(threadId);
      return;
    }

    const skill = skillCallSite(context);
    const testFeedback =
      context.testOutput && context.testRetries > 0
        ? `\n\n<previous_test_failure>\nTests failed on the previous attempt. Fix these issues before finishing:\n\n${context.testOutput}\n</previous_test_failure>`
        : '';
    context.testOutput = null;
    const stabilizationFeedback = context.stabilizationFeedback ?? '';
    context.stabilizationFeedback = null;
    const executionPrompt =
      buildExecutionPrompt(plan, skill.context, skill.deps, {
        contextFiles: context.repoContext ?? undefined,
        testingContext: getTestingContext(context),
      }) +
      testFeedback +
      stabilizationFeedback;

    void (async () => {
      try {
        const response = await runProviderPhase(context, 'execute', executionPrompt, {
          reasoningEffort: context.executorReasoningEffort,
        });

        if (context.cancelled) return;

        if (response.exitCode === 0) {
          if (context.autonomous) {
            handlers.startTesting(threadId);
          } else {
            emitPhase(threadId, 'completed');
            activePipelines.delete(threadId);
          }
        } else {
          const rawErrSnippet = response.rawOutput
            .trim()
            .split('\n')
            .slice(-3)
            .join(' ')
            .slice(0, 300);
          const errSnippet = rawErrSnippet.trimStart().startsWith('{') ? '' : rawErrSnippet;
          emitPhase(
            threadId,
            'failed',
            `Execution failed (exit ${response.exitCode})${errSnippet ? `: ${errSnippet}` : ''}`,
          );
          activePipelines.delete(threadId);
        }
      } catch (error) {
        if (!context.cancelled) {
          emitPhase(threadId, 'failed', `Execution error: ${String(error)}`);
          activePipelines.delete(threadId);
        }
      }
    })();
  }

  async function startTesting(threadId: string) {
    const context = activePipelines.get(threadId);
    if (!context) return;

    try {
      ensureRepoSetupContract(context);
    } catch (error) {
      emitPhase(threadId, 'failed', error instanceof Error ? error.message : String(error));
      activePipelines.delete(threadId);
      return;
    }

    const verifyCommands = getVerifyCommands(context);
    if (verifyCommands.length === 0) {
      handlers.startVerification(threadId);
      return;
    }

    emitPhase(threadId, 'testing');

    const cwd = context.worktreePath ?? context.projectPath;
    const preparation = await prepareWorktree(context, 'verify');
    if (!preparation.ok) {
      emitPhase(threadId, 'failed', `Verification preflight failed: ${preparation.error}`);
      activePipelines.delete(threadId);
      return;
    }

    const outputs: string[] = [];
    for (const command of verifyCommands) {
      emitTerminalLifecycle(threadId, `[verify] $ ${command}\r\n`);
      try {
        const result = await runShellCommand(threadId, cwd, command, context.abort.signal);
        outputs.push(result.output);
        context.testOutput = outputs.join('\n').slice(-16384);
        if (result.exitCode !== 0) {
          if (context.testRetries < MAX_TEST_RETRIES) {
            context.testRetries++;
            const latestPlan = deps.plans.getLatest(threadId);
            if (latestPlan?.structured) {
              handlers.startExecution(threadId, latestPlan.structured);
            } else {
              emitPhase(
                threadId,
                'failed',
                'Verification commands failed — plan unavailable for re-execution.',
              );
              activePipelines.delete(threadId);
            }
          } else {
            deps.emitter.emit({
              type: 'pipeline:verification-exhausted',
              threadId,
              retries: context.testRetries,
            });
            emitPhase(
              threadId,
              'failed',
              `Verification commands failed after ${context.testRetries + 1} attempt(s). See terminal output.`,
            );
            activePipelines.delete(threadId);
          }
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emitPhase(threadId, 'failed', `Verification command error: ${message}`);
        activePipelines.delete(threadId);
        return;
      }
    }

    context.testRetries = 0;
    context.testOutput = null;
    handlers.startVerification(threadId);
  }

  async function startVerification(threadId: string) {
    const context = activePipelines.get(threadId);
    if (!context) return;

    emitPhase(threadId, 'verifying');

    const cwd = context.worktreePath ?? context.projectPath;
    const latestPlan = deps.plans.getLatest(threadId);
    if (!latestPlan?.structured) {
      emitPhase(threadId, 'failed');
      activePipelines.delete(threadId);
      return;
    }

    const plan = latestPlan.structured;

    try {
      const dirty = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8' });
      if (dirty.trim()) {
        execFileSync('git', ['add', '-A'], { cwd, encoding: 'utf-8' });
        const title = context.githubIssueTitle ?? 'Apply plan changes';
        const issueRef = context.githubIssueNumber ? ` (#${context.githubIssueNumber})` : '';
        execFileSync('git', ['commit', '--no-verify', '-m', `${title}${issueRef}`], {
          cwd,
          encoding: 'utf-8',
        });
      }
    } catch (commitError) {
      const msg = commitError instanceof Error ? commitError.message : String(commitError);
      console.error(`[pipeline] pre-verification commit failed for thread ${threadId}:`, msg);
      emitPhase(threadId, 'failed', `Pre-verification commit failed: ${msg}`);
      activePipelines.delete(threadId);
      return;
    }

    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' }).trim();
    context.verifiedSha = headSha;

    let diff: string;
    try {
      diff = execFileSync('git', ['diff', `${context.forkPointSha}..${headSha}`], {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      }).toString();
    } catch {
      diff = '';
    }

    if (!diff.trim()) {
      deps.verifications.create(threadId, latestPlan.id, 'No changes detected', null);
      emitPhase(threadId, 'failed');
      activePipelines.delete(threadId);
      return;
    }

    const skill = skillCallSite(context);
    const verificationPrompt = buildVerificationPrompt(
      plan,
      diff,
      plan.acceptanceCriteria,
      skill.context,
      skill.deps,
      context.testOutput ?? null,
      { contextFiles: context.repoContext ?? undefined },
    );

    void (async () => {
      try {
        const response = await runProviderPhase(context, 'verify', verificationPrompt, {
          reasoningEffort: context.verifierReasoningEffort,
        });

        if (context.cancelled) return;

        const parser = new StreamParser();
        parser.feed(response.rawOutput);
        const result = parser.extractVerification();

        if (result.success && result.data) {
          deps.verifications.create(threadId, latestPlan.id, result.raw, result.data);
          deps.emitter.emit({ type: 'verification:parsed', threadId, verification: result.data });

          if (result.data.result === 'passed') {
            handlers.startCommitAndPush(threadId);
          } else if (context.verificationRetries < MAX_VERIFICATION_RETRIES) {
            context.verificationRetries++;
            handlers.startExecution(threadId, plan);
          } else {
            deps.emitter.emit({
              type: 'pipeline:verification-exhausted',
              threadId,
              retries: context.verificationRetries,
            });
            emitPhase(threadId, 'failed');
            activePipelines.delete(threadId);
          }
        } else {
          deps.verifications.create(threadId, latestPlan.id, parser.getRawOutput(), null);
          emitPhase(threadId, 'failed');
          activePipelines.delete(threadId);
        }
      } catch {
        if (!context.cancelled) {
          emitPhase(threadId, 'failed');
          activePipelines.delete(threadId);
        }
      }
    })();
  }

  async function startCommitAndPush(threadId: string) {
    const context = activePipelines.get(threadId);
    if (!context) return;

    const cwd = context.worktreePath ?? context.projectPath;

    try {
      const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
      if (context.verifiedSha && context.verifiedSha !== currentHead) {
        emitPhase(threadId, 'failed');
        activePipelines.delete(threadId);
        return;
      }

      const ahead = execFileSync('git', ['log', `${context.forkPointSha}..HEAD`, '--oneline'], {
        cwd,
        encoding: 'utf-8',
      });
      if (!ahead.trim()) {
        emitPhase(threadId, 'failed');
        activePipelines.delete(threadId);
        return;
      }

      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
      execFileSync('git', ['push', 'origin', branch, '--set-upstream'], { cwd, encoding: 'utf-8' });

      handlers.startShipping(threadId);
    } catch {
      try {
        const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd,
          encoding: 'utf-8',
        }).trim();
        execFileSync('git', ['push', 'origin', branch, '--set-upstream'], {
          cwd,
          encoding: 'utf-8',
        });
        handlers.startShipping(threadId);
      } catch {
        emitPhase(threadId, 'failed');
        activePipelines.delete(threadId);
      }
    }
  }

  async function startShipping(threadId: string) {
    const context = activePipelines.get(threadId);
    if (!context) return;

    emitPhase(threadId, 'shipping');

    if (!context.githubIssueNumber) {
      emitPhase(threadId, 'completed');
      activePipelines.delete(threadId);
      return;
    }

    const cwd = context.worktreePath ?? context.projectPath;

    try {
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
      const latestPlan = deps.plans.getLatest(threadId);
      const plan = latestPlan?.structured;
      const title = plan?.objective ?? `ShipCode: Issue #${context.githubIssueNumber}`;
      const body = [
        '## Summary',
        plan?.objective ?? '',
        '',
        `Closes #${context.githubIssueNumber}`,
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
    } catch {
      emitPhase(threadId, 'failed');
    }
    activePipelines.delete(threadId);
  }

  async function startStabilization(
    threadId: string,
    inputs: {
      prNumber: number;
      prUrl: string | null;
      failingChecks: GitHubPrCheckSummary[];
      unresolvedReviewComments: GitHubPrReviewCommentSummary[];
    },
  ) {
    const context = activePipelines.get(threadId);
    if (!context) return;

    const latestPlan = deps.plans.getLatest(threadId);
    if (!latestPlan?.structured) {
      throw new Error(`Thread ${threadId}: missing approved plan for stabilization`);
    }

    context.cancelled = false;
    context.stabilizationFeedback = formatStabilizationFeedback(inputs);
    context.verifiedSha = null;
    await handlers.startExecution(threadId, latestPlan.structured);
  }

  return {
    startExecution,
    startTesting,
    startVerification,
    startCommitAndPush,
    startShipping,
    startStabilization,
  };
}
