import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import {
  clampError,
  EXECUTION_PHASES,
  resolveEffectivePhaseReasoningEffortForIssue,
  resolveExecutorModelForIssue,
  resolvePhaseModelForIssue,
  resolvePhaseModelIdForIssue,
} from '@shipcode/shared';
import type { BrowserWindow } from 'electron';
import { transitionThreadPhase } from './ipc/helpers';
import type { IpcHandlerDeps } from './ipc/types';
import log from './logger.service';

export interface PipelineSchedulerDeps {
  queries: IpcHandlerDeps['queries'];
  pipeline: IpcHandlerDeps['pipeline'];
  emitter: IpcHandlerDeps['emitter'];
  getMainWindow: () => BrowserWindow;
}

const RUNNING_PIPELINE_PHASES = [
  'planning',
  'reviewing',
  'revising',
  'executing',
  'testing',
  'verifying',
  'shipping',
] as const;

/**
 * PipelineScheduler manages a global cap on concurrently-running pipelines.
 *
 * When `maxConcurrentPipelines` slots are all occupied, new issues are queued
 * (status = 'queued') in the DB.  Whenever a slot opens up — because a
 * pipeline reaches clarifying, awaiting_approval, completed, failed, or idle — the
 * scheduler drains the next queued issue.
 *
 * This class is intentionally a thin wrapper around the existing pipeline +
 * query helpers so that index.ts stays readable and the logic is independently
 * testable.
 */
export class PipelineScheduler {
  constructor(private readonly deps: PipelineSchedulerDeps) {}

  private _getRunningPipelineCount(): number {
    const { pipeline } = this.deps;
    if (typeof pipeline.listActiveInPhases === 'function') {
      return pipeline.listActiveInPhases(RUNNING_PIPELINE_PHASES).length;
    }
    return pipeline.listActive().length;
  }

  private _getRunningExecutionCountForProject(projectId: string, projectPath: string): number {
    return this.deps.pipeline
      .listActiveInPhases(EXECUTION_PHASES)
      .filter((summary) =>
        summary.projectId ? summary.projectId === projectId : summary.projectPath === projectPath,
      ).length;
  }

  /**
   * Attempt to start a GitHub issue pipeline.
   *
   * If all slots are full, queues the issue instead and returns `{ queued: true }`.
   * Otherwise starts the pipeline immediately and returns `{ queued: false }`.
   */
  async startOrQueue(projectId: string, issueNumber: number): Promise<{ queued: boolean }> {
    const { queries } = this.deps;

    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
    if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);

    const settings = queries.settings.get();
    const activeCount = this._getRunningPipelineCount();

    if (activeCount >= settings.maxConcurrentPipelines) {
      queries.githubIssues.updatePipelineStatus(issue.id, 'queued');
      this._sendIssuesUpdated(projectId);
      log.info(
        `[scheduler] queued issue #${issueNumber} (${activeCount}/${settings.maxConcurrentPipelines} slots used)`,
      );
      return { queued: true };
    }

