import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import {
  appendExecutionNotesProtocol,
  buildExecutionPrompt,
  buildVerificationPrompt,
  discoverRuntimeTests,
  getRuntimeTestsDir,
  loadRepoContext,
  loadStructuredRepoContext,
  type PromptMaterial,
  type RunningServer,
  ServerLifecycleManager,
  StreamParser,
  selectPromptMaterials,
  shellExecEnv,
  summarizePromptMaterials,
} from '@shipcode/agents';
import { WorktreeManager } from '@shipcode/git';
import {
  buildTaskNodePlan,
  EXECUTION_PHASES,
  formatTaskGraphExecutionContract,
  inferProviderFromModel,
  isRealGithubIssueNumber,
  MAX_NODE_VERIFICATION_RETRIES,
  MAX_TEST_RETRIES,
  MAX_VERIFICATION_RETRIES,
  PIPELINE_PHASE,
  parseUnifiedDiff,
  type ShipCodePlan,
  type TaskNodeRecord,
  VERIFICATION_FENCE_TAG,
} from '@shipcode/shared';
import { computeRetryDelayMs } from '../retry-scheduler';
import type { ExecutePhaseCarry, PipelineContext, VerifyPhaseCarry } from '../types';
import { renderWorkflowPromptTemplate } from '../workflow-prompt';
import { buildPhasePayload, resetPhaseState } from './context';
import { captureExecutionCheckpoint } from './execution-checkpoint';
import {
  buildContinuationPrompt,
  buildTestFailureFingerprint,
  CPU_QUEUE_NOTICE_INTERVAL_MS,
  DEFAULT_CPU_QUEUE_RETRY_MS,
  extractExecutionErrorSnippet,
  extractTestFailureSummary,
  probeWorktreeChanges,
  resolveWorktreeDiffBase,
} from './execution-phase-utils';
import { createShippingPhaseHandlers } from './execution-shipping-phases';
import {
  buildFanOutJudgePrompt,
  parseWinnerLabel,
  resolveFanOutMaxConcurrent,
  runFanOut,
} from './fan-out-executor';

export {
  buildContinuationPrompt,
  buildTestFailureFingerprint,
  extractExecutionErrorSnippet,
  extractImplicatedFiles,
  extractTestFailureSummary,
  normalizeFeatureQaResults,
  probeWorktreeChanges,
  resolveWorktreeDiffBase,
} from './execution-phase-utils';

import { extractQaFlowResults } from './qa-result-parser';
import { buildVerificationFindingInputs, formatOpenFindingsForPrompt } from './review-findings';
import type { PhaseOutcome, PipelineHelperEnv } from './shared';
import {
  collectQaEvidencePaths,
  formatVisualQaFailureFeedback,
  getVisualQaToolingStatus,
  hasVisualQaAssertions,
  summarizeQaFlowResults,
  toQaStatus,
  writeVisualQaRuntimeTest,
} from './visual-qa';

