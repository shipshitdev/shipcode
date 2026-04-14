import {
  buildPlanPrompt,
  buildReviewPrompt,
  buildRevisionPrompt,
  loadRepoContext,
  StreamParser,
} from '@shipcode/agents';
import { PIPELINE_MAX_RETRIES, type ShipCodePlan } from '@shipcode/shared';
import type { PipelineHelperEnv } from './shared';

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
    ensureRepoSetupContract,
    getVerifyCommands,
    postPlanComment,
    resolveAgentForPhase,
    runProviderPhase,
  } = runtime;

  async function startPlanGeneration(
    threadId: string,
    prompt: string,
    projectPath: string,
    worktreePath: string | null,
  ) {
    const context = ensureContext(threadId, { projectPath, worktreePath });

    if (context.repoContext === null) {
      context.repoContext = loadRepoContext(projectPath);
    }
    try {
      ensureRepoSetupContract(context);
    } catch (error) {
      emitPhase(threadId, 'failed', error instanceof Error ? error.message : String(error));
      activePipelines.delete(threadId);
      return;
    }

    emitPhase(threadId, 'planning');

    const skill = skillCallSite(context);
    const planPrompt =
      buildPlanPrompt(
        prompt,
        threadId,
        skill.context,
        skill.deps,
        {
          contextFiles: context.repoContext ?? undefined,
        },
        getVerifyCommands(context).join(' && ') || null,
      ) + buildRepoSetupPlannerNote(context);

    void (async () => {
      try {
        const response = await runProviderPhase(context, 'plan', planPrompt, {
          reasoningEffort: context.plannerReasoningEffort,
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

        if (response.exitCode !== 0) {
          const result = parser.extractPlan();
          if (result.success && result.data) {
            const nextVersion = deps.plans.getMaxVersion(threadId) + 1;
            const plan = deps.plans.create(threadId, result.raw, result.data, nextVersion);
            deps.plans.updateStatus(plan.id, 'pending_review');
            deps.emitter.emit({ type: 'plan:parsed', threadId, plan: result.data });
            handlers.startReview(threadId, result.data);
          } else {
            const detectedError = parser.detectError();
            if (context.retryCount < PIPELINE_MAX_RETRIES) {
              context.retryCount++;
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
          const plan = deps.plans.create(threadId, result.raw, result.data, nextVersion);
          deps.plans.updateStatus(plan.id, 'pending_review');
          deps.emitter.emit({ type: 'plan:parsed', threadId, plan: result.data });
          handlers.startReview(threadId, result.data);
        } else {
          deps.plans.create(threadId, result.raw, null, nextVersion);
          emitPhase(threadId, 'awaiting_approval');
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
    const reviewPromptText = buildReviewPrompt(plan, skill.context, skill.deps, {
      autonomous: context.autonomous,
      contextFiles: context.repoContext ?? undefined,
    });

    void (async () => {
      try {
        const response = await runProviderPhase(context, 'review', reviewPromptText, {
          reasoningEffort: context.reviewerReasoningEffort,
        });

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
            if (deps.settings.get().requireApproval || !context.autonomous) {
              deps.plans.updateStatus(latestPlan.id, 'awaiting_approval');
              void postPlanComment(context, latestStructuredPlan);
              emitPhase(threadId, 'awaiting_approval');
            } else {
              handlers.startExecution(threadId, latestStructuredPlan);
            }
          } else if (result.data.decision === 'request_changes') {
            if (context.reviewRound < deps.settings.get().maxReviewRounds) {
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
              if (
                deps.settings.get().requireApproval ||
                !context.autonomous ||
                hasCriticalOrMajor
              ) {
                deps.plans.updateStatus(latestPlan.id, 'awaiting_approval');
                void postPlanComment(context, latestStructuredPlan);
                emitPhase(threadId, 'awaiting_approval');
              } else {
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
    let revisionPrompt: string;
    try {
      revisionPrompt = buildRevisionPrompt(
        plan,
        reviewFeedback,
        threadId,
        skill.context,
        skill.deps,
        getVerifyCommands(context).join(' && ') || null,
      );
    } catch (error) {
      emitPhase(threadId, 'failed', error instanceof Error ? error.message : String(error));
      activePipelines.delete(threadId);
      return;
    }

    void (async () => {
      try {
        const response = await runProviderPhase(context, 'revision', revisionPrompt, {
          reasoningEffort: context.plannerReasoningEffort,
        });

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
