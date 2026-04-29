import fs from 'node:fs';
import path from 'node:path';
import { enhancePrdDraft, fetchProjectPriorities, GhCli } from '@shipcode/agents';
import type {
  ExecutorModel,
  GitHubIssueCacheRecord,
  GitHubIssueComment,
  IssuePipelineStatus,
  ReasoningEffort,
} from '@shipcode/shared';
import {
  clampError,
  deriveGithubIssueUrl,
  ISSUE_PIPELINE_STATUS,
  isRealGithubIssueNumber,
  PIPELINE_PHASE,
  parseGithubProjectUrl,
  SHIPCODE_DEFAULT_LABELS,
} from '@shipcode/shared';
import log, { logEvent } from '../logger.service';
import { PipelineScheduler } from '../pipeline-scheduler';
import {
  assertPrdRewriteModelSupported,
  attachIssueToConfiguredProjectBoard,
  sendGithubIssuesUpdated,
  syncLinkedPullRequestFeedback,
} from './helpers';
import { refreshIssueBodyEdges } from './register-issue-graph-handlers';
import type { IpcHandlerDeps } from './types';

const ISSUE_REFRESH_TTL_MS = 5 * 60_000;
const PR_FEEDBACK_SYNC_TTL_MS = 60_000;
const ISSUE_COMMENT_TTL_MS = 30_000;
const refreshIssuesInFlight = new Map<string, Promise<GitHubIssueCacheRecord[]>>();
const issueCommentsCache = new Map<
  string,
  { comments: GitHubIssueComment[]; cachedAtMs: number }
>();
const issueCommentsInFlight = new Map<string, Promise<GitHubIssueComment[]>>();

function assertRealGithubIssue(issue: GitHubIssueCacheRecord, action: string): void {
  if (issue.isQuickMode || !isRealGithubIssueNumber(issue.issueNumber)) {
    throw new Error(`Quick tasks have no GitHub issue: cannot ${action}`);
  }
}

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

function resolveOpenIssuePipelineStatus(
  issue: GitHubIssueCacheRecord,
  thread: ReturnType<IpcHandlerDeps['queries']['threads']['getById']>,
): IssuePipelineStatus {
  if (thread) {
    return thread.status === PIPELINE_PHASE.idle
      ? ISSUE_PIPELINE_STATUS.todo
      : (thread.status as IssuePipelineStatus);
  }
  return issue.linkedPrNumber != null
    ? ISSUE_PIPELINE_STATUS.completed
    : ISSUE_PIPELINE_STATUS.todo;
}

