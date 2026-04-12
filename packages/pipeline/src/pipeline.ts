import { execFileSync } from 'node:child_process';
import {
  StreamParser,
  buildPlanPrompt,
  buildReviewPrompt,
  buildRevisionPrompt,
  buildVerificationPrompt,
  buildExecutionPrompt,
} from '@shipcode/agents';
import type { ProviderPhase, ProviderRequest, SkillValidationError } from '@shipcode/agents';
import { WorktreeManager } from '@shipcode/git';
import type { AgentType, PhaseSkillKey, ShipCodePlan } from '@shipcode/shared';
import {
  PIPELINE_MAX_RETRIES,
  MAX_VERIFICATION_RETRIES,
} from '@shipcode/shared';
import type { Pipeline, PipelineContext, PipelineDeps, PipelineExecutorModel } from './types';

export function createPipeline(deps: PipelineDeps): Pipeline {
  const activePipelines = new Map<string, PipelineContext>();

  function mapPhaseToIssueStatus(phase: Parameters<typeof deps.threads.updateStatus>[1]) {
    switch (phase) {
      case 'idle':
        return 'todo' as const;
      default:
        return phase;
    }
  }

  function syncIssueStatus(
    threadId: string,
    phase: Parameters<typeof deps.threads.updateStatus>[1],
  ) {
    const thread = deps.threads.getById(threadId);
    if (!thread?.githubIssueNumber) return;

    const issue = deps.githubIssues.getByNumber(thread.projectId, thread.githubIssueNumber);
    if (!issue) return;
    deps.githubIssues.updatePipelineStatus(issue.id, mapPhaseToIssueStatus(phase));
  }

  function ensureContext(
    threadId: string,
    seed: Partial<PipelineContext> & Pick<PipelineContext, 'projectPath'>,
  ): PipelineContext {
    const existing = activePipelines.get(threadId);
    if (existing) {
      Object.assign(existing, seed);
      return existing;
    }

    // projectId is looked up once at context creation so per-phase skill
    // resolution doesn't need to re-query the threads table on every builder
    // call. Falls back to null when the thread row hasn't been created yet
    // (e.g. tests, or in-flight initializeContext seeds).
    const seededProjectId = seed.projectId ?? deps.threads.getById(threadId)?.projectId ?? null;

    const context: PipelineContext = {
      threadId,
      projectPath: seed.projectPath,
      projectId: seededProjectId,
      worktreePath: seed.worktreePath ?? null,
      retryCount: seed.retryCount ?? 0,
      autonomous: seed.autonomous ?? false,
      reviewRound: seed.reviewRound ?? 0,
      verificationRetries: seed.verificationRetries ?? 0,
      githubIssueNumber: seed.githubIssueNumber ?? null,
      githubIssueTitle: seed.githubIssueTitle ?? null,
      githubRepo: seed.githubRepo ?? null,
      executorModel: seed.executorModel ?? 'claude',
      executorModelOverride: seed.executorModelOverride ?? null,
      baseBranch: seed.baseBranch ?? '',
      forkPointSha: seed.forkPointSha ?? '',
      activeProcessId: seed.activeProcessId ?? null,
      cancelled: seed.cancelled ?? false,
      verifiedSha: seed.verifiedSha ?? null,
      startedAt: seed.startedAt ?? Date.now(),
      abort: seed.abort ?? new AbortController(),
    };
    activePipelines.set(threadId, context);
    return context;
  }

  /**
   * Build the (context, deps) pair every prompt builder needs. Centralized so
   * the four call sites stay terse and the fallback handler is wired exactly
   * once. The onFallback callback emits a `skill:fallback` PipelineEvent that
   * the desktop adapter routes into the inbox/toaster.
   */
  function skillCallSite(context: PipelineContext) {
    const onFallback = (phase: PhaseSkillKey, error: SkillValidationError | undefined) => {
      deps.emitter.emit({
        type: 'skill:fallback',
        threadId: context.threadId,
        phase,
        reason: error?.message ?? 'override quarantined',
      });
    };
    return {
      context: { projectId: context.projectId },
      deps: { skills: deps.skills, onFallback },
    };
  }

  /**
   * Resolve which agent handles a given phase for this run. PLAN and
   * REVISION share the planner setting; REVIEW/VERIFY have their own;
   * EXECUTE uses the per-run context choice (which comes from the
   * GitHub label via the model router).
   */
  function resolveAgentForPhase(
    context: PipelineContext,
    phase: ProviderPhase,
  ): PipelineExecutorModel {
    const settings = deps.settings.get();
    switch (phase) {
      case 'plan':
      case 'revision':
        return settings.plannerModel as PipelineExecutorModel;
      case 'review':
        return settings.reviewerModel as PipelineExecutorModel;
      case 'verify':
        return settings.verifierModel as PipelineExecutorModel;
      case 'execute':
        if (context.executorModelOverride)
          return context.executorModelOverride as PipelineExecutorModel;
        if (context.executorModel) return context.executorModel;
        return settings.executorModel as PipelineExecutorModel;
    }
  }

  /**
   * Run a provider-backed phase: resolve the right provider, build the
   * request with the shared signal, and return the raw output + exitCode
   * for the phase's existing completion handler to interpret.
   *
   * This replaces the inline `processManager.spawn` + event-listener
   * dance for Tier 1 phases. EXECUTE stays on the direct spawn path in
   * Tier 1 (task #11 scope).
   */
  async function runProviderPhase(
    context: PipelineContext,
    phase: ProviderPhase,
    prompt: string,
    phaseHints: ProviderRequest['phaseHints'],
  ): Promise<{ rawOutput: string; exitCode: number; resolvedModel?: string }> {
    const agent = resolveAgentForPhase(context, phase);
    const provider = deps.providers.for(agent, phase);
    // Plan and review run against the project root (no worktree yet).
    // Execute and verify run in the worktree.
    const cwd =
      phase === 'plan' || phase === 'review'
        ? context.projectPath
        : (context.worktreePath ?? context.projectPath);
    const modelHint =
      agent === context.executorModel && context.executorModelOverride
        ? context.executorModelOverride
        : undefined;

    // Inject plannerMaxTurns for Claude-driven analysis phases.
    // execute has no --max-turns limit; review is always 1 (structural).
    const PLANNER_PHASES: ProviderPhase[] = ['plan', 'revision', 'verify'];
    const mergedHints: ProviderRequest['phaseHints'] = PLANNER_PHASES.includes(phase)
      ? { maxTurns: deps.settings.get().plannerMaxTurns, ...phaseHints }
      : phaseHints;

    const response = await provider.generate({
      phase,
      prompt,
      cwd,
      projectPath: context.projectPath,
      signal: context.abort.signal,
      phaseHints: mergedHints,
      modelHint,
      threadId: context.threadId,
    });

    // Tier 3 telemetry: if the provider reported which model actually
    // served the request, persist it + emit an event so UI/CLI can
    // surface it. Also accumulate token + cost totals against the
    // thread row. Fire-and-forget persistence — if the threads table
    // write fails we don't want to tank the pipeline.
    if (response.resolvedModel) {
      const requestedModel = modelHint ?? agent;
      try {
        deps.threads.setResolvedModel(context.threadId, phase, response.resolvedModel);
      } catch (err) {
        console.error('[pipeline] setResolvedModel failed:', err);
      }
      if (response.tokensUsed) {
        try {
          deps.threads.addTokenUsage(
            context.threadId,
            response.tokensUsed.prompt,
            response.tokensUsed.completion,
            response.costUsd ?? 0,
          );
        } catch (err) {
          console.error('[pipeline] addTokenUsage failed:', err);
        }
      }
      deps.emitter.emit({
        type: 'pipeline:model-resolved',
        threadId: context.threadId,
        phase,
        requestedModel,
        resolvedModel: response.resolvedModel,
        ...(response.tokensUsed ? { tokensUsed: response.tokensUsed } : {}),
        ...(response.costUsd != null ? { costUsd: response.costUsd } : {}),
      });
    }

    return {
      rawOutput: response.rawOutput,
      exitCode: response.exitCode,
      resolvedModel: response.resolvedModel,
    };
  }

  function emitPhase(
    threadId: string,
    phase: Parameters<typeof deps.threads.updateStatus>[1],
    error?: string,
  ) {
    // Only pass the error arg when there's a value — avoids explicit undefined
    // in mock.calls, which makes toHaveBeenCalledWith(id, status) work cleanly.
    if (error !== undefined) {
      deps.threads.updateStatus(threadId, phase, error);
    } else {
      deps.threads.updateStatus(threadId, phase);
    }
    syncIssueStatus(threadId, phase);
    deps.emitter.emit({ type: 'pipeline:phase', threadId, phase });
  }

  async function startPlanGeneration(
    threadId: string,
    prompt: string,
    projectPath: string,
    worktreePath: string | null,
  ) {
    const context = ensureContext(threadId, { projectPath, worktreePath });

    emitPhase(threadId, 'planning');

    const skill = skillCallSite(context);
    const planPrompt = buildPlanPrompt(prompt, threadId, skill.context, skill.deps);

    // Fire-and-forget: kick off the provider call and let completion run
    // in the background. Callers (CLI, desktop IPC, tests) rely on phase
    // starters returning immediately after emitting the phase transition.
    void (async () => {
      try {
        const response = await runProviderPhase(context, 'plan', planPrompt, undefined);

        if (context.cancelled) return;

        if (response.exitCode === 127) {
          const agent = resolveAgentForPhase(context, 'plan');
          const name = agent === 'openrouter' ? 'Provider' : `${agent} CLI`;
          emitPhase(threadId, 'failed', `${name} not found (exit 127). Is the ${agent} binary installed and on PATH?`);
          activePipelines.delete(threadId);
          return;
        }

        const parser = new StreamParser();
        parser.feed(response.rawOutput);

        if (response.exitCode !== 0) {
          const result = parser.extractPlan();
          if (result.success && result.data) {
            // Plan extracted despite non-zero exit — proceed normally
            const nextVersion = deps.plans.getMaxVersion(threadId) + 1;
            const plan = deps.plans.create(threadId, result.raw, result.data, nextVersion);
            deps.plans.updateStatus(plan.id, 'pending_review');
            deps.emitter.emit({ type: 'plan:parsed', threadId, plan: result.data });
            startReview(threadId, result.data);
          } else {
            const detectedError = parser.detectError();
            if (context.retryCount < PIPELINE_MAX_RETRIES) {
              context.retryCount++;
              startPlanGeneration(threadId, prompt, projectPath, worktreePath);
            } else {
              const rawSnippet = detectedError?.match ?? parser.getRawOutput().trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300);
              const reason = rawSnippet?.trimStart().startsWith('{') ? '' : rawSnippet;
              emitPhase(threadId, 'failed', reason || 'Plan generation failed — no structured plan was produced.');
              activePipelines.delete(threadId);
            }
          }
          return;
        }

        // Try to extract plan
        const result = parser.extractPlan();
        const nextVersion = deps.plans.getMaxVersion(threadId) + 1;
        if (result.success && result.data) {
          const plan = deps.plans.create(threadId, result.raw, result.data, nextVersion);
          deps.plans.updateStatus(plan.id, 'pending_review');
          deps.emitter.emit({ type: 'plan:parsed', threadId, plan: result.data });

          startReview(threadId, result.data);
        } else {
          // Store raw output even without structured data
          deps.plans.create(threadId, result.raw, null, nextVersion);
          emitPhase(threadId, 'awaiting_approval');
        }
      } catch (err) {
        if (!context.cancelled) {
          emitPhase(threadId, 'failed', `Plan generation error: ${String(err)}`);
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
    });

    void (async () => {
      try {
        const response = await runProviderPhase(context, 'review', reviewPromptText, {
          reasoningEffort: deps.settings.get().reviewerReasoningEffort,
        });

        if (context.cancelled) return;

        if (response.exitCode === 127) {
          const agent = resolveAgentForPhase(context, 'review');
          const name = agent === 'openrouter' ? 'Provider' : `${agent} CLI`;
          emitPhase(threadId, 'failed', `${name} not found (exit 127). Is the ${agent} binary installed and on PATH?`);
          activePipelines.delete(threadId);
          return;
        }

        const parser = new StreamParser();
        parser.feed(response.rawOutput);

        const result = parser.extractReview();
        const latestPlan = deps.plans.getLatest(threadId);

        if (result.success && result.data && latestPlan) {
          deps.reviews.create(latestPlan.id, result.raw, result.data);
          deps.emitter.emit({ type: 'review:parsed', threadId, review: result.data });

          if (result.data.decision === 'approve') {
            // Codex satisfied — proceed to execution or hand off to human.
            // Only auto-execute for autonomous threads with approval disabled.
            if (deps.settings.get().requireApproval || !context.autonomous) {
              emitPhase(threadId, 'awaiting_approval');
            } else {
              startExecution(threadId, latestPlan!.structured!);
            }
          } else if (result.data.decision === 'request_changes') {
            if (context.reviewRound < deps.settings.get().maxReviewRounds) {
              // Revision loop — runs regardless of autonomous mode.
              // Both modes loop through review→revise up to MAX_REVIEW_ROUNDS times;
              // only the terminal state differs (execute vs awaiting_approval).
              context.reviewRound++;
              deps.threads.incrementReviewRound(threadId);
              const feedback =
                result.data.suggestedChanges.join('\n') +
                '\n\nFindings:\n' +
                result.data.findings
                  .map(
                    (f: { severity: string; description: string; suggestion?: string }) =>
                      `[${f.severity}] ${f.description}${f.suggestion ? ` — ${f.suggestion}` : ''}`,
                  )
                  .join('\n');
              startRevision(threadId, latestPlan!.structured!, feedback);
            } else {
              // Rounds exhausted.
              // In approval mode or for non-autonomous threads, always surface to human.
              if (deps.settings.get().requireApproval || !context.autonomous) {
                emitPhase(threadId, 'awaiting_approval');
              } else {
                const hasCriticalOrMajor = result.data.findings.some(
                  (f: { severity: string }) => f.severity === 'critical' || f.severity === 'major',
                );
                if (hasCriticalOrMajor) {
                  emitPhase(threadId, 'failed');
                  activePipelines.delete(threadId);
                } else {
                  startExecution(threadId, latestPlan!.structured!);
                }
              }
            }
          } else {
            // reject
            emitPhase(threadId, 'failed');
            activePipelines.delete(threadId);
          }
        } else {
          // Review couldn't be parsed
          if (latestPlan) {
            deps.reviews.create(latestPlan.id, parser.getRawOutput(), null);
          }
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

  async function startRevision(threadId: string, plan: ShipCodePlan, reviewFeedback: string) {
    const context = activePipelines.get(threadId);
    if (!context) return;

    emitPhase(threadId, 'revising');

    const skill = skillCallSite(context);
    const revisionPrompt = buildRevisionPrompt(
      plan,
      reviewFeedback,
      threadId,
      skill.context,
      skill.deps,
    );

    void (async () => {
      try {
        const response = await runProviderPhase(context, 'revision', revisionPrompt, undefined);

        if (context.cancelled) return;

        // REVISION historically ignored exit code and just parsed; preserve.
        const parser = new StreamParser();
        parser.feed(response.rawOutput);

        const result = parser.extractPlan();
        if (result.success && result.data) {
          deps.plans.supersedeAll(threadId);
          const newPlan = deps.plans.create(threadId, result.raw, result.data, plan.version + 1);
          deps.plans.updateStatus(newPlan.id, 'pending_review');
          deps.emitter.emit({ type: 'plan:parsed', threadId, plan: result.data });
          startReview(threadId, result.data);
        } else {
          deps.plans.supersedeAll(threadId);
          deps.plans.create(threadId, result.raw, null, plan.version + 1);
          emitPhase(threadId, 'failed');
          activePipelines.delete(threadId);
        }
      } catch {
        if (!context.cancelled) {
          deps.plans.supersedeAll(threadId);
          emitPhase(threadId, 'failed');
          activePipelines.delete(threadId);
        }
      }
    })();
  }

  async function startExecution(threadId: string, plan: ShipCodePlan) {
    const context = activePipelines.get(threadId);
    if (!context) return;

    // Create the worktree now — this is the first phase that writes to the repo.
    // context.baseBranch is always set before we reach here: startFromGitHubIssue
    // resolves it via git symbolic-ref, and pipeline:start seeds it via initializeContext.
    if (!context.worktreePath) {
      try {
        const appSettings = deps.settings.get();
        const worktreeManager = new WorktreeManager(context.projectPath, {
          worktreeRoot: appSettings.worktreeRoot,
          branchFormat: appSettings.worktreeBranchFormat,
        });
        const wt = context.githubIssueNumber
          ? await worktreeManager.create(
              context.githubIssueNumber,
              context.githubIssueTitle ?? '',
              context.baseBranch || undefined,
            )
          : await worktreeManager.create(threadId, context.baseBranch || undefined);
        context.worktreePath = wt.worktreePath;
        deps.threads.setWorktree(threadId, wt.branch, wt.worktreePath);
      } catch (err) {
        console.error(`[pipeline] worktree creation failed for thread ${threadId}:`, err);
        emitPhase(threadId, 'failed', `Worktree creation failed: ${String(err)}`);
        activePipelines.delete(threadId);
        return;
      }
    }

    emitPhase(threadId, 'executing');

    const skill = skillCallSite(context);
    const executionPrompt = buildExecutionPrompt(plan, skill.context, skill.deps);

    void (async () => {
      try {
        const response = await runProviderPhase(context, 'execute', executionPrompt, undefined);

        if (context.cancelled) return;

        // EXECUTE preserves the original semantic: exit code 0 means
        // success, anything non-zero is a failure. Claude/codex CLI
        // providers return their real subprocess exit code; the
        // OpenRouter provider's execute harness returns 0 when the
        // model successfully completed at least one tool call and
        // stopped cleanly, non-zero otherwise.
        if (response.exitCode === 0) {
          if (context.autonomous) {
            startVerification(threadId);
          } else {
            emitPhase(threadId, 'completed');
            activePipelines.delete(threadId);
          }
        } else {
          const rawErrSnippet = response.rawOutput.trim().split('\n').slice(-3).join(' ').slice(0, 300);
          const errSnippet = rawErrSnippet.trimStart().startsWith('{') ? '' : rawErrSnippet;
          emitPhase(threadId, 'failed', `Execution failed (exit ${response.exitCode})${errSnippet ? `: ${errSnippet}` : ''}`);
          activePipelines.delete(threadId);
        }
      } catch (err) {
        if (!context.cancelled) {
          emitPhase(threadId, 'failed', `Execution error: ${String(err)}`);
          activePipelines.delete(threadId);
        }
      }
    })();
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

    // Pin HEAD SHA for verification
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' }).trim();
    context.verifiedSha = headSha;

    // Generate diff from fork point
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
      // No changes — verification fails
      deps.verifications.create(threadId, latestPlan.id, 'No changes detected', null);
      emitPhase(threadId, 'failed');
      activePipelines.delete(threadId);
      return;
    }

    // Check for dirty worktree
    try {
      const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8' });
      if (status.trim()) {
        deps.verifications.create(threadId, latestPlan.id, `Dirty worktree: ${status}`, null);
        if (context.verificationRetries < MAX_VERIFICATION_RETRIES) {
          context.verificationRetries++;
          startExecution(threadId, plan);
          return;
        }
        emitPhase(threadId, 'failed');
        activePipelines.delete(threadId);
        return;
      }
    } catch {}

    const skill = skillCallSite(context);
    const verificationPrompt = buildVerificationPrompt(
      plan,
      diff,
      plan.acceptanceCriteria,
      skill.context,
      skill.deps,
    );

    void (async () => {
      try {
        const response = await runProviderPhase(context, 'verify', verificationPrompt, undefined);

        if (context.cancelled) return;

        // VERIFY historically ignored exit code and parsed regardless.
        const parser = new StreamParser();
        parser.feed(response.rawOutput);

        const result = parser.extractVerification();

        if (result.success && result.data) {
          deps.verifications.create(threadId, latestPlan.id, result.raw, result.data);
          deps.emitter.emit({ type: 'verification:parsed', threadId, verification: result.data });

          if (result.data.result === 'passed') {
            startCommitAndPush(threadId);
          } else if (context.verificationRetries < MAX_VERIFICATION_RETRIES) {
            context.verificationRetries++;
            startExecution(threadId, plan);
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
      // Verify HEAD hasn't changed since verification
      const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
      if (context.verifiedSha && context.verifiedSha !== currentHead) {
        emitPhase(threadId, 'failed');
        activePipelines.delete(threadId);
        return;
      }

      // Check if worktree is clean
      const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8' });
      if (status.trim()) {
        emitPhase(threadId, 'failed');
        activePipelines.delete(threadId);
        return;
      }

      // Verify there are commits ahead of base
      const ahead = execFileSync('git', ['log', context.forkPointSha + '..HEAD', '--oneline'], {
        cwd,
        encoding: 'utf-8',
      });
      if (!ahead.trim()) {
        emitPhase(threadId, 'failed');
        activePipelines.delete(threadId);
        return;
      }

      // Push
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
      execFileSync('git', ['push', 'origin', branch, '--set-upstream'], { cwd, encoding: 'utf-8' });

      startShipping(threadId);
    } catch {
      // Retry push once
      try {
        const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd,
          encoding: 'utf-8',
        }).trim();
        execFileSync('git', ['push', 'origin', branch, '--set-upstream'], {
          cwd,
          encoding: 'utf-8',
        });
        startShipping(threadId);
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
      // Non-GitHub thread — just complete
      emitPhase(threadId, 'completed');
      activePipelines.delete(threadId);
      return;
    }

    const cwd = context.worktreePath ?? context.projectPath;

    try {
      // Get branch name
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();

      // Build PR body
      const latestPlan = deps.plans.getLatest(threadId);
      const plan = latestPlan?.structured;
      const title = plan?.objective ?? `ShipCode: Issue #${context.githubIssueNumber}`;
      const body = [
        `## Summary`,
        plan?.objective ?? '',
        '',
        `Closes #${context.githubIssueNumber}`,
        '',
        `---`,
        `*Autonomous implementation by ShipCode*`,
      ].join('\n');

      // Create PR
      if (!context.baseBranch) {
        throw new Error(`Thread ${threadId}: missing baseBranch at PR creation`);
      }
      const prOutput = execFileSync(
        'gh',
        [
          'pr',
          'create',
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

      // Extract PR number from URL
      const prMatch = prOutput.match(/\/pull\/(\d+)/);
      if (prMatch) {
        const prNumber = parseInt(prMatch[1], 10);
        deps.threads.setGithubPr(threadId, prNumber);

        // Comment on issue
        try {
          execFileSync(
            'gh',
            [
              'issue',
              'comment',
              String(context.githubIssueNumber),
              '--body',
              'PR #' + prNumber + ' created by ShipCode.',
            ],
            { cwd, encoding: 'utf-8' },
          );
        } catch {}
      }

      emitPhase(threadId, 'completed');
    } catch {
      emitPhase(threadId, 'failed');
    }
    activePipelines.delete(threadId);
  }

  async function startFromGitHubIssue(
    threadId: string,
    projectPath: string,
    issue: { number: number; title: string; body: string | null; labels: string[] },
    executorModel: PipelineExecutorModel,
    options?: { baseBranch?: string; executorModelOverride?: string | null },
  ) {
    const executorModelOverride = options?.executorModelOverride ?? null;

    // Determine fork point. Caller-provided baseBranch wins (the Kanban
    // per-project selector flows through here). When absent, fall back to
    // symbolic-ref derivation so CLI/tests that don't pass a base still work.
    let baseBranch = options?.baseBranch ?? '';
    let forkPointSha = '';
    if (!baseBranch) {
      try {
        baseBranch = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], {
          cwd: projectPath,
          encoding: 'utf-8',
        })
          .trim()
          .replace('origin/', '');
      } catch {
        baseBranch = 'main';
      }
    }
    try {
      forkPointSha = execFileSync('git', ['rev-parse', baseBranch], {
        cwd: projectPath,
        encoding: 'utf-8',
      }).trim();
    } catch {}

    // updateAutonomousFields still stores the narrow string — cast safely
    // since openrouter is not yet persisted to the threads row in Tier 1.
    // Tier 3 will widen the DB column.
    deps.threads.updateAutonomousFields(threadId, {
      autonomous: true,
      reviewRound: 0,
      executorModel: executorModel as 'claude' | 'codex',
      baseBranch,
      forkPointSha,
    });

    // Worktree creation is deferred to startExecution — it is only needed
    // when the executor writes to disk. Planning and review run in projectPath.

    // Pre-create context with all autonomous fields
    ensureContext(threadId, {
      projectPath,
      worktreePath: null,
      retryCount: 0,
      autonomous: true,
      reviewRound: 0,
      verificationRetries: 0,
      githubIssueNumber: issue.number,
      githubIssueTitle: issue.title,
      githubRepo: null,
      executorModel,
      executorModelOverride,
      baseBranch,
      forkPointSha,
      activeProcessId: null,
      cancelled: false,
      verifiedSha: null,
    });

    const prompt = `GitHub Issue #${issue.number}: ${issue.title}\n\n${issue.body ?? ''}`;
    await startPlanGeneration(threadId, prompt, projectPath, null);
  }

  function cancel(threadId: string) {
    const context = activePipelines.get(threadId);
    if (context) {
      context.cancelled = true;
      try {
        context.abort.abort();
      } catch {}
      if (context.activeProcessId) {
        deps.processManager.kill(context.activeProcessId);
      }
    }
    activePipelines.delete(threadId);
    emitPhase(threadId, 'idle');
  }

  function listActive() {
    return Array.from(activePipelines.values()).map((ctx) => {
      const thread = deps.threads.getById(ctx.threadId);
      return {
        threadId: ctx.threadId,
        projectPath: ctx.projectPath,
        phase: (thread?.status ?? 'idle') as import('@shipcode/shared').PipelinePhase,
        startedAt: ctx.startedAt,
        activeProcessId: ctx.activeProcessId,
      };
    });
  }

  return {
    startPlanGeneration,
    startReview,
    startRevision,
    startExecution,
    startVerification,
    startCommitAndPush,
    startShipping,
    startFromGitHubIssue,
    initializeContext: ensureContext,
    cancel,
    getContext: (threadId: string) => activePipelines.get(threadId),
    listActive,
  };
}
