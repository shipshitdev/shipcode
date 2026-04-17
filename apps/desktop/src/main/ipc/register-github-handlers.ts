import fs from 'node:fs';
import { GhCli } from '@shipcode/agents';
import type { ExecutorModel, GitHubIssueCacheRecord } from '@shipcode/shared';
import {
  clampError,
  deriveGithubIssueUrl,
  parseGithubProjectUrl,
  resolveExecutorModelForIssue,
} from '@shipcode/shared';
import log, { logEvent } from '../logger.service';
import {
  attachIssueToConfiguredProjectBoard,
  resolveIssuePhaseModels,
  sendGithubIssuesUpdated,
  syncLinkedPullRequestFeedback,
  transitionThreadPhase,
} from './helpers';
import type { IpcHandlerDeps } from './types';

const ISSUE_REFRESH_TTL_MS = 5 * 60_000;
const PR_FEEDBACK_SYNC_TTL_MS = 60_000;
const refreshIssuesInFlight = new Map<string, Promise<GitHubIssueCacheRecord[]>>();

function resolveCanonicalIssueThread(
  queries: IpcHandlerDeps['queries'],
  issue: GitHubIssueCacheRecord,
) {
  if (issue.threadId) {
    const linkedThread = queries.threads.getById(issue.threadId);
    if (linkedThread) return linkedThread;
  }
  return queries.threads.getByProjectAndGithubIssue(issue.projectId, issue.issueNumber);
}