function syncOpenIssueState(
  queries: IpcHandlerDeps['queries'],
  issue: GitHubIssueCacheRecord,
): GitHubIssueCacheRecord | null {
  const thread = resolveCanonicalIssueThread(queries, issue);
  if (thread && issue.threadId !== thread.id) {
    queries.githubIssues.linkThread(issue.id, thread.id);
  }

  queries.githubIssues.updateState(issue.id, 'open');
  queries.githubIssues.updatePipelineStatus(
    issue.id,
    resolveOpenIssuePipelineStatus(issue, thread),
  );
  queries.githubIssues.clearArchivedAt(issue.id);

  return queries.githubIssues.getByNumber(issue.projectId, issue.issueNumber);
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
  const scheduler = new PipelineScheduler({
    queries,
    pipeline,
    emitter,
    getMainWindow: () => mainWindow,
  });

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
            syncOpenIssueState(queries, record);
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
        const issuesByNumber = new Map(
          cachedAfterIssueSync.map(
            (cachedIssue) => [cachedIssue.issueNumber, cachedIssue] as const,
          ),
        );
        for (const cachedIssue of cachedAfterIssueSync) {
          refreshIssueBodyEdges(queries.issueEdges, cachedIssue, issuesByNumber);
        }

        if (project.githubProjectUrl) {
          try {
            const priorities = await fetchProjectPriorities({
              cwd: project.path,
              projectUrl: project.githubProjectUrl,
              onWarn: (msg, err) => log.warn(msg, err),
            });
            const now = new Date().toISOString();
            for (const cachedIssue of cachedAfterIssueSync) {
              const p = priorities.get(cachedIssue.issueNumber) ?? { rank: null, raw: null };
              queries.githubIssues.setPriority({
                id: cachedIssue.id,
                rank: p.rank,
                raw: p.raw,
                fetchedAt: now,
              });
            }
          } catch (err) {
            log.warn('[github:refresh-issues] priority sync failed', err);
          }
        }
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
        sendGithubIssuesUpdated(mainWindow, queries, projectId);
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
      assertRealGithubIssue(issue, 'archive');

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
        queries.githubIssues.updateState(issue.id, 'closed');
        queries.githubIssues.updatePipelineStatus(issue.id, ISSUE_PIPELINE_STATUS.done);
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
      assertRealGithubIssue(issue, 'mark done on GitHub');

      const thread = issue.threadId ? queries.threads.getById(issue.threadId) : null;
      const hasCompletionEvidence =
        issue.linkedPrNumber != null || thread?.status === PIPELINE_PHASE.completed;

      if (issue.state === 'closed') {
        queries.githubIssues.updateState(issue.id, 'closed');
        queries.githubIssues.updatePipelineStatus(issue.id, ISSUE_PIPELINE_STATUS.done);
      } else if (hasCompletionEvidence) {
        queries.githubIssues.updateState(issue.id, 'open');
        queries.githubIssues.updatePipelineStatus(issue.id, ISSUE_PIPELINE_STATUS.completed);
      } else {
        const ghCli = new GhCli(project.path);
        await ghCli.closeIssue(issueNumber);
        queries.githubIssues.updateState(issue.id, 'closed');
        queries.githubIssues.updatePipelineStatus(issue.id, ISSUE_PIPELINE_STATUS.done);
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
      assertRealGithubIssue(issue, 'close on GitHub');

      const ghCli = new GhCli(project.path);
      if (issue.state !== 'closed') {
        await ghCli.closeIssue(issueNumber);
      }

      queries.githubIssues.updateState(issue.id, 'closed');
      queries.githubIssues.updatePipelineStatus(issue.id, ISSUE_PIPELINE_STATUS.done);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
    },
  );

  ipcMain.handle(
    'github:reopen-issue',
    async (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in project ${projectId}`);
      assertRealGithubIssue(issue, 'reopen on GitHub');

      const ghCli = new GhCli(project.path);
      if (issue.state !== 'open') {
        await ghCli.reopenIssue(issueNumber);
      }

      syncOpenIssueState(queries, issue);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
    },
  );

  ipcMain.handle(
    'github:archive-all-done',
    async (_event, { projectId }: { projectId: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const doneIssues = queries.githubIssues
        .listCompleted(projectId)
        .filter((i) => !i.isQuickMode && isRealGithubIssueNumber(i.issueNumber));
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

      const cachedIssue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!cachedIssue) throw new Error(`Issue #${issueNumber} not found in project ${projectId}`);
      assertRealGithubIssue(cachedIssue, 'edit on GitHub');

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

      const issues = queries.githubIssues
        .list(projectId)
        .filter((i) => !i.isQuickMode && isRealGithubIssueNumber(i.issueNumber));
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
    'github:list-repo-labels',
    async (_event, { projectId }: { projectId: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      const ghCli = new GhCli(project.path);
      return ghCli.listRepoLabelsWithMeta();
    },
  );

  ipcMain.handle(
    'github:ensure-shipcode-labels',
    async (_event, { projectId }: { projectId: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      const ghCli = new GhCli(project.path);
      const result = await ghCli.ensureLabels(SHIPCODE_DEFAULT_LABELS);
      log.info(
        `[github:ensure-shipcode-labels] project=${projectId} created=${result.created.length} alreadyPresent=${result.alreadyPresent.length} failed=${result.failed.length}`,
      );
      return result;
    },
  );

  ipcMain.handle(
    'github:start-issue',
    async (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);

      if (issue.isQuickMode || !isRealGithubIssueNumber(issue.issueNumber)) {
        await scheduler.startQuickTaskOrQueue(projectId, issueNumber);
        return;
      }

      const issueUrl = deriveGithubIssueUrl(project.gitRemote, issue.issueNumber);
      const ghCliForAttach = new GhCli(project.path);
      await attachIssueToConfiguredProjectBoard(
        project,
        ghCliForAttach,
        issue.issueNumber,
        issueUrl,
        'github:start-issue',
      );
      await scheduler.startOrQueue(projectId, issueNumber);
    },
  );

  ipcMain.handle(
    'github:retry-issue',
    (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);

      const thread = resolveCanonicalIssueThread(queries, issue);
      if (
        thread &&
        thread.status !== PIPELINE_PHASE.idle &&
        thread.status !== PIPELINE_PHASE.completed
      ) {
        pipeline.cancel(thread.id);
        queries.threads.updateStatus(thread.id, PIPELINE_PHASE.idle);
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

  ipcMain.handle(
    'github:clear-all-phase-overrides-for-project',
    (_event, { projectId }: { projectId: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const clearedCount = queries.githubIssues.clearAllPhaseOverridesForProject(projectId);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return { clearedCount };
    },
  );

  ipcMain.handle(
    'github:set-revision-count-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        revisionCount,
      }: {
        projectId: string;
        issueNumber: number;
        revisionCount: import('@shipcode/shared').GitHubIssueCacheRecord['revisionCountOverride'];
      },
    ) => {
      if (
        revisionCount !== null &&
        revisionCount !== 0 &&
        revisionCount !== 1 &&
        revisionCount !== 2 &&
        revisionCount !== 3 &&
        revisionCount !== 4 &&
        revisionCount !== 5
      ) {
        throw new Error(`Invalid revision count override: ${revisionCount}`);
      }
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      queries.githubIssues.updateRevisionCountOverride(issue.id, revisionCount);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  ipcMain.handle(
    'github:set-require-approval-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        requireApproval,
      }: {
        projectId: string;
        issueNumber: number;
        requireApproval: import('@shipcode/shared').GitHubIssueCacheRecord['requireApprovalOverride'];
      },
    ) => {
      if (requireApproval !== null && typeof requireApproval !== 'boolean') {
        throw new Error(`Invalid requireApproval override: ${String(requireApproval)}`);
      }
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      queries.githubIssues.updateRequireApprovalOverride(issue.id, requireApproval);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  ipcMain.handle(
    'github:set-phase-reasoning-effort-override',
    (
      _event,
      {
        projectId,
        issueNumber,
        phase,
        effort,
      }: {
        projectId: string;
        issueNumber: number;
        phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
        effort: ReasoningEffort;
      },
    ) => {
      const VALID_EFFORTS: readonly string[] = [
        'none',
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
      ];
      if (!VALID_EFFORTS.includes(effort)) {
        throw new Error(`Invalid ${phase} reasoning effort: ${effort}`);
      }
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      queries.githubIssues.updatePhaseReasoningEffortOverride(issue.id, phase, effort);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  ipcMain.handle(
    'github:clear-phase-reasoning-effort-override',
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
      queries.githubIssues.updatePhaseReasoningEffortOverride(issue.id, phase, null);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  ipcMain.handle(
    'github:add-comment',
    async (
      _event,
      { projectId, issueNumber, body }: { projectId: string; issueNumber: number; body: string },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in project ${projectId}`);
      assertRealGithubIssue(issue, 'comment on GitHub');
      const ghCli = new GhCli(project.path);
      await ghCli.addIssueComment(issueNumber, body);
      issueCommentsCache.delete(`${projectId}:${issueNumber}`);
    },
  );

  ipcMain.handle(
    'github:list-comments',
    async (
      _event,
      {
        projectId,
        issueNumber,
        force = false,
      }: { projectId: string; issueNumber: number; force?: boolean },
    ) => {
      const cacheKey = `${projectId}:${issueNumber}`;
      const cached = issueCommentsCache.get(cacheKey);
      if (!force && cached && Date.now() - cached.cachedAtMs < ISSUE_COMMENT_TTL_MS) {
        return cached.comments;
      }

      const inFlight = issueCommentsInFlight.get(cacheKey);
      if (inFlight) {
        return inFlight;
      }

      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in project ${projectId}`);
      assertRealGithubIssue(issue, 'list comments from GitHub');
      const request = (async () => {
        const ghCli = new GhCli(project.path);
        const comments = await ghCli.listIssueComments(issueNumber);
        issueCommentsCache.set(cacheKey, { comments, cachedAtMs: Date.now() });
        return comments;
      })();

      issueCommentsInFlight.set(cacheKey, request);
      try {
        return await request;
      } finally {
        issueCommentsInFlight.delete(cacheKey);
      }
    },
  );

  ipcMain.handle(
    'github:rewrite-issue',
    async (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const cachedIssue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!cachedIssue) throw new Error(`Issue #${issueNumber} not found in project ${projectId}`);
      assertRealGithubIssue(cachedIssue, 'rewrite PRD on GitHub');

      const ghCli = new GhCli(project.path);
      const issue = await ghCli.getIssue(issueNumber);

      const settings = queries.settings.get();
      const modelId =
        settings.prdRewriteCli === 'claude'
          ? settings.prdRewriteClaudeModel
          : settings.prdRewriteCodexModel;
      await assertPrdRewriteModelSupported(
        settings.prdRewriteCli,
        modelId,
        settings.prdRewriteReasoningEffort,
      );
      const skillPath = path.join(project.path, 'skills', 'writing-prds', 'SKILL.md');
      let skillContent: string;
      try {
        skillContent = fs.readFileSync(skillPath, 'utf-8');
      } catch {
        skillContent =
          "You are drafting a PRD that will be consumed by the ShipCode pipeline's planner agent. " +
          'The PRD lives in a GitHub issue body. Required sections: Executive Summary, Problem Statement, ' +
          'Goals, Non-Goals, User Stories, Functional Requirements, Non-Functional Requirements, ' +
          'Success Criteria, Out of Scope, Dependencies, Verification Plan, Risks & Open Questions.';
      }

      const enhanced = await enhancePrdDraft({
        draftBody: issue.body ?? '',
        skillContent,
        cwd: project.path,
        cli: settings.prdRewriteCli,
        modelId,
        reasoningEffort: settings.prdRewriteReasoningEffort,
      });

      await ghCli.editIssue({
        issueNumber,
        title: issue.title,
        body: enhanced.body,
        labels: issue.labels,
      });

      const handles: string[] = [];
      if (issue.author?.login) handles.push(`@${issue.author.login}`);
      if (project.notifyGithubUser) handles.push(`@${project.notifyGithubUser}`);
      const mention = handles.length > 0 ? `${handles.join(' ')} — ` : '';
      const commentBody = `${mention}This issue has been rewritten as a structured spec by ShipCode. Please review and let us know if anything is missing or incorrect.`;
      await ghCli.addIssueComment(issueNumber, commentBody);

      const updatedIssue = await ghCli.getIssue(issueNumber);
      const cached = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (cached) {
        queries.githubIssues.upsert({
          projectId,
          issueNumber: updatedIssue.number,
          title: updatedIssue.title,
          body: updatedIssue.body,
          labels: updatedIssue.labels,
          assignee: updatedIssue.assignee,
          state: updatedIssue.state,
        });
      }
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      const result = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!result) throw new Error(`Issue #${issueNumber} not found in cache after rewrite`);
      return result;
    },
  );
}
