import {
  buildPlanPrompt,
  buildPreviousAttemptContext,
  buildReviewPrompt,
  buildRevisionPrompt,
  formatClarificationContext,
  loadCodeReviewGraphContext,
  loadRepoContext,
  loadStructuredRepoContext,
  type PromptMaterial,
  StreamParser,
  selectPromptMaterials,
  summarizePromptMaterials,
} from '@shipcode/agents/source';
import {
  type AnsweredClarification,
  buildQaStateGapMessage,
  type ClarificationRequest,
  clampTextBlock,
  extractFeatureQaState,
  getPrdQualityIssues,
  MAX_CLARIFICATION_ROUNDS,
  PIPELINE_MAX_RETRIES,
  type PlanRecord,
  resolvePipelineSpeedProfile,
  resolveRequireApproval,
  resolveRequireApprovalForIssue,
  resolveRevisionCount,
  resolveRevisionCountForIssue,
  type ShipCodePlan,
} from '@shipcode/shared';
import type { TaskGraphWithNodes } from '@shipcode/shared/source';
import { computeRetryDelayMs } from '../retry-scheduler';
import type { PipelineContext, PlanPhaseCarry } from '../types';
import { renderWorkflowPromptTemplate } from '../workflow-prompt';
import { buildPhasePayload, resetPhaseState } from './context';
import type { PhaseOutcome, PipelineHelperEnv } from './shared';

const NO_VALID_PLAN_REASON = 'Plan generation failed — no valid shipcode-plan block was produced.';

/**
 * @knipignore
 */
export function clearRetryTimer(context: PipelineContext): void {
  if (!context.retryTimer) return;
  clearTimeout(context.retryTimer);
  context.retryTimer = null;
}

/**
 * @knipignore
 */
export function formatPlanParseFailure(error?: string): string {
  if (!error) return NO_VALID_PLAN_REASON;
  const firstLine = error.split('\n')[0] ?? error;
  return `Plan output could not be parsed — ${clampTextBlock(firstLine, 280)}`;
}

function formatAnsweredClarification(
  answered: AnsweredClarification,
  index: number,
): string | null {
  const formatted = formatClarificationContext(answered.request, answered.answers);
  return formatted ? `Clarification round ${index + 1}\n${formatted}` : null;
}

/**
 * @knipignore
 */
export function buildClarificationContext(context: PipelineContext): string | null {
  const history = context.clarificationHistory ?? [];
  const blocks = history
    .map((answered, index) => formatAnsweredClarification(answered, index))
    .filter((block): block is string => Boolean(block));

  if (blocks.length === 0) {
    const current = formatClarificationContext(
      context.clarificationRequest,
      context.clarificationAnswers,
    );
    if (current) blocks.push(current);
  }

  if (blocks.length === 0) return null;

  return [
    'The user has already answered planner clarification. Treat this as final planning input.',
    ...blocks,
    'Produce a concrete plan now unless another user-owned product/security/destructive-data/billing/external-provider decision makes planning impossible.',
  ].join('\n\n');
}

