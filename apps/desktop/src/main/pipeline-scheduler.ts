import fs from 'node:fs';
import { loadWorkflowPolicy } from '@shipcode/pipeline';
import type {
  ExecutorModel,
  GitHubIssueCacheRecord,
  IssuePipelineStatus,
  PipelinePhase,
} from '@shipcode/shared';
import {
  clampError,
  EXECUTION_PHASES,
  ISSUE_PIPELINE_STATUS,
  PIPELINE_PHASE,
  resolveEffectivePhaseReasoningEffortForIssue,
  resolveExecutorModelForIssue,
  resolvePhaseModelForIssue,
  resolvePhaseModelIdForIssue,
} from '@shipcode/shared';
import type { BrowserWindow } from 'electron';
import { syncIssuePipelineLabelSoon } from './github-pipeline-label-sync';
import {
  assertCliPhaseModelsSupported,
  resolveProjectPhaseModels,
  transitionThreadPhase,
} from './ipc/helpers';
import type { IpcHandlerDeps } from './ipc/types';
import log from './logger.service';

export interface PipelineSchedulerDeps {
  queries: IpcHandlerDeps['queries'];
  pipeline: IpcHandlerDeps['pipeline'];
  emitter: IpcHandlerDeps['emitter'];
  getMainWindow: () => BrowserWindow;
}

const RUNNING_PIPELINE_PHASES = [
  PIPELINE_PHASE.planning,
  PIPELINE_PHASE.reviewing,
  PIPELINE_PHASE.revising,
  PIPELINE_PHASE.executing,
  PIPELINE_PHASE.testing,
  PIPELINE_PHASE.verifying,
  PIPELINE_PHASE.shipping,
] as const;

const REUSABLE_THREAD_STATUSES = new Set<PipelinePhase>([
  PIPELINE_PHASE.failed,
  PIPELINE_PHASE.completed,
  PIPELINE_PHASE.idle,
]);

/**
 * PipelineScheduler manages a global cap on concurrently-running pipelines.
 *
 * When `maxConcurrentPipelines` slots are all occupied, new issues are queued
 * (status = 'queued') in the DB.  Whenever a slot opens up — because a
 * pipeline reaches clarifying, approval, completed, failed, or idle — the
 * scheduler drains the next queued issue.
 *
 * This class is intentionally a thin wrapper around the existing pipeline +
 * query helpers so that index.ts stays readable and the logic is independently
 * testable.
 */
export class PipelineScheduler {
  /**
   * In-memory FIFO queue for automation targets that fired while all pipeline
   * slots were occupied. Each entry is one (automation, target project) pair,
   * so a multi-repo automation queues per target independently. Drained one at
   * a time by `onSlotFreed`. Lost on app restart by design — automation cron
   * resumes from `next_run_at` so a missed tick is simply skipped.
   */
  private pendingAutomations: Array<{ automationId: string; projectId: string }> = [];

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

  private _getProjectPipelineCap(projectPath: string): number {
    const settings = this.deps.queries.settings.get();
    return Math.min(
      settings.maxConcurrentPipelines,
      loadWorkflowPolicy(projectPath).agent.maxConcurrentAgents,
    );
  }

  /**
   * Check whether per-state concurrency cap allows dispatching a new
   * pipeline that will enter `targetPhase`. Returns true when dispatch
   * is allowed (no cap or under the cap).
   */
  private _isPerStateSlotAvailable(projectPath: string, targetPhase: string): boolean {
    const policy = loadWorkflowPolicy(projectPath);
    const caps = policy.agent.maxConcurrentAgentsByState;
    const phaseKey = targetPhase.toLowerCase();
    const cap = caps[phaseKey];
    if (cap === undefined) return true; // no per-state cap → global cap governs

    const runningInPhase = this.deps.pipeline.listActiveInPhases([targetPhase]).length;
    return runningInPhase < cap;
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

    const activeCount = this._getRunningPipelineCount();
    const pipelineCap = this._getProjectPipelineCap(project.path);

    if (
      activeCount >= pipelineCap ||
      !this._isPerStateSlotAvailable(project.path, PIPELINE_PHASE.planning)
    ) {
      queries.githubIssues.updatePipelineStatus(issue.id, ISSUE_PIPELINE_STATUS.queued);
      this._syncPipelineLabel(project.path, issue.issueNumber, ISSUE_PIPELINE_STATUS.queued);
      this._sendIssuesUpdated(projectId);
      log.info(
        `[scheduler] queued issue #${issueNumber} (${activeCount}/${pipelineCap} slots used)`,
      );
      return { queued: true };
    }

    await this._launch(issue, project);
    return { queued: false };
  }

