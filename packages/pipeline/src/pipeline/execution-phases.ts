import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import {
  buildExecutionPrompt,
  buildPRBody,
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
} from '@shipcode/agents/source';
import { WorktreeManager } from '@shipcode/git';
import {
  EXECUTION_PHASES,
  type FeatureQaResult,
  type GitHubPrCheckSummary,
  type GitHubPrReviewCommentSummary,
  isRealGithubIssueNumber,
  MAX_NODE_VERIFICATION_RETRIES,
  MAX_TEST_RETRIES,
  MAX_VERIFICATION_RETRIES,
  PIPELINE_PHASE,
  parseUnifiedDiff,
  type ShipCodePlan,
  stripAnsi,
  VERIFICATION_FENCE_TAG,
} from '@shipcode/shared';
import {
  buildTaskNodePlan,
  formatTaskGraphExecutionContract,
  type TaskNodeRecord,
} from '@shipcode/shared/source';
import { computeRetryDelayMs } from '../retry-scheduler';
import type { PipelineContext } from '../types';
import { renderWorkflowPromptTemplate } from '../workflow-prompt';
import { resetPhaseState } from './context';
import { extractQaFlowResults } from './qa-result-parser';
import type { PipelineHelperEnv } from './shared';
import {
  collectQaEvidencePaths,
  formatVisualQaFailureFeedback,
  getVisualQaToolingStatus,
  hasVisualQaAssertions,
  summarizeQaFlowResults,
  toQaStatus,
  writeVisualQaRuntimeTest,
} from './visual-qa';

const DEFAULT_CONTINUATION_PROMPT_TEMPLATE = `The previous turn failed verification. Address the remaining gaps and fix the issues.

Prior failure reason: {{ prior_failure_reason }}

Do NOT re-read the original PRD — you already have it in context. Focus only on fixing the verification failures above.`;
const CPU_QUEUE_NOTICE_INTERVAL_MS = 30_000;
const DEFAULT_CPU_QUEUE_RETRY_MS = 5_000;

/**
 * Build a continuation prompt for a new turn after verify failure.
 * Uses the WORKFLOW.md continuation_prompt template if available,
 * otherwise falls back to the built-in default.
 */
function buildContinuationPrompt(context: PipelineContext, failureReason: string): string {
  const template =
    context.workflowPolicy.continuationPromptTemplate ?? DEFAULT_CONTINUATION_PROMPT_TEMPLATE;

  // Simple variable replacement — the template is short and doesn't
  // need the full Liquid engine unless the user provides a custom one.
  // For custom templates the workflow-prompt renderer handles it.
  return template
    .replace(/\{\{\s*prior_failure_reason\s*\}\}/g, failureReason)
    .replace(/\{\{\s*turn_count\s*\}\}/g, String(context.turnCount))
    .trim();
}

function normalizeFeatureQaResults(
  results: Array<Omit<FeatureQaResult, 'evidencePaths'> & { evidencePaths?: string[] | null }>,
): FeatureQaResult[] {
  return results.map((result) => ({
    ...result,
    evidencePaths: result.evidencePaths ?? undefined,
  }));
}

// Extract a short, human-readable error from an executor transcript.
// The previous heuristic only dropped the snippet when the joined last
// 3 lines started with `{`, which let backtick-fenced shipcode-plan
// blocks leak into `lastError` and dump the plan JSON onto the failure
// panel.
/**
 * Exported for focused transcript parsing regression tests.
 *
 * @knipignore
 */
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

/**
 * Extract a short summary from raw test command output for use in
 * last_error and notification bodies. Looks for common test failure
 * patterns across Jest, Vitest, Go test, pytest, and plain exit output.
 */
function extractTestFailureSummary(testOutput: string): string {
  if (!testOutput.trim()) return 'Tests failed (no output captured)';

  const lines = testOutput.split('\n');

  // Pattern 1: FAIL <path> (Jest/Vitest)
  const failLine = lines.find((l) => /^\s*(FAIL|✗|×)\s+\S/.test(l));
  if (failLine) return failLine.trim().slice(0, 280);

  // Pattern 2: "X failed" summary line (pytest, Vitest)
  const summaryLine = lines
    .slice()
    .reverse()
    .find((l) => /\d+\s+(failed|error|failing)/i.test(l));
  if (summaryLine) return summaryLine.trim().slice(0, 280);

  // Pattern 3: "--- FAIL" (Go)
  const goFail = lines.find((l) => l.startsWith('--- FAIL'));
  if (goFail) return goFail.trim().slice(0, 280);

  // Pattern 4: "Error:" lines
  const errorLine = lines.find((l) => /^\s*Error:/i.test(l));
  if (errorLine) return errorLine.trim().slice(0, 280);

  // Fallback: last non-empty line, capped
  const lastMeaningful = lines
    .slice()
    .reverse()
    .find((l) => l.trim().length > 0);
  return (lastMeaningful ?? 'Tests failed').trim().slice(0, 280);
}

