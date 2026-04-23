import {
  buildPlanPrompt,
  buildPreviousAttemptContext,
  buildReviewPrompt,
  buildRevisionPrompt,
  formatClarificationContext,
  loadRepoContext,
  loadStructuredRepoContext,
  type PromptMaterial,
  StreamParser,
  selectPromptMaterials,
  summarizePromptMaterials,
} from '@shipcode/agents';
import {
  type ClarificationRequest,
  MAX_CLARIFICATION_ROUNDS,
  PIPELINE_MAX_RETRIES,
  type PlanRecord,
  REQUIRED_PRD_SECTIONS,
  resolveRequireApproval,
  resolveRequireApprovalForIssue,
  resolveRevisionCount,
  resolveRevisionCountForIssue,
  type ShipCodePlan,
} from '@shipcode/shared';
import type { PipelineHelperEnv } from './shared';

const NO_VALID_PLAN_REASON = 'Plan generation failed — no valid shipcode-plan block was produced.';

/**
 * Scan a PRD (issue body / prompt) for required section headings.
 * Returns the list of section names that are MISSING.
 * Matching is case-insensitive against `##` or `###` markdown headings.
 */
function checkPrdSections(prompt: string): string[] {
  const headingPattern = /^#{2,3}\s+(.+)$/gm;
  const found = new Set<string>();
  while (true) {
    const match = headingPattern.exec(prompt);
    if (!match) break;
    found.add(match[1].trim().toLowerCase());
  }
  return REQUIRED_PRD_SECTIONS.filter((section) => !found.has(section.toLowerCase()));
}