  /**
   * Quick Mode entry: synthetic cache row already exists with negative
   * sentinel issueNumber + thread linked. Behaves like startOrQueue but
   * dispatches via `pipeline.startFromQuickTask` so the workpad / PR /
   * gh CLI paths stay disabled.
   */
  async startQuickTaskOrQueue(
    projectId: string,
    issueNumber: number,
  ): Promise<{ queued: boolean }> {
    const { queries } = this.deps;

    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
    if (!issue) throw new Error(`Quick task ${issueNumber} not found in cache`);
    if (!issue.isQuickMode) {
      throw new Error(`Issue #${issueNumber} is not a quick task — use startOrQueue`);
    }

    const activeCount = this._getRunningPipelineCount();
    const pipelineCap = this._getProjectPipelineCap(project.path);

    if (
      activeCount >= pipelineCap ||
      !this._isPerStateSlotAvailable(project.path, PIPELINE_PHASE.planning)
    ) {
      queries.githubIssues.updatePipelineStatus(issue.id, ISSUE_PIPELINE_STATUS.queued);
      this._syncPipelineLabel(project.path, issue.issueNumber, ISSUE_PIPELINE_STATUS.queued);
      this._sendIssuesUpdated(projectId);
      log.info(
        `[scheduler] queued quick task ${issueNumber} (${activeCount}/${pipelineCap} slots used)`,
      );
      return { queued: true };
    }

    await this._launchQuickTask(issue, project);
    return { queued: false };
  }

  /**
   * Called when a pipeline slot frees up (clarifying, approval, completed, failed, idle).
   * Drains one queued issue if capacity allows.
   */
  onSlotFreed(): void {
    const { queries } = this.deps;
    try {
      const activeCount = this._getRunningPipelineCount();

      // Drain one pending automation before queued issues — automations
      // already fired their cron tick and should not wait behind issues
      // that can simply re-queue.
      const pending = this.pendingAutomations.shift();
      if (pending) {
        const project = queries.projects.getById(pending.projectId);
        if (
          project &&
          (activeCount >= this._getProjectPipelineCap(project.path) ||
            !this._isPerStateSlotAvailable(project.path, PIPELINE_PHASE.planning))
        ) {
          this.pendingAutomations.unshift(pending);
          return;
        }
        log.info(
          `[scheduler] auto-promoting automation ${pending.automationId} → project ${pending.projectId}`,
        );
        this._launchAutomation(pending.automationId, pending.projectId).catch((err) => {
          log.error('[scheduler] automation promote failed:', err);
        });
        return;
      }

      const next = queries.githubIssues.getNextQueued();
      if (!next) return;

      const project = queries.projects.getById(next.projectId);
      if (!project) return;
      if (activeCount >= this._getProjectPipelineCap(project.path)) return;
      if (!this._isPerStateSlotAvailable(project.path, PIPELINE_PHASE.planning)) return;

      log.info(`[scheduler] auto-promoting #${next.issueNumber} "${next.title}"`);

      const launch = next.isQuickMode
        ? this._launchQuickTask(next, project)
        : this._launch(next, project);
      launch.catch((err) => {
        log.error('[scheduler] auto-promote failed:', err);
      });
    } catch (err) {
      log.error('[scheduler] slot-freed promotion error:', err);
    }
  }