export function createExecutionPhaseHandlers({ deps, contextHelpers, runtime }: PipelineHelperEnv) {
  const { activePipelines, skillCallSite } = contextHelpers;
  const {
    emitPhase,
    emitTerminalLifecycle,
    emitTerminalRaw,
    ensureRepoSetupContract,
    formatTestFixFeedback,
    getTestingContext,
    getVerifyCommands,
    prepareWorktree,
    postTaskGraphComment,
    resolveAgentForPhase,
    runProviderPhase,
    runShellCommand,
  } = runtime;

  const { startCommitAndPush, startShipping, startStabilization } = createShippingPhaseHandlers({
    deps,
    contextHelpers,
    runtime,
  });

  /**
   * Dynamic-workflow (fan-out) execute: run `fanOutWorkerCount` workers, each in
   * its own isolated worktree off the base branch, have a judge pick the best,
   * then worktree-swap — the winner's worktree becomes the thread's and the
   * losers (plus the original primary worktree) are torn down. Returns the same
   * shape as `runProviderPhase` so the caller is unchanged.
   *
   * EXPERIMENTAL, opt-in via `agent.execute_orchestration: fan-out` in
   * WORKFLOW.md (default `single`). Certify on a real run before relying on it.
   */
  async function runFanOutExecute(
    context: PipelineContext,
    executionPrompt: string,
    executeMaterials: PromptMaterial[],
    phaseHints: { reasoningEffort?: PipelineContext['plannerReasoningEffort'] },
  ): Promise<{ rawOutput: string; exitCode: number; resolvedModel?: string }> {
    const agentPolicy = context.workflowPolicy.agent;
    const appSettings = deps.settings.get();
    const wm = new WorktreeManager(context.projectPath, {
      worktreeRoot: appSettings.worktreeRoot,
      branchFormat: appSettings.worktreeBranchFormat,
    });
    const baseBranch = context.baseBranch || undefined;
    const signal = context.abort.signal;
    const judgeModelId = agentPolicy.fanOutJudgeModel;
    const created: Array<{ label: string; worktreePath: string; branch: string }> = [];

    const captureDiff = async (cwd: string): Promise<string> => {
      await runShellCommand(context.threadId, cwd, 'git add -A', signal).catch(() => undefined);
      const r = await runShellCommand(context.threadId, cwd, 'git diff --cached', signal).catch(
        () => ({ output: '' }),
      );
      return r.output ?? '';
    };

    const result = await runFanOut({
      workerCount: agentPolicy.fanOutWorkerCount,
      // Bound the in-phase worker pool by its own worker count — NOT by
      // `maxConcurrentAgents`, which is the scheduler's project-wide cap on
      // concurrently running pipeline THREADS. Sharing that value overshot the
      // real agent-process ceiling (N threads × fanOutWorkerCount).
      maxConcurrent: resolveFanOutMaxConcurrent(agentPolicy.fanOutWorkerCount),
      runWorker: async (i) => {
        const label = `worker-${i + 1}`;
        const wt = await wm.create(
          `${context.threadId}-fan-${i + 1}`,
          `[fan-out] ${context.threadId} ${label}`,
          baseBranch,
        );
        created.push({ label, worktreePath: wt.worktreePath, branch: wt.branch });
        const workerCtx: PipelineContext = { ...context, worktreePath: wt.worktreePath };
        const prep = await prepareWorktree(workerCtx, 'execute');
        if (!prep.ok)
          return { label, rawOutput: `worker setup failed: ${prep.error}`, exitCode: 1 };
        const resp = await runProviderPhase(
          workerCtx,
          buildPhasePayload(workerCtx, 'execute'),
          executionPrompt,
          executeMaterials,
          phaseHints,
        );
        return {
          label,
          rawOutput: resp.rawOutput,
          exitCode: resp.exitCode,
          resolvedModel: resp.resolvedModel,
          diff: await captureDiff(wt.worktreePath),
        };
      },
      runJudge: async (candidates) => {
        // Judge in a throwaway worktree so any stray edits never touch a winner.
        const judgeWt = await wm.create(
          `${context.threadId}-fan-judge`,
          `[fan-out] ${context.threadId} judge`,
          baseBranch,
        );
        try {
          const judgeCtx: PipelineContext = {
            ...context,
            worktreePath: judgeWt.worktreePath,
            ...(judgeModelId
              ? {
                  executorModel: (inferProviderFromModel(judgeModelId) ??
                    context.executorModel) as PipelineContext['executorModel'],
                  executorModelOverride: null,
                  executorModelIdOverride: judgeModelId,
                }
              : {}),
          };
          // With an explicit judge model use the execute payload (carries the
          // override); otherwise judge as the verifier phase (its configured model).
          const payload = buildPhasePayload(judgeCtx, judgeModelId ? 'execute' : 'verify');
          const resp = await runProviderPhase(
            judgeCtx,
            payload,
            buildFanOutJudgePrompt(executionPrompt, candidates),
            [],
            phaseHints,
          );
          return {
            rawOutput: resp.rawOutput,
            exitCode: resp.exitCode,
            resolvedModel: resp.resolvedModel,
            winnerLabel: parseWinnerLabel(resp.rawOutput, candidates),
          };
        } finally {
          await wm.remove(judgeWt.worktreePath, judgeWt.branch).catch(() => undefined);
        }
      },
      promoteWinner: async (winner) => {
        const chosen = created.find((c) => c.label === winner.label);
        if (!chosen) return;
        const prior = deps.threads.getById(context.threadId);
        context.worktreePath = chosen.worktreePath;
        deps.threads.setWorktree(context.threadId, chosen.branch, chosen.worktreePath);
        for (const c of created) {
          if (c.label !== winner.label) {
            await wm.remove(c.worktreePath, c.branch).catch(() => undefined);
          }
        }
        if (
          prior?.worktreePath &&
          prior.worktreeBranch &&
          prior.worktreePath !== chosen.worktreePath
        ) {
          await wm.remove(prior.worktreePath, prior.worktreeBranch).catch(() => undefined);
        }
      },
      onAllFailed: async () => {
        // Every worker failed, so promoteWinner never runs and the worker
        // worktrees/branches would otherwise leak on disk. Tear each down using
        // its concrete persisted path+branch (never recomputed from threadId —
        // see .agents/memory/worktrees.md path-as-truth rule).
        for (const c of created) {
          await wm.remove(c.worktreePath, c.branch).catch(() => undefined);
        }
      },
    });

    return {
      rawOutput: result.rawOutput,
      exitCode: result.exitCode,
      resolvedModel: result.resolvedModel,
    };
  }

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

  function formatOpenReviewFindingsFeedback(threadId: string): string {
    if (!deps.reviewFindings) return '';
    return formatOpenFindingsForPrompt(deps.reviewFindings.listOpenByThread(threadId));
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

  /**
   * Coordinate a test-fix retry after a failed verify/runtime command.
   * Returns the `PhaseOutcome` the caller should propagate:
   *   - `{ next: 'retry', then: <re-execute> }` to schedule a fix attempt,
   *   - `{ next: 'failed' }` when a shared-failure block halts this thread
   *     (emitPhase + delete already done), or
   *   - `null` when the retry budget is exhausted (caller emits the failure).
   */
  function scheduleCoordinatedTestFixRetry(
    threadId: string,
    context: NonNullable<ReturnType<typeof activePipelines.get>>,
    command: string,
    testOutput: string,
  ): PhaseOutcome | null {
    const blockMessage = claimSharedTestFailure(threadId, context, command, testOutput);
    if (blockMessage) {
      emitTerminalLifecycle(threadId, `[shared-failure] ${blockMessage}\r\n`);
      emitPhase(threadId, 'failed', blockMessage);
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }

    if (context.testRetries >= MAX_TEST_RETRIES) return null;

    context.testRetries++;
    const delayMs = computeRetryDelayMs({
      reason: 'continuation',
      attempt: context.testRetries,
    });
    return { next: 'retry', delayMs, andThen: makeTestFixOutcome(threadId, testOutput) };
  }

  /**
   * Build the re-execution outcome for a test-fix retry. Mirrors the old
   * `startTestFix`: consume accumulated test output, reset phase state, and
   * inject focused test-fix feedback before re-entering execute.
   */
  function makeTestFixOutcome(threadId: string, testOutput: string): PhaseOutcome {
    const context = activePipelines.get(threadId);
    if (!context) return { next: 'paused' };

    const latestPlan = deps.plans.getLatest(threadId);
    const structuredPlan = latestPlan?.structured;
    if (!structuredPlan) {
      emitPhase(
        threadId,
        'failed',
        'Test fix cannot start: structured plan missing for this thread.',
      );
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }

    // Clear remaining phase-local state, then carry focused test-fix feedback into
    // the re-execute on the outcome (consumed-once by the execute phase).
    resetPhaseState(context);
    return {
      next: 'execute',
      plan: structuredPlan,
      carry: { stabilizationFeedback: formatTestFixFeedback(testOutput, context.testRetries) },
    };
  }

  function queueTestingIfCpuBusy(
    threadId: string,
    context: NonNullable<ReturnType<typeof activePipelines.get>>,
  ): PhaseOutcome | null {
    const settings = deps.settings.get();
    const maxConcurrentCpuTasks = Math.max(1, settings.maxConcurrentCpuTasks ?? 1);
    const runningCpuTasks = contextHelpers
      .listActiveInPhases([PIPELINE_PHASE.testing])
      .filter((summary) => summary.threadId !== threadId).length;
    const gate = deps.cpuTaskGate?.canStartCpuTask() ?? { allowed: true };

    const blockedBySlot = runningCpuTasks >= maxConcurrentCpuTasks;
    const blockedByCpu = !gate.allowed;
    if (!blockedBySlot && !blockedByCpu) {
      context.cpuQueueStartedAt = null;
      context.cpuQueueLastNotifiedAt = null;
      return null;
    }

    const now = Date.now();
    context.cpuQueueStartedAt ??= now;
    const shouldNotify =
      context.cpuQueueLastNotifiedAt == null ||
      now - context.cpuQueueLastNotifiedAt >= CPU_QUEUE_NOTICE_INTERVAL_MS;
    if (shouldNotify) {
      context.cpuQueueLastNotifiedAt = now;
      const reasons = [
        blockedBySlot
          ? `${runningCpuTasks}/${maxConcurrentCpuTasks} CPU-heavy task slots are busy`
          : null,
        blockedByCpu && gate.reason ? gate.reason : null,
      ].filter((reason): reason is string => Boolean(reason));
      emitTerminalLifecycle(
        threadId,
        `[cpu-queue] Waiting to start local tests: ${reasons.join('; ')}\r\n`,
      );
    }

    const retryMs = deps.cpuTaskGate?.retryDelayMs ?? DEFAULT_CPU_QUEUE_RETRY_MS;
    return { next: 'retry', delayMs: retryMs, andThen: { next: 'testing' } };
  }

  function claimSharedTestFailure(
    threadId: string,
    context: NonNullable<ReturnType<typeof activePipelines.get>>,
    command: string,
    testOutput: string,
  ): string | null {
    if (!deps.projectFailures || !context.projectId) return null;

    const fingerprint = buildTestFailureFingerprint(command, testOutput);
    const record = deps.projectFailures.claimOrCreate({
      projectId: context.projectId,
      baseBranch: context.baseBranch,
      fingerprint: fingerprint.fingerprint,
      threadId,
      command,
      summary: fingerprint.summary,
      outputExcerpt: fingerprint.outputExcerpt,
      implicatedFiles: fingerprint.implicatedFiles,
    });

    if (record.status === 'resolved') {
      const sha = record.resolvedCommitSha ? ` at ${record.resolvedCommitSha.slice(0, 12)}` : '';
      return `Shared test failure already resolved by ${record.resolvedByThreadId ?? 'another thread'}${sha}. Rebase or cherry-pick that fix before retrying this worktree.`;
    }

    if (record.ownerThreadId && record.ownerThreadId !== threadId) {
      return `Shared test failure is already being fixed by ${record.ownerThreadId}. This worktree is blocked to avoid a duplicate fix and merge conflict.`;
    }

    return null;
  }

  // ─── Per-node verification helpers ───────────────────────────────────────────

  function captureNodeAnchorSha(context: PipelineContext): string {
    const cwd = context.worktreePath ?? context.projectPath;
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' }).trim();
    } catch {
      return '';
    }
  }

  function computeNodeDiff(context: PipelineContext, anchorSha: string): string {
    if (!anchorSha) return '';
    const cwd = context.worktreePath ?? context.projectPath;
    try {
      // Commit any uncommitted work so git diff captures it
      const dirty = execFileSync('git', ['status', '--porcelain'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
      if (dirty) {
        execFileSync('git', ['add', '-A'], { cwd, encoding: 'utf-8' });
        execFileSync('git', ['commit', '--no-verify', '-m', '[shipcode] node checkpoint'], {
          cwd,
          encoding: 'utf-8',
        });
      }
      return execFileSync('git', ['diff', `${anchorSha}..HEAD`], {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
      });
    } catch {
      return '';
    }
  }

  function buildNodeVerificationPrompt(
    node: TaskNodeRecord,
    diff: string,
    threadId: string,
    planId: string,
  ): string {
    const criteria = node.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n');

    return `You are a code verifier evaluating a single task node from a larger implementation plan.

<task_node>
Key: ${node.stableKey}
Title: ${node.title}
Description: ${node.description.slice(0, 500)}
</task_node>

<acceptance_criteria>
${criteria}
</acceptance_criteria>

<implementation_diff>
${diff.slice(0, 60_000)}
</implementation_diff>

Review the diff above against the acceptance criteria for this specific node.
Be STRICT about structural correctness (compilation errors, missing exports, broken interfaces)
but LENIENT about completeness of later nodes — this node may be intentionally partial.

Output ONLY a fenced block in this exact format:
\`\`\`${VERIFICATION_FENCE_TAG}
{
  "threadId": "${threadId}",
  "planId": "${planId}",
  "result": "passed or failed",
  "summary": "One sentence assessment",
  "criteriaResults": [
    { "criterion": "...", "passed": true, "evidence": "..." }
  ],
  "issues": [
    { "severity": "blocker or warning", "description": "...", "filePath": "optional" }
  ]
}
\`\`\`

Pass criteria: ALL acceptance criteria passed with no blocker-severity issues.`;
  }

  function formatNodeVerificationFailureFeedback(
    node: TaskNodeRecord,
    retryAttempt: number,
  ): string {
    return [
      '',
      '',
      '<node_verification_failure>',
      `Node "${node.stableKey}: ${node.title}" failed verification on attempt ${retryAttempt}.`,
      'Re-examine your implementation against these acceptance criteria before finishing:',
      '',
      ...node.acceptanceCriteria.map((c) => `- ${c}`),
      '',
      'Do NOT expand scope beyond this node. Fix only what is wrong here.',
      '</node_verification_failure>',
    ].join('\n');
  }

  /**
   * Lightweight per-node verification: runs an LLM check against the node's
   * acceptance criteria using only the node-scoped diff. Uses reasoningEffort: 'low'
   * to minimize cost. Returns 'passed', 'retry', or 'failed'.
   */
  async function verifyNodeCompletion(
    threadId: string,
    _plan: ShipCodePlan,
    node: TaskNodeRecord,
  ): Promise<'passed' | 'retry' | 'failed'> {
    const context = activePipelines.get(threadId);
    if (!context) return 'failed';

    let diff = computeNodeDiff(context, context.nodeAnchorSha ?? '');
    if (!diff.trim()) {
      const cumulativeBase = resolveWorktreeDiffBase(context);
      const cumulativeDiff = cumulativeBase ? computeNodeDiff(context, cumulativeBase) : '';
      if (!cumulativeDiff.trim()) {
        // No scoped or cumulative changes produced — treat as needing retry.
        return 'retry';
      }
      emitTerminalLifecycle(
        threadId,
        `[node-verifier] No new diff since node start; verifying cumulative worktree diff from ${cumulativeBase}.\r\n`,
      );
      diff = cumulativeDiff;
    }

    const latestPlanRecord = deps.plans.getLatest(threadId);
    const planId = latestPlanRecord?.id ?? '';
    const prompt = buildNodeVerificationPrompt(node, diff, threadId, planId);

    const verifyMaterials: PromptMaterial[] = [
      {
        kind: 'diff_summary',
        label: `node ${node.stableKey} diff`,
        content: diff.slice(0, 60_000),
      },
    ];

    const payload = buildPhasePayload(context, 'verify');
    try {
      const response = await runProviderPhase(context, payload, prompt, verifyMaterials, {
        maxTurns: 1,
        reasoningEffort: 'low',
      });

      if (context.cancelled) return 'failed';

      const parser = new StreamParser();
      parser.feed(response.rawOutput);
      const result = parser.extractVerification();

      if (result.success && result.data) {
        if (result.data.result === 'passed') return 'passed';
        // Verification found issues
        if (context.nodeVerificationRetries < MAX_NODE_VERIFICATION_RETRIES) {
          return 'retry';
        }
        return 'failed';
      }

      // Parse failure — retry if budget allows
      if (context.nodeVerificationRetries < MAX_NODE_VERIFICATION_RETRIES) {
        return 'retry';
      }
      return 'failed';
    } catch {
      return context.cancelled ? 'failed' : 'retry';
    }
  }

  // ─── End per-node verification helpers ─────────────────────────────────────

  async function startExecution(
    threadId: string,
    plan: ShipCodePlan,
    carry?: ExecutePhaseCarry,
  ): Promise<PhaseOutcome> {
    const context = activePipelines.get(threadId);
    if (!context) return { next: 'paused' };

    // Defense-in-depth: every direct caller already passes a parsed
    // ShipCodePlan, but the DB record is the source of truth. Halt at the
    // boundary if the latest plan is missing, unparseable, or no longer
    // current — never run the executor with partial / stale data.
    const executionGatePlan = deps.plans.getLatest(threadId);
    if (!executionGatePlan) {
      emitPhase(threadId, 'failed', 'Refusing to execute: no plan record found for this thread.');
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }
    if (executionGatePlan.structured === null) {
      emitPhase(
        threadId,
        'failed',
        'Refusing to execute: latest plan has no parsed structured output.',
      );
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }
    if (executionGatePlan.status === 'superseded' || executionGatePlan.status === 'rejected') {
      emitPhase(
        threadId,
        'failed',
        `Refusing to execute: latest plan is ${executionGatePlan.status}.`,
      );
      activePipelines.delete(threadId);
      return { next: 'failed' };
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
      // Project execution slots full — stay in approval until a slot frees.
      emitPhase(threadId, 'approval');
      return { next: 'paused' };
    }

    if (
      deps.pipelineRuns &&
      context.projectId &&
      isRealGithubIssueNumber(context.githubIssueNumber)
    ) {
      const lockedIssue = deps.githubIssues.getByNumber(
        context.projectId,
        context.githubIssueNumber,
      );
      if (
        lockedIssue?.executionRunId &&
        context.runId &&
        lockedIssue.executionRunId !== context.runId
      ) {
        emitPhase(threadId, 'approval');
        return { next: 'paused' };
      }
    }

    emitPhase(threadId, 'executing');

    ensureRepoPromptMaterials(context);
    try {
      ensureRepoSetupContract(context);
    } catch (error) {
      emitPhase(threadId, 'failed', error instanceof Error ? error.message : String(error));
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }

    if (!context.worktreePath || !existsSync(context.worktreePath)) {
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
          : await worktreeManager.create(
              threadId,
              context.githubIssueTitle ?? deps.threads.getById(threadId)?.title ?? '',
              context.baseBranch || undefined,
            );
        context.worktreePath = worktree.worktreePath;
        deps.threads.setWorktree(threadId, worktree.branch, worktree.worktreePath);
      } catch (error) {
        console.error(`[pipeline] worktree creation failed for thread ${threadId}:`, error);
        emitPhase(threadId, 'failed', `Worktree creation failed: ${String(error)}`);
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }
    }

    const preparation = await prepareWorktree(context, 'execute');
    if (!preparation.ok) {
      emitPhase(threadId, 'failed', `Setup failed: ${preparation.error}`);
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }

    const preExecuteRetryOrdinal =
      1 + context.reviewRound + context.testRetries + context.verificationRetries;
    const preExecuteReason = preExecuteRetryOrdinal > 1 ? 'before_retry' : 'before_execute';
    const preExecuteLabel =
      preExecuteRetryOrdinal > 1
        ? `Before execute retry ${preExecuteRetryOrdinal}`
        : 'Before execute attempt 1';
    // Snapshot the pre-execute worktree state (#212) so restore/resume can
    // recover uncommitted work. `dedupe` skips a redundant row when the latest
    // checkpoint already pins this commit/phase/reason. Capture is best-effort
    // and async — it MUST NEVER block execution (see captureExecutionCheckpoint
    // for the single failure policy shared with the post-attempt site below).
    await captureExecutionCheckpoint(
      context.worktreePath ?? context.projectPath,
      threadId,
      {
        projectId: context.projectId,
        phase: PIPELINE_PHASE.executing,
        reason: preExecuteReason,
        label: () => preExecuteLabel,
        dedupe: true,
      },
      deps,
    );

    const skill = skillCallSite(context);
    const latestPlanRecord = deps.plans.getLatest(threadId);
    let taskGraph =
      latestPlanRecord?.id && deps.taskGraphs
        ? deps.taskGraphs.getByPlanId(latestPlanRecord.id)
        : null;
    let activeTaskNode: TaskNodeRecord | null = null;
    const usesTaskGraph = Boolean(
      taskGraph && deps.taskGraphs && taskGraph.mode !== 'direct' && taskGraph.nodes.length >= 1,
    );
    if (usesTaskGraph && taskGraph && deps.taskGraphs) {
      const isRetry =
        context.testRetries > 0 ||
        context.verificationRetries > 0 ||
        Boolean(carry?.stabilizationFeedback) ||
        taskGraph.status === 'failed';
      const hasTerminalNodesOnly = taskGraph.nodes.every((node) =>
        ['completed', 'failed', 'blocked'].includes(node.status),
      );
      if (isRetry && hasTerminalNodesOnly) {
        taskGraph = deps.taskGraphs.resetForRetry(taskGraph.id);
        // Reset per-node verification state so re-executed nodes start with a fresh budget
        context.nodeVerificationRetries = 0;
        context.nodeAnchorSha = null;
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
            resetPhaseState(context);
            return { next: 'testing' };
          }
          // Check if any code was actually changed. Only a confirmed-clean tree
          // fails the run; an 'unknown' probe (bad diff base, transient git
          // error) must not fail an otherwise-successful task graph — the probe
          // failure is already logged inside probeWorktreeChanges.
          if (probeWorktreeChanges(context) === 'clean') {
            emitPhase(
              threadId,
              'failed',
              'All task graph nodes completed but no code changes were produced',
            );
            activePipelines.delete(threadId);
            return { next: 'failed' };
          }
          emitPhase(threadId, 'completed');
          activePipelines.delete(threadId);
          return { next: 'done' };
        }

        const blockedSummary = incompleteNodes
          .map((node) => `${node.stableKey}:${node.status}`)
          .join(', ');
        emitPhase(threadId, 'failed', `Task graph has no ready node (${blockedSummary}).`);
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }

      deps.taskGraphs.updateNodeStatus(activeTaskNode.id, 'running');
      taskGraph = deps.taskGraphs.getByPlanId(latestPlanRecord?.id ?? '') ?? taskGraph;
      void postTaskGraphComment(context, taskGraph);
    }

    const verificationFeedback = formatVerificationRetryFeedback(
      threadId,
      latestPlanRecord?.id ?? null,
    );
    const openReviewFindingsFeedback = formatOpenReviewFindingsFeedback(threadId);
    // The execute carry is the typed hand-off from the producing phase (test-fix,
    // node-verification, stabilization, plan→execute) or the desktop resume/retry
    // IPC's seed carry. Threaded into this invocation's PhasePayload below and read
    // back from `payload.carry` when building the prompt.
    const executeCarry: ExecutePhaseCarry = {
      testOutput: carry?.testOutput,
      stabilizationFeedback: carry?.stabilizationFeedback,
      executionResumeContext: carry?.executionResumeContext,
    };
    const executeMaterials: PromptMaterial[] = [
      {
        kind: 'issue_prompt',
        label: 'thread prompt',
        content: deps.threads.getById(threadId)?.prompt ?? '',
      },
      ...ensureRepoPromptMaterials(context),
      ...(context.featureQaState
        ? [
            {
              kind: 'qa_contract' as const,
              label: 'feature QA contract',
              content: JSON.stringify(context.featureQaState, null, 2),
            },
          ]
        : []),
    ];
    rememberMaterialSummary(context, 'execute', executeMaterials);
    const payload = buildPhasePayload(context, 'execute', executeCarry);
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
      return { next: 'failed' };
    }
    const executionTaskGraph = usesTaskGraph ? taskGraph : null;
    const baseExecutionPrompt =
      workflowExecutionPrompt ??
      buildExecutionPrompt(executionPlan, skill.context, skill.deps, {
        promptMaterials: executeMaterials,
        testingContext: getTestingContext(context),
        isAutomationRun: context.isAutomationRun,
      });
    const testFeedback =
      payload.carry.testOutput && context.testRetries > 0
        ? `\n\n<previous_test_failure>\nTests failed on the previous attempt. Fix these issues before finishing:\n\n${payload.carry.testOutput}\n</previous_test_failure>`
        : '';
    const executionPrompt =
      appendExecutionNotesProtocol(baseExecutionPrompt) +
      formatTaskGraphExecutionContract(executionTaskGraph, { activeNode: activeTaskNode }) +
      verificationFeedback +
      openReviewFindingsFeedback +
      testFeedback +
      (payload.carry.stabilizationFeedback ?? '') +
      (payload.carry.executionResumeContext ?? '');

    // Capture HEAD before execution for per-node diff scoping
    if (activeTaskNode) {
      context.nodeAnchorSha = captureNodeAnchorSha(context);
    }

    try {
      const executeHints = {
        reasoningEffort:
          activeTaskNode?.suggestedReasoningEffort ?? context.phaseReasoningEfforts.execute,
      };
      const response =
        context.workflowPolicy.agent.executeOrchestration === 'fan-out'
          ? await runFanOutExecute(context, executionPrompt, executeMaterials, executeHints)
          : await runProviderPhase(
              context,
              payload,
              executionPrompt,
              executeMaterials,
              executeHints,
            );

      if (context.cancelled) return { next: 'paused' };

      // Post-attempt checkpoint ref (#212): snapshot the attempt's worktree
      // state (including uncommitted executor changes) after every execute /
      // task-graph-node attempt. Runs on the per-attempt hot path (× task-graph
      // nodes × retries), so it shares captureExecutionCheckpoint's single
      // async, best-effort, never-blocks-the-phase policy with the pre-execute
      // site — no synchronous git that would freeze the Electron main loop.
      //
      // Note (#3, fan-out): when execute ran fan-out, the winner's worktree was
      // already `git add -A`-staged by captureDiff for the judge; captureCheckpoint
      // then stages the identical tree once more into an isolated temp index. That
      // double full-tree stage is one extra `git add -A` per fan-out attempt on the
      // winner only — accepted here rather than reused via a trusted pre-staged
      // index, whose correctness would hinge on a fragile cross-function invariant
      // (a stale real index would silently drop uncommitted work from the snapshot).
      // Fan-out is experimental/opt-in, so the cost is bounded and localized.
      await captureExecutionCheckpoint(
        context.worktreePath ?? context.projectPath,
        threadId,
        {
          projectId: context.projectId,
          phase: PIPELINE_PHASE.executing,
          reason: 'after_execute',
          label: (turn) =>
            activeTaskNode
              ? `After node ${activeTaskNode.stableKey} attempt${turn !== null ? ` (turn ${turn})` : ''}`
              : `After execute attempt${turn !== null ? ` (turn ${turn})` : ''}`,
        },
        deps,
      );

      if (response.exitCode === 0) {
        if (activeTaskNode && deps.taskGraphs) {
          // ─── Per-node verification gate ───
          const nodeOutcome = await verifyNodeCompletion(threadId, plan, activeTaskNode);

          if (nodeOutcome === 'passed') {
            context.nodeVerificationRetries = 0;
            context.nodeAnchorSha = null;
            const updatedGraph = deps.taskGraphs.markNodeCompletedAndPromote(activeTaskNode.id);
            void postTaskGraphComment(context, updatedGraph);
            resetPhaseState(context);
            return { next: 'execute', plan };
          }

          if (nodeOutcome === 'retry') {
            // Budget check BEFORE scheduling — covers all retry sources (empty diff,
            // provider error, LLM non-pass). Without this the loop is unbounded.
            if (context.nodeVerificationRetries >= MAX_NODE_VERIFICATION_RETRIES) {
              const failedGraph = deps.taskGraphs.markNodeFailed(activeTaskNode.id);
              void postTaskGraphComment(context, failedGraph);
              emitPhase(
                threadId,
                'failed',
                `Node "${activeTaskNode.stableKey}" failed verification after ${MAX_NODE_VERIFICATION_RETRIES + 1} attempts.`,
              );
              activePipelines.delete(threadId);
              return { next: 'failed' };
            }
            context.nodeVerificationRetries++;
            const nodeFeedback = formatNodeVerificationFailureFeedback(
              activeTaskNode,
              context.nodeVerificationRetries,
            );
            deps.taskGraphs.updateNodeStatus(activeTaskNode.id, 'ready');
            const delayMs = computeRetryDelayMs({
              reason: 'continuation',
              attempt: context.nodeVerificationRetries,
            });
            return {
              next: 'retry',
              delayMs,
              andThen: { next: 'execute', plan, carry: { stabilizationFeedback: nodeFeedback } },
            };
          }

          // nodeOutcome === 'failed' — max retries exhausted
          const failedGraph = deps.taskGraphs.markNodeFailed(activeTaskNode.id);
          void postTaskGraphComment(context, failedGraph);
          emitPhase(
            threadId,
            'failed',
            `Node "${activeTaskNode.stableKey}" failed verification after ${MAX_NODE_VERIFICATION_RETRIES + 1} attempts.`,
          );
          activePipelines.delete(threadId);
          return { next: 'failed' };
          // ─── End per-node verification gate ───
        }

        if (taskGraph?.mode === 'direct' && deps.taskGraphs && taskGraph.status !== 'completed') {
          try {
            deps.taskGraphs.updateGraphStatus(taskGraph.id, 'completed');
          } catch (error) {
            console.error(`[pipeline] direct task graph completion failed for ${threadId}:`, error);
          }
        }

        if (context.autonomous) {
          resetPhaseState(context);
          return { next: 'testing' };
        }
        // Check if executor actually produced code changes. Only a
        // confirmed-clean tree fails; an 'unknown' probe result (bad diff base,
        // transient git error) proceeds, since real changes may sit in the
        // worktree — the probe failure is already logged.
        if (probeWorktreeChanges(context) === 'clean') {
          const errSnippet = extractExecutionErrorSnippet(response.rawOutput);
          emitPhase(
            threadId,
            'failed',
            `Executor exited successfully but produced no code changes${errSnippet ? `: ${errSnippet}` : ''}`,
          );
          activePipelines.delete(threadId);
          return { next: 'failed' };
        }
        emitPhase(threadId, 'completed');
        activePipelines.delete(threadId);
        return { next: 'done' };
      }

      const errSnippet = extractExecutionErrorSnippet(response.rawOutput);
      if (activeTaskNode && deps.taskGraphs) {
        const failedGraph = deps.taskGraphs.markNodeFailed(activeTaskNode.id);
        void postTaskGraphComment(context, failedGraph);
      } else if (taskGraph?.mode === 'direct' && deps.taskGraphs && taskGraph.status !== 'failed') {
        try {
          deps.taskGraphs.updateGraphStatus(taskGraph.id, 'failed');
        } catch (error) {
          console.error(`[pipeline] direct task graph failure failed for ${threadId}:`, error);
        }
      }
      emitPhase(
        threadId,
        'failed',
        `Execution failed (exit ${response.exitCode})${errSnippet ? `: ${errSnippet}` : ''}`,
      );
      activePipelines.delete(threadId);
      return { next: 'failed' };
    } catch (error) {
      if (!context.cancelled) {
        emitPhase(threadId, 'failed', `Execution error: ${String(error)}`);
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }
      return { next: 'paused' };
    }
  }

  async function startTesting(threadId: string): Promise<PhaseOutcome> {
    const context = activePipelines.get(threadId);
    if (!context) return { next: 'paused' };

    try {
      ensureRepoSetupContract(context);
    } catch (error) {
      emitPhase(threadId, 'failed', error instanceof Error ? error.message : String(error));
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }

    const verifyCommands = getVerifyCommands(context);
    const runtimeQa = context.repoSetupContract?.contract.runtimeQa;
    const hasVisualQa = hasVisualQaAssertions(context.featureQaState);
    const hasRuntimeQa = Boolean(
      runtimeQa?.server ||
        runtimeQa?.testCommands?.length ||
        runtimeQa?.discoverAgentTests ||
        hasVisualQa,
    );

    if (verifyCommands.length === 0 && !hasRuntimeQa) {
      resetPhaseState(context);
      return { next: 'verification' };
    }

    const cpuQueueOutcome = queueTestingIfCpuBusy(threadId, context);
    if (cpuQueueOutcome) return cpuQueueOutcome;

    emitPhase(threadId, 'testing');

    const cwd = context.worktreePath ?? context.projectPath;
    const preparation = await prepareWorktree(context, 'verify');
    if (!preparation.ok) {
      emitPhase(threadId, 'failed', `Verification preflight failed: ${preparation.error}`);
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }

    if (hasVisualQa && context.featureQaState) {
      if (context.featureQaState.selectorReadiness !== 'ready') {
        const message =
          `[runtime-qa] Visual QA requires stable selectors, but selectorReadiness is ` +
          `"${context.featureQaState.selectorReadiness}". Add stable data-testid selectors for the visual QA targets.`;
        const selectorRetry = scheduleCoordinatedTestFixRetry(
          threadId,
          context,
          'runtime-qa:selector-readiness',
          message,
        );
        if (selectorRetry) return selectorRetry;
        emitPhase(threadId, 'failed', message);
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }

      const visualRoutes = context.featureQaState.visualAssertions ?? [];
      const hasRelativeRoute = visualRoutes.some((assertion) => assertion.route.startsWith('/'));
      if (hasRelativeRoute && !runtimeQa?.server) {
        const message =
          '[runtime-qa] Visual QA uses relative routes but the repo setup contract has no runtimeQa.server. ' +
          'Configure .shipcode/setup.json runtimeQa.server so ShipCode can start the app under test.';
        emitPhase(threadId, 'failed', message);
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }

      try {
        const tooling = getVisualQaToolingStatus(cwd, shellExecEnv().PATH);
        if (!tooling.available) {
          emitPhase(threadId, 'failed', tooling.message);
          activePipelines.delete(threadId);
          return { next: 'failed' };
        }
        emitTerminalLifecycle(threadId, `[runtime-qa] ${tooling.message}\r\n`);
        if (tooling.warning) {
          emitTerminalLifecycle(threadId, `[runtime-qa] Warning: ${tooling.warning}\r\n`);
        }

        const generated = writeVisualQaRuntimeTest(cwd, threadId, context.featureQaState);
        emitTerminalLifecycle(
          threadId,
          `[runtime-qa] Generated visual QA Playwright test ${generated.runId}\r\n`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emitPhase(threadId, 'failed', `Visual QA generation failed: ${message}`);
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }
    }

    // --- Phase 1: Static verify commands (unit tests, typecheck, build) ---
    // Accumulate verify output in a local (no longer on `context`); the testing
    // phase's output is handed forward as typed carry — to verify on success, to
    // execute (test-fix) on failure.
    const outputs: string[] = [];
    let accumulatedTestOutput = '';
    for (const command of verifyCommands) {
      emitTerminalLifecycle(threadId, `[verify] $ ${command}\r\n`);
      try {
        const result = await runShellCommand(threadId, cwd, command, context.abort.signal);
        outputs.push(result.output);
        accumulatedTestOutput = outputs.join('\n').slice(-16384);
        if (result.exitCode !== 0) {
          const retryOutcome = scheduleCoordinatedTestFixRetry(
            threadId,
            context,
            command,
            accumulatedTestOutput,
          );
          if (retryOutcome) return retryOutcome;
          const testSummary = extractTestFailureSummary(accumulatedTestOutput);
          deps.emitter.emit({
            type: 'pipeline:verification-exhausted',
            threadId,
            retries: context.testRetries,
            testSummary,
          });
          emitPhase(
            threadId,
            'failed',
            `Test fix exhausted after ${context.testRetries + 1} attempt(s): ${testSummary}`,
          );
          activePipelines.delete(threadId);
          return { next: 'failed' };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emitPhase(threadId, 'failed', `Verification command error: ${message}`);
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }
    }

    // --- Phase 2: Runtime QA (server lifecycle + runtime tests) ---
    let runtimeQaOutput: string | null = null;
    if (hasRuntimeQa) {
      const runtimeQaResult = await runRuntimeQa(
        threadId,
        context,
        cwd,
        runtimeQa ?? { testCommands: [], discoverAgentTests: true },
        accumulatedTestOutput,
      );
      if (!runtimeQaResult.ok) {
        if (runtimeQaResult.fatal) {
          emitPhase(threadId, 'failed', runtimeQaResult.error);
          activePipelines.delete(threadId);
          return { next: 'failed' };
        }
        return runtimeQaResult.outcome;
      }
      runtimeQaOutput = runtimeQaResult.runtimeQaOutput;
    }

    context.testRetries = 0;
    resetPhaseState(context);
    // Passing test output and runtime-QA output are handed to verify as typed
    // carry — they previously survived `resetPhaseState` as context fields.
    const verifyCarry: VerifyPhaseCarry | undefined =
      accumulatedTestOutput || runtimeQaOutput
        ? {
            ...(accumulatedTestOutput ? { testOutput: accumulatedTestOutput } : {}),
            ...(runtimeQaOutput ? { runtimeQaOutput } : {}),
          }
        : undefined;
    return { next: 'verification', carry: verifyCarry };
  }

  async function runRuntimeQa(
    threadId: string,
    context: PipelineContext,
    cwd: string,
    config: NonNullable<PipelineContext['repoSetupContract']>['contract']['runtimeQa'],
    priorTestOutput: string,
  ): Promise<
    | { ok: true; runtimeQaOutput: string | null }
    | { ok: false; fatal: true; error: string }
    | { ok: false; fatal: false; outcome: PhaseOutcome }
  > {
    if (!config) return { ok: true, runtimeQaOutput: null };

    emitTerminalLifecycle(threadId, '[runtime-qa] Starting runtime QA\r\n');

    const lifecycle = new ServerLifecycleManager(deps.processManager, (msg) =>
      emitTerminalRaw(threadId, msg),
    );
    let server: RunningServer | undefined;

    const cleanupServer = async () => {
      if (server) {
        await lifecycle.stop(server);
        server = undefined;
      }
    };
    context.runtimeQaCleanup = cleanupServer;

    const onAbort = () => void cleanupServer();
    context.abort.signal.addEventListener('abort', onAbort, { once: true });

    try {
      if (config.server) {
        return {
          ok: false,
          fatal: true,
          error:
            'Runtime QA server startup is disabled until server commands have an explicit trust gate',
        };
      }

      const extraEnv: Record<string, string> = {};
      if (server) {
        extraEnv.BASE_URL = server.baseUrl;
      }

      const allCommands = [...(config.testCommands ?? [])];
      if (config.discoverAgentTests !== false || hasVisualQaAssertions(context.featureQaState)) {
        const discovered = discoverRuntimeTests(cwd);
        if (discovered.length > 0) {
          emitTerminalLifecycle(
            threadId,
            `[runtime-qa] Discovered ${discovered.length} agent test(s)\r\n`,
          );
          allCommands.push(...discovered);
        }
      }

      const runtimeOutputs: string[] = [];
      let runtimeQaOutput: string | null = null;
      const qaFlowResults: ReturnType<typeof extractQaFlowResults> = [];
      const persistQaFlowResults = () => {
        if (!context.featureQaState || qaFlowResults.length === 0) return;
        try {
          deps.featureQaResults?.insert({
            threadId,
            featureId: context.featureQaState.featureId,
            status: toQaStatus(qaFlowResults),
            flowResults: qaFlowResults,
            summary: summarizeQaFlowResults(qaFlowResults),
            evidencePaths: collectQaEvidencePaths(qaFlowResults),
          });
        } catch (err) {
          console.error('[pipeline] runtime feature QA result insert failed:', err);
        }
      };

      for (const command of allCommands) {
        if (server?.crashed) {
          const failMsg = '[runtime-qa] Server crashed during testing';
          runtimeOutputs.push(failMsg);
          runtimeQaOutput = runtimeOutputs.join('\n').slice(-16384);
          const mergedOutput = `${priorTestOutput}\n${runtimeQaOutput}`.slice(-16384);
          const crashRetry = scheduleCoordinatedTestFixRetry(
            threadId,
            context,
            'runtime-qa:server-crashed',
            mergedOutput,
          );
          if (crashRetry) return { ok: false, fatal: false, outcome: crashRetry };
          return { ok: false, fatal: true, error: failMsg };
        }

        emitTerminalLifecycle(threadId, `[runtime-qa] $ ${command}\r\n`);
        try {
          const result = await runShellCommand(threadId, cwd, command, context.abort.signal, {
            extraEnv,
          });
          runtimeOutputs.push(`[runtime-qa] ${command}\n${result.output}`);
          runtimeQaOutput = runtimeOutputs.join('\n').slice(-16384);
          const commandQaResults = extractQaFlowResults(result.output);
          if (commandQaResults.length > 0) {
            qaFlowResults.push(...commandQaResults);
          }

          const hasFailedQaResult = commandQaResults.some((flow) => !flow.passed);
          if (result.exitCode !== 0 || hasFailedQaResult) {
            persistQaFlowResults();
            const visualFeedback = formatVisualQaFailureFeedback(commandQaResults);
            const mergedOutput = `${priorTestOutput}\n${runtimeQaOutput}${visualFeedback}`.slice(
              -16384,
            );
            const commandRetry = scheduleCoordinatedTestFixRetry(
              threadId,
              context,
              command,
              mergedOutput,
            );
            if (commandRetry) return { ok: false, fatal: false, outcome: commandRetry };
            return {
              ok: false,
              fatal: true,
              error: `Runtime QA exhausted retries on: ${command}`,
            };
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { ok: false, fatal: true, error: `Runtime QA command error: ${message}` };
        }
      }

      persistQaFlowResults();
      emitTerminalLifecycle(threadId, '[runtime-qa] All runtime tests passed\r\n');
      return { ok: true, runtimeQaOutput };
    } finally {
      await cleanupServer();
      context.runtimeQaCleanup = null;
      context.abort.signal.removeEventListener('abort', onAbort);
    }
  }

  async function startVerification(
    threadId: string,
    carry?: VerifyPhaseCarry,
  ): Promise<PhaseOutcome> {
    const context = activePipelines.get(threadId);
    if (!context) return { next: 'paused' };

    emitPhase(threadId, 'verifying');

    // Passing test output and runtime-QA output are handed in as typed carry
    // from the testing phase (absent when verify is entered directly, e.g. via
    // the re-verify IPC).
    const testOutput = carry?.testOutput ?? null;
    const runtimeQaOutput = carry?.runtimeQaOutput ?? null;

    const cwd = context.worktreePath ?? context.projectPath;
    const latestPlan = deps.plans.getLatest(threadId);
    if (!latestPlan?.structured) {
      emitPhase(
        threadId,
        'failed',
        'Verification cannot start: structured plan missing for this thread.',
      );
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }

    const plan = latestPlan.structured;

    try {
      const runtimeTestDir = getRuntimeTestsDir(cwd);
      if (existsSync(runtimeTestDir)) {
        rmSync(runtimeTestDir, { recursive: true, force: true });
      }

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
      return { next: 'failed' };
    }

    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' }).trim();
    let branch: string | null = null;
    try {
      branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
    } catch {
      branch = null;
    }
    context.verifiedSha = headSha;
    deps.projectFailures?.resolveOwnedByThread(threadId, headSha);

    const diffBase = resolveWorktreeDiffBase(context);
    let diff: string;
    try {
      diff = diffBase
        ? execFileSync('git', ['diff', `${diffBase}..${headSha}`], {
            cwd,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
          }).toString()
        : '';
    } catch {
      diff = '';
    }

    if (!diff.trim()) {
      deps.diffs.replaceForThread(threadId, []);
      deps.verifications.create(threadId, latestPlan.id, 'No changes detected', null);
      emitPhase(
        threadId,
        'failed',
        'Verification skipped: executor produced no file changes (empty diff vs. worktree base).',
      );
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }

    deps.diffs.replaceForThread(threadId, parseUnifiedDiff(diff));

    const skill = skillCallSite(context);
    const verifyMaterials: PromptMaterial[] = [
      ...ensureRepoPromptMaterials(context),
      { kind: 'diff_summary', label: 'implementation diff', content: diff },
      ...(testOutput
        ? [
            {
              kind: 'verification_output' as const,
              label: 'test output',
              content: testOutput,
            },
          ]
        : []),
      ...(runtimeQaOutput
        ? [
            {
              kind: 'verification_output' as const,
              label: 'runtime QA output',
              content: runtimeQaOutput,
            },
          ]
        : []),
      ...(context.featureQaState
        ? [
            {
              kind: 'qa_contract' as const,
              label: 'feature QA contract',
              content: JSON.stringify(context.featureQaState, null, 2),
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
          testOutput,
        }) ??
        buildVerificationPrompt(
          plan,
          diff,
          plan.acceptanceCriteria,
          skill.context,
          skill.deps,
          testOutput,
          {
            promptMaterials: verifyMaterials,
            qaState: context.featureQaState ?? undefined,
          },
        );
    } catch (error) {
      emitPhase(
        threadId,
        'failed',
        `WORKFLOW.md template render error: ${error instanceof Error ? error.message : String(error)}`,
      );
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }

    const payload = buildPhasePayload(context, 'verify');
    try {
      const response = await runProviderPhase(
        context,
        payload,
        verificationPrompt,
        verifyMaterials,
        {
          reasoningEffort: context.phaseReasoningEfforts.verify,
        },
      );

      if (context.cancelled) return { next: 'paused' };

      const parser = new StreamParser();
      parser.feed(response.rawOutput);
      const result = parser.extractVerification();

      if (!(result.success && result.data)) {
        deps.verifications.create(threadId, latestPlan.id, parser.getRawOutput(), null);
        emitPhase(
          threadId,
          'failed',
          'Verification output could not be parsed — verifier did not emit a shipcode-verify block.',
        );
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }

      const verificationRecord = deps.verifications.create(
        threadId,
        latestPlan.id,
        result.raw,
        result.data,
      );
      if (context.projectId && deps.reviewFindings) {
        if (result.data.result === 'passed') {
          deps.reviewFindings.markOpenFixed({
            threadId,
            planId: latestPlan.id,
            runId: context.runId,
            commitSha: headSha,
          });
        } else {
          deps.reviewFindings.replaceOpenForVerification({
            threadId,
            planId: latestPlan.id,
            verificationId: verificationRecord.id,
            findings: buildVerificationFindingInputs({
              projectId: context.projectId,
              threadId,
              planId: latestPlan.id,
              verificationId: verificationRecord.id,
              runId: context.runId,
              sourceModel:
                context.verifierModelIdOverride ?? resolveAgentForPhase(context, 'verify'),
              worktreePath: context.worktreePath,
              branch,
              commitSha: headSha,
              verification: result.data,
            }),
          });
        }
      }
      deps.emitter.emit({ type: 'verification:parsed', threadId, verification: result.data });

      if (context.featureQaState) {
        try {
          const qaFlowResults = extractQaFlowResults(response.rawOutput);
          if (qaFlowResults.length > 0) {
            deps.featureQaResults?.insert({
              threadId,
              featureId: context.featureQaState.featureId,
              status: toQaStatus(qaFlowResults),
              flowResults: qaFlowResults,
              summary: result.data.summary,
              evidencePaths: collectQaEvidencePaths(qaFlowResults),
            });
          }
        } catch (err) {
          console.error('[pipeline] feature QA result insert failed:', err);
        }
      }

      if (result.data.result === 'passed') {
        resetPhaseState(context);
        return { next: 'commit' };
      }

      if (context.verificationRetries < MAX_VERIFICATION_RETRIES) {
        context.verificationRetries++;
        const delayMs = computeRetryDelayMs({
          reason: 'continuation',
          attempt: context.verificationRetries,
        });
        resetPhaseState(context);
        return { next: 'retry', delayMs, andThen: { next: 'execute', plan } };
      }

      deps.emitter.emit({
        type: 'pipeline:verification-exhausted',
        threadId,
        retries: context.verificationRetries,
      });

      // Turn-level retry: if maxTurns allows, start a new turn
      // (re-enter planning with a continuation prompt).
      const maxTurns = context.workflowPolicy.agent.maxTurns;
      if (context.turnCount + 1 < maxTurns) {
        deps.emitter.emit({
          type: 'pipeline:turn-completed',
          threadId,
          turnNumber: context.turnCount + 1,
          result: 'failed',
        });
        context.turnCount++;
        context.verificationRetries = 0;
        context.testRetries = 0;
        context.retryCount = 0;
        deps.emitter.emit({
          type: 'pipeline:turn-started',
          threadId,
          turnNumber: context.turnCount + 1,
        });

        // Build continuation prompt — short, references prior failure
        const failureReason =
          result.data.summary ?? 'Verification failed — address remaining gaps.';
        const continuationPrompt = buildContinuationPrompt(context, failureReason);

        const delayMs = computeRetryDelayMs({
          reason: 'continuation',
          attempt: 1,
        });
        resetPhaseState(context);
        return {
          next: 'retry',
          delayMs,
          andThen: {
            next: 'plan',
            prompt: continuationPrompt,
            projectPath: context.projectPath,
            worktreePath: context.worktreePath,
          },
        };
      }

      deps.emitter.emit({
        type: 'pipeline:turn-completed',
        threadId,
        turnNumber: context.turnCount + 1,
        result: 'max_turns_reached',
      });
      emitPhase(
        threadId,
        'failed',
        `Verification failed: max turns reached (${context.turnCount + 1}/${maxTurns}).`,
      );
      activePipelines.delete(threadId);
      return { next: 'failed' };
    } catch (err) {
      if (!context.cancelled) {
        const message = err instanceof Error ? err.message : String(err);
        emitPhase(threadId, 'failed', `Verification error: ${message}`);
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }
      return { next: 'paused' };
    }
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
