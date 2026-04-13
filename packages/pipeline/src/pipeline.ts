import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import {
  StreamParser,
  buildPlanPrompt,
  buildReviewPrompt,
  buildRevisionPrompt,
  buildVerificationPrompt,
  buildExecutionPrompt,
  loadRepoContext,
  loadRepoSetupContract,
  formatPlanComment,
  GhCli,
} from '@shipcode/agents';
import type { ProviderPhase, ProviderRequest, SkillValidationError } from '@shipcode/agents';
import { WorktreeManager } from '@shipcode/git';
import type { PhaseSkillKey, ShipCodePlan } from '@shipcode/shared';
import {
  PIPELINE_MAX_RETRIES,
  MAX_VERIFICATION_RETRIES,
  MAX_TEST_RETRIES,
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
      testRetries: seed.testRetries ?? 0,
      testOutput: seed.testOutput ?? null,
      githubIssueNumber: seed.githubIssueNumber ?? null,
      githubIssueTitle: seed.githubIssueTitle ?? null,
      githubRepo: seed.githubRepo ?? null,
      plannerModel: seed.plannerModel ?? (deps.settings.get().plannerModel as PipelineExecutorModel),
      reviewerModel: seed.reviewerModel ?? (deps.settings.get().reviewerModel as PipelineExecutorModel),
      verifierModel: seed.verifierModel ?? (deps.settings.get().verifierModel as PipelineExecutorModel),
      executorModel: seed.executorModel ?? 'claude',
      executorModelOverride: seed.executorModelOverride ?? null,
      baseBranch: seed.baseBranch ?? '',
      forkPointSha: seed.forkPointSha ?? '',
      activeProcessId: seed.activeProcessId ?? null,
      cancelled: seed.cancelled ?? false,
      verifiedSha: seed.verifiedSha ?? null,
      startedAt: seed.startedAt ?? Date.now(),
      repoContext: seed.repoContext ?? null,
      repoSetupContract: seed.repoSetupContract ?? null,
      repoSetupLoaded: seed.repoSetupLoaded ?? false,
      abort: seed.abort ?? new AbortController(),
      stabilizationFeedback: seed.stabilizationFeedback ?? null,
    };
    activePipelines.set(threadId, context);
    return context;
  }

  /**
   * Re-create in-memory PipelineContext from the persisted Thread row.
   * Used when the user approves/rejects a plan after the app restarted
   * (the in-memory activePipelines Map was cleared).
   *
   * Note: worktreePath will typically be null for awaiting_approval
   * threads since worktrees are created lazily in startExecution.
   */
  function rehydrateContext(threadId: string, projectPath: string, issueTitle?: string | null) {
    if (activePipelines.has(threadId)) return; // already live

    const thread = deps.threads.getById(threadId);
    if (!thread) return;

    ensureContext(threadId, {
      projectPath,
      worktreePath: thread.worktreePath ?? null,
      retryCount: 0,
      autonomous: thread.autonomous,
      reviewRound: thread.reviewRound,
      verificationRetries: thread.verificationRetries,
      githubIssueNumber: thread.githubIssueNumber ?? null,
      githubIssueTitle: issueTitle ?? null,
      githubRepo: thread.githubRepo ?? null,
      plannerModel: (thread.plannerModel as PipelineExecutorModel) || 'claude',
      reviewerModel: (thread.reviewerModel as PipelineExecutorModel) || 'codex',
      verifierModel: (thread.verifierModel as PipelineExecutorModel) || 'claude',
      executorModel: (thread.executorModel as PipelineExecutorModel) || 'claude',
      baseBranch: thread.baseBranch ?? '',
      forkPointSha: thread.forkPointSha ?? '',
      activeProcessId: null,
      cancelled: false,
      verifiedSha: null,
      stabilizationFeedback: null,
    });
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

  function emitTerminalRaw(threadId: string, content: string) {
    deps.emitter.emit({ type: 'pipeline:output', threadId, chunk: content });
    deps.emitter.emit({ type: 'terminal:event', threadId, event: { kind: 'raw', content } });
  }

  function emitTerminalLifecycle(threadId: string, message: string) {
    deps.emitter.emit({
      type: 'terminal:event',
      threadId,
      event: { kind: 'lifecycle', message },
    });
  }

  function ensurePathInsideRoot(root: string, targetPath: string, label: string): string {
    const resolvedRoot = resolve(root);
    const resolvedTarget = resolve(targetPath);
    if (resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + sep)) {
      return resolvedTarget;
    }
    throw new Error(`${label} escapes the project root`);
  }

  function ensureRepoSetupContract(context: PipelineContext) {
    if (context.repoSetupLoaded) return context.repoSetupContract;
    context.repoSetupContract = loadRepoSetupContract(context.projectPath);
    context.repoSetupLoaded = true;
    return context.repoSetupContract;
  }

  async function runShellCommand(
    threadId: string,
    cwd: string,
    command: string,
    signal: AbortSignal,
  ): Promise<{ exitCode: number; output: string }> {
    return await new Promise((resolvePromise, rejectPromise) => {
      const chunks: string[] = [];
      const child = spawn(command, { cwd, shell: true, signal });

      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        chunks.push(text);
        emitTerminalRaw(threadId, text);
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', rejectPromise);
      child.on('close', (code) => {
        resolvePromise({ exitCode: code ?? 1, output: chunks.join('') });
      });
    });
  }

  async function prepareWorktree(
    context: PipelineContext,
    stage: 'execute' | 'verify',
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const loaded = ensureRepoSetupContract(context);
    if (!loaded || !context.worktreePath) return { ok: true };

    const { contract, path: contractPath } = loaded;
    const shouldRunSetup =
      stage === 'execute' || (stage === 'verify' && contract.setupBeforeVerify);
    if (!shouldRunSetup && contract.envFiles.length === 0) return { ok: true };

    emitTerminalLifecycle(
      context.threadId,
      `[setup] Using repo setup contract ${contractPath}\r\n`,
    );

    for (const envFile of contract.envFiles) {
      try {
        const sourcePath = ensurePathInsideRoot(
          context.projectPath,
          resolve(context.projectPath, envFile.source),
          `env file source "${envFile.source}"`,
        );
        const targetRelative = envFile.target ?? envFile.source;
        const targetPath = ensurePathInsideRoot(
          context.worktreePath,
          resolve(context.worktreePath, targetRelative),
          `env file target "${targetRelative}"`,
        );

        if (!existsSync(sourcePath)) {
          if (envFile.required) {
            return { ok: false, error: `required env file missing: ${envFile.source}` };
          }
          emitTerminalLifecycle(
            context.threadId,
            `[setup] Optional env file missing, skipping ${envFile.source}\r\n`,
          );
          continue;
        }

        mkdirSync(dirname(targetPath), { recursive: true });
        copyFileSync(sourcePath, targetPath);
        emitTerminalLifecycle(
          context.threadId,
          `[setup] Copied ${envFile.source} -> ${targetRelative}\r\n`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
    }

    if (!shouldRunSetup) return { ok: true };

    for (const command of contract.setupCommands) {
      emitTerminalLifecycle(context.threadId, `[setup] $ ${command}\r\n`);
      try {
        const result = await runShellCommand(
          context.threadId,
          context.worktreePath,
          command,
          context.abort.signal,
        );
        if (result.exitCode !== 0) {
          const snippet = result.output.trim().split('\n').slice(-3).join(' ').slice(0, 300);
          return {
            ok: false,
            error: `command failed (${result.exitCode}): ${command}${snippet ? ` — ${snippet}` : ''}`,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `command error: ${command} — ${message}` };
      }
    }

    return { ok: true };
  }

  function getTestingContext(context: PipelineContext): string | null {
    const loaded = ensureRepoSetupContract(context);
    return loaded?.contract.testingContext ?? deps.settings.get().testingContext;
  }

  function getVerifyCommands(context: PipelineContext): string[] {
    const loaded = ensureRepoSetupContract(context);
    if (loaded && loaded.contract.verifyCommands.length > 0) {
      return loaded.contract.verifyCommands;
    }
    const testCmd = deps.settings.get().testCommand?.trim();
    return testCmd ? [testCmd] : [];
  }

  function buildRepoSetupPlannerNote(context: PipelineContext): string {
    const loaded = ensureRepoSetupContract(context);
    if (!loaded) return '';

    const bits: string[] = [];
    if (loaded.contract.setupCommands.length > 0) {
      bits.push(`Setup commands: ${loaded.contract.setupCommands.map((cmd) => `\`${cmd}\``).join(', ')}`);
    }
    if (loaded.contract.verifyCommands.length > 0) {
      bits.push(
        `Verification commands: ${loaded.contract.verifyCommands
          .map((cmd) => `\`${cmd}\``)
          .join(', ')}`,
      );
    }
    if (loaded.contract.envFiles.length > 0) {
      bits.push(
        `Env files propagated into the worktree: ${loaded.contract.envFiles
          .map((file) => `\`${file.source}\`${file.required ? '' : ' (optional)'}`)
          .join(', ')}`,
      );
    }
    if (bits.length === 0) return '';

    return `\n\n<!-- auto-injected: repo setup contract -->\nNote: This repo defines a setup contract in \`.shipcode/setup.json\`.\n${bits.join('\n')}`;
  }

  function formatStabilizationFeedback(inputs: {
    prNumber: number;
    prUrl: string | null;
    failingChecks: Array<{
      name: string;
      conclusion: string | null;
      detailsUrl: string | null;
      workflowName: string | null;
    }>;
    unresolvedReviewComments: Array<{
      author: string | null;
      body: string;
      url: string;
      path: string | null;
      line: number | null;
    }>;
  }): string {
    const lines = [
      '',
      '',
      '<stabilization_feedback>',
      `Continue work on linked draft PR #${inputs.prNumber}. Resolve the remaining GitHub feedback without expanding scope.`,
    ];

    if (inputs.prUrl) {
      lines.push(`PR URL: ${inputs.prUrl}`);
    }

    if (inputs.failingChecks.length > 0) {
      lines.push('', 'Failing checks:');
      for (const check of inputs.failingChecks.slice(0, 10)) {
        const summary = [check.workflowName, check.name].filter(Boolean).join(' / ');
        const detail = [check.conclusion, check.detailsUrl].filter(Boolean).join(' — ');
        lines.push(`- ${summary}${detail ? ` — ${detail}` : ''}`);
      }
    }

    if (inputs.unresolvedReviewComments.length > 0) {
      lines.push('', 'Unresolved review comments:');
      for (const comment of inputs.unresolvedReviewComments.slice(0, 10)) {
        const location = [comment.path, comment.line ? `:${comment.line}` : null]
          .filter(Boolean)
          .join('');
        const header = [comment.author, location].filter(Boolean).join(' — ');
        const body =
          comment.body.length > 600 ? `${comment.body.slice(0, 600).trimEnd()}…` : comment.body;
        lines.push(`- ${header || 'Review comment'}: ${body.replace(/\s+/g, ' ')}${comment.url ? ` (${comment.url})` : ''}`);
      }
    }

    lines.push(
      '',
      'Apply the minimal follow-up changes, rerun the required verification, and leave the branch ready for another push.',
      '</stabilization_feedback>',
    );

    return lines.join('\n');
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
    switch (phase) {
      case 'plan':
      case 'revision':
        return context.plannerModel;
      case 'review':
        return context.reviewerModel;
      case 'verify':
        return context.verifierModel;
      case 'execute':
        if (context.executorModelOverride)
          return context.executorModelOverride as PipelineExecutorModel;
        if (context.executorModel) return context.executorModel;
        return 'claude';
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
      onTerminalEvent: (event) =>
        deps.emitter.emit({ type: 'terminal:event', threadId: context.threadId, event }),
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

  async function postPlanComment(context: PipelineContext, plan: ShipCodePlan): Promise<void> {
    if (!context.githubIssueNumber) return;
    const cwd = context.projectPath;
    try {
      const ghCli = new GhCli(cwd);
      await ghCli.addIssueComment(context.githubIssueNumber, formatPlanComment(plan));
    } catch (err) {
      console.error('[pipeline] Failed to post plan comment:', err);
    }
  }

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

    // Fire-and-forget: kick off the provider call and let completion run
    // in the background. Callers (CLI, desktop IPC, tests) rely on phase
    // starters returning immediately after emitting the phase transition.
    void (async () => {
      try {
        const response = await runProviderPhase(context, 'plan', planPrompt, {
          reasoningEffort: deps.settings.get().plannerReasoningEffort,
        });

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
              // Try to extract a human-readable error from the CLI result JSON
              // (e.g. error_max_turns emits {"type":"result","errors":["..."],...}).
              let cliError: string | null = null;
              for (const line of parser.getRawOutput().trim().split('\n').filter(Boolean).reverse()) {
                try {
                  const obj = JSON.parse(line.trim()) as Record<string, unknown>;
                  if (obj.type === 'result') {
                    if (typeof obj.result === 'string') { cliError = obj.result.slice(0, 300); break; }
                    if (Array.isArray(obj.errors) && obj.errors.length > 0 && typeof obj.errors[0] === 'string') { cliError = obj.errors[0].slice(0, 300); break; }
                  }
                } catch { /* skip */ }
              }
              const rawSnippet = cliError ?? detectedError?.match ?? parser.getRawOutput().trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300);
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
      contextFiles: context.repoContext ?? undefined,
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
              void postPlanComment(context, latestPlan!.structured!);
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
                void postPlanComment(context, latestPlan!.structured!);
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
          reasoningEffort: deps.settings.get().plannerReasoningEffort,
        });

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

    if (context.repoContext === null) {
      context.repoContext = loadRepoContext(context.projectPath);
    }
    try {
      ensureRepoSetupContract(context);
    } catch (error) {
      emitPhase(threadId, 'failed', error instanceof Error ? error.message : String(error));
      activePipelines.delete(threadId);
      return;
    }

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
        retryOrdinal > 1
          ? `Before execute retry ${retryOrdinal}`
          : 'Before execute attempt 1';

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
    const basePrompt = buildExecutionPrompt(plan, skill.context, skill.deps, {
      contextFiles: context.repoContext ?? undefined,
      testingContext: getTestingContext(context),
    });
    const executionPrompt = basePrompt + testFeedback + stabilizationFeedback;

    void (async () => {
      try {
        const response = await runProviderPhase(context, 'execute', executionPrompt, {
          reasoningEffort: deps.settings.get().executorReasoningEffort,
        });

        if (context.cancelled) return;

        // EXECUTE preserves the original semantic: exit code 0 means
        // success, anything non-zero is a failure. Claude/codex CLI
        // providers return their real subprocess exit code; the
        // OpenRouter provider's execute harness returns 0 when the
        // model successfully completed at least one tool call and
        // stopped cleanly, non-zero otherwise.
        if (response.exitCode === 0) {
          if (context.autonomous) {
            startTesting(threadId);
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
      startVerification(threadId);
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
              startExecution(threadId, latestPlan.structured);
            } else {
              emitPhase(threadId, 'failed', 'Verification commands failed — plan unavailable for re-execution.');
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

    startVerification(threadId);
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

    // Safety net: if the executor left uncommitted changes, commit them now.
    // The skill instructs the agent to commit, but older runs or edge cases may not.
    try {
      const dirty = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8' });
      if (dirty.trim()) {
        execFileSync('git', ['add', '-A'], { cwd, encoding: 'utf-8' });
        const title = context.githubIssueTitle ?? 'Apply plan changes';
        const issueRef = context.githubIssueNumber ? ` (#${context.githubIssueNumber})` : '';
        execFileSync('git', ['commit', '--no-verify', '-m', `${title}${issueRef}`], { cwd, encoding: 'utf-8' });
      }
    } catch { /* if commit fails, the diff check below will catch it */ }

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
      // Executor made no changes at all — this is a real failure, not a recoverable state.
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
          reasoningEffort: deps.settings.get().verifierReasoningEffort,
        });

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
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf-8',
      }).trim();
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

      if (!context.baseBranch) {
        throw new Error(`Thread ${threadId}: missing baseBranch at PR creation`);
      }

      const existingPrJson = execFileSync(
        'gh',
        ['pr', 'list', '--state', 'all', '--head', branch, '--json', 'number,url,isDraft', '--limit', '1'],
        { cwd, encoding: 'utf-8' },
      );
      const existingPr = (JSON.parse(existingPrJson) as Array<{
        number: number;
        url: string;
        isDraft: boolean;
      }>)[0];

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
        prNumber = parseInt(prMatch[1], 10);
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
          } catch {}
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
      failingChecks: Array<{
        name: string;
        conclusion: string | null;
        detailsUrl: string | null;
        workflowName: string | null;
      }>;
      unresolvedReviewComments: Array<{
        author: string | null;
        body: string;
        url: string;
        path: string | null;
        line: number | null;
      }>;
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
    await startExecution(threadId, latestPlan.structured);
  }

  async function startFromGitHubIssue(
    threadId: string,
    projectPath: string,
    issue: { number: number; title: string; body: string | null; labels: string[] },
    executorModel: PipelineExecutorModel,
    options?: {
      baseBranch?: string;
      executorModelOverride?: string | null;
      plannerModel?: PipelineExecutorModel;
      reviewerModel?: PipelineExecutorModel;
      verifierModel?: PipelineExecutorModel;
    },
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
      plannerModel: options?.plannerModel ?? (deps.settings.get().plannerModel as PipelineExecutorModel),
      reviewerModel: options?.reviewerModel ?? (deps.settings.get().reviewerModel as PipelineExecutorModel),
      verifierModel: options?.verifierModel ?? (deps.settings.get().verifierModel as PipelineExecutorModel),
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
    rehydrateContext,
    startPlanGeneration,
    startReview,
    startRevision,
    startExecution,
    startVerification,
    startCommitAndPush,
    startShipping,
    startStabilization,
    startFromGitHubIssue,
    initializeContext: ensureContext,
    cancel,
    getContext: (threadId: string) => activePipelines.get(threadId),
    listActive,
  };
}
