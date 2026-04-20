import type { ActivePipelineSummary } from '@shipcode/shared';
import { resolveExecutorModelForIssue } from '@shipcode/shared';
import { logEvent } from '../logger.service';
import {
  resolveIssuePhaseModels,
  resolveProjectPhaseModels,
  transitionThreadPhase,
  tryParsePlan,
} from './helpers';
import { getRetryAction } from './retry-phase';
import type { IpcHandlerDeps } from './types';

export function registerPipelineHandlers({
  ipcMain,
  mainWindow,
  queries,
  pipeline,
  emitter,
  notificationService,
}: IpcHandlerDeps): void {
  ipcMain.handle('verification:get', (_event, { threadId }: { threadId: string }) => {
    return queries.verifications.getLatest(threadId);
  });

  ipcMain.handle(
    'terminal:list',
    (_event, { threadId, limit }: { threadId: string; limit?: number }) => {
      const persisted = queries.terminalEvents.listByThread(threadId, limit);
      if (persisted.length > 0) return persisted;

      const fallback: import('@shipcode/shared').TerminalEventRecord[] = [];
      const latestPlan = queries.plans.getLatest(threadId);
      if (latestPlan?.rawOutput) {
        fallback.push({
          id: `fallback-plan-${latestPlan.id}`,
          threadId,
          createdAt: latestPlan.createdAt,
          event: { kind: 'raw', content: latestPlan.rawOutput },
        });
      }

      const latestReview = latestPlan ? queries.reviews.getByPlanId(latestPlan.id) : null;
      if (latestReview?.rawOutput) {
        fallback.push({
          id: `fallback-review-${latestReview.id}`,
          threadId,
          createdAt: latestReview.createdAt,
          event: { kind: 'raw', content: latestReview.rawOutput },
        });
      }

      const latestVerification = queries.verifications.getLatest(threadId);
      if (latestVerification?.rawOutput) {
        fallback.push({
          id: `fallback-verification-${latestVerification.id}`,
          threadId,
          createdAt: latestVerification.createdAt,
          event: { kind: 'raw', content: latestVerification.rawOutput },
        });
      }

      return fallback
        .sort((a, b) =>
          a.createdAt === b.createdAt
            ? a.id.localeCompare(b.id)
            : a.createdAt.localeCompare(b.createdAt),
        )
        .slice(-(limit ?? fallback.length));
    },
  );

  ipcMain.handle('pipeline:start', async (_event, { threadId }: { threadId: string }) => {
    const thread = queries.threads.getById(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const project = queries.projects.getById(thread.projectId);
    if (!project) throw new Error(`Project ${thread.projectId} not found`);
    const settings = queries.settings.get();
    const phaseModels = resolveProjectPhaseModels(settings, project);
    queries.threads.setPhaseModels(threadId, phaseModels);

    pipeline.initializeContext(threadId, {
      projectPath: project.path,
      worktreePath: null,
      plannerModel: phaseModels.plannerModel,
      reviewerModel: phaseModels.reviewerModel,
      verifierModel: phaseModels.verifierModel,
      executorModel: phaseModels.executorModel,
      plannerModelIdOverride: phaseModels.plannerModelId,
      reviewerModelIdOverride: phaseModels.reviewerModelId,
      executorModelIdOverride: phaseModels.executorModelId,
      verifierModelIdOverride: phaseModels.verifierModelId,
      plannerReasoningEffort: phaseModels.plannerReasoningEffort,
      reviewerReasoningEffort: phaseModels.reviewerReasoningEffort,
      executorReasoningEffort: phaseModels.executorReasoningEffort,
      verifierReasoningEffort: phaseModels.verifierReasoningEffort,
      baseBranch: project.defaultBranch,
    });
    logEvent('pipeline:start-context', {
      threadId,
      source: 'pipeline:start',
      projectPath: project.path,
      githubIssueNumber: thread.githubIssueNumber ?? null,
      autonomous: false,
      requireApproval: settings.requireApproval,
      reviewRound: thread.reviewRound,
    });

    queries.threads.resetFailureTracking(threadId);
    queries.plans.supersedeAll(threadId);
    await pipeline.startPlanGeneration(threadId, thread.prompt, project.path, null);
  });

  ipcMain.handle('pipeline:approve', async (_event, { threadId }: { threadId: string }) => {
    const thread = queries.threads.getById(threadId);
    if (!thread || thread.status !== 'awaiting_approval') return;

    const latestPlan = queries.plans.getLatest(threadId);
    const structured = latestPlan?.structured ?? tryParsePlan(latestPlan?.rawOutput ?? '');
    if (structured) {
      if (!latestPlan?.structured && latestPlan) {
        queries.plans.updateStructured(latestPlan.id, structured);
      }
      if (!latestPlan) throw new Error('No plan available to approve');
      queries.plans.updateStatus(latestPlan.id, 'approved');

      const project = queries.projects.getById(thread.projectId);
      if (project) {
        const issue = thread.githubIssueNumber
          ? queries.githubIssues.getByNumber(project.id, thread.githubIssueNumber)
          : null;
        pipeline.rehydrateContext(threadId, project.path, issue?.title);
        logEvent('pipeline:start-context', {
          threadId,
          source: 'pipeline:approve',
          projectPath: project.path,
          githubIssueNumber: thread.githubIssueNumber ?? null,
          autonomous: thread.autonomous,
          requireApproval: queries.settings.get().requireApproval,
          reviewRound: thread.reviewRound,
        });
      }

      notificationService.dismissByThread(threadId);
      await pipeline.startExecution(threadId, structured);
    } else {
      notificationService.dismissByThread(threadId);
      transitionThreadPhase(mainWindow, queries, emitter, {
        threadId,
        phase: 'failed',
        errorMessage: 'No plan available to approve',
      });
    }
  });

  ipcMain.handle(
    'pipeline:reject',
    async (_event, { threadId, feedback }: { threadId: string; feedback: string }) => {
      const thread = queries.threads.getById(threadId);
      if (!thread) return;

      const project = queries.projects.getById(thread.projectId);
      if (!project) return;

      const issue = thread.githubIssueNumber
        ? queries.githubIssues.getByNumber(project.id, thread.githubIssueNumber)
        : null;
      pipeline.rehydrateContext(threadId, project.path, issue?.title);

      queries.plans.supersedeAll(threadId);
      const revisedPrompt = `${thread.prompt}\n\nFeedback from review:\n${feedback}`;
      notificationService.dismissByThread(threadId);
      await pipeline.startPlanGeneration(
        threadId,
        revisedPrompt,
        project.path,
        thread.worktreePath,
      );
    },
  );

  ipcMain.handle('pipeline:stabilize-pr', async (_event, { threadId }: { threadId: string }) => {
    if (pipeline.listActive().some((summary) => summary.threadId === threadId)) {
      throw new Error('Stop the active pipeline before starting a stabilization pass');
    }

    const thread = queries.threads.getById(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const project = queries.projects.getById(thread.projectId);
    if (!project) throw new Error(`Project ${thread.projectId} not found`);

    const issue = thread.githubIssueNumber
      ? queries.githubIssues.getByNumber(project.id, thread.githubIssueNumber)
      : null;
    if (!issue?.linkedPrNumber) {
      throw new Error('No linked pull request found for this task');
    }
    if (!issue.ciBlocked && issue.unresolvedReviewCommentCount === 0) {
      throw new Error('The linked pull request has no unresolved CI or review blockers');
    }

    const latestPlan = queries.plans.getLatest(threadId);
    const structured = latestPlan?.structured ?? tryParsePlan(latestPlan?.rawOutput ?? '');
    if (!structured) {
      throw new Error('No approved plan found for stabilization');
    }
    if (!latestPlan?.structured && latestPlan) {
      queries.plans.updateStructured(latestPlan.id, structured);
    }

    pipeline.rehydrateContext(threadId, project.path, issue.title);
    notificationService.dismissByThread(threadId);
    await pipeline.startStabilization(threadId, {
      prNumber: issue.linkedPrNumber,
      prUrl: issue.linkedPrUrl,
      failingChecks: issue.failingChecks,
      unresolvedReviewComments: issue.unresolvedReviewComments,
    });
  });

  ipcMain.handle('pipeline:cancel', (_event, { threadId }: { threadId: string }) => {
    pipeline.cancel(threadId);
  });

  ipcMain.handle('pipeline:retry', async (_event, { threadId }: { threadId: string }) => {
    if (pipeline.listActive().some((summary) => summary.threadId === threadId)) {
      throw new Error('Stop the active pipeline before retrying');
    }

    const thread = queries.threads.getById(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const project = queries.projects.getById(thread.projectId);
    if (!project) throw new Error(`Project ${thread.projectId} not found`);

    const settings = queries.settings.get();
    const issue = thread.githubIssueNumber
      ? queries.githubIssues.getByNumber(project.id, thread.githubIssueNumber)
      : null;

    if (issue) {
      const phaseModels = resolveIssuePhaseModels(settings, project, issue);
      queries.threads.setPhaseModels(threadId, {
        ...phaseModels,
        executorModel: resolveExecutorModelForIssue(settings, project, issue),
      });
    } else {
      queries.threads.setPhaseModels(threadId, resolveProjectPhaseModels(settings, project));
    }

    pipeline.rehydrateContext(threadId, project.path, issue?.title);
    notificationService.dismissByThread(threadId);
    logEvent('pipeline:start-context', {
      threadId,
      source: 'pipeline:retry',
      projectPath: project.path,
      githubIssueNumber: thread.githubIssueNumber ?? null,
      autonomous: thread.autonomous,
      requireApproval: settings.requireApproval,
      reviewRound: thread.reviewRound,
    });

    const latestPlan = queries.plans.getLatest(threadId);
    const structured = latestPlan?.structured ?? tryParsePlan(latestPlan?.rawOutput ?? '');
    if (structured) {
      if (!latestPlan?.structured && latestPlan) {
        queries.plans.updateStructured(latestPlan.id, structured);
      }
      const latestVerification = queries.verifications.getLatest(threadId);
      const retryAction = getRetryAction(thread, latestPlan, latestVerification);
      if (retryAction === 'review') {
        if (latestPlan) queries.plans.updateStatus(latestPlan.id, 'pending_review');
        await pipeline.startReview(threadId, structured);
      } else if (retryAction === 'execute') {
        await pipeline.startExecution(threadId, structured);
      } else if (retryAction === 'verify') {
        await pipeline.startVerification(threadId);
      } else if (retryAction === 'commit_and_push') {
        await pipeline.startCommitAndPush(threadId);
      } else {
        const retryCtx = pipeline.getContext(threadId);
        if (retryCtx && latestPlan?.rawOutput) {
          retryCtx.previousPlanRawOutput = latestPlan.rawOutput;
        }
        queries.plans.supersedeAll(threadId);
        await pipeline.startPlanGeneration(
          threadId,
          thread.prompt,
          project.path,
          thread.worktreePath,
        );
      }
      return;
    }

    // Smart retry: walk backward through plan history before re-planning.
    // 1. Check current thread for an earlier plan with structured content.
    const fallbackPlan = queries.plans.getLatestStructured(threadId);
    // 2. Cross-thread: check other threads for the same issue.
    const borrowedPlan =
      fallbackPlan ??
      (thread.githubIssueNumber
        ? queries.plans.getLatestStructuredForIssue(project.id, thread.githubIssueNumber)
        : null);

    if (borrowedPlan?.structured) {
      // Clone the plan into the current thread with corrected threadId/version.
      const nextVersion = queries.plans.getMaxVersion(threadId) + 1;
      const clonedStructured = {
        ...borrowedPlan.structured,
        threadId,
        version: nextVersion,
      };
      queries.plans.supersedeAll(threadId);
      const clonedPlan = queries.plans.create(
        threadId,
        borrowedPlan.rawOutput,
        clonedStructured,
        nextVersion,
      );
      // Borrowed plans always go to review — they came from a different context.
      queries.plans.updateStatus(clonedPlan.id, 'pending_review');
      await pipeline.startReview(threadId, clonedStructured);
      return;
    }

    // No structured plan exists anywhere — restart planning from scratch.
    const failedPlan = queries.plans.getLatest(threadId);
    const ctx = pipeline.getContext(threadId);
    if (ctx && failedPlan?.rawOutput) {
      ctx.previousPlanRawOutput = failedPlan.rawOutput;
    }

    queries.plans.supersedeAll(threadId);
    await pipeline.startPlanGeneration(threadId, thread.prompt, project.path, thread.worktreePath);
  });

  ipcMain.handle('pipeline:skip-review', async (_event, { threadId }: { threadId: string }) => {
    const thread = queries.threads.getById(threadId);
    const latestPlan = queries.plans.getLatest(threadId);
    if (latestPlan) {
      queries.plans.updateStatus(latestPlan.id, 'awaiting_approval');
    }
    logEvent('pipeline:approval-gate', {
      threadId,
      outcome: 'awaiting_approval',
      reviewDecision: 'approve',
      planVersion: latestPlan?.version ?? null,
      requireApproval: queries.settings.get().requireApproval,
      autonomous: thread?.autonomous ?? false,
      reviewRound: thread?.reviewRound ?? 0,
      maxReviewRounds: queries.settings.get().maxReviewRounds,
      hasCriticalOrMajor: false,
      reasons: ['manualSkipReview'],
    });
    transitionThreadPhase(mainWindow, queries, emitter, {
      threadId,
      phase: 'awaiting_approval',
    });
  });

  ipcMain.handle('pipeline:list-active', (): ActivePipelineSummary[] => {
    const summaries = pipeline.listActive();
    return summaries.map((summary) => {
      const thread = queries.threads.getById(summary.threadId);
      const project = thread ? queries.projects.getById(thread.projectId) : null;
      return {
        threadId: summary.threadId,
        projectId: thread?.projectId ?? '',
        projectName: project?.name ?? 'Unknown project',
        threadTitle: thread?.title ?? summary.threadId,
        phase: summary.phase,
        startedAt: summary.startedAt,
        activeProcessId: summary.activeProcessId,
      };
    });
  });

  ipcMain.handle(
    'dashboard:get-overview',
    (
      _event,
      {
        activityLimit,
        activityOffset,
        recentLimit,
        recentOffset,
      }: {
        activityLimit?: number;
        activityOffset?: number;
        recentLimit?: number;
        recentOffset?: number;
      } = {},
    ) => {
      const running = pipeline.listActive().map((summary) => {
        const thread = queries.threads.getById(summary.threadId);
        const project = thread ? queries.projects.getById(thread.projectId) : null;
        return {
          threadId: summary.threadId,
          projectId: thread?.projectId ?? '',
          projectName: project?.name ?? 'Unknown project',
          threadTitle: thread?.title ?? summary.threadId,
          phase: summary.phase,
          startedAt: summary.startedAt,
          activeProcessId: summary.activeProcessId,
        };
      });

      return {
        stats: queries.dashboard.getStats(),
        running,
        activity: queries.activity.listRecent(activityLimit ?? 50, undefined, activityOffset ?? 0),
        activityTotal: queries.activity.countRecent(),
        recent: queries.dashboard.getRecentTasks(recentLimit ?? 20, recentOffset ?? 0),
        recentTotal: queries.dashboard.countRecentTasks(),
      };
    },
  );

  ipcMain.handle('dashboard:get-stats', () => {
    return queries.dashboard.getStats();
  });

  ipcMain.handle(
    'dashboard:get-activity',
    (
      _event,
      { limit, offset, projectId }: { limit?: number; offset?: number; projectId?: string } = {},
    ) => {
      return queries.activity.listRecent(limit ?? 50, projectId, offset ?? 0);
    },
  );

  ipcMain.handle(
    'activity:list-for-issue',
    (
      _event,
      { projectId, issueNumber, limit }: { projectId: string; issueNumber: number; limit?: number },
    ) => {
      return queries.activity.listByIssue(projectId, issueNumber, limit ?? 200);
    },
  );

  ipcMain.handle(
    'dashboard:count-activity',
    (_event, { projectId }: { projectId?: string } = {}) => {
      return queries.activity.countRecent(projectId);
    },
  );

  ipcMain.handle(
    'dashboard:get-recent-tasks',
    (_event, { limit, offset }: { limit?: number; offset?: number } = {}) => {
      return queries.dashboard.getRecentTasks(limit ?? 20, offset ?? 0);
    },
  );

  ipcMain.handle('dashboard:count-recent-tasks', () => {
    return queries.dashboard.countRecentTasks();
  });

  ipcMain.handle('costs:get-summary', () => {
    return queries.costs.getSummary();
  });

  ipcMain.handle(
    'costs:list-tasks',
    (
      _event,
      { limit, offset, projectId }: { limit?: number; offset?: number; projectId?: string } = {},
    ) => {
      return queries.costs.listTasks(limit ?? 20, offset ?? 0, projectId ?? null);
    },
  );

  ipcMain.handle('costs:count-tasks', (_event, { projectId }: { projectId?: string } = {}) => {
    return queries.costs.countTasks(projectId ?? null);
  });

  ipcMain.handle(
    'costs:list-for-issue',
    (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      return queries.costs.listTasksForIssue(projectId, issueNumber);
    },
  );
}