    await this._launch(issue, project);
    return { queued: false };
  }

  /**
   * Called when a pipeline slot frees up (clarifying, awaiting_approval, completed, failed, idle).
   * Drains one queued issue if capacity allows.
   */
  onSlotFreed(): void {
    const { queries } = this.deps;
    try {
      const settings = queries.settings.get();
      const activeCount = this._getRunningPipelineCount();
      if (activeCount >= settings.maxConcurrentPipelines) return;

      const next = queries.githubIssues.getNextQueued();
      if (!next) return;

      const project = queries.projects.getById(next.projectId);
      if (!project) return;

      log.info(`[scheduler] auto-promoting #${next.issueNumber} "${next.title}"`);

      this._launch(next, project).catch((err) => {
        log.error('[scheduler] auto-promote failed:', err);
      });
    } catch (err) {
      log.error('[scheduler] slot-freed promotion error:', err);
    }
  }

  /**
   * Called when an execution slot frees up. Execution capacity is scoped per project,
   * so a full project must not block an older waiter from another project.
   */
  onExecutionSlotFreed(): boolean {
    const { queries, pipeline, emitter, getMainWindow } = this.deps;
    try {
      const settings = queries.settings.get();
      const candidates = queries.threads.listAwaitingWithApprovedPlans();

      for (const thread of candidates) {
        const project = queries.projects.getById(thread.projectId);
        if (!project) continue;

        const executingCount = this._getRunningExecutionCountForProject(project.id, project.path);
        if (executingCount >= settings.maxConcurrentExecutions) continue;

        const latestPlan = queries.plans.getLatest(thread.id);
        if (!latestPlan?.structured) continue;

        pipeline.rehydrateContext(thread.id, project.path);

        log.info(`[execution-queue] promoting thread ${thread.id} "${thread.title}"`);

        pipeline.startExecution(thread.id, latestPlan.structured).catch((err) => {
          transitionThreadPhase(getMainWindow(), queries, emitter, {
            threadId: thread.id,
            phase: 'failed',
            errorMessage: clampError(err),
          });
          log.error('[execution-queue] promotion failed:', err);
        });
        return true;
      }
    } catch (err) {
      log.error('[execution-queue] drain error:', err);
    }

    return false;
  }

  drainExecutionQueue(): void {
    try {
      const candidateCount = this.deps.queries.threads.listAwaitingWithApprovedPlans().length;
      for (let i = 0; i < candidateCount; i++) {
        if (!this.onExecutionSlotFreed()) return;
      }
    } catch (err) {
      log.error('[execution-queue] startup drain error:', err);
    }
  }

  private _resolvePhaseModels(
    settings: ReturnType<PipelineSchedulerDeps['queries']['settings']['get']>,
    project: NonNullable<ReturnType<PipelineSchedulerDeps['queries']['projects']['getById']>>,
    issue: GitHubIssueCacheRecord,
  ) {
    return {
      plannerModel: resolvePhaseModelForIssue(settings, project, issue, 'planner'),
      reviewerModel: resolvePhaseModelForIssue(settings, project, issue, 'reviewer'),
      verifierModel: resolvePhaseModelForIssue(settings, project, issue, 'verifier'),
      executorModel: resolvePhaseModelForIssue(settings, project, issue, 'executor'),
      plannerModelId: resolvePhaseModelIdForIssue(settings, project, issue, 'planner'),
      reviewerModelId: resolvePhaseModelIdForIssue(settings, project, issue, 'reviewer'),
      verifierModelId: resolvePhaseModelIdForIssue(settings, project, issue, 'verifier'),
      executorModelId: resolvePhaseModelIdForIssue(settings, project, issue, 'executor'),
      plannerReasoningEffort: resolveEffectivePhaseReasoningEffortForIssue(
        settings,
        project,
        issue,
        'planner',
      ),
      reviewerReasoningEffort: resolveEffectivePhaseReasoningEffortForIssue(
        settings,
        project,
        issue,
        'reviewer',
      ),
      verifierReasoningEffort: resolveEffectivePhaseReasoningEffortForIssue(
        settings,
        project,
        issue,
        'verifier',
      ),
      executorReasoningEffort: resolveEffectivePhaseReasoningEffortForIssue(
        settings,
        project,
        issue,
        'executor',
      ),
    };
  }

  private async _launch(
    issue: GitHubIssueCacheRecord,
    project: NonNullable<ReturnType<PipelineSchedulerDeps['queries']['projects']['getById']>>,
  ): Promise<void> {
    const { queries, pipeline, emitter, getMainWindow } = this.deps;
    const settings = queries.settings.get();

    const reusableThread = issue.threadId
      ? queries.threads.getById(issue.threadId)
      : queries.threads.getByProjectAndGithubIssue(issue.projectId, issue.issueNumber);

    if (reusableThread && !['failed', 'completed', 'idle'].includes(reusableThread.status)) {
      throw new Error(`Issue #${issue.issueNumber} already has active thread`);
    }

    queries.githubIssues.updatePipelineStatus(issue.id, 'planning');
    const thread =
      reusableThread && ['failed', 'completed', 'idle'].includes(reusableThread.status)
        ? reusableThread
        : queries.threads.create(issue.projectId, issue.body ?? issue.title, issue.title);

    if (reusableThread && thread.id === reusableThread.id) {
      queries.threads.updateIssueContent(thread.id, issue.body ?? issue.title, issue.title);
    }

    queries.threads.setGithubIssue(thread.id, issue.issueNumber, project.gitRemote);
    queries.githubIssues.linkThread(issue.id, thread.id);
    this._sendIssuesUpdated(issue.projectId);

    const phaseModels = this._resolvePhaseModels(settings, project, issue);
    const effectiveExecutorModel = resolveExecutorModelForIssue(settings, project, issue);
    queries.threads.setPhaseModels(thread.id, {
      ...phaseModels,
      executorModel: effectiveExecutorModel,
    });
    queries.threads.resetFailureTracking(thread.id);
    queries.plans.supersedeAll(thread.id);
    queries.plans.supersedeAllForIssue(issue.projectId, issue.issueNumber, thread.id);

    try {
      await pipeline.startFromGitHubIssue(
        thread.id,
        project.path,
        { number: issue.issueNumber, title: issue.title, body: issue.body, labels: issue.labels },
        effectiveExecutorModel,
        {
          worktreePath: thread.worktreePath,
          baseBranch: project.defaultBranch,
          plannerModel: phaseModels.plannerModel,
          reviewerModel: phaseModels.reviewerModel,
          verifierModel: phaseModels.verifierModel,
          plannerModelIdOverride: phaseModels.plannerModelId,
          reviewerModelIdOverride: phaseModels.reviewerModelId,
          executorModelIdOverride: phaseModels.executorModelId,
          verifierModelIdOverride: phaseModels.verifierModelId,
          plannerReasoningEffort: phaseModels.plannerReasoningEffort,
          reviewerReasoningEffort: phaseModels.reviewerReasoningEffort,
          executorReasoningEffort: phaseModels.executorReasoningEffort,
          verifierReasoningEffort: phaseModels.verifierReasoningEffort,
        },
      );
    } catch (err) {
      const win = getMainWindow();
      transitionThreadPhase(win, queries, emitter, {
        threadId: thread.id,
        phase: 'failed',
        errorMessage: clampError(err),
      });
      throw err;
    }
  }

  private _sendIssuesUpdated(projectId: string): void {
    try {
      const win = this.deps.getMainWindow();
      if (!win.isDestroyed()) {
        win.webContents.send('github:issues-updated', {
          projectId,
          issues: this.deps.queries.githubIssues.list(projectId),
        });
      }
    } catch {
      /* window destroyed */
    }
  }
}