interface TestFailureFingerprint {
  fingerprint: string;
  summary: string;
  outputExcerpt: string;
  implicatedFiles: string[];
}

function buildTestFailureFingerprint(command: string, output: string): TestFailureFingerprint {
  const summary = extractTestFailureSummary(output);
  const implicatedFiles = extractImplicatedFiles(`${command}\n${output}`);
  const normalizedOutput = output
    .split('\n')
    .map((line) =>
      stripAnsi(line)
        .replace(/\b\d+(?:\.\d+)?\s?(ms|s)\b/gi, '<duration>')
        .replace(/:\d+:\d+\b/g, ':<line>:<col>')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .slice(-40)
    .join('\n')
    .toLowerCase();
  const source = [
    command.trim(),
    summary.toLowerCase(),
    implicatedFiles.join(','),
    normalizedOutput,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    fingerprint: createHash('sha256').update(source).digest('hex').slice(0, 32),
    summary,
    outputExcerpt: output.trim().slice(-8192),
    implicatedFiles,
  };
}

function extractImplicatedFiles(value: string): string[] {
  const matches = value.match(/[A-Za-z0-9_./-]+\.(?:test|spec)\.[cm]?[jt]sx?/g) ?? [];
  return Array.from(new Set(matches.map((file) => file.replace(/^\.\//, '')))).slice(0, 20);
}

function worktreeHasChanges(context: PipelineContext): boolean {
  const cwd = context.worktreePath ?? context.projectPath;
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    }).trim();
    if (status.length > 0) return true;

    if (context.forkPointSha) {
      const diff = execFileSync('git', ['diff', '--name-only', `${context.forkPointSha}..HEAD`], {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
      }).trim();
      if (diff.length > 0) return true;
    }

    return false;
  } catch {
    return true;
  }
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
    emitTerminalRaw,
    ensureRepoSetupContract,
    formatStabilizationFeedback,
    formatTestFixFeedback,
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

  function scheduleCoordinatedTestFixRetry(
    threadId: string,
    context: NonNullable<ReturnType<typeof activePipelines.get>>,
    command: string,
    testOutput: string,
  ): boolean {
    context.testOutput = context.testOutput?.includes(testOutput)
      ? context.testOutput
      : `${context.testOutput ?? ''}\n${testOutput}`.slice(-16384);
    const blockMessage = claimSharedTestFailure(threadId, context, command, context.testOutput);
    if (blockMessage) {
      emitTerminalLifecycle(threadId, `[shared-failure] ${blockMessage}\r\n`);
      emitPhase(threadId, 'failed', blockMessage);
      activePipelines.delete(threadId);
      return true;
    }

    if (context.testRetries >= MAX_TEST_RETRIES) return false;

    context.testRetries++;
    context.stabilizationFeedback = formatTestFixFeedback(context.testOutput, context.testRetries);
    const delayMs = computeRetryDelayMs({
      reason: 'continuation',
      attempt: context.testRetries,
    });
    if (context.retryTimer) clearTimeout(context.retryTimer);
    context.retryTimer = setTimeout(() => {
      context.retryTimer = null;
      if (context.cancelled || !activePipelines.has(threadId)) return;
      void startTestFix(threadId);
    }, delayMs);
    return true;
  }

  function queueTestingIfCpuBusy(
    threadId: string,
    context: NonNullable<ReturnType<typeof activePipelines.get>>,
  ): boolean {
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
      return false;
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
    if (context.retryTimer) clearTimeout(context.retryTimer);
    context.retryTimer = setTimeout(() => {
      context.retryTimer = null;
      if (context.cancelled || !activePipelines.has(threadId)) return;
      void handlers.startTesting(threadId);
    }, retryMs);
    return true;
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

    const diff = computeNodeDiff(context, context.nodeAnchorSha ?? '');
    if (!diff.trim()) {
      // No changes produced — treat as needing retry
      return 'retry';
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

    try {
      const response = await runProviderPhase(context, 'verify', prompt, verifyMaterials, {
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
    const usesTaskGraph = Boolean(
      taskGraph && deps.taskGraphs && taskGraph.mode !== 'direct' && taskGraph.nodes.length >= 1,
    );
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
            handlers.startTesting(threadId);
          } else {
            // Check if any code was actually changed
            if (!worktreeHasChanges(context)) {
              emitPhase(
                threadId,
                'failed',
                'All task graph nodes completed but no code changes were produced',
              );
              activePipelines.delete(threadId);
              return;
            }
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
    const executionResumeContext = context.executionResumeContext ?? '';
    context.executionResumeContext = null;
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
    const executionTaskGraph = usesTaskGraph ? taskGraph : null;
    const executionPrompt =
      (workflowExecutionPrompt ??
        buildExecutionPrompt(executionPlan, skill.context, skill.deps, {
          promptMaterials: executeMaterials,
          testingContext: getTestingContext(context),
        })) +
      formatTaskGraphExecutionContract(executionTaskGraph, { activeNode: activeTaskNode }) +
      verificationFeedback +
      testFeedback +
      stabilizationFeedback +
      executionResumeContext;

    // Capture HEAD before execution for per-node diff scoping
    if (activeTaskNode) {
      context.nodeAnchorSha = captureNodeAnchorSha(context);
    }

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
            // ─── Per-node verification gate ───
            const nodeOutcome = await verifyNodeCompletion(threadId, plan, activeTaskNode);

            if (nodeOutcome === 'passed') {
              context.nodeVerificationRetries = 0;
              context.nodeAnchorSha = null;
              const updatedGraph = deps.taskGraphs.markNodeCompletedAndPromote(activeTaskNode.id);
              void postTaskGraphComment(context, updatedGraph);
              resetPhaseState(context);
              handlers.startExecution(threadId, plan);
              return;
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
                return;
              }
              context.nodeVerificationRetries++;
              context.stabilizationFeedback = formatNodeVerificationFailureFeedback(
                activeTaskNode,
                context.nodeVerificationRetries,
              );
              deps.taskGraphs.updateNodeStatus(activeTaskNode.id, 'ready');
              const delayMs = computeRetryDelayMs({
                reason: 'continuation',
                attempt: context.nodeVerificationRetries,
              });
              if (context.retryTimer) clearTimeout(context.retryTimer);
              context.retryTimer = setTimeout(() => {
                context.retryTimer = null;
                if (context.cancelled || !activePipelines.has(threadId)) return;
                handlers.startExecution(threadId, plan);
              }, delayMs);
              return;
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
            return;
            // ─── End per-node verification gate ───
          }

          if (taskGraph?.mode === 'direct' && deps.taskGraphs && taskGraph.status !== 'completed') {
            try {
              deps.taskGraphs.updateGraphStatus(taskGraph.id, 'completed');
            } catch (error) {
              console.error(
                `[pipeline] direct task graph completion failed for ${threadId}:`,
                error,
              );
            }
          }

          if (context.autonomous) {
            resetPhaseState(context);
            handlers.startTesting(threadId);
          } else {
            // Check if executor actually produced code changes
            const hasChanges = worktreeHasChanges(context);
            if (!hasChanges) {
              const errSnippet = extractExecutionErrorSnippet(response.rawOutput);
              emitPhase(
                threadId,
                'failed',
                `Executor exited successfully but produced no code changes${errSnippet ? `: ${errSnippet}` : ''}`,
              );
              activePipelines.delete(threadId);
              return;
            }
            emitPhase(threadId, 'completed');
            activePipelines.delete(threadId);
          }
        } else {
          const errSnippet = extractExecutionErrorSnippet(response.rawOutput);
          if (activeTaskNode && deps.taskGraphs) {
            const failedGraph = deps.taskGraphs.markNodeFailed(activeTaskNode.id);
            void postTaskGraphComment(context, failedGraph);
          } else if (
            taskGraph?.mode === 'direct' &&
            deps.taskGraphs &&
            taskGraph.status !== 'failed'
          ) {
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
        }
      } catch (error) {
        if (!context.cancelled) {
          emitPhase(threadId, 'failed', `Execution error: ${String(error)}`);
          activePipelines.delete(threadId);
        }
      }
    })();
  }

  async function startTestFix(threadId: string) {
    const context = activePipelines.get(threadId);
    if (!context) return;

    const testOutput = context.testOutput ?? '';
    context.testOutput = null;

    const latestPlan = deps.plans.getLatest(threadId);
    const structuredPlan = latestPlan?.structured;
    if (!structuredPlan) {
      emitPhase(
        threadId,
        'failed',
        'Test fix cannot start: structured plan missing for this thread.',
      );
      activePipelines.delete(threadId);
      return;
    }

    // Reset phase state, then inject focused test-fix feedback (consumed-once).
    resetPhaseState(context);
    context.stabilizationFeedback = formatTestFixFeedback(testOutput, context.testRetries);

    await handlers.startExecution(threadId, structuredPlan);
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
      handlers.startVerification(threadId);
      return;
    }

    if (queueTestingIfCpuBusy(threadId, context)) return;

    emitPhase(threadId, 'testing');

    const cwd = context.worktreePath ?? context.projectPath;
    const preparation = await prepareWorktree(context, 'verify');
    if (!preparation.ok) {
      emitPhase(threadId, 'failed', `Verification preflight failed: ${preparation.error}`);
      activePipelines.delete(threadId);
      return;
    }

    if (hasVisualQa && context.featureQaState) {
      if (context.featureQaState.selectorReadiness !== 'ready') {
        const message =
          `[runtime-qa] Visual QA requires stable selectors, but selectorReadiness is ` +
          `"${context.featureQaState.selectorReadiness}". Add stable data-testid selectors for the visual QA targets.`;
        if (
          scheduleCoordinatedTestFixRetry(
            threadId,
            context,
            'runtime-qa:selector-readiness',
            message,
          )
        )
          return;
        emitPhase(threadId, 'failed', message);
        activePipelines.delete(threadId);
        return;
      }

      const visualRoutes = context.featureQaState.visualAssertions ?? [];
      const hasRelativeRoute = visualRoutes.some((assertion) => assertion.route.startsWith('/'));
      if (hasRelativeRoute && !runtimeQa?.server) {
        const message =
          '[runtime-qa] Visual QA uses relative routes but the repo setup contract has no runtimeQa.server. ' +
          'Configure .shipcode/setup.json runtimeQa.server so ShipCode can start the app under test.';
        emitPhase(threadId, 'failed', message);
        activePipelines.delete(threadId);
        return;
      }

      try {
        const tooling = getVisualQaToolingStatus(cwd, shellExecEnv().PATH);
        if (!tooling.available) {
          emitPhase(threadId, 'failed', tooling.message);
          activePipelines.delete(threadId);
          return;
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
        return;
      }
    }

    // --- Phase 1: Static verify commands (unit tests, typecheck, build) ---
    const outputs: string[] = [];
    for (const command of verifyCommands) {
      emitTerminalLifecycle(threadId, `[verify] $ ${command}\r\n`);
      try {
        const result = await runShellCommand(threadId, cwd, command, context.abort.signal);
        outputs.push(result.output);
        context.testOutput = outputs.join('\n').slice(-16384);
        if (result.exitCode !== 0) {
          if (!scheduleCoordinatedTestFixRetry(threadId, context, command, result.output)) {
            const testSummary = extractTestFailureSummary(context.testOutput ?? '');
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

    // --- Phase 2: Runtime QA (server lifecycle + runtime tests) ---
    if (hasRuntimeQa) {
      const runtimeQaResult = await runRuntimeQa(
        threadId,
        context,
        cwd,
        runtimeQa ?? { testCommands: [], discoverAgentTests: true },
      );
      if (!runtimeQaResult.ok) {
        if (runtimeQaResult.fatal) {
          emitPhase(threadId, 'failed', runtimeQaResult.error);
          activePipelines.delete(threadId);
        }
        return;
      }
    }

    context.testRetries = 0;
    resetPhaseState(context, ['testOutput', 'runtimeQaOutput']);
    handlers.startVerification(threadId);
  }

  async function runRuntimeQa(
    threadId: string,
    context: PipelineContext,
    cwd: string,
    config: NonNullable<PipelineContext['repoSetupContract']>['contract']['runtimeQa'],
  ): Promise<{ ok: true } | { ok: false; fatal: boolean; error: string }> {
    if (!config) return { ok: true };

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
        try {
          server = await lifecycle.start(config.server, cwd, context.abort.signal, threadId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (
            scheduleCoordinatedTestFixRetry(
              threadId,
              context,
              config.server.command,
              `[runtime-qa] Server startup failed: ${message}`,
            )
          ) {
            return { ok: false, fatal: false, error: message };
          }
          return { ok: false, fatal: true, error: `Runtime QA server startup failed: ${message}` };
        }
      }

      const extraEnv: Record<string, string> = {};
      if (server) {
        extraEnv.BASE_URL = server.baseUrl;
        if (config.server?.portEnvVar) {
          extraEnv[config.server.portEnvVar] = String(server.port);
        }
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
          context.runtimeQaOutput = runtimeOutputs.join('\n').slice(-16384);
          context.testOutput = `${context.testOutput ?? ''}\n${context.runtimeQaOutput}`.slice(
            -16384,
          );
          if (
            scheduleCoordinatedTestFixRetry(threadId, context, 'runtime-qa:server-crashed', failMsg)
          ) {
            return { ok: false, fatal: false, error: failMsg };
          }
          return { ok: false, fatal: true, error: failMsg };
        }

        emitTerminalLifecycle(threadId, `[runtime-qa] $ ${command}\r\n`);
        try {
          const result = await runShellCommand(threadId, cwd, command, context.abort.signal, {
            extraEnv,
          });
          runtimeOutputs.push(`[runtime-qa] ${command}\n${result.output}`);
          context.runtimeQaOutput = runtimeOutputs.join('\n').slice(-16384);
          const commandQaResults = extractQaFlowResults(result.output);
          if (commandQaResults.length > 0) {
            qaFlowResults.push(...commandQaResults);
          }

          const hasFailedQaResult = commandQaResults.some((flow) => !flow.passed);
          if (result.exitCode !== 0 || hasFailedQaResult) {
            persistQaFlowResults();
            const visualFeedback = formatVisualQaFailureFeedback(commandQaResults);
            const output = `${context.runtimeQaOutput}${visualFeedback}`;
            if (scheduleCoordinatedTestFixRetry(threadId, context, command, output)) {
              return { ok: false, fatal: false, error: `Runtime test failed: ${command}` };
            }
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
      return { ok: true };
    } finally {
      await cleanupServer();
      context.runtimeQaCleanup = null;
      context.abort.signal.removeEventListener('abort', onAbort);
    }
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
      return;
    }

    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' }).trim();
    context.verifiedSha = headSha;
    deps.projectFailures?.resolveOwnedByThread(threadId, headSha);

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
      ...(context.runtimeQaOutput
        ? [
            {
              kind: 'verification_output' as const,
              label: 'runtime QA output',
              content: context.runtimeQaOutput,
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
          testOutput: context.testOutput,
        }) ??
        buildVerificationPrompt(
          plan,
          diff,
          plan.acceptanceCriteria,
          skill.context,
          skill.deps,
          context.testOutput ?? null,
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
            handlers.startCommitAndPush(threadId);
          } else if (context.verificationRetries < MAX_VERIFICATION_RETRIES) {
            context.verificationRetries++;
            const delayMs = computeRetryDelayMs({
              reason: 'continuation',
              attempt: context.verificationRetries,
            });
            if (context.retryTimer) clearTimeout(context.retryTimer);
            context.retryTimer = setTimeout(() => {
              context.retryTimer = null;
              if (context.cancelled || !activePipelines.has(threadId)) return;
              resetPhaseState(context);
              handlers.startExecution(threadId, plan);
            }, delayMs);
          } else {
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
              if (context.retryTimer) clearTimeout(context.retryTimer);
              context.retryTimer = setTimeout(() => {
                context.retryTimer = null;
                if (context.cancelled || !activePipelines.has(threadId)) return;
                resetPhaseState(context);
                handlers.startPlanGeneration(
                  threadId,
                  continuationPrompt,
                  context.projectPath,
                  context.worktreePath,
                );
              }, delayMs);
            } else {
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
            }
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

      resetPhaseState(context);
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
        resetPhaseState(context);
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
    resetPhaseState(context);
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