export function registerGitHubHandlers({
  ipcMain,
  mainWindow,
  queries,
  pipeline,
  emitter,
  notificationService,
  chatNotificationService,
}: IpcHandlerDeps): void {
  ipcMain.handle(
    'github:get-issue',
    (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  ipcMain.handle('github:list-issues', (_event, { projectId }: { projectId: string }) => {
    return queries.githubIssues.list(projectId);
  });

  ipcMain.handle(
    'github:refresh-issues',
    async (_event, { projectId, force = false }: { projectId: string; force?: boolean }) => {
      const cached = queries.githubIssues.list(projectId);
      const latestFetchedAt = cached.reduce<string | null>((latest, issue) => {
        if (!latest) return issue.fetchedAt;
        return new Date(issue.fetchedAt).getTime() > new Date(latest).getTime()
          ? issue.fetchedAt
          : latest;
      }, null);
      const cacheAgeMs = latestFetchedAt ? Date.now() - new Date(latestFetchedAt).getTime() : null;

      if (!force && cached.length > 0 && cacheAgeMs !== null && cacheAgeMs < ISSUE_REFRESH_TTL_MS) {
        logEvent('github:refresh-issues:cache-hit', {
          projectId,
          issueCount: cached.length,
          cacheAgeMs,
        });
        return cached;
      }

      const inFlight = refreshIssuesInFlight.get(projectId);
      if (inFlight) {
        logEvent('github:refresh-issues:deduped', { projectId, force, issueCount: cached.length });
        return inFlight;
      }

      const refreshPromise = (async () => {
        const startedAt = Date.now();
        const project = queries.projects.getById(projectId);
        if (!project) throw new Error(`Project ${projectId} not found`);
        if (!fs.existsSync(project.path)) {
          throw new Error(
            `Project path no longer exists: ${project.path}. Re-add the repository from a valid path.`,
          );
        }

        const ghCli = new GhCli(project.path);
        const issues = await ghCli.listAllIssues();
        logEvent('github:refresh-issues:listAllIssues', {
          projectId,
          issueCount: issues.length,
          elapsedMs: Date.now() - startedAt,
        });

        for (const issue of issues) {
          const existingIssue = queries.githubIssues.getByNumber(projectId, issue.number);
          const record = queries.githubIssues.upsert({
            projectId,
            issueNumber: issue.number,
            title: issue.title,
            body: issue.body,
            labels: issue.labels,
            assignee: issue.assignee,
            state: issue.state,
          });
          if (record.state === 'closed') {
            queries.githubIssues.markDoneOnClose(record.id);
          } else if (record.state === 'open') {
            queries.githubIssues.markReopenedOnOpen(record.id);
            queries.githubIssues.reconcileCompletedFromEvidence(record.id);
            queries.githubIssues.clearArchivedAt(record.id);
          }

          if (!existingIssue) {
            await attachIssueToConfiguredProjectBoard(
              project,
              ghCli,
              issue.number,
              issue.url,
              'github:refresh-issues',
            );
          }
        }

        const cachedAfterIssueSync = queries.githubIssues.list(projectId);
        for (const issue of cachedAfterIssueSync) {
          if (!issue.threadId) continue;
          if (
            !force &&
            issue.prLastSyncAt &&
            Date.now() - new Date(issue.prLastSyncAt).getTime() < PR_FEEDBACK_SYNC_TTL_MS
          ) {
            continue;
          }
          try {
            await syncLinkedPullRequestFeedback(
              project,
              issue,
              queries,
              notificationService,
              chatNotificationService,
            );
          } catch (err) {
            log.warn(
              `[github:refresh-issues] PR feedback sync failed for #${issue.issueNumber}:`,
              err,
            );
          }
        }

        const refreshed = queries.githubIssues.list(projectId);
        logEvent('github:refresh-issues:done', {
          projectId,
          issueCount: refreshed.length,
          elapsedMs: Date.now() - startedAt,
          force,
        });
        mainWindow.webContents.send('github:issues-updated', { projectId, issues: refreshed });
        return refreshed;
      })();

      refreshIssuesInFlight.set(projectId, refreshPromise);
      try {
        return await refreshPromise;
      } finally {
        if (refreshIssuesInFlight.get(projectId) === refreshPromise) {
          refreshIssuesInFlight.delete(projectId);
        }
      }
    },
  );

  ipcMain.handle(
    'github:archive-issue',
    async (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in project ${projectId}`);

      const ghCli = new GhCli(project.path);
      if (issue.state !== 'closed') {
        await ghCli.closeIssue(issueNumber);
      }
      try {
        await ghCli.archiveProjectItems(issueNumber);
      } catch (err) {
        log.warn('[github:archive-issue] project board archive failed after GitHub close:', err);
        throw new Error(
          `Issue #${issueNumber} was closed on GitHub but could not be archived from the GitHub project board.`,
        );
      }

      try {
        queries.githubIssues.updatePipelineStatus(issue.id, 'done');
        queries.githubIssues.archiveIssues([issue.id]);
      } catch (err) {
        log.error('[github:archive-issue] DB archive failed after GitHub close:', err);
        throw new Error(
          `Issue #${issueNumber} was closed on GitHub but could not be hidden locally. Refresh the board to sync.`,
        );
      }

      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return { archivedCount: 1 };
    },
  );

  ipcMain.handle(
    'github:mark-done',
    async (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in project ${projectId}`);

      const thread = issue.threadId ? queries.threads.getById(issue.threadId) : null;
      const hasCompletionEvidence = issue.linkedPrNumber != null || thread?.status === 'completed';

      if (issue.state === 'closed') {
        queries.githubIssues.updatePipelineStatus(issue.id, 'done');
      } else if (hasCompletionEvidence) {
        queries.githubIssues.updatePipelineStatus(issue.id, 'completed');
      } else {
        const ghCli = new GhCli(project.path);
        await ghCli.closeIssue(issueNumber);
        queries.githubIssues.updatePipelineStatus(issue.id, 'done');
      }

      sendGithubIssuesUpdated(mainWindow, queries, projectId);
    },
  );

  ipcMain.handle(
    'github:close-issue',
    async (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in project ${projectId}`);

      const ghCli = new GhCli(project.path);
      if (issue.state !== 'closed') {
        await ghCli.closeIssue(issueNumber);
      }

      queries.githubIssues.updatePipelineStatus(issue.id, 'done');
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
    },
  );

  ipcMain.handle(
    'github:archive-all-done',
    async (_event, { projectId }: { projectId: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const doneIssues = queries.githubIssues.listCompleted(projectId);
      const ghCli = new GhCli(project.path);
      const succeededIds: string[] = [];
      let failedCount = 0;

      for (const issue of doneIssues) {
        try {
          if (issue.state !== 'closed') {
            await ghCli.closeIssue(issue.issueNumber);
          }
          await ghCli.archiveProjectItems(issue.issueNumber);
          succeededIds.push(issue.id);
        } catch (err) {
          log.warn(`[github:archive-all-done] archive #${issue.issueNumber} failed:`, err);
          failedCount++;
        }
      }

      if (succeededIds.length > 0) {
        queries.githubIssues.archiveIssues(succeededIds);
      }

      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return { archivedCount: succeededIds.length, failedCount };
    },
  );

  ipcMain.handle('github:list-archived', () => {
    return queries.githubIssues.listArchived();
  });

  ipcMain.handle('github:unarchive-issue', (_event, { issueId }: { issueId: string }) => {
    queries.githubIssues.clearArchivedAt(issueId);
  });

  ipcMain.handle(
    'github:create-issue',
    async (
      _event,
      {
        projectId,
        title,
        body,
        labels,
      }: { projectId: string; title: string; body: string; labels?: string[] },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const ghCli = new GhCli(project.path);
      const issue = await ghCli.createIssue({ title, body, labels });

      queries.githubIssues.upsert({
        projectId,
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
        assignee: issue.assignee,
        state: issue.state,
      });

      const allIssues = queries.githubIssues.list(projectId);
      mainWindow.webContents.send('github:issues-updated', { projectId, issues: allIssues });

      let projectAttachWarning: string | null = null;
      if (parseGithubProjectUrl(project.githubProjectUrl) && issue.url) {
        projectAttachWarning = await attachIssueToConfiguredProjectBoard(
          project,
          ghCli,
          issue.number,
          issue.url,
          'github:create-issue',
        );
      }

      const record = queries.githubIssues.getByNumber(projectId, issue.number);
      if (!record) {
        throw new Error(`Created issue #${issue.number} not found in cache after upsert`);
      }
      return { issue: record, projectAttachWarning };
    },
  );

  ipcMain.handle(
    'github:edit-issue-body',
    async (
      _event,
      {
        projectId,
        issueNumber,
        title,
        body,
        labels,
      }: {
        projectId: string;
        issueNumber: number;
        title: string;
        body: string;
        labels?: string[];
      },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const ghCli = new GhCli(project.path);
      await ghCli.editIssue({ issueNumber, title, body, labels });

      const issue = await ghCli.getIssue(issueNumber);
      queries.githubIssues.upsert({
        projectId,
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
        assignee: issue.assignee,
        state: issue.state,
      });

      const allIssues = queries.githubIssues.list(projectId);
      mainWindow.webContents.send('github:issues-updated', { projectId, issues: allIssues });
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  ipcMain.handle(
    'github:sync-to-project-board',
    async (_event, { projectId }: { projectId: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const parsed = parseGithubProjectUrl(project.githubProjectUrl);
      if (!parsed) {
        throw new Error('No GitHub Projects v2 URL set. Paste a board URL above and save first.');
      }

      const issues = queries.githubIssues.list(projectId);
      const ghCli = new GhCli(project.path);

      let attached = 0;
      let alreadyPresent = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const issue of issues) {
        const issueUrl = deriveGithubIssueUrl(project.gitRemote, issue.issueNumber);
        if (!issueUrl) {
          failed += 1;
          errors.push(`#${issue.issueNumber}: could not derive issue URL from git remote`);
          continue;
        }
        try {
          const result = await ghCli.addIssueToProject({
            projectNumber: parsed.number,
            owner: parsed.owner,
            issueUrl,
          });
          if (result.alreadyPresent) alreadyPresent += 1;
          else attached += 1;
        } catch (err) {
          failed += 1;
          errors.push(`#${issue.issueNumber}: ${clampError(err)}`);
          log.warn(`[github:sync-to-project-board] #${issue.issueNumber} failed:`, err);
        }
      }

      log.info(
        `[github:sync-to-project-board] project=${projectId} attached=${attached} alreadyPresent=${alreadyPresent} failed=${failed}`,
      );
      return { attached, alreadyPresent, failed, errors };
    },
  );

  ipcMain.handle(
    'github:start-issue',
    async (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);

      const reusableThread = resolveCanonicalIssueThread(queries, issue);
      if (reusableThread && !['failed', 'completed', 'idle'].includes(reusableThread.status)) {
        throw new Error(`Issue #${issueNumber} already has active thread`);
      }

      const settings = queries.settings.get();
      const activeCount = pipeline.listActive().length;
      if (activeCount >= settings.maxConcurrentPipelines) {
        queries.githubIssues.updatePipelineStatus(issue.id, 'queued');
        sendGithubIssuesUpdated(mainWindow, queries, projectId);
        log.info(
          `[pipeline] queued issue #${issue.issueNumber} (${activeCount}/${settings.maxConcurrentPipelines} slots used)`,
        );
        return;
      }

      queries.githubIssues.updatePipelineStatus(issue.id, 'planning');
      const thread =
        reusableThread ?? queries.threads.create(projectId, issue.body ?? issue.title, issue.title);
      if (reusableThread) {
        queries.threads.updateIssueContent(thread.id, issue.body ?? issue.title, issue.title);
      }
      queries.threads.setGithubIssue(thread.id, issue.issueNumber, project.gitRemote);
      queries.githubIssues.linkThread(issue.id, thread.id);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);

      const issueUrl = deriveGithubIssueUrl(project.gitRemote, issue.issueNumber);
      const ghCliForAttach = new GhCli(project.path);
      await attachIssueToConfiguredProjectBoard(
        project,
        ghCliForAttach,
        issue.issueNumber,
        issueUrl,
        'github:start-issue',
      );

      const phaseModels = resolveIssuePhaseModels(settings, project, issue);
      const effectiveExecutorModel = resolveExecutorModelForIssue(settings, project, issue);
      queries.threads.setPhaseModels(thread.id, {
        ...phaseModels,
        executorModel: effectiveExecutorModel,
      });
      queries.plans.supersedeAll(thread.id);
      queries.plans.supersedeAllForIssue(projectId, issueNumber, thread.id);

      log.info(
        `[pipeline] starting issue #${issue.issueNumber} "${issue.title}" (thread ${thread.id}${reusableThread ? ', reusing existing worktree' : ''}, executor: ${effectiveExecutorModel})`,
      );
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
        transitionThreadPhase(mainWindow, queries, emitter, {
          threadId: thread.id,
          phase: 'failed',
          errorMessage: clampError(err),
        });
        throw err;
      }
    },
  );

  ipcMain.handle(
    'github:retry-issue',
    (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);

      const thread = resolveCanonicalIssueThread(queries, issue);
      if (thread && thread.status !== 'idle' && thread.status !== 'completed') {
        pipeline.cancel(thread.id);
        queries.threads.updateStatus(thread.id, 'idle');
      }

      if (!queries.githubIssues.resetToTodo(issue.id)) {
        queries.githubIssues.reconcileCompletedFromEvidence(issue.id);
      }
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
    },
  );

  ipcMain.handle(
    'github:set-phase-model-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        phase,
        model,
      }: {
        projectId: string;
        issueNumber: number;
        phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
        model: ExecutorModel;
      },
    ) => {
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      if (model !== 'claude' && model !== 'codex' && model !== 'openrouter') {
        throw new Error(`Invalid ${phase} model: ${model}`);
      }

      queries.githubIssues.updatePhaseModelOverride(issue.id, phase, model);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  ipcMain.handle(
    'github:clear-phase-model-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        phase,
      }: {
        projectId: string;
        issueNumber: number;
        phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
      },
    ) => {
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);

      queries.githubIssues.updatePhaseModelOverride(issue.id, phase, null);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  ipcMain.handle(
    'github:set-phase-model-id-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        phase,
        modelId,
      }: {
        projectId: string;
        issueNumber: number;
        phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
        modelId: string;
      },
    ) => {
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      queries.githubIssues.updatePhaseModelIdOverride(issue.id, phase, modelId.trim() || null);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  ipcMain.handle(
    'github:clear-phase-model-id-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        phase,
      }: {
        projectId: string;
        issueNumber: number;
        phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
      },
    ) => {
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      queries.githubIssues.updatePhaseModelIdOverride(issue.id, phase, null);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );
}