  /**
   * Cron-driven entry: tries to launch one automation target now or queues it
   * in-memory if pipeline slots are full. Called per target by
   * AutomationScheduler so a multi-repo automation fans out across repos.
   */
  async startOrQueueAutomation(
    automationId: string,
    targetProjectId: string,
  ): Promise<{ queued: boolean }> {
    const { queries } = this.deps;
    const project = queries.projects.getById(targetProjectId);

    // Per-target guard: this automation can still run a different target repo.
    if (queries.threads.hasActiveForAutomation(automationId, targetProjectId)) {
      log.info(
        `[scheduler] skipping automation ${automationId} → ${targetProjectId} — target already active`,
      );
      return { queued: false };
    }

    const settings = queries.settings.get();
    const activeCount = this._getRunningPipelineCount();
    const pipelineCap = project
      ? this._getProjectPipelineCap(project.path)
      : settings.maxConcurrentPipelines;

    const perStateBlocked = project
      ? !this._isPerStateSlotAvailable(project.path, PIPELINE_PHASE.planning)
      : false;

    if (activeCount >= pipelineCap || perStateBlocked) {
      const alreadyQueued = this.pendingAutomations.some(
        (p) => p.automationId === automationId && p.projectId === targetProjectId,
      );
      if (!alreadyQueued) {
        this.pendingAutomations.push({ automationId, projectId: targetProjectId });
      }
      log.info(
        `[scheduler] queued automation ${automationId} → ${targetProjectId} (${activeCount}/${pipelineCap} slots used)`,
      );
      return { queued: true };
    }

    await this._launchAutomation(automationId, targetProjectId);
    return { queued: false };
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
        const maxConcurrentExecutions = Math.min(
          settings.maxConcurrentExecutions,
          loadWorkflowPolicy(project.path).agent.maxConcurrentAgents,
        );
        if (executingCount >= maxConcurrentExecutions) continue;

        const latestPlan = queries.plans.getLatest(thread.id);
        if (!latestPlan?.structured) continue;

        pipeline.rehydrateContext(thread.id, project.path);

        log.info(`[execution-queue] promoting thread ${thread.id} "${thread.title}"`);

        pipeline.startExecution(thread.id, latestPlan.structured).catch((err) => {
          transitionThreadPhase(getMainWindow(), queries, emitter, {
            threadId: thread.id,
            phase: PIPELINE_PHASE.failed,
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

    const reusableThread = issue.threadId ? queries.threads.getById(issue.threadId) : null;

    if (reusableThread && !REUSABLE_THREAD_STATUSES.has(reusableThread.status)) {
      throw new Error(`Issue #${issue.issueNumber} already has active thread`);
    }

    queries.githubIssues.updatePipelineStatus(issue.id, ISSUE_PIPELINE_STATUS.planning);
    this._syncPipelineLabel(project.path, issue.issueNumber, ISSUE_PIPELINE_STATUS.planning);
    const thread =
      reusableThread && REUSABLE_THREAD_STATUSES.has(reusableThread.status)
        ? reusableThread
        : queries.threads.create(issue.projectId, issue.body ?? issue.title, issue.title);

    if (reusableThread && thread.id === reusableThread.id) {
      queries.threads.updateIssueContent(thread.id, issue.body ?? issue.title, issue.title);
    }

    queries.threads.setGithubIssue(thread.id, issue.issueNumber, project.gitRemote);
    queries.githubIssues.linkThread(issue.id, thread.id);
    this._sendIssuesUpdated(issue.projectId);

    const phaseModels = this._resolvePhaseModels(settings, project, issue);
    await assertCliPhaseModelsSupported(phaseModels);

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
        phase: PIPELINE_PHASE.failed,
        errorMessage: clampError(err),
      });
      throw err;
    }
  }

  private async _launchQuickTask(
    issue: GitHubIssueCacheRecord,
    project: NonNullable<ReturnType<PipelineSchedulerDeps['queries']['projects']['getById']>>,
  ): Promise<void> {
    const { queries, pipeline, emitter, getMainWindow } = this.deps;
    const settings = queries.settings.get();

    if (!issue.threadId) {
      throw new Error(`Quick task ${issue.issueNumber} has no linked thread`);
    }
    const thread = queries.threads.getById(issue.threadId);
    if (!thread) {
      throw new Error(`Quick task ${issue.issueNumber}: thread ${issue.threadId} missing`);
    }

    queries.githubIssues.updatePipelineStatus(issue.id, ISSUE_PIPELINE_STATUS.planning);
    this._syncPipelineLabel(project.path, issue.issueNumber, ISSUE_PIPELINE_STATUS.planning);
    this._sendIssuesUpdated(issue.projectId);

    const phaseModels = this._resolvePhaseModels(settings, project, issue);
    await assertCliPhaseModelsSupported(phaseModels);

    const effectiveExecutorModel = resolveExecutorModelForIssue(settings, project, issue);
    queries.threads.setPhaseModels(thread.id, {
      ...phaseModels,
      executorModel: effectiveExecutorModel,
    });
    queries.threads.resetFailureTracking(thread.id);
    queries.plans.supersedeAll(thread.id);

    try {
      await pipeline.startFromQuickTask(
        thread.id,
        project.path,
        {
          issueNumber: issue.issueNumber,
          title: issue.title,
          text: issue.body ?? issue.title,
        },
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
        phase: PIPELINE_PHASE.failed,
        errorMessage: clampError(err),
      });
      throw err;
    }
  }