export function createPlanningPhaseHandlers({ deps, contextHelpers, runtime }: PipelineHelperEnv) {
  const { activePipelines, ensureContext, skillCallSite } = contextHelpers;
  const {
    buildRepoSetupPlannerNote,
    emitPhase,
    emitTerminalLifecycle,
    ensureRepoSetupContract,
    getVerifyCommands,
    postPlanComment,
    postTaskGraphComment,
    resolveAgentForPhase,
    runProviderPhase,
  } = runtime;

  function ensureRepoPromptMaterials(context: ReturnType<typeof ensureContext>): PromptMaterial[] {
    if (context.repoPromptMaterials === null) {
      const materials = [
        ...loadStructuredRepoContext(context.worktreePath ?? context.projectPath),
        ...loadCodeReviewGraphContext(context.projectPath),
      ];
      context.repoPromptMaterials = materials;
      context.repoContext = materials.map((material) => material.content).join('\n\n');
    }
    return context.repoPromptMaterials;
  }

  function rememberMaterialSummary(
    context: ReturnType<typeof ensureContext>,
    phase: 'plan' | 'review' | 'revision',
    materials: PromptMaterial[],
  ) {
    context.promptMaterialSummaries[phase] = summarizePromptMaterials(
      selectPromptMaterials(phase, materials),
    );
  }

  function resolveClarificationRequest(
    parser: StreamParser,
    responseClarification?: ClarificationRequest,
  ): ClarificationRequest | null {
    if (responseClarification) return responseClarification;
    const parsed = parser.extractClarificationRequest();
    return parsed.success ? parsed.data : null;
  }

  function enterClarifying(
    threadId: string,
    context: ReturnType<typeof ensureContext>,
    request: ClarificationRequest,
  ): PhaseOutcome {
    const nextRound = context.clarificationRound + 1;
    if (nextRound > MAX_CLARIFICATION_ROUNDS) {
      emitPhase(
        threadId,
        'failed',
        `Planning clarification limit reached after ${MAX_CLARIFICATION_ROUNDS} rounds.`,
      );
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }

    context.clarificationRound = nextRound;
    context.clarificationRequest = {
      ...request,
      threadId,
      phase: 'plan',
    };
    context.clarificationAnswers = [];
    context.retryCount = 0;

    deps.threads.setClarificationRequest(threadId, context.clarificationRequest, nextRound);
    deps.emitter.emit({
      type: 'terminal:event',
      threadId,
      ...(context.runId ? { runId: context.runId } : {}),
      event: {
        kind: 'clarification_requested',
        summary: context.clarificationRequest.summary,
        questionCount: context.clarificationRequest.questions.length,
      },
    });
    emitPhase(threadId, 'clarifying');
    return { next: 'paused' };
  }

  function clearClarificationState(threadId: string, context: ReturnType<typeof ensureContext>) {
    context.clarificationRound = 0;
    context.clarificationRequest = null;
    context.clarificationAnswers = [];
    context.clarificationHistory = [];
    const threads = deps.threads as typeof deps.threads & {
      clearClarification?: (id: string) => void;
      clearPendingClarification?: (id: string) => void;
    };
    if (typeof threads.clearPendingClarification === 'function') {
      threads.clearPendingClarification(threadId);
    } else {
      threads.clearClarification?.(threadId);
    }
  }

  function getRevisionCountForContext(context: ReturnType<typeof ensureContext>): number {
    const settings = deps.settings.get();
    const project = context.projectId ? deps.projects.getById(context.projectId) : null;
    const issue =
      context.projectId && context.githubIssueNumber != null
        ? deps.githubIssues.getByNumber(context.projectId, context.githubIssueNumber)
        : null;
    return issue
      ? resolveRevisionCountForIssue(settings, project, issue)
      : resolveRevisionCount(settings, project);
  }

  function getRequireApprovalForContext(context: ReturnType<typeof ensureContext>): boolean {
    const settings = deps.settings.get();
    const project = context.projectId ? deps.projects.getById(context.projectId) : null;
    const issue =
      context.projectId && context.githubIssueNumber != null
        ? deps.githubIssues.getByNumber(context.projectId, context.githubIssueNumber)
        : null;
    return issue
      ? resolveRequireApprovalForIssue(settings, project, issue)
      : resolveRequireApproval(settings, project);
  }

  function getSpeedProfileForContext(context: ReturnType<typeof ensureContext>) {
    const settings = deps.settings.get();
    const project = context.projectId ? deps.projects.getById(context.projectId) : null;
    return resolvePipelineSpeedProfile(settings, project);
  }

  async function continueFromStructuredPlan(
    threadId: string,
    context: ReturnType<typeof ensureContext>,
    plan: PlanRecord,
    structuredPlan: ShipCodePlan,
  ): Promise<PhaseOutcome> {
    let taskGraph: TaskGraphWithNodes | null = null;
    try {
      taskGraph =
        deps.taskGraphs?.replaceForPlan(threadId, plan.id, structuredPlan, {
          speedProfile: getSpeedProfileForContext(context),
        }) ?? null;
    } catch (error) {
      console.error(`[pipeline] task graph persistence failed for thread ${threadId}:`, error);
    }
    if (taskGraph && taskGraph.mode !== 'direct') {
      await postTaskGraphComment(context, taskGraph);
    }

    const revisionCount = getRevisionCountForContext(context);
    deps.emitter.emit({ type: 'plan:parsed', threadId, plan: structuredPlan });

    if (revisionCount > 0) {
      deps.plans.updateStatus(plan.id, 'pending_review');
      resetPhaseState(context);
      return { next: 'review', plan: structuredPlan };
    }

    deps.plans.updateStatus(plan.id, 'approved');
    const requireApproval = getRequireApprovalForContext(context);
    const reasons: Array<'requireApproval' | 'nonAutonomous' | 'reviewApproved'> = [
      'reviewApproved',
    ];
    if (requireApproval) reasons.push('requireApproval');
    if (!context.autonomous) reasons.push('nonAutonomous');

    if (requireApproval || !context.autonomous) {
      deps.emitter.emit({
        type: 'pipeline:approval-gate',
        threadId,
        outcome: 'approval',
        reviewDecision: 'approve',
        planVersion: plan.version,
        requireApproval,
        autonomous: context.autonomous,
        reviewRound: context.reviewRound,
        revisionCount,
        hasCriticalOrMajor: false,
        reasons,
      });
      deps.plans.updateStatus(plan.id, 'approval');
      void postPlanComment(context, structuredPlan);
      emitPhase(threadId, 'approval');
      return { next: 'paused' };
    }

    deps.emitter.emit({
      type: 'pipeline:approval-gate',
      threadId,
      outcome: 'auto_execute',
      reviewDecision: 'approve',
      planVersion: plan.version,
      requireApproval,
      autonomous: context.autonomous,
      reviewRound: context.reviewRound,
      revisionCount,
      hasCriticalOrMajor: false,
      reasons,
    });
    resetPhaseState(context);
    return { next: 'execute', plan: structuredPlan };
  }

  async function startPlanGeneration(
    threadId: string,
    prompt: string,
    projectPath: string,
    worktreePath: string | null,
    carry?: PlanPhaseCarry,
  ): Promise<PhaseOutcome> {
    const context = ensureContext(threadId, { projectPath, worktreePath });
    clearRetryTimer(context);

    if (context.repoPromptMaterials === null) {
      const materials = [
        ...loadStructuredRepoContext(worktreePath ?? projectPath),
        ...loadCodeReviewGraphContext(projectPath),
      ];
      context.repoPromptMaterials = materials;
      context.repoContext =
        materials.map((material) => material.content).join('\n\n') ||
        loadRepoContext(worktreePath ?? projectPath);
    }
    try {
      ensureRepoSetupContract(context);
    } catch (error) {
      emitPhase(threadId, 'failed', error instanceof Error ? error.message : String(error));
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }

    // PRD quality gate — check issue body for required sections and structure.
    const qualityIssues = getPrdQualityIssues(prompt);
    if (qualityIssues.length > 0) {
      const project = context.projectId ? deps.projects.getById(context.projectId) : null;
      const gateEnabled = project?.prdQualityGate === true;
      const issueList = qualityIssues.join('; ');

      if (gateEnabled) {
        emitPhase(
          threadId,
          'failed',
          `PRD quality gate: ${issueList}. Update the issue body and re-trigger.`,
        );
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }

      // Gate OFF (default) — post/log a warning and continue
      emitTerminalLifecycle(threadId, `[prd-gate] Warning: PRD quality issues: ${issueList}\r\n`);
    }

    // Extract feature QA state from the PRD `## QA State` section (once per pipeline).
    if (!context.featureQaState) {
      const qaExtraction = extractFeatureQaState(prompt);
      context.featureQaState = qaExtraction.qaState;
      if (qaExtraction.status !== 'present') {
        const gapMsg = buildQaStateGapMessage(
          qaExtraction.status,
          qaExtraction.reason ?? '',
          context.githubIssueNumber,
        );
        emitTerminalLifecycle(threadId, `[qa-state] ${gapMsg}\r\n`);
      }
    }

    emitPhase(threadId, 'planning');

    const skill = skillCallSite(context);
    // Prefer the typed carry from an internal retry; fall back to the context
    // field seeded externally by the desktop retry IPC. Consume either way.
    const previousAttempt = carry?.previousPlanRawOutput ?? context.previousPlanRawOutput;
    context.previousPlanRawOutput = null;
    const clarificationContext = buildClarificationContext(context);
    const planMaterials: PromptMaterial[] = [
      { kind: 'issue_prompt', label: 'issue prompt', content: prompt },
      ...ensureRepoPromptMaterials(context),
    ];
    rememberMaterialSummary(context, 'plan', planMaterials);
    const payload = buildPhasePayload(context, 'plan', {
      previousPlanRawOutput: previousAttempt,
    });
    let workflowPlanPrompt: string | null;
    try {
      workflowPlanPrompt = renderWorkflowPromptTemplate(context, deps, 'plan');
    } catch (error) {
      emitPhase(
        threadId,
        'failed',
        `WORKFLOW.md template render error: ${error instanceof Error ? error.message : String(error)}`,
      );
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }
    const planPrompt =
      (workflowPlanPrompt ??
        buildPlanPrompt(
          prompt,
          threadId,
          skill.context,
          skill.deps,
          {
            promptMaterials: planMaterials,
            clarificationContext: clarificationContext ?? undefined,
          },
          getVerifyCommands(context).join(' && ') || null,
        )) +
      buildRepoSetupPlannerNote(context) +
      (payload.carry.previousPlanRawOutput
        ? buildPreviousAttemptContext(payload.carry.previousPlanRawOutput)
        : '');

    try {
      const response = await runProviderPhase(context, payload, planPrompt, planMaterials, {
        reasoningEffort: context.phaseReasoningEfforts.plan,
      });

      if (context.cancelled) return { next: 'paused' };

      if (response.exitCode === 127) {
        const agent = resolveAgentForPhase(context, 'plan');
        const name = agent === 'openrouter' ? 'Provider' : `${agent} CLI`;
        emitPhase(
          threadId,
          'failed',
          `${name} not found (exit 127). Is the ${agent} binary installed and on PATH?`,
        );
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }

      const parser = new StreamParser();
      parser.feed(response.rawOutput);
      const clarificationRequest = resolveClarificationRequest(
        parser,
        response.clarificationRequest,
      );

      if (response.exitCode !== 0) {
        const result = parser.extractPlan();
        if (result.success && result.data) {
          clearClarificationState(threadId, context);
          const nextVersion = deps.plans.getMaxVersion(threadId) + 1;
          const plan = deps.plans.create(threadId, result.raw, result.data, nextVersion);
          return await continueFromStructuredPlan(threadId, context, plan, result.data);
        }
        if (clarificationRequest) {
          return enterClarifying(threadId, context, clarificationRequest);
        }
        const detectedError = parser.detectError();
        if (context.retryCount < PIPELINE_MAX_RETRIES) {
          context.retryCount++;
          const delayMs = computeRetryDelayMs({
            reason: 'failure',
            attempt: context.retryCount,
            maxRetryBackoffMs: context.workflowPolicy.agent.maxRetryBackoffMs,
          });
          return {
            next: 'retry',
            delayMs,
            andThen: {
              next: 'plan',
              prompt,
              projectPath,
              worktreePath,
              carry: { previousPlanRawOutput: response.rawOutput },
            },
          };
        }
        let cliError: string | null = null;
        for (const line of parser.getRawOutput().trim().split('\n').filter(Boolean).reverse()) {
          try {
            const obj = JSON.parse(line.trim()) as Record<string, unknown>;
            if (obj.type === 'result') {
              if (typeof obj.result === 'string') {
                cliError = obj.result.slice(0, 300);
                break;
              }
              if (
                Array.isArray(obj.errors) &&
                obj.errors.length > 0 &&
                typeof obj.errors[0] === 'string'
              ) {
                cliError = obj.errors[0].slice(0, 300);
                break;
              }
            }
          } catch {
            // skip malformed lines
          }
        }
        const rawSnippet =
          cliError ??
          detectedError?.match ??
          parser
            .getRawOutput()
            .trim()
            .split('\n')
            .filter(Boolean)
            .slice(-3)
            .join(' ')
            .slice(0, 300);
        const reason = rawSnippet?.trimStart().startsWith('{') ? '' : rawSnippet;
        emitPhase(
          threadId,
          'failed',
          reason || 'Plan generation failed — no structured plan was produced.',
        );
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }

      const result = parser.extractPlan();
      const nextVersion = deps.plans.getMaxVersion(threadId) + 1;
      if (result.success && result.data) {
        clearClarificationState(threadId, context);
        const plan = deps.plans.create(threadId, result.raw, result.data, nextVersion);
        return await continueFromStructuredPlan(threadId, context, plan, result.data);
      }
      if (clarificationRequest) {
        return enterClarifying(threadId, context, clarificationRequest);
      }
      deps.plans.create(threadId, result.raw, null, nextVersion);
      emitPhase(threadId, 'failed', formatPlanParseFailure(result.error));
      activePipelines.delete(threadId);
      return { next: 'failed' };
    } catch (error) {
      if (!context.cancelled) {
        emitPhase(threadId, 'failed', `Plan generation error: ${String(error)}`);
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }
      return { next: 'paused' };
    }
  }

  async function startReview(threadId: string, plan: ShipCodePlan): Promise<PhaseOutcome> {
    const context = activePipelines.get(threadId);
    if (!context) return { next: 'paused' };

    emitPhase(threadId, 'reviewing');

    const skill = skillCallSite(context);
    const reviewMaterials: PromptMaterial[] = [
      {
        kind: 'issue_prompt',
        label: 'thread prompt',
        content: deps.threads.getById(threadId)?.prompt ?? '',
      },
      ...ensureRepoPromptMaterials(context),
    ];
    rememberMaterialSummary(context, 'review', reviewMaterials);
    let workflowReviewPrompt: string | null;
    try {
      workflowReviewPrompt = renderWorkflowPromptTemplate(context, deps, 'review', { plan });
    } catch (error) {
      emitPhase(
        threadId,
        'failed',
        `WORKFLOW.md template render error: ${error instanceof Error ? error.message : String(error)}`,
      );
      activePipelines.delete(threadId);
      return { next: 'failed' };
    }
    const reviewPromptText =
      workflowReviewPrompt ??
      buildReviewPrompt(plan, skill.context, skill.deps, {
        autonomous: context.autonomous,
        promptMaterials: reviewMaterials,
      });

    const payload = buildPhasePayload(context, 'review');
    try {
      const response = await runProviderPhase(context, payload, reviewPromptText, reviewMaterials, {
        reasoningEffort: context.phaseReasoningEfforts.review,
      });

      if (context.cancelled) return { next: 'paused' };

      if (response.exitCode === 127) {
        const agent = resolveAgentForPhase(context, 'review');
        const name = agent === 'openrouter' ? 'Provider' : `${agent} CLI`;
        emitPhase(
          threadId,
          'failed',
          `${name} not found (exit 127). Is the ${agent} binary installed and on PATH?`,
        );
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }

      const parser = new StreamParser();
      parser.feed(response.rawOutput);

      const result = parser.extractReview();
      const latestPlan = deps.plans.getLatest(threadId);

      if (!(result.success && result.data && latestPlan)) {
        if (latestPlan) {
          deps.reviews.create(latestPlan.id, parser.getRawOutput(), null);
        }
        emitPhase(
          threadId,
          'failed',
          'Review output could not be parsed — reviewer did not emit a shipcode-review block.',
        );
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }

      const latestStructuredPlan = latestPlan.structured;
      if (!latestStructuredPlan) {
        emitPhase(threadId, 'failed', 'Review aborted: latest plan record has no structured plan.');
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }
      deps.reviews.create(latestPlan.id, result.raw, result.data);
      deps.plans.updateStatus(
        latestPlan.id,
        result.data.decision === 'approve' ? 'approved' : 'rejected',
      );
      deps.emitter.emit({ type: 'review:parsed', threadId, review: result.data });

      if (result.data.decision === 'approve') {
        const requireApproval = getRequireApprovalForContext(context);
        const revisionCount = getRevisionCountForContext(context);
        const reasons: Array<'requireApproval' | 'nonAutonomous' | 'reviewApproved'> = [
          'reviewApproved',
        ];
        if (requireApproval) reasons.push('requireApproval');
        if (!context.autonomous) reasons.push('nonAutonomous');

        if (requireApproval || !context.autonomous) {
          deps.emitter.emit({
            type: 'pipeline:approval-gate',
            threadId,
            outcome: 'approval',
            reviewDecision: 'approve',
            planVersion: latestPlan.version,
            requireApproval,
            autonomous: context.autonomous,
            reviewRound: context.reviewRound,
            revisionCount,
            hasCriticalOrMajor: false,
            reasons,
          });
          deps.plans.updateStatus(latestPlan.id, 'approval');
          void postPlanComment(context, latestStructuredPlan);
          emitPhase(threadId, 'approval');
          return { next: 'paused' };
        }
        deps.emitter.emit({
          type: 'pipeline:approval-gate',
          threadId,
          outcome: 'auto_execute',
          reviewDecision: 'approve',
          planVersion: latestPlan.version,
          requireApproval,
          autonomous: context.autonomous,
          reviewRound: context.reviewRound,
          revisionCount,
          hasCriticalOrMajor: false,
          reasons,
        });
        resetPhaseState(context);
        return { next: 'execute', plan: latestStructuredPlan };
      }

      if (result.data.decision === 'request_changes') {
        const revisionCountLimit = getRevisionCountForContext(context);
        if (context.reviewRound < revisionCountLimit) {
          context.reviewRound++;
          deps.threads.incrementReviewRound(threadId);
          const feedback =
            result.data.suggestedChanges.join('\n') +
            '\n\nFindings:\n' +
            result.data.findings
              .map(
                (finding: { severity: string; description: string; suggestion?: string }) =>
                  `[${finding.severity}] ${finding.description}${finding.suggestion ? ` — ${finding.suggestion}` : ''}`,
              )
              .join('\n');
          resetPhaseState(context);
          return { next: 'revision', plan: latestStructuredPlan, reviewFeedback: feedback };
        }
        const hasCriticalOrMajor = result.data.findings.some(
          (finding: { severity: string }) =>
            finding.severity === 'critical' || finding.severity === 'major',
        );
        const requireApproval = getRequireApprovalForContext(context);
        const reasons: Array<
          'requireApproval' | 'nonAutonomous' | 'criticalFindings' | 'revisionsExhausted'
        > = ['revisionsExhausted'];
        if (requireApproval) reasons.push('requireApproval');
        if (!context.autonomous) reasons.push('nonAutonomous');
        if (hasCriticalOrMajor) reasons.push('criticalFindings');

        if (requireApproval || !context.autonomous || hasCriticalOrMajor) {
          deps.emitter.emit({
            type: 'pipeline:approval-gate',
            threadId,
            outcome: 'approval',
            reviewDecision: 'request_changes',
            planVersion: latestPlan.version,
            requireApproval,
            autonomous: context.autonomous,
            reviewRound: context.reviewRound,
            revisionCount: revisionCountLimit,
            hasCriticalOrMajor,
            reasons,
          });
          deps.plans.updateStatus(latestPlan.id, 'approval');
          void postPlanComment(context, latestStructuredPlan);
          emitPhase(threadId, 'approval');
          return { next: 'paused' };
        }
        deps.emitter.emit({
          type: 'pipeline:approval-gate',
          threadId,
          outcome: 'auto_execute',
          reviewDecision: 'request_changes',
          planVersion: latestPlan.version,
          requireApproval,
          autonomous: context.autonomous,
          reviewRound: context.reviewRound,
          revisionCount: revisionCountLimit,
          hasCriticalOrMajor,
          reasons,
        });
        resetPhaseState(context);
        return { next: 'execute', plan: latestStructuredPlan };
      }

      if (result.data.decision === 'reject') {
        // Reviewer rejected the plan outright — do not loop revisions
        // and do not auto-execute even in autonomous mode. Halt at the
        // approval gate so the user can intervene (edit issue, retry,
        // or abandon).
        const hasCriticalOrMajor = result.data.findings.some(
          (finding: { severity: string }) =>
            finding.severity === 'critical' || finding.severity === 'major',
        );
        const requireApproval = getRequireApprovalForContext(context);
        const revisionCountLimit = getRevisionCountForContext(context);
        const reasons: Array<
          'requireApproval' | 'nonAutonomous' | 'criticalFindings' | 'reviewRejected'
        > = ['reviewRejected'];
        if (requireApproval) reasons.push('requireApproval');
        if (!context.autonomous) reasons.push('nonAutonomous');
        if (hasCriticalOrMajor) reasons.push('criticalFindings');

        deps.emitter.emit({
          type: 'pipeline:approval-gate',
          threadId,
          outcome: 'approval',
          reviewDecision: 'reject',
          planVersion: latestPlan.version,
          requireApproval,
          autonomous: context.autonomous,
          reviewRound: context.reviewRound,
          revisionCount: revisionCountLimit,
          hasCriticalOrMajor,
          reasons,
        });
        deps.plans.updateStatus(latestPlan.id, 'approval');
        void postPlanComment(context, latestStructuredPlan);
        emitPhase(threadId, 'approval');
        return { next: 'paused' };
      }

      emitPhase(
        threadId,
        'failed',
        `Review failed: reviewer returned an unexpected decision (${result.data.decision ?? 'unknown'}).`,
      );
      activePipelines.delete(threadId);
      return { next: 'failed' };
    } catch (error) {
      if (!context.cancelled) {
        emitPhase(
          threadId,
          'failed',
          `Review error: ${error instanceof Error ? error.message : String(error)}`,
        );
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }
      return { next: 'paused' };
    }
  }

  async function startRevision(
    threadId: string,
    plan: ShipCodePlan,
    reviewFeedback: string,
  ): Promise<PhaseOutcome> {
    const context = activePipelines.get(threadId);
    if (!context) return { next: 'paused' };

    emitPhase(threadId, 'revising');

    const skill = skillCallSite(context);
    const revisionMaterials: PromptMaterial[] = [
      {
        kind: 'issue_prompt',
        label: 'thread prompt',
        content: deps.threads.getById(threadId)?.prompt ?? '',
      },
      ...ensureRepoPromptMaterials(context),
    ];
    rememberMaterialSummary(context, 'revision', revisionMaterials);
    let revisionPrompt: string;
    try {
      revisionPrompt =
        renderWorkflowPromptTemplate(context, deps, 'revision', { plan }) ??
        buildRevisionPrompt(
          plan,
          reviewFeedback,
          threadId,
          skill.context,
          skill.deps,
          getVerifyCommands(context).join(' && ') || null,
          { promptMaterials: revisionMaterials },
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

    const payload = buildPhasePayload(context, 'revision');
    try {
      const response = await runProviderPhase(context, payload, revisionPrompt, revisionMaterials, {
        reasoningEffort: context.phaseReasoningEfforts.revision,
      });

      if (context.cancelled) return { next: 'paused' };

      const parser = new StreamParser();
      parser.feed(response.rawOutput);

      const result = parser.extractPlan();
      if (result.success && result.data) {
        deps.plans.supersedeAll(threadId);
        const newPlan = deps.plans.create(threadId, result.raw, result.data, plan.version + 1);
        deps.plans.updateStatus(newPlan.id, 'pending_review');
        deps.emitter.emit({ type: 'plan:parsed', threadId, plan: result.data });
        resetPhaseState(context);
        return { next: 'review', plan: result.data };
      }
      deps.plans.supersedeAll(threadId);
      deps.plans.create(threadId, result.raw, null, plan.version + 1);
      emitPhase(
        threadId,
        'failed',
        'Revision output could not be parsed — revisor did not emit a shipcode-plan block.',
      );
      activePipelines.delete(threadId);
      return { next: 'failed' };
    } catch (error) {
      if (!context.cancelled) {
        deps.plans.supersedeAll(threadId);
        emitPhase(
          threadId,
          'failed',
          `Revision error: ${error instanceof Error ? error.message : String(error)}`,
        );
        activePipelines.delete(threadId);
        return { next: 'failed' };
      }
      return { next: 'paused' };
    }
  }

  return {
    startPlanGeneration,
    startReview,
    startRevision,
  };
}
