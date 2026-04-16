import type { PlanQueries, ProjectQueries, SettingsQueries, ThreadQueries, GitHubIssueQueries } from '@shipcode/db';
import type { Pipeline } from '@shipcode/pipeline';
import type { GitHubIssueCacheRecord, PipelinePhase, Project, ShipCodePlan } from '@shipcode/shared';

export function isSchedulerSlotConsumingPhase(phase: PipelinePhase): boolean {
  return phase !== 'awaiting_approval';
}

interface Reservation {
  release: () => Promise<void>;
}

interface LoggerLike {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

interface PipelineSchedulerDeps {
  pipeline: Pipeline;
  projects: ProjectQueries;
  threads: ThreadQueries;
  plans: PlanQueries;
  githubIssues: GitHubIssueQueries;
  settings: SettingsQueries;
  emitGithubIssuesUpdated: (projectId: string) => void;
  attachIssueToProject: (project: Project, issue: GitHubIssueCacheRecord) => Promise<void>;
  logger: LoggerLike;
}

export class PipelineScheduler {
  private reservationCount = 0;
  private mutex = Promise.resolve();
  private readonly claimOwner = `shipcode-scheduler:${process.pid}`;

  constructor(private deps: PipelineSchedulerDeps) {}

  private async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const previous = this.mutex;
    let release!: () => void;
    this.mutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private getMaxConcurrentPipelines(): number {
    return this.deps.settings.get().maxConcurrentPipelines;
  }

  countSchedulerActivePipelines(): number {
    return this.deps.pipeline
      .listActive()
      .filter((summary) => isSchedulerSlotConsumingPhase(summary.phase)).length;
  }

  private async tryReserveSlot(): Promise<Reservation | null> {
    return this.withLock(() => {
      const active = this.countSchedulerActivePipelines() + this.reservationCount;
      if (active >= this.getMaxConcurrentPipelines()) return null;

      this.reservationCount += 1;
      let released = false;

      return {
        release: async () => {
          if (released) return;
          released = true;
          await this.withLock(() => {
            this.reservationCount -= 1;
          });
        },
      };
    });
  }

  private getQueuedIssues(): Array<{ project: Project; issue: GitHubIssueCacheRecord }> {
    const items = this.deps.projects.list().flatMap((project) =>
      this.deps.githubIssues.getRequeued(project.id).map((issue) => ({ project, issue })),
    );

    return items.sort(
      (a, b) => new Date(a.issue.fetchedAt).getTime() - new Date(b.issue.fetchedAt).getTime(),
    );
  }

  private async startGitHubIssueFromRecord(
    project: Project,
    issue: GitHubIssueCacheRecord,
    options?: { queueClaimed?: boolean },
  ): Promise<void> {
    const previousThread = issue.threadId ? this.deps.threads.getById(issue.threadId) : null;
    if (previousThread && !['failed', 'completed'].includes(previousThread.status)) {
      throw new Error(`Issue #${issue.issueNumber} already has active thread`);
    }

    this.deps.githubIssues.updatePipelineStatus(issue.id, 'planning');
    const thread = this.deps.threads.create(project.id, issue.body ?? issue.title, issue.title);
    this.deps.threads.setGithubIssue(thread.id, issue.issueNumber, project.gitRemote);
    this.deps.githubIssues.linkThread(issue.id, thread.id);
    this.deps.plans.supersedeAll(thread.id);
    this.deps.emitGithubIssuesUpdated(project.id);

    try {
      await this.deps.attachIssueToProject(project, issue);
    } catch (err) {
      this.deps.logger.warn(`[github:start-issue] project attach failed for #${issue.issueNumber}:`, err);
    }

    this.deps.logger.info(
      `[pipeline] starting issue #${issue.issueNumber} "${issue.title}" (thread ${thread.id}, executor: ${issue.executorModel})`,
    );

    try {
      await this.deps.pipeline.startFromGitHubIssue(
        thread.id,
        project.path,
        {
          number: issue.issueNumber,
          title: issue.title,
          body: issue.body,
          labels: issue.labels,
        },
        issue.executorModel,
        { baseBranch: project.defaultBranch },
      );
    } catch (err) {
      if (options?.queueClaimed) {
        this.deps.githubIssues.releaseClaim(issue.id);
      }
      this.deps.githubIssues.updatePipelineStatus(issue.id, 'todo');
      this.deps.threads.updateStatus(thread.id, 'failed');
      this.deps.emitGithubIssuesUpdated(project.id);
      throw err;
    }
  }

  async startGitHubIssue(projectId: string, issueNumber: number): Promise<{ queued: boolean }> {
    const project = this.deps.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const issue = this.deps.githubIssues.getByNumber(projectId, issueNumber);
    if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);

    if (issue.threadId) {
      const thread = this.deps.threads.getById(issue.threadId);
      if (thread && !['failed', 'completed'].includes(thread.status)) {
        throw new Error(`Issue #${issueNumber} already has active thread`);
      }
    }

    const reservation = await this.tryReserveSlot();
    if (!reservation) {
      this.deps.githubIssues.updatePipelineStatus(issue.id, 'queued');
      this.deps.emitGithubIssuesUpdated(projectId);
      return { queued: true };
    }

    try {
      await this.startGitHubIssueFromRecord(project, issue);
      return { queued: false };
    } finally {
      await reservation.release();
    }
  }

  async drainQueuedGitHubIssues(): Promise<void> {
    while (true) {
      const queued = this.getQueuedIssues()[0];
      if (!queued) return;

      const reservation = await this.tryReserveSlot();
      if (!reservation) return;

      try {
        if (!this.deps.githubIssues.tryClaim(queued.issue.id, this.claimOwner)) {
          continue;
        }

        try {
          await this.startGitHubIssueFromRecord(queued.project, queued.issue, {
            queueClaimed: true,
          });
        } catch (err) {
          this.deps.logger.error('[scheduler] queued issue promotion failed:', err);
        }
      } finally {
        await reservation.release();
      }
    }
  }

  async startApprovedExecution(
    threadId: string,
    plan: ShipCodePlan,
  ): Promise<{ started: boolean; error?: string }> {
    const reservation = await this.tryReserveSlot();
    if (!reservation) {
      return {
        started: false,
        error: `Cannot start execution: max concurrent pipelines (${this.getMaxConcurrentPipelines()}) already reached.`,
      };
    }

    try {
      await this.deps.pipeline.startExecution(threadId, plan);
      return { started: true };
    } finally {
      await reservation.release();
    }
  }
}