  private async _launchAutomation(automationId: string, targetProjectId: string): Promise<void> {
    const { queries, pipeline, emitter, getMainWindow } = this.deps;

    const automation = queries.automations.getById(automationId);
    if (!automation) {
      log.warn(`[automation] missing automation ${automationId}`);
      return;
    }
    if (!automation.enabled) {
      log.info(`[automation] skipping disabled automation ${automationId}`);
      return;
    }

    const project = queries.projects.getById(targetProjectId);
    if (!project) {
      log.warn(`[automation] target project ${targetProjectId} not found`);
      queries.automations.recordRunFinished(automation.id, targetProjectId, 'failed');
      return;
    }
    if (!fs.existsSync(project.path)) {
      log.warn(`[automation] project path missing: ${project.path}`);
      queries.automations.recordRunFinished(automation.id, targetProjectId, 'failed');
      return;
    }

    const settings = queries.settings.get();
    const phaseModels = resolveProjectPhaseModels(settings, project);

    // Per-automation override beats project default beats global default.
    const mergedPhaseModels = {
      ...phaseModels,
      executorModel:
        (automation.executorProvider as ExecutorModel | null) ??
        (phaseModels.executorModel as ExecutorModel),
      executorModelId: automation.executorModelId ?? phaseModels.executorModelId,
      executorReasoningEffort:
        automation.executorReasoningEffort ?? phaseModels.executorReasoningEffort,
    };

    try {
      await assertCliPhaseModelsSupported(mergedPhaseModels);
    } catch (err) {
      log.error('[automation] CLI phase model unsupported:', err);
      queries.automations.recordRunFinished(automation.id, targetProjectId, 'failed');
      return;
    }

    // Distinguish sibling runs of a multi-repo automation by target repo.
    const projectLabel = project.path.split(/[\\/]/).filter(Boolean).pop() ?? project.path;
    const title =
      automation.targets.length > 1
        ? `[Auto] ${automation.name} — ${projectLabel}`
        : `[Auto] ${automation.name}`;
    const thread = queries.threads.create(project.id, automation.prompt, title);
    queries.threads.setAutomationId(thread.id, automation.id);
    queries.threads.setPhaseModels(thread.id, mergedPhaseModels);

    pipeline.initializeContext(thread.id, {
      projectPath: project.path,
      worktreePath: null,
      retryCount: 0,
      autonomous: true,
      reviewRound: 0,
      clarificationRound: 0,
      clarificationRequest: null,
      clarificationAnswers: [],
      clarificationHistory: [],
      verificationRetries: 0,
      githubIssueNumber: null,
      githubIssueTitle: null,
      githubRepo: null,
      plannerModel: mergedPhaseModels.plannerModel,
      reviewerModel: mergedPhaseModels.reviewerModel,
      verifierModel: mergedPhaseModels.verifierModel,
      executorModel: mergedPhaseModels.executorModel,
      plannerModelIdOverride: mergedPhaseModels.plannerModelId,
      reviewerModelIdOverride: mergedPhaseModels.reviewerModelId,
      executorModelIdOverride: mergedPhaseModels.executorModelId,
      verifierModelIdOverride: mergedPhaseModels.verifierModelId,
      plannerReasoningEffort: mergedPhaseModels.plannerReasoningEffort,
      reviewerReasoningEffort: mergedPhaseModels.reviewerReasoningEffort,
      executorReasoningEffort: mergedPhaseModels.executorReasoningEffort,
      verifierReasoningEffort: mergedPhaseModels.verifierReasoningEffort,
      executorModelOverride: null,
      baseBranch: project.defaultBranch,
      forkPointSha: '',
      activeProcessId: null,
      cancelled: false,
      verifiedSha: null,
    });

    queries.automations.recordRunStarted(automation.id, targetProjectId, thread.id);

    try {
      await pipeline.startFromAutomation(
        thread.id,
        automation.prompt,
        project.path,
        automation.name,
      );
    } catch (err) {
      const win = getMainWindow();
      transitionThreadPhase(win, queries, emitter, {
        threadId: thread.id,
        phase: PIPELINE_PHASE.failed,
        errorMessage: clampError(err),
      });
      queries.automations.recordRunFinished(automation.id, targetProjectId, 'failed');
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

  private _syncPipelineLabel(
    projectPath: string,
    issueNumber: number,
    status: IssuePipelineStatus,
  ): void {
    syncIssuePipelineLabelSoon({
      projectPath,
      issueNumber,
      status,
      source: 'scheduler',
    });
  }
}
