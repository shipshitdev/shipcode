import { execFileSync } from 'node:child_process';
import { buildWorkpadProtocol } from '@shipcode/agents/source';
import {
  resolvePipelineSpeedProfile,
  resolveRequireApproval,
  resolveRequireApprovalForIssue,
  type ShipCodePlan,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { createPipelineContextHelpers } from './pipeline/context';
import { createExecutionPhaseHandlers } from './pipeline/execution-phases';
import { createPlanningPhaseHandlers } from './pipeline/planning-phases';
import { createPipelineRuntime } from './pipeline/runtime';
import type { PipelinePhaseHandlers } from './pipeline/shared';
import type { Pipeline, PipelineContext, PipelineDeps, PipelineExecutorModel } from './types';

export function createPipeline(deps: PipelineDeps): Pipeline {
  const activePipelines = new Map<string, PipelineContext>();
  const contextHelpers = createPipelineContextHelpers(deps, activePipelines);
  const runtime = createPipelineRuntime(deps, contextHelpers);
  const handlers = {} as PipelinePhaseHandlers;

  Object.assign(
    handlers,
    createPlanningPhaseHandlers({
      deps,
      contextHelpers,
      runtime,
      handlers,
    }),
    createExecutionPhaseHandlers({
      deps,
      contextHelpers,
      runtime,
      handlers,
    }),
  );

  async function startFromGitHubIssue(
    threadId: string,
    projectPath: string,
    issue: { number: number; title: string; body: string | null; labels: string[] },
    executorModel: PipelineExecutorModel,
    options?: {
      baseBranch?: string;
      worktreePath?: string | null;
      executorModelOverride?: string | null;
      plannerModel?: PipelineExecutorModel;
      reviewerModel?: PipelineExecutorModel;
      verifierModel?: PipelineExecutorModel;
      plannerModelIdOverride?: string | null;
      reviewerModelIdOverride?: string | null;
      executorModelIdOverride?: string | null;
      verifierModelIdOverride?: string | null;
      plannerReasoningEffort?: PipelineContext['plannerReasoningEffort'];
      reviewerReasoningEffort?: PipelineContext['reviewerReasoningEffort'];
      executorReasoningEffort?: PipelineContext['executorReasoningEffort'];
      verifierReasoningEffort?: PipelineContext['verifierReasoningEffort'];
    },
  ) {
    const executorModelOverride = options?.executorModelOverride ?? null;
    const settings = deps.settings.get();

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
    } catch {
      forkPointSha = '';
    }

    deps.threads.updateAutonomousFields(threadId, {
      autonomous: true,
      reviewRound: 0,
      executorModel,
      baseBranch,
      forkPointSha,
    });
    deps.threads.clearClarification(threadId);

    contextHelpers.ensureContext(threadId, {
      projectPath,
      worktreePath: options?.worktreePath ?? null,
      retryCount: 0,
      autonomous: true,
      reviewRound: 0,
      clarificationRound: 0,
      clarificationRequest: null,
      clarificationAnswers: [],
      clarificationHistory: [],
      verificationRetries: 0,
      githubIssueNumber: issue.number,
      githubIssueTitle: issue.title,
      githubRepo: null,
      plannerModel: options?.plannerModel ?? (settings.plannerModel as PipelineExecutorModel),
      reviewerModel: options?.reviewerModel ?? (settings.reviewerModel as PipelineExecutorModel),
      verifierModel: options?.verifierModel ?? (settings.verifierModel as PipelineExecutorModel),
      executorModel,
      plannerModelIdOverride: options?.plannerModelIdOverride ?? null,
      reviewerModelIdOverride: options?.reviewerModelIdOverride ?? null,
      executorModelIdOverride: options?.executorModelIdOverride ?? null,
      verifierModelIdOverride: options?.verifierModelIdOverride ?? null,
      plannerReasoningEffort: options?.plannerReasoningEffort ?? settings.plannerReasoningEffort,
      reviewerReasoningEffort: options?.reviewerReasoningEffort ?? settings.reviewerReasoningEffort,
      executorReasoningEffort: options?.executorReasoningEffort ?? settings.executorReasoningEffort,
      verifierReasoningEffort: options?.verifierReasoningEffort ?? settings.verifierReasoningEffort,
      executorModelOverride,
      baseBranch,
      forkPointSha,
      activeProcessId: null,
      cancelled: false,
      verifiedSha: null,
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

    const prompt =
      `GitHub Issue #${issue.number}: ${issue.title}\n\n${issue.body ?? ''}` +
      buildWorkpadProtocol({ issueNumber: issue.number });
    await handlers.startPlanGeneration(
      threadId,
      prompt,
      projectPath,
      options?.worktreePath ?? null,
    );
  }

  async function startFromQuickTask(
    threadId: string,
    projectPath: string,
    task: { issueNumber: number; title: string; text: string },
    executorModel: PipelineExecutorModel,
    options?: {
      baseBranch?: string;
      worktreePath?: string | null;
      executorModelOverride?: string | null;
      plannerModel?: PipelineExecutorModel;
      reviewerModel?: PipelineExecutorModel;
      verifierModel?: PipelineExecutorModel;
      plannerModelIdOverride?: string | null;
      reviewerModelIdOverride?: string | null;
      executorModelIdOverride?: string | null;
      verifierModelIdOverride?: string | null;
      plannerReasoningEffort?: PipelineContext['plannerReasoningEffort'];
      reviewerReasoningEffort?: PipelineContext['reviewerReasoningEffort'];
      executorReasoningEffort?: PipelineContext['executorReasoningEffort'];
      verifierReasoningEffort?: PipelineContext['verifierReasoningEffort'];
    },
  ) {
    const executorModelOverride = options?.executorModelOverride ?? null;
    const settings = deps.settings.get();

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
    } catch {
      forkPointSha = '';
    }

    deps.threads.updateAutonomousFields(threadId, {
      autonomous: true,
      reviewRound: 0,
      executorModel,
      baseBranch,
      forkPointSha,
    });
    deps.threads.clearClarification(threadId);

    contextHelpers.ensureContext(threadId, {
      projectPath,
      worktreePath: options?.worktreePath ?? null,
      retryCount: 0,
      autonomous: true,
      reviewRound: 0,
      clarificationRound: 0,
      clarificationRequest: null,
      clarificationAnswers: [],
      clarificationHistory: [],
      verificationRetries: 0,
      // Quick tasks have no real GH issue. Pipeline guards check this with
      // isRealGithubIssueNumber, so leaving null skips workpad / PR / comments.
      githubIssueNumber: null,
      githubIssueTitle: task.title,
      githubRepo: null,
      plannerModel: options?.plannerModel ?? (settings.plannerModel as PipelineExecutorModel),
      reviewerModel: options?.reviewerModel ?? (settings.reviewerModel as PipelineExecutorModel),
      verifierModel: options?.verifierModel ?? (settings.verifierModel as PipelineExecutorModel),
      executorModel,
      plannerModelIdOverride: options?.plannerModelIdOverride ?? null,
      reviewerModelIdOverride: options?.reviewerModelIdOverride ?? null,
      executorModelIdOverride: options?.executorModelIdOverride ?? null,
      verifierModelIdOverride: options?.verifierModelIdOverride ?? null,
      plannerReasoningEffort: options?.plannerReasoningEffort ?? settings.plannerReasoningEffort,
      reviewerReasoningEffort: options?.reviewerReasoningEffort ?? settings.reviewerReasoningEffort,
      executorReasoningEffort: options?.executorReasoningEffort ?? settings.executorReasoningEffort,
      verifierReasoningEffort: options?.verifierReasoningEffort ?? settings.verifierReasoningEffort,
      executorModelOverride,
      baseBranch,
      forkPointSha,
      activeProcessId: null,
      cancelled: false,
      verifiedSha: null,
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

    const prompt = `Quick task: ${task.title}\n\n${task.text}`;

    const synthesizedPlan: ShipCodePlan = {
      id: nanoid(),
      threadId,
      version: 1,
      objective: `Quick: ${task.title}`,
      files: [],
      steps: [
        {
          order: 1,
          description: prompt,
          files: [],
          rationale: 'Quick task — executed directly without plan/review.',
        },
      ],
      acceptanceCriteria: [
        `Implements: ${task.title}`,
        ...(task.text.trim().length > 20
          ? [`Satisfies instructions: ${task.text.trim().slice(0, 200)}`]
          : []),
      ],
      outOfScope: [],
      estimatedComplexity: 'low',
      dependencies: [],
    };

    const planRecord = deps.plans.create(threadId, '<quick-task-synthesized>', synthesizedPlan, 1);
    deps.plans.updateStatus(planRecord.id, 'approved');
    deps.taskGraphs?.replaceForPlan(threadId, planRecord.id, synthesizedPlan, { speedProfile });

    await handlers.startExecution(threadId, synthesizedPlan);
  }

  async function startFromAutomation(
    threadId: string,
    prompt: string,
    projectPath: string,
    automationName: string,
  ) {
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
    const synthesizedPlan: ShipCodePlan = {
      id: nanoid(),
      threadId,
      version: 1,
      objective: `Automation: ${automationName}`,
      files: [],
      steps: [
        {
          order: 1,
          description: prompt,
          files: [],
          rationale: 'Automation prompt — executed directly without plan/review.',
        },
      ],
      acceptanceCriteria: [
        `Implements automation: ${automationName}`,
        ...(prompt.trim().length > 20 ? [`Satisfies prompt: ${prompt.trim().slice(0, 200)}`] : []),
      ],
      outOfScope: [],
      estimatedComplexity: 'medium',
      dependencies: [],
    };

    const planRecord = deps.plans.create(threadId, '<automation-synthesized>', synthesizedPlan, 1);
    deps.plans.updateStatus(planRecord.id, 'approved');
    const context = activePipelines.get(threadId);
    const project = context?.projectId ? deps.projects.getById(context.projectId) : null;
    deps.taskGraphs?.replaceForPlan(threadId, planRecord.id, synthesizedPlan, {
      speedProfile: resolvePipelineSpeedProfile(deps.settings.get(), project),
    });

    await handlers.startExecution(threadId, synthesizedPlan);
  }

  function cancel(threadId: string) {
    const context = activePipelines.get(threadId);
    if (context) {
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

    activePipelines.delete(threadId);
    runtime.emitPhase(threadId, 'idle');
  }

  function pause(threadId: string) {
    const context = activePipelines.get(threadId);
    if (context) {
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

    activePipelines.delete(threadId);
    runtime.emitPhase(threadId, 'paused');
  }

  return {
    rehydrateContext: contextHelpers.rehydrateContext,
    startPlanGeneration: handlers.startPlanGeneration,
    startReview: handlers.startReview,
    startRevision: handlers.startRevision,
    startExecution: handlers.startExecution,
    startTesting: handlers.startTesting,
    startVerification: handlers.startVerification,
    startCommitAndPush: handlers.startCommitAndPush,
    startShipping: handlers.startShipping,
    startStabilization: handlers.startStabilization,
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
