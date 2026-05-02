import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import {
  buildExecutionPrompt,
  buildPRBody,
  buildVerificationPrompt,
  loadRepoContext,
  loadStructuredRepoContext,
  type PromptMaterial,
  StreamParser,
  selectPromptMaterials,
  summarizePromptMaterials,
} from '@shipcode/agents/source';
import { WorktreeManager } from '@shipcode/git';
import {
  EXECUTION_PHASES,
  type GitHubPrCheckSummary,
  type GitHubPrReviewCommentSummary,
  isRealGithubIssueNumber,
  MAX_TEST_RETRIES,
  MAX_VERIFICATION_RETRIES,
  PIPELINE_PHASE,
  parseUnifiedDiff,
  type ShipCodePlan,
} from '@shipcode/shared';
import {
  buildTaskNodePlan,
  formatTaskGraphExecutionContract,
  type TaskNodeRecord,
} from '@shipcode/shared/source';
import { renderWorkflowPromptTemplate } from '../workflow-prompt';
import type { PipelineHelperEnv } from './shared';

// Extract a short, human-readable error from an executor transcript.
// The previous heuristic only dropped the snippet when the joined last
// 3 lines started with `{`, which let backtick-fenced shipcode-plan
// blocks leak into `lastError` and dump the plan JSON onto the failure
// panel.
export function extractExecutionErrorSnippet(rawOutput: string): string {
  const lines = rawOutput.split('\n');
  const tail = lines.slice(-30);

  // 1) Reverse-scan for a structured streaming error event from claude/codex.
  for (let i = tail.length - 1; i >= 0; i--) {
    const trimmed = tail[i].trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof obj.error === 'string' && obj.error.trim()) {
        return obj.error.trim().slice(0, 280);
      }
      if (
        obj.type === 'result' &&
        (obj.is_error === true || obj.subtype === 'error') &&
        typeof obj.result === 'string' &&
        obj.result.trim()
      ) {
        return obj.result.trim().slice(0, 280);
      }
    } catch {
      /* skip */
    }
  }

  // 2) Reverse-scan for a plain-text error line. Skip JSON objects, code
  // fences, shipcode-plan markers, and bare structural punctuation.
  for (let i = tail.length - 1; i >= 0; i--) {
    const trimmed = tail[i].trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('{') || trimmed.startsWith('}')) continue;
    if (trimmed.startsWith('[') || trimmed.startsWith(']')) continue;
    if (trimmed.startsWith('```')) continue;
    if (/^["'][a-zA-Z_]+["']\s*:/.test(trimmed)) continue; // looks like a JSON field
    return trimmed.slice(0, 280);
  }

  return '';
}

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
    postTaskGraphComment,
    runProviderPhase,
    runShellCommand,
  } = runtime;

  function isSameProject(
    summary: ReturnType<typeof contextHelpers.listActive>[number],
    context: NonNullable<ReturnType<typeof activePipelines.get>>,
  ) {
    if (context.projectId) return summary.projectId === context.projectId;
    return summary.projectPath === context.projectPath;
  }

  function formatVerificationRetryFeedback(threadId: string, planRecordId: string | null): string {
    const latestVerification = deps.verifications.getLatest(threadId);
    const structured = latestVerification?.structured;
    if (
      !planRecordId ||
      !latestVerification ||
      latestVerification.planId !== planRecordId ||
      latestVerification.result !== 'failed' ||
      !structured
    ) {
      return '';
    }

    const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
    const failedCriteria = structured.criteriaResults
      .filter((criterion) => !criterion.passed)
      .slice(0, 5)
      .map((criterion) => `- ${compact(criterion.criterion)}: ${compact(criterion.evidence)}`)
      .join('\n');
    const issues = structured.issues
      .slice(0, 10)
      .map((issue) =>
        [
          '-',
          `[${issue.severity}]`,
          issue.filePath ? `${issue.filePath}:` : null,
          compact(issue.description),
        ]
          .filter(Boolean)
          .join(' '),
      )
      .join('\n');

    const lines = [
      '',
      '',
      '<previous_verification_failure>',
      'Verification failed on the previous attempt. Address these findings before finishing.',
      '',
      `Summary: ${compact(structured.summary)}`,
    ];

    if (failedCriteria) {
      lines.push('', 'Failed criteria:', failedCriteria);
    }

    if (issues) {
      lines.push('', 'Issues:', issues);
    }

    lines.push('</previous_verification_failure>');
    return lines.join('\n');
  }

  function ensureRepoPromptMaterials(
    context: NonNullable<ReturnType<typeof activePipelines.get>>,
  ): PromptMaterial[] {
    if (context.repoPromptMaterials === null) {
      context.repoPromptMaterials = loadStructuredRepoContext(
        context.worktreePath ?? context.projectPath,
      );
      context.repoContext =
        context.repoPromptMaterials.map((material) => material.content).join('\n\n') ||
        loadRepoContext(context.worktreePath ?? context.projectPath);
    }
    return context.repoPromptMaterials;
  }

  function rememberMaterialSummary(
    context: NonNullable<ReturnType<typeof activePipelines.get>>,
    phase: 'execute' | 'verify',
    materials: PromptMaterial[],
  ) {
    context.promptMaterialSummaries[phase] = summarizePromptMaterials(
      selectPromptMaterials(phase, materials),
    );
  }

  async function startExecution(threadId: string, plan: ShipCodePlan) {
    const context = activePipelines.get(threadId);
    if (!context) return;

    // Defense-in-depth: every direct caller already passes a parsed
    // ShipCodePlan, but the DB record is the source of truth. Halt at the
    // boundary if the latest plan is missing, unparseable, or no longer
    // current — never run the executor with partial / stale data.
    const executionGatePlan = deps.plans.getLatest(threadId);
    if (!executionGatePlan) {
      emitPhase(threadId, 'failed', 'Refusing to execute: no plan record found for this thread.');
      activePipelines.delete(threadId);
      return;
    }
    if (executionGatePlan.structured === null) {
      emitPhase(
        threadId,
        'failed',
        'Refusing to execute: latest plan has no parsed structured output.',
      );
      activePipelines.delete(threadId);
      return;
    }
    if (executionGatePlan.status === 'superseded' || executionGatePlan.status === 'rejected') {
      emitPhase(
        threadId,
        'failed',
        `Refusing to execute: latest plan is ${executionGatePlan.status}.`,
      );
      activePipelines.delete(threadId);
      return;
    }

    const settings = deps.settings.get();
    const maxConcurrentExecutions = Math.min(
      settings.maxConcurrentExecutions,
      context.workflowPolicy.agent.maxConcurrentAgents,
    );
    const executingCount = contextHelpers
      .listActiveInPhases(EXECUTION_PHASES)
      .filter((summary) => summary.threadId !== threadId && isSameProject(summary, context)).length;
    if (executingCount >= maxConcurrentExecutions) {
      // Project execution slots full — stay in awaiting_approval until a slot frees.
      emitPhase(threadId, 'awaiting_approval');
      return;
    }

    emitPhase(threadId, 'executing');

    ensureRepoPromptMaterials(context);
    try {
      ensureRepoSetupContract(context);
    } catch (error) {
      emitPhase(threadId, 'failed', error instanceof Error ? error.message : String(error));
      activePipelines.delete(threadId);
      return;
    }

    if (!context.worktreePath || !fs.existsSync(context.worktreePath)) {
      try {
        const appSettings = deps.settings.get();
        const worktreeManager = new WorktreeManager(context.projectPath, {
          worktreeRoot: appSettings.worktreeRoot,
          branchFormat: appSettings.worktreeBranchFormat,
        });
        const worktree = isRealGithubIssueNumber(context.githubIssueNumber)
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
        latest.phase !== PIPELINE_PHASE.executing ||
        latest.reason !== reason
      ) {
        deps.checkpoints.create({
          threadId,
          projectId: context.projectId,
          phase: PIPELINE_PHASE.executing,
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
    const latestPlanRecord = deps.plans.getLatest(threadId);
    let taskGraph =
      latestPlanRecord?.id && deps.taskGraphs
        ? deps.taskGraphs.getByPlanId(latestPlanRecord.id)
        : null;
    let activeTaskNode: TaskNodeRecord | null = null;
    const usesTaskGraph = Boolean(taskGraph && deps.taskGraphs && taskGraph.nodes.length > 1);
    if (usesTaskGraph && taskGraph && deps.taskGraphs) {
      const isRetry =
        context.testRetries > 0 ||
        context.verificationRetries > 0 ||
        Boolean(context.stabilizationFeedback) ||
        taskGraph.status === 'failed';
      const hasTerminalNodesOnly = taskGraph.nodes.every((node) =>
        ['completed', 'failed', 'blocked'].includes(node.status),
      );
      if (isRetry && hasTerminalNodesOnly) {
        taskGraph = deps.taskGraphs.resetForRetry(taskGraph.id);
      }

      activeTaskNode = deps.taskGraphs.getNextReadyNode(taskGraph.id);
      if (!activeTaskNode) {
        const incompleteNodes = taskGraph.nodes.filter((node) => node.status !== 'completed');
        if (incompleteNodes.length === 0) {
          const completedGraph =
            taskGraph.status === 'completed'
              ? taskGraph
              : deps.taskGraphs.updateGraphStatus(taskGraph.id, 'completed');
          void postTaskGraphComment(context, completedGraph);
          if (context.autonomous) {
            handlers.startTesting(threadId);
          } else {
            emitPhase(threadId, 'completed');
            activePipelines.delete(threadId);
          }
          return;
        }

        const blockedSummary = incompleteNodes
          .map((node) => `${node.stableKey}:${node.status}`)
          .join(', ');
        emitPhase(threadId, 'failed', `Task graph has no ready node (${blockedSummary}).`);
        activePipelines.delete(threadId);
        return;
      }

      deps.taskGraphs.updateNodeStatus(activeTaskNode.id, 'running');
      taskGraph = deps.taskGraphs.getByPlanId(latestPlanRecord?.id ?? '') ?? taskGraph;
      void postTaskGraphComment(context, taskGraph);
    }

    const verificationFeedback = formatVerificationRetryFeedback(
      threadId,
      latestPlanRecord?.id ?? null,
    );
    const testFeedback =
      context.testOutput && context.testRetries > 0
        ? `\n\n<previous_test_failure>\nTests failed on the previous attempt. Fix these issues before finishing:\n\n${context.testOutput}\n</previous_test_failure>`
        : '';
    context.testOutput = null;
    const stabilizationFeedback = context.stabilizationFeedback ?? '';
    context.stabilizationFeedback = null;
    const executeMaterials: PromptMaterial[] = [
      {
        kind: 'issue_prompt',
        label: 'thread prompt',
        content: deps.threads.getById(threadId)?.prompt ?? '',
      },
      ...ensureRepoPromptMaterials(context),
    ];
    rememberMaterialSummary(context, 'execute', executeMaterials);
    const executionPlan = activeTaskNode ? buildTaskNodePlan(plan, activeTaskNode) : plan;
    let workflowExecutionPrompt: string | null;
    try {
      workflowExecutionPrompt = renderWorkflowPromptTemplate(context, deps, 'execute', {
        plan: executionPlan,
      });
    } catch (error) {
      emitPhase(
        threadId,
        'failed',
        `WORKFLOW.md template render error: ${error instanceof Error ? error.message : String(error)}`,
      );
      activePipelines.delete(threadId);
      return;
    }
    const executionPrompt =
      (workflowExecutionPrompt ??
        buildExecutionPrompt(executionPlan, skill.context, skill.deps, {
          promptMaterials: executeMaterials,
          testingContext: getTestingContext(context),
        })) +
      formatTaskGraphExecutionContract(taskGraph, { activeNode: activeTaskNode }) +
      verificationFeedback +
      testFeedback +
      stabilizationFeedback;

    void (async () => {
      try {
        const response = await runProviderPhase(
          context,
          'execute',
          executionPrompt,
          executeMaterials,
          {
            reasoningEffort:
              activeTaskNode?.suggestedReasoningEffort ?? context.phaseReasoningEfforts.execute,
          },
        );

        if (context.cancelled) return;

        if (response.exitCode === 0) {
          if (activeTaskNode && deps.taskGraphs) {
            const updatedGraph = deps.taskGraphs.markNodeCompletedAndPromote(activeTaskNode.id);
            void postTaskGraphComment(context, updatedGraph);
            handlers.startExecution(threadId, plan);
            return;
          }

          if (context.autonomous) {
            handlers.startTesting(threadId);
          } else {
            emitPhase(threadId, 'completed');
            activePipelines.delete(threadId);
          }
        } else {
          const errSnippet = extractExecutionErrorSnippet(response.rawOutput);
          if (activeTaskNode && deps.taskGraphs) {
            const failedGraph = deps.taskGraphs.markNodeFailed(activeTaskNode.id);
            void postTaskGraphComment(context, failedGraph);
          }
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
    handlers.startVerification(threadId);
  }

  async function startVerification(threadId: string) {
    const context = activePipelines.get(threadId);
    if (!context) return;

    emitPhase(threadId, 'verifying');

    const cwd = context.worktreePath ?? context.projectPath;
    const latestPlan = deps.plans.getLatest(threadId);
    if (!latestPlan?.structured) {
      emitPhase(
        threadId,
        'failed',
        'Verification cannot start: structured plan missing for this thread.',
      );
      activePipelines.delete(threadId);
      return;
    }

    const plan = latestPlan.structured;

    try {
      const dirty = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8' });
      if (dirty.trim()) {
        execFileSync('git', ['add', '-A'], { cwd, encoding: 'utf-8' });
        const title = context.githubIssueTitle ?? 'Apply plan changes';
        const issueRef = isRealGithubIssueNumber(context.githubIssueNumber)
          ? ` (#${context.githubIssueNumber})`
          : '';
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
      deps.diffs.replaceForThread(threadId, []);
      deps.verifications.create(threadId, latestPlan.id, 'No changes detected', null);
      emitPhase(
        threadId,
        'failed',
        'Verification skipped: executor produced no file changes (empty diff vs. fork point).',
      );
      activePipelines.delete(threadId);
      return;
    }

    deps.diffs.replaceForThread(threadId, parseUnifiedDiff(diff));

    const skill = skillCallSite(context);
    const verifyMaterials: PromptMaterial[] = [
      ...ensureRepoPromptMaterials(context),
      { kind: 'diff_summary', label: 'implementation diff', content: diff },
      ...(context.testOutput
        ? [
            {
              kind: 'verification_output' as const,
              label: 'test output',
              content: context.testOutput,
            },
          ]
        : []),
    ];
    rememberMaterialSummary(context, 'verify', verifyMaterials);
    let verificationPrompt: string;
    try {
      verificationPrompt =
        renderWorkflowPromptTemplate(context, deps, 'verify', {
          plan,
          diff,
          acceptanceCriteria: plan.acceptanceCriteria,
          testOutput: context.testOutput,
        }) ??
        buildVerificationPrompt(
          plan,
          diff,
          plan.acceptanceCriteria,
          skill.context,
          skill.deps,
          context.testOutput ?? null,
          { promptMaterials: verifyMaterials },
        );
    } catch (error) {
      emitPhase(
        threadId,
        'failed',
        `WORKFLOW.md template render error: ${error instanceof Error ? error.message : String(error)}`,
      );
      activePipelines.delete(threadId);
      return;
    }

    void (async () => {
      try {
        const response = await runProviderPhase(
          context,
          'verify',
          verificationPrompt,
          verifyMaterials,
          {
            reasoningEffort: context.phaseReasoningEfforts.verify,
          },
        );

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
            emitPhase(
              threadId,
              'failed',
              `Verification failed: retries exhausted (${context.verificationRetries}/${MAX_VERIFICATION_RETRIES}).`,
            );
            activePipelines.delete(threadId);
          }
        } else {
          deps.verifications.create(threadId, latestPlan.id, parser.getRawOutput(), null);
          emitPhase(
            threadId,
            'failed',
            'Verification output could not be parsed — verifier did not emit a shipcode-verify block.',
          );
          activePipelines.delete(threadId);
        }
      } catch (err) {
        if (!context.cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          emitPhase(threadId, 'failed', `Verification error: ${message}`);
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
        emitPhase(
          threadId,
          'failed',
          'Commit aborted: HEAD moved after verification (verifiedSha mismatch).',
        );
        activePipelines.delete(threadId);
        return;
      }

      const ahead = execFileSync('git', ['log', `${context.forkPointSha}..HEAD`, '--oneline'], {
        cwd,
        encoding: 'utf-8',
      });
      if (!ahead.trim()) {
        emitPhase(
          threadId,
          'failed',
          'Commit aborted: no commits ahead of fork point — nothing to push.',
        );
        activePipelines.delete(threadId);
        return;
      }

      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
      execFileSync('git', ['push', 'origin', branch, '--set-upstream'], { cwd, encoding: 'utf-8' });

      handlers.startShipping(threadId);
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
        handlers.startShipping(threadId);
      } catch (secondErr) {
        const message = secondErr instanceof Error ? secondErr.message : String(secondErr);
        const firstMessage = firstErr instanceof Error ? firstErr.message : String(firstErr);
        emitPhase(
          threadId,
          'failed',
          `Commit and push failed (both attempts). first=${firstMessage.slice(0, 120)} retry=${message.slice(0, 120)}`,
        );
        activePipelines.delete(threadId);
      }
    }
  }

  async function startShipping(threadId: string) {
    const context = activePipelines.get(threadId);
    if (!context) return;

    emitPhase(threadId, 'shipping');

    if (!isRealGithubIssueNumber(context.githubIssueNumber)) {
      // Quick tasks (negative sentinel) and pipelines without an issue
      // skip PR shipping. Branch is left on disk for manual follow-up.
      emitPhase(threadId, 'completed');
      activePipelines.delete(threadId);
      return;
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

      const body = plan
        ? buildPRBody(plan, reviews, latestVerification?.structured ?? null, issueNumber, {
            projectId: context.projectId,
            skills: deps.skills,
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitPhase(threadId, 'failed', `Shipping failed: ${message}`);
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
