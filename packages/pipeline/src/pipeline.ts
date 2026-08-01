import { buildIssueRunPrompt } from '@shipcode/agents';
import { resolveCurrentBranch } from '@shipcode/git';
import {
  type PipelinePhase,
  resolvePipelineSpeedProfile,
  resolveRequireApproval,
  resolveRequireApprovalForIssue,
  stripPrdFrontmatter,
} from '@shipcode/shared';
import { createPipelineContextHelpers } from './pipeline/context';
import { synthesizeDirectExecutionPlan } from './pipeline/direct-execution-plan';
import { createExecutionPhaseHandlers } from './pipeline/execution-phases';
import { createPlanningPhaseHandlers } from './pipeline/planning-phases';
import { bootstrapPipelineRun } from './pipeline/run-bootstrap';
import { createPipelineRuntime } from './pipeline/runtime';
import type { PhaseOutcome } from './pipeline/shared';
import type {
  Pipeline,
  PipelineContext,
  PipelineDeps,
  PipelineExecutorModel,
  PipelineStartOptions,
} from './types';

export function createPipeline(deps: PipelineDeps): Pipeline {
  const activePipelines = new Map<string, PipelineContext>();
  const contextHelpers = createPipelineContextHelpers(deps, activePipelines);
  const runtime = createPipelineRuntime(deps, contextHelpers);
  const planning = createPlanningPhaseHandlers({ deps, contextHelpers, runtime });
  const execution = createExecutionPhaseHandlers({ deps, contextHelpers, runtime });

  /**
   * Wait `delayMs`, resolving `true` on normal expiry or `false` if the run is
   * aborted first. The timer handle is stored on `context.retryTimer` and the
   * wait is tied to `context.abort.signal`, so `cancel()`/`pause()` (which call
   * `abort.abort()`) unblock a pending retry immediately — exact parity with the
   * old `if (cancelled || !activePipelines.has) return` guard inside setTimeout.
   */
  function cancelableDelay(context: PipelineContext, delayMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (context.retryTimer) clearTimeout(context.retryTimer);
      let handle: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => {
        if (handle) clearTimeout(handle);
        context.retryTimer = null;
        resolve(false);
      };
      handle = setTimeout(() => {
        context.retryTimer = null;
        context.abort.signal.removeEventListener('abort', onAbort);
        resolve(true);
      }, delayMs);
      context.retryTimer = handle;
      if (context.abort.signal.aborted) {
        onAbort();
        return;
      }
      context.abort.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Orchestrator dispatch loop. Drives the pipeline as an explicit state machine:
   * each phase returns a `PhaseOutcome`, and this loop advances to the next phase.
   * Terminal outcomes (`done`/`paused`/`failed`) — whose `emitPhase` + cleanup the
   * phase already performed — stop the loop. `retry` waits a cancelable delay then
   * dispatches its `then` outcome.
   */
  async function dispatch(threadId: string, initial: PhaseOutcome): Promise<void> {
    let outcome = initial;
    while (true) {
      switch (outcome.next) {
        case 'plan':
          outcome = await planning.startPlanGeneration(
            threadId,
            outcome.prompt,
            outcome.projectPath,
            outcome.worktreePath,
            outcome.carry,
          );
          break;
        case 'review':
          outcome = await planning.startReview(threadId, outcome.plan);
          break;
        case 'revision':
          outcome = await planning.startRevision(threadId, outcome.plan, outcome.reviewFeedback);
          break;
        case 'execute':
          outcome = await execution.startExecution(threadId, outcome.plan, outcome.carry);
          break;
        case 'testing':
          outcome = await execution.startTesting(threadId);
          break;
        case 'verification':
          outcome = await execution.startVerification(threadId, outcome.carry);
          break;
        case 'commit':
          outcome = await execution.startCommitAndPush(threadId);
          break;
        case 'shipping':
          outcome = await execution.startShipping(threadId);
          break;
        case 'retry': {
          const context = activePipelines.get(threadId);
          if (!context || context.cancelled) return;
          const proceed = await cancelableDelay(context, outcome.delayMs);
          if (!proceed || context.cancelled || !activePipelines.has(threadId)) return;
          outcome = outcome.andThen;
          break;
        }
        case 'done':
        case 'paused':
        case 'failed':
          return;
      }
    }
  }

  /**
   * Kick off the dispatch loop for a phase WITHOUT blocking the caller. The
   * phase's synchronous setup (e.g. `emitPhase('planning')`) runs immediately;
   * the provider calls and subsequent phases advance in the background — exactly
   * the old fire-and-forget behavior, where public `startX` resolved after setup
   * and the pipeline progressed on its own. Phase handlers own their own error
   * handling (emit `failed` + cleanup); this guard only catches the unexpected.
   */
  function launch(threadId: string, start: () => Promise<PhaseOutcome>): void {
    void (async () => {
      try {
        await dispatch(threadId, await start());
      } catch (error) {
        console.error(`[pipeline] dispatch loop crashed for thread ${threadId}:`, error);
        runtime.emitPhase(
          threadId,
          'failed',
          error instanceof Error ? error.message : String(error),
        );
        activePipelines.delete(threadId);
      }
    })();
  }

  function createRun(input: {
    threadId: string;
    source: string;
    triggerDetail: string | null;
    currentPhase: PipelinePhase;
    context: Record<string, unknown>;
    retryOfRunId?: string | null;
  }): string | null {
    if (!deps.pipelineRuns) return null;
    try {
      const thread = deps.threads.getById(input.threadId);
      const previousRun =
        input.retryOfRunId !== undefined
          ? null
          : (deps.pipelineRuns.getCurrentForThread(input.threadId) ??
            deps.pipelineRuns.listByThread(input.threadId)[0] ??
            null);
      const retryOfRunId =
        input.retryOfRunId !== undefined ? input.retryOfRunId : (previousRun?.id ?? null);
      return deps.pipelineRuns.create({
        threadId: input.threadId,
        projectId: thread?.projectId ?? null,
        source: input.source,
        triggerDetail: input.triggerDetail,
        currentPhase: input.currentPhase,
        context: input.context,
        retryOfRunId,
      }).id;
    } catch (error) {
      console.error(`[pipeline] failed to create run for thread ${input.threadId}:`, error);
      return null;
    }
  }

  function finishCurrentRun(
    threadId: string,
    status: 'cancelled' | 'paused',
    errorMessage: string,
  ): void {
    if (!deps.pipelineRuns) return;
    try {
      const runId =
        activePipelines.get(threadId)?.runId ??
        deps.pipelineRuns.getCurrentForThread(threadId)?.id ??
        null;
      if (!runId) return;
      deps.pipelineRuns.finish(runId, {
        status,
        currentPhase: status === 'paused' ? 'paused' : 'idle',
        errorKind: status,
        errorMessage,
      });
    } catch (error) {
      console.error(`[pipeline] failed to finish run for thread ${threadId}:`, error);
    }
  }

  function haltActivePipeline(threadId: string): void {
    const context = activePipelines.get(threadId);
    if (!context) return;

    context.cancelled = true;
    if (context.retryTimer) {
      clearTimeout(context.retryTimer);
      context.retryTimer = null;
    }
    try {
      context.abort.abort();
    } catch {
      // best effort
    }
    if (context.activeProcessId) {
      deps.processManager.kill(context.activeProcessId);
    }
    if (context.runtimeQaCleanup) {
      void context.runtimeQaCleanup();
    }
  }

  async function startFromGitHubIssue(
    threadId: string,
    projectPath: string,
    issue: { number: number; title: string; body: string | null; labels: string[] },
    executorModel: PipelineExecutorModel,
    options?: PipelineStartOptions,
  ) {
    const { settings, worktreePath, baseBranch } = bootstrapPipelineRun(deps, contextHelpers, {
      threadId,
      projectPath,
      githubIssueNumber: issue.number,
      githubIssueTitle: issue.title,
      executorModel,
      options,
      createRun: () =>
        createRun({
          threadId,
          source: 'github:start-issue',
          triggerDetail: `issue:${issue.number}`,
          currentPhase: 'planning',
          context: {
            githubIssueNumber: issue.number,
            githubIssueTitle: issue.title,
            worktreePath: options?.worktreePath ?? null,
            executorModel,
          },
        }),
    });

    const thread = deps.threads.getById(threadId);
    const project = thread ? deps.projects.getById(thread.projectId) : null;
    const cachedIssue =
      thread?.projectId != null
        ? deps.githubIssues.getByNumber(thread.projectId, issue.number)
        : null;
    const requireApproval =
      project && cachedIssue
        ? resolveRequireApprovalForIssue(settings, project, cachedIssue)
        : project
          ? resolveRequireApproval(settings, project)
          : settings.requireApproval;

    deps.emitter.emit({
      type: 'pipeline:start-context',
      threadId,
      source: 'github:start-issue',
      projectPath,
      githubIssueNumber: issue.number,
      autonomous: true,
      requireApproval,
      reviewRound: 0,
    });

    // Strip any legacy YAML frontmatter from the body so the planner sees the
    // clean PRD prose, not duplicated metadata that now lives in native
    // labels / project fields (#45).
    // NOTE: the ShipCode Workpad comment is maintained by the pipeline main
    // process (see postWorkpadComment) — it is NOT part of the executor prompt.
    // The executor runs in a network-disabled sandbox and cannot reach GitHub,
    // so instructing it to update the Workpad produced impossible acceptance
    // criteria that failed every attempt (#394).
    const prompt = buildIssueRunPrompt({
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: stripPrdFrontmatter(issue.body ?? ''),
      projectPath,
      worktreePath,
      baseBranch,
      currentBranch: worktreePath ? await resolveCurrentBranch(worktreePath) : null,
    });
    launch(threadId, () =>
      planning.startPlanGeneration(threadId, prompt, projectPath, worktreePath),
    );
  }

  async function startFromQuickTask(
    threadId: string,
    projectPath: string,
    task: { issueNumber: number; title: string; text: string },
    executorModel: PipelineExecutorModel,
    options?: PipelineStartOptions,
  ) {
    const { settings } = bootstrapPipelineRun(deps, contextHelpers, {
      threadId,
      projectPath,
      // Quick tasks have no real GH issue. Pipeline guards check this with
      // isRealGithubIssueNumber, so null skips workpad / PR / comments.
      githubIssueNumber: null,
      githubIssueTitle: task.title,
      executorModel,
      options,
      createRun: () =>
        createRun({
          threadId,
          source: 'quick-task:start',
          triggerDetail: `quick:${task.issueNumber}`,
          currentPhase: 'executing',
          context: {
            quickTaskIssueNumber: task.issueNumber,
            quickTaskTitle: task.title,
            worktreePath: options?.worktreePath ?? null,
            executorModel,
          },
        }),
    });

    const thread = deps.threads.getById(threadId);
    const project = thread?.projectId ? deps.projects.getById(thread.projectId) : null;
    const requireApproval = project
      ? resolveRequireApproval(settings, project)
      : settings.requireApproval;
    const speedProfile = resolvePipelineSpeedProfile(settings, project);

    deps.emitter.emit({
      type: 'pipeline:start-context',
      threadId,
      source: 'quick-task:start',
      projectPath,
      githubIssueNumber: null,
      autonomous: true,
      requireApproval,
      reviewRound: 0,
    });

    const synthesizedPlan = synthesizeDirectExecutionPlan({
      source: 'quick-task',
      threadId,
      title: task.title,
      text: task.text,
    });

    const planRecord = deps.plans.create(threadId, '<quick-task-synthesized>', synthesizedPlan, 1);
    deps.plans.updateStatus(planRecord.id, 'approved');
    deps.taskGraphs?.replaceForPlan(threadId, planRecord.id, synthesizedPlan, { speedProfile });

    launch(threadId, () => execution.startExecution(threadId, synthesizedPlan));
  }

  async function startFromAutomation(
    threadId: string,
    prompt: string,
    projectPath: string,
    automationName: string,
  ) {
    const runId = createRun({
      threadId,
      source: 'automation:tick',
      triggerDetail: automationName,
      currentPhase: 'executing',
      context: {
        automationName,
        projectPath,
      },
    });
    const seededContext = activePipelines.get(threadId);
    if (seededContext) {
      seededContext.isAutomationRun = true;
      if (runId) seededContext.runId = runId;
    }

    deps.emitter.emit({
      type: 'pipeline:start-context',
      threadId,
      source: 'automation:tick',
      projectPath,
      githubIssueNumber: null,
      autonomous: true,
      requireApproval: false,
      reviewRound: 0,
    });

    // Synthesize a complete approved plan so the executor gate (which
    // requires `structured !== null` and `status !== rejected/superseded`)
    // passes without running planner/reviewer phases. Trivial-but-valid
    // values are required for every ShipCodePlan field.
    const synthesizedPlan = synthesizeDirectExecutionPlan({
      source: 'automation',
      threadId,
      name: automationName,
      prompt,
    });

    const planRecord = deps.plans.create(threadId, '<automation-synthesized>', synthesizedPlan, 1);
    deps.plans.updateStatus(planRecord.id, 'approved');
    const context = activePipelines.get(threadId);
    const project = context?.projectId ? deps.projects.getById(context.projectId) : null;
    deps.taskGraphs?.replaceForPlan(threadId, planRecord.id, synthesizedPlan, {
      speedProfile: resolvePipelineSpeedProfile(deps.settings.get(), project),
    });

    launch(threadId, () => execution.startExecution(threadId, synthesizedPlan));
  }

  function cancel(threadId: string) {
    haltActivePipeline(threadId);

    finishCurrentRun(threadId, 'cancelled', 'Pipeline cancelled by user.');
    activePipelines.delete(threadId);
    runtime.emitPhase(threadId, 'idle');
  }

  function pause(threadId: string) {
    haltActivePipeline(threadId);

    runtime.emitPhase(threadId, 'paused');
    activePipelines.delete(threadId);
  }

  return {
    rehydrateContext: contextHelpers.rehydrateContext,
    startPlanGeneration: async (threadId, prompt, projectPath, worktreePath, carry) => {
      launch(threadId, () =>
        planning.startPlanGeneration(threadId, prompt, projectPath, worktreePath, carry),
      );
    },
    startReview: async (threadId, plan) => {
      launch(threadId, () => planning.startReview(threadId, plan));
    },
    startRevision: async (threadId, plan, reviewFeedback) => {
      launch(threadId, () => planning.startRevision(threadId, plan, reviewFeedback));
    },
    startExecution: async (threadId, plan, carry) => {
      launch(threadId, () => execution.startExecution(threadId, plan, carry));
    },
    startTesting: async (threadId) => {
      launch(threadId, () => execution.startTesting(threadId));
    },
    startVerification: async (threadId) => {
      launch(threadId, () => execution.startVerification(threadId));
    },
    startCommitAndPush: async (threadId) => {
      launch(threadId, () => execution.startCommitAndPush(threadId));
    },
    startShipping: async (threadId) => {
      launch(threadId, () => execution.startShipping(threadId));
    },
    startStabilization: async (threadId, inputs) => {
      // Await the synchronous setup so a missing-plan throw reaches the caller
      // (e.g. the PR-check webhook handler), then dispatch the execute outcome
      // in the background like every other phase.
      const outcome = await execution.startStabilization(threadId, inputs);
      launch(threadId, () => Promise.resolve(outcome));
    },
    startFromGitHubIssue,
    startFromQuickTask,
    startFromAutomation,
    initializeContext: contextHelpers.ensureContext,
    cancel,
    pause,
    getContext: (threadId: string) => activePipelines.get(threadId),
    listActive: contextHelpers.listActive,
    listActiveInPhases: contextHelpers.listActiveInPhases,
  };
}