export function createPlanningPhaseHandlers({
  deps,
  contextHelpers,
  runtime,
  handlers,
}: PipelineHelperEnv) {
  const { activePipelines, ensureContext, skillCallSite } = contextHelpers;
  const {
    buildRepoSetupPlannerNote,
    emitPhase,
    emitTerminalLifecycle,
    ensureRepoSetupContract,
    getVerifyCommands,
    postPlanComment,
    resolveAgentForPhase,
    runProviderPhase,
  } = runtime;

  function ensureRepoPromptMaterials(context: ReturnType<typeof ensureContext>): PromptMaterial[] {
    if (context.repoPromptMaterials === null) {
      context.repoPromptMaterials = loadStructuredRepoContext(
        context.worktreePath ?? context.projectPath,
      );
      context.repoContext = context.repoPromptMaterials
        .map((material) => material.content)
        .join('\n\n');
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
  ) {
    const nextRound = context.clarificationRound + 1;
    if (nextRound > MAX_CLARIFICATION_ROUNDS) {
      emitPhase(
        threadId,
        'failed',
        `Planning clarification limit reached after ${MAX_CLARIFICATION_ROUNDS} rounds.`,
      );
      activePipelines.delete(threadId);
      return;
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
      event: {
        kind: 'clarification_requested',
        summary: context.clarificationRequest.summary,
        questionCount: context.clarificationRequest.questions.length,
      },
    });
    emitPhase(threadId, 'clarifying');
  }

  function clearClarificationState(threadId: string, context: ReturnType<typeof ensureContext>) {
    context.clarificationRound = 0;
    context.clarificationRequest = null;
    context.clarificationAnswers = [];
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

  function continueFromStructuredPlan(
    threadId: string,
    context: ReturnType<typeof ensureContext>,
    plan: PlanRecord,
    structuredPlan: ShipCodePlan,
  ) {
    const revisionCount = getRevisionCountForContext(context);
    deps.emitter.emit({ type: 'plan:parsed', threadId, plan: structuredPlan });

    if (revisionCount > 0) {
      deps.plans.updateStatus(plan.id, 'pending_review');
      handlers.startReview(threadId, structuredPlan);
      return;
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
        outcome: 'awaiting_approval',
        reviewDecision: 'approve',
        planVersion: plan.version,
        requireApproval,
        autonomous: context.autonomous,
        reviewRound: context.reviewRound,
        revisionCount,
        hasCriticalOrMajor: false,
        reasons,
      });
      deps.plans.updateStatus(plan.id, 'awaiting_approval');
      void postPlanComment(context, structuredPlan);
      emitPhase(threadId, 'awaiting_approval');
      return;
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
    handlers.startExecution(threadId, structuredPlan);
  }

  async function startPlanGeneration(
    threadId: string,
    prompt: string,
    projectPath: string,
    worktreePath: string | null,
  ) {
    const context = ensureContext(threadId, { projectPath, worktreePath });

    if (context.repoPromptMaterials === null) {
      context.repoPromptMaterials = loadStructuredRepoContext(worktreePath ?? projectPath);
      context.repoContext =
        context.repoPromptMaterials.map((material) => material.content).join('\n\n') ||
        loadRepoContext(worktreePath ?? projectPath);
    }
    try {
      ensureRepoSetupContract(context);
    } catch (error) {
      emitPhase(threadId, 'failed', error instanceof Error ? error.message : String(error));
      activePipelines.delete(threadId);
      return;
    }

    // PRD quality gate — check issue body for required sections
    const missingSections = checkPrdSections(prompt);
    if (missingSections.length > 0) {
      const project = context.projectId ? deps.projects.getById(context.projectId) : null;
      const gateEnabled = project?.prdQualityGate === true;
      const sectionList = missingSections.join(', ');

      if (gateEnabled) {
        emitPhase(
          threadId,
          'failed',
          `PRD quality gate: missing sections — ${sectionList}. Update the issue body and re-trigger.`,
        );
        activePipelines.delete(threadId);
        return;
      }

      // Gate OFF (default) — post/log a warning and continue
      emitTerminalLifecycle(
        threadId,
        `[prd-gate] Warning: PRD may be missing sections: ${sectionList}\r\n`,
      );
    }

    emitPhase(threadId, 'planning');

    const skill = skillCallSite(context);
    const previousAttempt = context.previousPlanRawOutput;
    context.previousPlanRawOutput = null; // consume — one shot
    const clarificationContext = formatClarificationContext(
      context.clarificationRequest,
      context.clarificationAnswers,
    );
    const planMaterials: PromptMaterial[] = [
      { kind: 'issue_prompt', label: 'issue prompt', content: prompt },
      ...ensureRepoPromptMaterials(context),
    ];
    rememberMaterialSummary(context, 'plan', planMaterials);
    const planPrompt =
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
      ) +
      buildRepoSetupPlannerNote(context) +
      (previousAttempt ? buildPreviousAttemptContext(previousAttempt) : '');

    void (async () => {
      try {
        const response = await runProviderPhase(context, 'plan', planPrompt, planMaterials, {
          reasoningEffort: context.phaseReasoningEfforts.plan,
        });

        if (context.cancelled) return;

        if (response.exitCode === 127) {
          const agent = resolveAgentForPhase(context, 'plan');
          const name = agent === 'openrouter' ? 'Provider' : `${agent} CLI`;
          emitPhase(
            threadId,
            'failed',
            `${name} not found (exit 127). Is the ${agent} binary installed and on PATH?`,
          );
          activePipelines.delete(threadId);
          return;
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
            continueFromStructuredPlan(threadId, context, plan, result.data);
          } else if (clarificationRequest) {
            enterClarifying(threadId, context, clarificationRequest);
          } else {
            const detectedError = parser.detectError();
            if (context.retryCount < PIPELINE_MAX_RETRIES) {
              context.retryCount++;
              context.previousPlanRawOutput = response.rawOutput;
              handlers.startPlanGeneration(threadId, prompt, projectPath, worktreePath);
            } else {
              let cliError: string | null = null;
              for (const line of parser
                .getRawOutput()
                .trim()
                .split('\n')
                .filter(Boolean)
                .reverse()) {
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
            }
          }
          return;
        }

        const result = parser.extractPlan();
        const nextVersion = deps.plans.getMaxVersion(threadId) + 1;
        if (result.success && result.data) {
          clearClarificationState(threadId, context);
          const plan = deps.plans.create(threadId, result.raw, result.data, nextVersion);
          continueFromStructuredPlan(threadId, context, plan, result.data);
        } else if (clarificationRequest) {
          enterClarifying(threadId, context, clarificationRequest);
        } else {
          deps.plans.create(threadId, result.raw, null, nextVersion);
          emitPhase(threadId, 'failed', NO_VALID_PLAN_REASON);
          activePipelines.delete(threadId);
        }
      } catch (error) {
        if (!context.cancelled) {
          emitPhase(threadId, 'failed', `Plan generation error: ${String(error)}`);
          activePipelines.delete(threadId);
        }
      }
    })();
  }

  async function startReview(threadId: string, plan: ShipCodePlan) {
    const context = activePipelines.get(threadId);
    if (!context) return;

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
    const reviewPromptText = buildReviewPrompt(plan, skill.context, skill.deps, {
      autonomous: context.autonomous,
      promptMaterials: reviewMaterials,
    });

    void (async () => {
      try {
        const response = await runProviderPhase(
          context,
          'review',
          reviewPromptText,
          reviewMaterials,
          {
            reasoningEffort: context.phaseReasoningEfforts.review,
          },
        );

        if (context.cancelled) return;

        if (response.exitCode === 127) {
          const agent = resolveAgentForPhase(context, 'review');
          const name = agent === 'openrouter' ? 'Provider' : `${agent} CLI`;
          emitPhase(
            threadId,
            'failed',
            `${name} not found (exit 127). Is the ${agent} binary installed and on PATH?`,
          );
          activePipelines.delete(threadId);
          return;
        }

        const parser = new StreamParser();
        parser.feed(response.rawOutput);

        const result = parser.extractReview();
        const latestPlan = deps.plans.getLatest(threadId);

        if (result.success && result.data && latestPlan) {
          const latestStructuredPlan = latestPlan.structured;
          if (!latestStructuredPlan) {
            emitPhase(threadId, 'failed');
            activePipelines.delete(threadId);
            return;
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
                outcome: 'awaiting_approval',
                reviewDecision: 'approve',
                planVersion: latestPlan.version,
                requireApproval,
                autonomous: context.autonomous,
                reviewRound: context.reviewRound,
                revisionCount,
                hasCriticalOrMajor: false,
                reasons,
              });
              deps.plans.updateStatus(latestPlan.id, 'awaiting_approval');
              void postPlanComment(context, latestStructuredPlan);
              emitPhase(threadId, 'awaiting_approval');
            } else {
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
              handlers.startExecution(threadId, latestStructuredPlan);
            }
          } else if (result.data.decision === 'request_changes') {
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
              handlers.startRevision(threadId, latestStructuredPlan, feedback);
            } else {
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
                  outcome: 'awaiting_approval',
                  reviewDecision: 'request_changes',
                  planVersion: latestPlan.version,
                  requireApproval,
                  autonomous: context.autonomous,
                  reviewRound: context.reviewRound,
                  revisionCount: revisionCountLimit,
                  hasCriticalOrMajor,
                  reasons,
                });
                deps.plans.updateStatus(latestPlan.id, 'awaiting_approval');
                void postPlanComment(context, latestStructuredPlan);
                emitPhase(threadId, 'awaiting_approval');
              } else {
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
                handlers.startExecution(threadId, latestStructuredPlan);
              }
            }
          } else {
            emitPhase(threadId, 'failed');
            activePipelines.delete(threadId);
          }
        } else {
          if (latestPlan) {
            deps.reviews.create(latestPlan.id, parser.getRawOutput(), null);
          }
          emitPhase(threadId, 'failed');
          activePipelines.delete(threadId);
        }
      } catch (error) {
        if (!context.cancelled) {
          emitPhase(
            threadId,
            'failed',
            `Review error: ${error instanceof Error ? error.message : String(error)}`,
          );
          activePipelines.delete(threadId);
        }
      }
    })();
  }

  async function startRevision(threadId: string, plan: ShipCodePlan, reviewFeedback: string) {
    const context = activePipelines.get(threadId);
    if (!context) return;

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
      revisionPrompt = buildRevisionPrompt(
        plan,
        reviewFeedback,
        threadId,
        skill.context,
        skill.deps,
        getVerifyCommands(context).join(' && ') || null,
        { promptMaterials: revisionMaterials },
      );
    } catch (error) {
      emitPhase(threadId, 'failed', error instanceof Error ? error.message : String(error));
      activePipelines.delete(threadId);
      return;
    }

    void (async () => {
      try {
        const response = await runProviderPhase(
          context,
          'revision',
          revisionPrompt,
          revisionMaterials,
          {
            reasoningEffort: context.phaseReasoningEfforts.revision,
          },
        );

        if (context.cancelled) return;

        const parser = new StreamParser();
        parser.feed(response.rawOutput);

        const result = parser.extractPlan();
        if (result.success && result.data) {
          deps.plans.supersedeAll(threadId);
          const newPlan = deps.plans.create(threadId, result.raw, result.data, plan.version + 1);
          deps.plans.updateStatus(newPlan.id, 'pending_review');
          deps.emitter.emit({ type: 'plan:parsed', threadId, plan: result.data });
          handlers.startReview(threadId, result.data);
        } else {
          deps.plans.supersedeAll(threadId);
          deps.plans.create(threadId, result.raw, null, plan.version + 1);
          emitPhase(threadId, 'failed');
          activePipelines.delete(threadId);
        }
      } catch (error) {
        if (!context.cancelled) {
          deps.plans.supersedeAll(threadId);
          emitPhase(
            threadId,
            'failed',
            `Revision error: ${error instanceof Error ? error.message : String(error)}`,
          );
          activePipelines.delete(threadId);
        }
      }
    })();
  }

  return {
    startPlanGeneration,
    startReview,
    startRevision,
  };
}
