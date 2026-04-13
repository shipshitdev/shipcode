import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ProcessManager, TerminalEvent } from '@shipcode/agents';
import {
  ClaudeNormalizer,
  CodexNormalizer,
  checkGhAuth,
  checkIntegrationStatus,
  checkSystemHealthWithAuth,
  DEFAULT_SKILLS,
  enhancePrdDraft,
  GhCli,
  generateContextFiles,
  listContextFiles,
  PHASE_SKILL_KEYS,
  readContextFile,
  StreamParser,
  validateOpenRouterModel,
  validateSkill,
} from '@shipcode/agents';
import type {
  ActivityQueries,
  CheckpointQueries,
  CostsQueries,
  DashboardQueries,
  DiffQueries,
  GitHubIssueQueries,
  NotificationsQueries,
  PlanQueries,
  ProjectQueries,
  ReviewQueries,
  SettingsQueries,
  SkillsQueries,
  ThreadQueries,
  VerificationQueries,
} from '@shipcode/db';
import type { PhaseSkillKey, ShipCodePlan } from '@shipcode/shared';
import {
  clampError,
  deriveGithubIssueUrl,
  parseGithubProjectUrl,
  resolveExecutorModelForIssue,
  resolvePhaseModel,
  resolvePhaseModelForIssue,
  resolvePhaseModelId,
  resolvePhaseModelIdForIssue,
  resolvePhaseReasoningEffort,
  validateGithubProjectUrl,
} from '@shipcode/shared';
import { type BrowserWindow, dialog, type IpcMain, shell } from 'electron';
import log, { logProcessOutput } from './logger.service';
import { isSafeExternalUrl } from './security';

const execAsync = promisify(exec);

import { GitService, WorktreeManager } from '@shipcode/git';
import type { Pipeline } from '@shipcode/pipeline';
import type { ActivePipelineSummary, ExecutorModel } from '@shipcode/shared';
import type { NotificationService } from './notification-service';

interface Queries {
  projects: ProjectQueries;
  threads: ThreadQueries;
  plans: PlanQueries;
  reviews: ReviewQueries;
  diffs: DiffQueries;
  settings: SettingsQueries;
  verifications: VerificationQueries;
  githubIssues: GitHubIssueQueries;
  checkpoints: CheckpointQueries;
  activity: ActivityQueries;
  notifications: NotificationsQueries;
  dashboard: DashboardQueries;
  costs: CostsQueries;
  skills: SkillsQueries;
}

function enrichProjectPath(project: import('@shipcode/shared').Project | null) {
  if (!project) return null;
  return {
    ...project,
    pathExists: fs.existsSync(project.path),
  };
}

function enrichProjectPaths(projects: import('@shipcode/shared').Project[]) {
  return projects.map((project) => ({
    ...project,
    pathExists: fs.existsSync(project.path),
  }));
}

function resolveProjectPhaseModels(
  settings: ReturnType<SettingsQueries['get']>,
  project: import('@shipcode/shared').Project,
) {
  return {
    plannerModel: resolvePhaseModel(settings, project, 'planner'),
    reviewerModel: resolvePhaseModel(settings, project, 'reviewer'),
    verifierModel: resolvePhaseModel(settings, project, 'verifier'),
    executorModel: resolvePhaseModel(settings, project, 'executor'),
    plannerModelId: resolvePhaseModelId(settings, project, 'planner'),
    reviewerModelId: resolvePhaseModelId(settings, project, 'reviewer'),
    verifierModelId: resolvePhaseModelId(settings, project, 'verifier'),
    executorModelId: resolvePhaseModelId(settings, project, 'executor'),
    plannerReasoningEffort: resolvePhaseReasoningEffort(settings, project, 'planner'),
    reviewerReasoningEffort: resolvePhaseReasoningEffort(settings, project, 'reviewer'),
    verifierReasoningEffort: resolvePhaseReasoningEffort(settings, project, 'verifier'),
    executorReasoningEffort: resolvePhaseReasoningEffort(settings, project, 'executor'),
  };
}

function resolveIssuePhaseModels(
  settings: ReturnType<SettingsQueries['get']>,
  project: import('@shipcode/shared').Project,
  issue: import('@shipcode/shared').GitHubIssueCacheRecord,
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
    plannerReasoningEffort: resolvePhaseReasoningEffort(settings, project, 'planner'),
    reviewerReasoningEffort: resolvePhaseReasoningEffort(settings, project, 'reviewer'),
    verifierReasoningEffort: resolvePhaseReasoningEffort(settings, project, 'verifier'),
    executorReasoningEffort: resolvePhaseReasoningEffort(settings, project, 'executor'),
  };
}

/** Try to extract a validated ShipCodePlan from raw pipeline output.
 *  Reuses StreamParser which already handles stream-json / codex unwrapping
 *  and fenced-block extraction with JSON fallback. */
function tryParsePlan(rawOutput: string): ShipCodePlan | null {
  if (!rawOutput) return null;
  const parser = new StreamParser();
  parser.feed(rawOutput);
  const result = parser.extractPlan();
  return result.success ? result.data : null;
}

async function syncLinkedPullRequestFeedback(
  project: import('@shipcode/shared').Project,
  issue: import('@shipcode/shared').GitHubIssueCacheRecord,
  queries: Queries,
  notificationService: NotificationService,
): Promise<void> {
  const thread = issue.threadId ? queries.threads.getById(issue.threadId) : null;
  const ghCli = new GhCli(project.path);

  if (!thread?.githubPrNumber) {
    if (
      issue.linkedPrNumber !== null ||
      issue.ciBlocked ||
      issue.unresolvedReviewCommentCount > 0
    ) {
      queries.githubIssues.updatePullRequestFeedback(issue.id, {
        linkedPrNumber: null,
        linkedPrUrl: null,
        linkedPrIsDraft: false,
        ciBlocked: false,
        failingChecks: [],
        unresolvedReviewComments: [],
      });
      queries.githubIssues.setCachedLabelPresence(issue.id, 'blocked:ci', false);
      await ghCli.setIssueLabelPresence(issue.issueNumber, 'blocked:ci', false);
    }
    return;
  }

  const feedback = await ghCli.getPullRequestFeedback(thread.githubPrNumber);
  queries.githubIssues.updatePullRequestFeedback(issue.id, {
    linkedPrNumber: feedback.number,
    linkedPrUrl: feedback.url,
    linkedPrIsDraft: feedback.isDraft,
    ciBlocked: feedback.ciBlocked,
    failingChecks: feedback.failingChecks,
    unresolvedReviewComments: feedback.unresolvedReviewComments,
  });

  if (feedback.ciBlocked !== issue.ciBlocked) {
    queries.githubIssues.setCachedLabelPresence(issue.id, 'blocked:ci', feedback.ciBlocked);
    await ghCli.setIssueLabelPresence(issue.issueNumber, 'blocked:ci', feedback.ciBlocked);
    if (feedback.ciBlocked) {
      notificationService.fire('ci_blocked', thread);
    }
  } else if (feedback.ciBlocked) {
    queries.githubIssues.setCachedLabelPresence(issue.id, 'blocked:ci', true);
  }
}

async function attachIssueToConfiguredProjectBoard(
  project: import('@shipcode/shared').Project,
  ghCli: GhCli,
  issueNumber: number,
  issueUrl: string | null,
  source: string,
): Promise<string | null> {
  const parsed = parseGithubProjectUrl(project.githubProjectUrl);
  if (!parsed || !issueUrl) return null;

  try {
    await ghCli.addIssueToProject({
      projectNumber: parsed.number,
      owner: parsed.owner,
      issueUrl,
    });
    return null;
  } catch (err) {
    log.warn(`[${source}] project attach failed for #${issueNumber}:`, err);
    return clampError(err);
  }
}

export function registerIpcHandlers(
  ipcMain: IpcMain,
  mainWindow: BrowserWindow,
  queries: Queries,
  processManager: ProcessManager,
  pipeline: Pipeline,
  notificationService: NotificationService,
): void {
  // === Startup: reset any threads/issues stuck in agent-loop phases from a prior session ===
  // processManager is fresh on every launch, so any in-flight DB rows are orphaned.
  for (const thread of queries.threads.getOrphaned()) {
    queries.threads.updateStatus(thread.id, 'failed');
    const issue = queries.githubIssues.getByThreadId(thread.id);
    if (issue) queries.githubIssues.updatePipelineStatus(issue.id, 'failed');
    log.info(`[startup] reset orphaned thread ${thread.id} → failed`);
  }

  // === Project handlers ===
  // `project:list` returns the full registry (including archived projects).
  // The sidebar uses `project:list-visible` for the filtered list; Titlebar,
  // IssueDetail, and ThreadPanel continue to use `project:list` so they can
  // resolve archived projects that are still navigable via deep links.
  ipcMain.handle('project:list', () => {
    return enrichProjectPaths(queries.projects.list());
  });

  ipcMain.handle('project:list-visible', () => {
    return enrichProjectPaths(queries.projects.listVisible());
  });

  ipcMain.handle('project:list-archived', () => {
    return enrichProjectPaths(queries.projects.listArchived());
  });

  ipcMain.handle('project:add', async (_event, { path: projectPath }: { path: string }) => {
    const project = queries.projects.add(projectPath);

    // Detect git info
    try {
      const git = new GitService(projectPath);
      const remote = await git.getRemoteUrl();
      const branch = await git.getDefaultBranch();
      queries.projects.updateGitInfo(project.id, remote, branch);
      return enrichProjectPath({ ...project, gitRemote: remote, defaultBranch: branch });
    } catch {
      return enrichProjectPath(project);
    }
  });

  ipcMain.handle(
    'project:relink-path',
    async (_event, { projectId, path: projectPath }: { projectId: string; path: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      if (!fs.existsSync(projectPath)) {
        throw new Error(`Selected folder does not exist: ${projectPath}`);
      }

      const existing = queries.projects.getByPath(projectPath);
      if (existing && existing.id !== projectId) {
        throw new Error(`Another project already points to ${projectPath}`);
      }

      queries.projects.updatePath(projectId, projectPath);

      try {
        const git = new GitService(projectPath);
        const remote = await git.getRemoteUrl();
        const branch = await git.getDefaultBranch();
        queries.projects.updateGitInfo(projectId, remote, branch);
      } catch {
        // Keep the new path even if git metadata refresh fails. The user may
        // have selected the repo root incorrectly or the folder may not be a
        // git checkout yet; the recovery action should still persist.
      }

      return enrichProjectPath(queries.projects.getById(projectId));
    },
  );

  ipcMain.handle('project:remove', async (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    const ignoreAttentionOnly = project ? !fs.existsSync(project.path) : false;

    // Fast pre-check: bail early without running slow worktree cleanup if the
    // project clearly has active work. The final safety guarantee comes from
    // `removeIfIdle()`'s atomic DELETE below.
    if (queries.projects.hasLiveWork(projectId, { ignoreAttentionOnly })) {
      throw new Error(
        ignoreAttentionOnly
          ? 'Cannot remove this missing project while a pipeline is still active. Stop running pipelines first.'
          : 'Cannot remove a project with active work. Stop running pipelines and dismiss notifications first.',
      );
    }

    // Worktree cleanup — fail closed on errors. The previous implementation
    // silently swallowed cleanup failures and deleted the project row anyway,
    // leaving orphaned worktrees on disk with no registry entry to recover
    // them. Now we collect real failures and throw before any DB mutation.
    if (project) {
      const appSettings = queries.settings.get();
      const worktreeManager = new WorktreeManager(project.path, {
        worktreeRoot: appSettings.worktreeRoot,
      });
      const threads = queries.threads.list(projectId);
      const failures: string[] = [];
      for (const t of threads) {
        if (t.worktreePath && t.worktreeBranch) {
          const result = await worktreeManager.remove(t.worktreePath, t.worktreeBranch);
          if (result.error) {
            failures.push(`${t.worktreePath}: ${result.error}`);
          }
        }
      }
      if (failures.length > 0) {
        throw new Error(
          `Failed to clean up ${failures.length} worktree(s). Project not removed:\n${failures.join('\n')}`,
        );
      }
    }

    // Atomic final DELETE: refuses to remove the row if live work appeared
    // during the (slow) worktree cleanup phase.
    const removed = queries.projects.removeIfIdle(projectId, { ignoreAttentionOnly });
    if (!removed) {
      throw new Error(
        ignoreAttentionOnly
          ? 'A pipeline became active during cleanup. Project not removed. Retry after it stops.'
          : 'New work appeared during cleanup. Project not removed. Retry after stopping pipelines.',
      );
    }
  });

  ipcMain.handle(
    'project:pin',
    (_event, { projectId, pinned }: { projectId: string; pinned: boolean }) => {
      queries.projects.pin(projectId, pinned);
    },
  );

  ipcMain.handle('project:archive', (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    const ignoreAttentionOnly = project ? !fs.existsSync(project.path) : false;
    const archived = queries.projects.archiveIfIdle(projectId, { ignoreAttentionOnly });
    if (!archived) {
      throw new Error(
        ignoreAttentionOnly
          ? 'Cannot archive this missing project while a pipeline is still active. Stop running pipelines first.'
          : 'Cannot archive a project with active work. Stop running pipelines and dismiss notifications first.',
      );
    }
  });

  ipcMain.handle('project:unarchive', (_event, { projectId }: { projectId: string }) => {
    queries.projects.unarchive(projectId);
  });

  // === Thread handlers ===
  ipcMain.handle('thread:list', (_event, { projectId }: { projectId: string }) => {
    return queries.threads.list(projectId);
  });

  ipcMain.handle(
    'thread:create',
    (_event, { projectId, prompt }: { projectId: string; prompt: string }) => {
      const title = prompt.length > 60 ? prompt.substring(0, 60) + '...' : prompt;
      return queries.threads.create(projectId, prompt, title);
    },
  );

  ipcMain.handle('thread:get', (_event, { threadId }: { threadId: string }) => {
    return queries.threads.getById(threadId);
  });

  ipcMain.handle('checkpoint:list', (_event, { threadId }: { threadId: string }) => {
    return queries.checkpoints.list(threadId);
  });

  ipcMain.handle(
    'checkpoint:restore',
    async (_event, { threadId, checkpointId }: { threadId: string; checkpointId: string }) => {
      const checkpoint = queries.checkpoints.getById(checkpointId);
      if (!checkpoint || checkpoint.threadId !== threadId) {
        throw new Error('Checkpoint not found');
      }

      const thread = queries.threads.getById(threadId);
      if (!thread?.worktreePath) {
        throw new Error('Thread has no active worktree to restore');
      }

      if (pipeline.listActive().some((entry) => entry.threadId === threadId)) {
        throw new Error('Stop the active pipeline before restoring a checkpoint');
      }

      await execAsync(`git reset --hard ${checkpoint.commitSha}`, {
        cwd: thread.worktreePath,
        timeout: 15_000,
      });
      await execAsync('git clean -fd', {
        cwd: thread.worktreePath,
        timeout: 15_000,
      });

      queries.threads.updateStatus(threadId, 'idle');

      const issue = queries.githubIssues.getByThreadId(threadId);
      if (issue) {
        queries.githubIssues.updatePipelineStatus(issue.id, 'todo');
        mainWindow.webContents.send('github:issues-updated', {
          projectId: issue.projectId,
          issues: queries.githubIssues.list(issue.projectId),
        });
      }

      mainWindow.webContents.send('pipeline:phase', { threadId, phase: 'idle' });
      return { restored: true as const, checkpoint };
    },
  );

  // === Plan handlers ===
  ipcMain.handle('plan:get', (_event, { threadId }: { threadId: string }) => {
    return queries.plans.getLatest(threadId);
  });

  ipcMain.handle('plan:list', (_event, { threadId }: { threadId: string }) => {
    return queries.plans.list(threadId);
  });

  ipcMain.handle(
    'plan:list-for-issue',
    (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      return queries.plans.listByIssue(projectId, issueNumber);
    },
  );

  ipcMain.handle(
    'plan:update',
    (_event, { planId, structured }: { planId: string; structured: any }) => {
      queries.plans.updateStructured(planId, structured);
    },
  );

  // === Review handlers ===
  ipcMain.handle('review:get', (_event, { planId }: { planId: string }) => {
    return queries.reviews.getByPlanId(planId);
  });

  ipcMain.handle('review:list-by-plans', (_event, { planIds }: { planIds: string[] }) => {
    return queries.reviews.listByPlanIds(planIds);
  });

  // === Diff handlers ===
  ipcMain.handle('diff:list', (_event, { threadId }: { threadId: string }) => {
    return queries.diffs.list(threadId);
  });

  // === Git handlers ===
  ipcMain.handle('git:status', async (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    const git = new GitService(project.path);
    return git.getStatus();
  });

  ipcMain.handle(
    'git:commit',
    async (_event, { projectId, message }: { projectId: string; message: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      const git = new GitService(project.path);
      return git.commit(message);
    },
  );

  ipcMain.handle('git:push', async (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    const git = new GitService(project.path);
    return git.push();
  });

  // === Settings handlers ===
  ipcMain.handle('settings:get', () => {
    return queries.settings.get();
  });

  ipcMain.handle('settings:set', (_event, patch: any) => {
    queries.settings.set(patch);
  });

  // === Health check ===
  ipcMain.handle('health:check', async () => {
    return checkSystemHealthWithAuth();
  });

  ipcMain.handle('integrations:check', async () => {
    return checkIntegrationStatus(queries.settings.get());
  });

  ipcMain.handle(
    'integrations:validate-openrouter-model',
    async (_event, { modelId }: { modelId: string }) => {
      return validateOpenRouterModel(queries.settings.get(), modelId);
    },
  );

  // === Dialog handlers ===
  ipcMain.handle('dialog:open-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // Open an external URL in the user's default browser.
  // Hardened bridge: https-only, github.com host allowlist, userinfo rejected,
  // normalized parsed.href passed through, length capped. The renderer is a
  // browser context so we validate everything in main.
  ipcMain.handle('shell:open-external', async (_event, { url }: { url: string }) => {
    const validated = isSafeExternalUrl(url);
    if (!validated.ok) return;
    await shell.openExternal(validated.href);
  });

  // === GitHub handlers ===
  ipcMain.handle(
    'github:get-issue',
    (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  ipcMain.handle('github:list-issues', (_event, { projectId }: { projectId: string }) => {
    return queries.githubIssues.list(projectId);
  });

  ipcMain.handle('github:refresh-issues', async (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    if (!fs.existsSync(project.path)) {
      throw new Error(
        `Project path no longer exists: ${project.path}. Re-add the repository from a valid path.`,
      );
    }

    const ghCli = new GhCli(project.path);
    const issues = await ghCli.listAllIssues();

    // Upsert all issues into cache. After each upsert, sync external GH
    // state into the local pipeline_status: closed → completed (guarded),
    // reopened → todo (guarded). See `markCompletedOnClose` / `markReopenedOnOpen`
    // for the in-flight guards that keep this race-safe with the pipeline writer.
    for (const issue of issues) {
      const rec = queries.githubIssues.upsert({
        projectId,
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
        assignee: issue.assignee,
        state: issue.state,
      });
      if (rec.state === 'closed') {
        queries.githubIssues.markCompletedOnClose(rec.id);
      } else if (rec.state === 'open') {
        queries.githubIssues.markReopenedOnOpen(rec.id);
        queries.githubIssues.clearArchivedAt(rec.id);
      }

      await attachIssueToConfiguredProjectBoard(
        project,
        ghCli,
        issue.number,
        issue.url,
        'github:refresh-issues',
      );
    }

    const cachedBeforePrSync = queries.githubIssues.list(projectId);
    for (const issue of cachedBeforePrSync) {
      try {
        await syncLinkedPullRequestFeedback(project, issue, queries, notificationService);
      } catch (err) {
        log.warn(`[github:refresh-issues] PR feedback sync failed for #${issue.issueNumber}:`, err);
      }
    }

    const cached = queries.githubIssues.list(projectId);
    mainWindow.webContents.send('github:issues-updated', { projectId, issues: cached });
    return cached;
  });

  ipcMain.handle(
    'github:archive-issue',
    async (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in project ${projectId}`);

      const ghCli = new GhCli(project.path);
      await ghCli.closeIssue(issueNumber);
      try {
        await ghCli.archiveProjectItems(issueNumber);
      } catch (err) {
        log.warn('[github:archive-issue] project board archive failed after GitHub close:', err);
        throw new Error(
          `Issue #${issueNumber} was closed on GitHub but could not be archived from the GitHub project board.`,
        );
      }

      // GitHub close succeeded. DB write is synchronous/local — failures here
      // are rare but would leave GitHub closed and board still showing the
      // issue. Log the inconsistency and surface it so the user can refresh.
      try {
        queries.githubIssues.updatePipelineStatus(issue.id, 'completed');
        queries.githubIssues.archiveIssues([issue.id]);
      } catch (err) {
        log.error('[github:archive-issue] DB archive failed after GitHub close:', err);
        throw new Error(
          `Issue #${issueNumber} was closed on GitHub but could not be hidden locally. Refresh the board to sync.`,
        );
      }

      const cached = queries.githubIssues.list(projectId);
      mainWindow.webContents.send('github:issues-updated', { projectId, issues: cached });
      return { archivedCount: 1 };
    },
  );

  // Close issue on GitHub + mark completed locally, without hiding from the board.
  // Used by "Mark as done" on failed tasks — issue moves to DONE column.
  ipcMain.handle(
    'github:close-issue',
    async (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in project ${projectId}`);

      const ghCli = new GhCli(project.path);
      await ghCli.closeIssue(issueNumber);

      queries.githubIssues.updatePipelineStatus(issue.id, 'completed');

      const cached = queries.githubIssues.list(projectId);
      mainWindow.webContents.send('github:issues-updated', { projectId, issues: cached });
    },
  );

  ipcMain.handle(
    'github:archive-all-done',
    async (_event, { projectId }: { projectId: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      // Snapshot completed, non-archived issues before any async work
      const doneIssues = queries.githubIssues.listCompleted(projectId);

      const ghCli = new GhCli(project.path);
      const succeededIds: string[] = [];
      let failedCount = 0;

      for (const issue of doneIssues) {
        try {
          await ghCli.closeIssue(issue.issueNumber);
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

      const cached = queries.githubIssues.list(projectId);
      mainWindow.webContents.send('github:issues-updated', { projectId, issues: cached });
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

      // Cache the new issue in the database
      queries.githubIssues.upsert({
        projectId,
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
        assignee: issue.assignee,
        state: issue.state,
      });

      // Notify renderer that issues changed
      const allIssues = queries.githubIssues.list(projectId);
      mainWindow.webContents.send('github:issues-updated', { projectId, issues: allIssues });

      // Best-effort: if the project has a Projects v2 board override set,
      // attach the new issue to that board. Failures never block issue
      // creation — the issue is already on GitHub; we surface the failure
      // via `projectAttachWarning` so the modal can show an inline note.
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

      // Re-fetch canonical state from GitHub after the edit so the cache reflects
      // whatever GitHub actually stored (GitHub may trim whitespace, etc.).
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

  // Backfill: walk every cached issue for the project and call
  // `gh project item-add` for each. Idempotent thanks to GhCli's
  // duplicate-detection guard. Returns a structured summary so the UI
  // can render "Attached N, already present M, failed K".
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

      // Idempotency: reject if issue already has an active thread
      if (issue.threadId) {
        const thread = queries.threads.getById(issue.threadId);
        if (thread && !['failed', 'completed', 'idle'].includes(thread.status)) {
          throw new Error(`Issue #${issueNumber} already has active thread`);
        }
      }

      // Concurrency gate: queue the issue if the limit is reached.
      const settings = queries.settings.get();
      const activeCount = pipeline.listActive().length;
      if (activeCount >= settings.maxConcurrentPipelines) {
        queries.githubIssues.updatePipelineStatus(issue.id, 'queued');
        mainWindow.webContents.send('github:issues-updated', {
          projectId,
          issues: queries.githubIssues.list(projectId),
        });
        log.info(
          `[pipeline] queued issue #${issue.issueNumber} (${activeCount}/${settings.maxConcurrentPipelines} slots used)`,
        );
        return;
      }

      // Update status and create thread (single source of thread creation)
      queries.githubIssues.updatePipelineStatus(issue.id, 'planning');
      const thread = queries.threads.create(projectId, issue.body ?? issue.title, issue.title);
      queries.threads.setGithubIssue(thread.id, issue.issueNumber, project.gitRemote);
      queries.githubIssues.linkThread(issue.id, thread.id);
      mainWindow.webContents.send('github:issues-updated', {
        projectId,
        issues: queries.githubIssues.list(projectId),
      });

      // Best-effort: attach the issue to the project's GitHub Projects v2
      // board if one is configured. Same idempotent path that
      // `github:create-issue` uses (see :363-376). Failure is logged but
      // never blocks the pipeline start — the board is a display surface,
      // not a runtime dependency.
      const issueUrl = deriveGithubIssueUrl(project.gitRemote, issue.issueNumber);
      const ghCliForAttach = new GhCli(project.path);
      await attachIssueToConfiguredProjectBoard(
        project,
        ghCliForAttach,
        issue.issueNumber,
        issueUrl,
        'github:start-issue',
      );

      // Start pipeline — pass existing threadId, not projectId
      const phaseModels = resolveIssuePhaseModels(settings, project, issue);
      const effectiveExecutorModel = resolveExecutorModelForIssue(settings, project, issue);
      queries.threads.setPhaseModels(thread.id, {
        ...phaseModels,
        executorModel: effectiveExecutorModel,
      });
      queries.plans.supersedeAllForIssue(projectId, issueNumber, thread.id);

      log.info(
        `[pipeline] starting issue #${issue.issueNumber} "${issue.title}" (thread ${thread.id}, executor: ${effectiveExecutorModel})`,
      );
      try {
        await pipeline.startFromGitHubIssue(
          thread.id,
          project.path,
          { number: issue.issueNumber, title: issue.title, body: issue.body, labels: issue.labels },
          effectiveExecutorModel,
          {
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
        // Rollback
        queries.githubIssues.updatePipelineStatus(issue.id, 'todo');
        queries.threads.updateStatus(thread.id, 'failed');
        mainWindow.webContents.send('github:issues-updated', {
          projectId,
          issues: queries.githubIssues.list(projectId),
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

      // Cancel any active pipeline for this issue's thread
      const threads = queries.threads.list(projectId);
      const thread = threads.find((t: any) => t.githubIssueNumber === issueNumber);
      if (thread && thread.status !== 'idle' && thread.status !== 'completed') {
        pipeline.cancel(thread.id);
        queries.threads.updateStatus(thread.id, 'idle');
      }

      queries.githubIssues.updatePipelineStatus(issue.id, 'todo');
      const allIssues = queries.githubIssues.list(projectId);
      mainWindow.webContents.send('github:issues-updated', { projectId, issues: allIssues });
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
      const allIssues = queries.githubIssues.list(projectId);
      mainWindow.webContents.send('github:issues-updated', { projectId, issues: allIssues });
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
      const allIssues = queries.githubIssues.list(projectId);
      mainWindow.webContents.send('github:issues-updated', { projectId, issues: allIssues });
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
      const allIssues = queries.githubIssues.list(projectId);
      mainWindow.webContents.send('github:issues-updated', { projectId, issues: allIssues });
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
      const allIssues = queries.githubIssues.list(projectId);
      mainWindow.webContents.send('github:issues-updated', { projectId, issues: allIssues });
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  // === Project + base-branch handlers ===

  ipcMain.handle('project:get', (_event, { projectId }: { projectId: string }) => {
    return enrichProjectPath(queries.projects.getById(projectId));
  });

  ipcMain.handle(
    'git:list-branches',
    async (_event, { projectId, fetch }: { projectId: string; fetch?: boolean }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      const git = new GitService(project.path);
      if (fetch) {
        await git.fetch();
      }
      return git.listBranches(project.defaultBranch);
    },
  );

  ipcMain.handle(
    'project:set-default-branch',
    async (_event, { projectId, branch }: { projectId: string; branch: string }) => {
      if (!branch || typeof branch !== 'string') throw new Error('branch is required');
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      // Sanity-check: the branch must appear in the normalized list. This
      // blocks injection of nonexistent refs and any shipcode/* internals
      // that are filtered out of listBranches().
      const git = new GitService(project.path);
      const branches = await git.listBranches(project.defaultBranch);
      if (!branches.includes(branch)) {
        throw new Error(`Branch '${branch}' not found in project ${project.name}`);
      }

      queries.projects.updateDefaultBranch(projectId, branch);
      return enrichProjectPath(queries.projects.getById(projectId))!;
    },
  );

  ipcMain.handle(
    'project:set-github-project-url',
    async (_event, { projectId, url }: { projectId: string; url: string | null }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const result = validateGithubProjectUrl(url);
      if (!result.ok) {
        // Clamp: the validator reason is already short, but we route through
        // clampError to guarantee a single-line <=280 char payload for the
        // renderer toaster, matching the pattern the repo memory calls out.
        log.warn('[ipc] project:set-github-project-url rejected', {
          projectId,
          reason: result.reason,
        });
        throw new Error(clampError(result.reason));
      }

      queries.projects.updateGithubProjectUrl(projectId, result.value);
      return enrichProjectPath(queries.projects.getById(projectId))!;
    },
  );

  ipcMain.handle(
    'project:set-model-overrides',
    async (
      _event,
      {
        projectId,
        overrides,
      }: {
        projectId: string;
        overrides: {
          plannerModelOverride: import('@shipcode/shared').Project['plannerModelOverride'];
          reviewerModelOverride: import('@shipcode/shared').Project['reviewerModelOverride'];
          executorModelOverride: import('@shipcode/shared').Project['executorModelOverride'];
          verifierModelOverride: import('@shipcode/shared').Project['verifierModelOverride'];
          plannerModelIdOverride: import('@shipcode/shared').Project['plannerModelIdOverride'];
          reviewerModelIdOverride: import('@shipcode/shared').Project['reviewerModelIdOverride'];
          executorModelIdOverride: import('@shipcode/shared').Project['executorModelIdOverride'];
          verifierModelIdOverride: import('@shipcode/shared').Project['verifierModelIdOverride'];
          plannerReasoningEffortOverride: import('@shipcode/shared').Project['plannerReasoningEffortOverride'];
          reviewerReasoningEffortOverride: import('@shipcode/shared').Project['reviewerReasoningEffortOverride'];
          executorReasoningEffortOverride: import('@shipcode/shared').Project['executorReasoningEffortOverride'];
          verifierReasoningEffortOverride: import('@shipcode/shared').Project['verifierReasoningEffortOverride'];
        };
      },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      queries.projects.updateModelOverrides(projectId, overrides);
      return enrichProjectPath(queries.projects.getById(projectId))!;
    },
  );

  // === Verification handlers ===
  ipcMain.handle('verification:get', (_event, { threadId }: { threadId: string }) => {
    return queries.verifications.getLatest(threadId);
  });

  // === Pipeline handlers (wired to actual pipeline) ===
  ipcMain.handle('pipeline:start', async (_event, { threadId }: { threadId: string }) => {
    const thread = queries.threads.getById(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const project = queries.projects.getById(thread.projectId);
    if (!project) throw new Error(`Project ${thread.projectId} not found`);
    const settings = queries.settings.get();
    const phaseModels = resolveProjectPhaseModels(settings, project);
    queries.threads.setPhaseModels(threadId, phaseModels);

    // Worktree is created lazily in startExecution; baseBranch must be seeded
    // here so startExecution can resolve which branch to fork from.
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

    queries.plans.supersedeAll(threadId);
    await pipeline.startPlanGeneration(threadId, thread.prompt, project.path, null);
  });

  ipcMain.handle('pipeline:approve', async (_event, { threadId }: { threadId: string }) => {
    // Idempotency guard -- prevent double-click race
    const thread = queries.threads.getById(threadId);
    if (!thread || thread.status !== 'awaiting_approval') return;

    const latestPlan = queries.plans.getLatest(threadId);
    const structured = latestPlan?.structured ?? tryParsePlan(latestPlan?.rawOutput ?? '');
    if (structured) {
      // Persist the parsed plan so future reads don't re-parse
      if (!latestPlan?.structured && latestPlan) {
        queries.plans.updateStructured(latestPlan.id, structured);
      }
      queries.plans.updateStatus(latestPlan!.id, 'approved');

      // Rehydrate in-memory pipeline context from DB if lost (e.g. app restart).
      // Fetch issue title from cache for worktree branch naming.
      const project = queries.projects.getById(thread.projectId);
      if (project) {
        const issue = thread.githubIssueNumber
          ? queries.githubIssues.getByNumber(project.id, thread.githubIssueNumber)
          : null;
        pipeline.rehydrateContext(threadId, project.path, issue?.title);
      }

      await pipeline.startExecution(threadId, structured);
    } else {
      mainWindow.webContents.send('pipeline:phase', { threadId, phase: 'failed' });
    }
  });

  ipcMain.handle(
    'pipeline:reject',
    async (_event, { threadId, feedback }: { threadId: string; feedback: string }) => {
      const thread = queries.threads.getById(threadId);
      if (!thread) return;

      const project = queries.projects.getById(thread.projectId);
      if (!project) return;

      // Rehydrate in-memory pipeline context if lost (e.g. app restart)
      const issue = thread.githubIssueNumber
        ? queries.githubIssues.getByNumber(project.id, thread.githubIssueNumber)
        : null;
      pipeline.rehydrateContext(threadId, project.path, issue?.title);

      // Supersede old plans and restart planning with feedback
      queries.plans.supersedeAll(threadId);
      const revisedPrompt = `${thread.prompt}\n\nFeedback from review:\n${feedback}`;
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

    const latestPlan = queries.plans.getLatest(threadId);
    const structured = latestPlan?.structured ?? tryParsePlan(latestPlan?.rawOutput ?? '');
    if (structured) {
      if (!latestPlan?.structured && latestPlan) {
        queries.plans.updateStructured(latestPlan.id, structured);
      }
      if (thread.worktreePath) {
        await pipeline.startExecution(threadId, structured);
      } else {
        if (latestPlan) queries.plans.updateStatus(latestPlan.id, 'pending_review');
        await pipeline.startReview(threadId, structured);
      }
      return;
    }

    queries.plans.supersedeAll(threadId);
    await pipeline.startPlanGeneration(threadId, thread.prompt, project.path, thread.worktreePath);
  });

  ipcMain.handle('pipeline:skip-review', async (_event, { threadId }: { threadId: string }) => {
    queries.threads.updateStatus(threadId, 'awaiting_approval');
    mainWindow.webContents.send('pipeline:phase', { threadId, phase: 'awaiting_approval' });
  });

  // === Mission Control / Dashboard handlers ===
  ipcMain.handle('pipeline:list-active', (): ActivePipelineSummary[] => {
    const summaries = pipeline.listActive();
    return summaries.map((s) => {
      const thread = queries.threads.getById(s.threadId);
      const project = thread ? queries.projects.getById(thread.projectId) : null;
      return {
        threadId: s.threadId,
        projectId: thread?.projectId ?? '',
        projectName: project?.name ?? 'Unknown project',
        threadTitle: thread?.title ?? s.threadId,
        phase: s.phase,
        startedAt: s.startedAt,
        activeProcessId: s.activeProcessId,
      };
    });
  });

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

  // === Cost tracking ===
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

  // === Skills (per-phase prompt overrides) ===
  // The /skills page is the user's editing surface for the five phase prompts
  // (planner, reviewer, reviser, executor, verifier). Edits land in the
  // skills DB table; reads walk project → global → bundled-default. Validation
  // runs both here (server-side) and in the renderer to give early feedback.
  //
  // The bundled DEFAULT_SKILLS object lives in @shipcode/agents — the desktop
  // adapter is the only place that pulls both halves together.

  function buildSkillRow(phase: PhaseSkillKey, projectId: string | null) {
    const bundled = DEFAULT_SKILLS[phase];
    const row = queries.skills.get(projectId, phase);
    if (!row) {
      return {
        phase,
        projectId,
        source: 'default' as const,
        content: bundled.content,
        baseVersion: bundled.version,
        schemaVersion: bundled.schemaVersion,
        bundledVersion: bundled.version,
        bundledSchemaVersion: bundled.schemaVersion,
        requiredSlots: bundled.requiredSlots,
        status: 'ok' as const,
        statusReason: null,
        updatedAt: null,
      };
    }
    return {
      phase,
      projectId: row.projectId,
      source: row.projectId === null ? ('global' as const) : ('project' as const),
      content: row.content,
      baseVersion: row.baseVersion,
      schemaVersion: row.schemaVersion,
      bundledVersion: bundled.version,
      bundledSchemaVersion: bundled.schemaVersion,
      requiredSlots: bundled.requiredSlots,
      status: row.status,
      statusReason: row.statusReason,
      updatedAt: row.updatedAt,
    };
  }

  // Returns one row per (phase, scope-tier) so the /skills view can show the
  // resolution chain. Each phase contributes either:
  //   - 1 entry (when no override exists at the requested scope)
  //   - 2 entries (project + global), or
  //   - 1 entry that explains it is the bundled default.
  // The renderer picks the first non-default tier and presents it in the
  // editor; the rest are surfaced as "fall-through" badges.
  ipcMain.handle('skills:list-for-view', (_event, { projectId }: { projectId: string | null }) => {
    return PHASE_SKILL_KEYS.map((phase) => {
      const projectRow = projectId !== null ? buildSkillRow(phase, projectId) : null;
      const globalRow = buildSkillRow(phase, null);
      return {
        phase,
        requiredSlots: DEFAULT_SKILLS[phase].requiredSlots,
        bundledVersion: DEFAULT_SKILLS[phase].version,
        bundledSchemaVersion: DEFAULT_SKILLS[phase].schemaVersion,
        projectRow,
        globalRow,
        // The "active" row is what the resolver would actually use right now.
        active:
          projectRow && projectRow.source !== 'default' && projectRow.status === 'ok'
            ? projectRow
            : globalRow,
      };
    });
  });

  ipcMain.handle(
    'skills:read',
    (_event, { projectId, phase }: { projectId: string | null; phase: PhaseSkillKey }) => {
      return buildSkillRow(phase, projectId);
    },
  );

  ipcMain.handle(
    'skills:write',
    (
      _event,
      {
        projectId,
        phase,
        content,
      }: { projectId: string | null; phase: PhaseSkillKey; content: string },
    ) => {
      // Server-side validation. The renderer pre-validates for early feedback,
      // but we re-validate here so the contract holds even when the renderer
      // is bypassed (e.g. tests, or a bug in client validation).
      const error = validateSkill(phase, content);
      if (error) {
        return { ok: false as const, error };
      }
      const bundled = DEFAULT_SKILLS[phase];
      queries.skills.set(projectId, phase, content, bundled.version, bundled.schemaVersion);
      return { ok: true as const, row: buildSkillRow(phase, projectId) };
    },
  );

  ipcMain.handle(
    'skills:reset',
    (_event, { projectId, phase }: { projectId: string | null; phase: PhaseSkillKey }) => {
      queries.skills.delete(projectId, phase);
      return buildSkillRow(phase, projectId);
    },
  );

  ipcMain.handle('skills:list-quarantined', () => {
    return queries.skills.listQuarantined().map((row) => ({
      phase: row.phase,
      projectId: row.projectId,
      statusReason: row.statusReason,
      updatedAt: row.updatedAt,
    }));
  });

  // === Notification handlers ===
  ipcMain.handle('notification:list', () => {
    return notificationService.listActive();
  });

  ipcMain.handle('notification:dismiss', (_event, { id }: { id: string }) => {
    notificationService.dismiss(id);
  });

  ipcMain.handle('notification:dismiss-all', () => {
    notificationService.dismissAll();
  });

  // === Onboarding handlers ===
  ipcMain.handle('onboarding:check-auth', async () => {
    const [health, ghAuth] = await Promise.all([checkSystemHealthWithAuth(), checkGhAuth()]);
    return { ...health, ghAuth };
  });

  ipcMain.handle('onboarding:list-repos', async () => {
    try {
      const { stdout } = await execAsync(
        "gh api 'user/repos?per_page=100&affiliation=owner,collaborator,organization_member' --paginate --jq '.[] | [.full_name, (.private | tostring)] | join(\":\")'",
        { timeout: 20_000 },
      );

      const seen = new Set<string>();
      const repos: { name: string; private: boolean }[] = [];
      for (const line of stdout.trim().split('\n').filter(Boolean)) {
        const lastColon = line.lastIndexOf(':');
        const name = line.slice(0, lastColon);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        repos.push({ name, private: line.slice(lastColon + 1) === 'true' });
      }
      return repos.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  });

  // === AI-assisted PRD enhancement (in-place refinement) ===
  ipcMain.handle(
    'ai:enhance-prd',
    async (_event, { projectId, draftBody }: { projectId: string; draftBody: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      // Load the repo's writing-prds skill. Preferred location is
      // .agents/skills/writing-prds/SKILL.md inside the target project. If the
      // project doesn't have one, fall back to a minimal inline instruction so
      // enhancement still works — but the result will be less repo-tailored.
      const skillPath = path.join(project.path, '.agents', 'skills', 'writing-prds', 'SKILL.md');
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

      // enhancePrdDraft only accepts 'claude' | 'codex'. AppSettings.plannerModel
      // widened to AgentType in Tier 1 (claude | codex | gh | openrouter), so
      // when the user picks 'openrouter' or 'gh' we fall back to 'claude' rather
      // than double-casting an unsupported value through the type system.
      const settings = queries.settings.get();
      const plannerModel: 'claude' | 'codex' =
        settings.plannerModel === 'codex' ? 'codex' : 'claude';

      try {
        return await enhancePrdDraft({
          draftBody: draftBody ?? '',
          skillContent,
          plannerModel,
          cwd: project.path,
        });
      } catch (err) {
        // Full trace stays in main-process stdout for devtools/console debugging.
        log.error('[ai:enhance-prd]', err);
        // Short, prompt-free message crosses the IPC boundary to the renderer.
        const short =
          err instanceof Error ? err.message.split('\n')[0].slice(0, 300) : 'Enhancement failed';
        throw new Error(short);
      }
    },
  );

  // === Repo context files ===
  ipcMain.handle('context:list', (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    return listContextFiles(project.path);
  });

  ipcMain.handle(
    'context:generate',
    async (_event, { projectId, cli }: { projectId: string; cli: 'claude' | 'codex' }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      try {
        const result = await generateContextFiles(project.path, cli);
        return { success: result.success, error: result.error };
      } catch (err) {
        log.error('[context:generate]', err);
        const short =
          err instanceof Error ? err.message.split('\n')[0].slice(0, 300) : 'Generation failed';
        return { success: false, error: short };
      }
    },
  );

  ipcMain.handle(
    'context:read',
    (_event, { projectId, name }: { projectId: string; name: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      return { content: readContextFile(project.path, name) };
    },
  );

  // === CLI normalizer registry (Claude/Codex NDJSON → canonical TerminalEvents) ===
  const normalizers = new Map<string, ClaudeNormalizer | CodexNormalizer>();

  function emitTerminalEvent(threadId: string, event: TerminalEvent) {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    try {
      mainWindow.webContents.send('terminal:event', { threadId, event });
    } catch {
      // webContents destroyed between check and send
    }
  }

  function ensureNormalizer(processId: string, type: string, threadId: string) {
    if (normalizers.has(processId)) return;
    const onEvent = (event: TerminalEvent) => emitTerminalEvent(threadId, event);
    if (type === 'claude') {
      normalizers.set(processId, new ClaudeNormalizer(onEvent));
    } else if (type === 'codex') {
      normalizers.set(processId, new CodexNormalizer(onEvent));
    }
  }

  // === Agent output forwarding to renderer ===
  processManager.on('output', (processId: string, data: string) => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    const proc = processManager.get(processId);

    // Feed raw output into the normalizer (if one exists for this process type)
    if (proc?.threadId) {
      ensureNormalizer(processId, proc.type, proc.threadId);
      const normalizer = normalizers.get(processId);
      normalizer?.feed(data);
    }

    // Mirror raw output to app log
    logProcessOutput(proc?.type ?? 'unknown', data);

    try {
      mainWindow.webContents.send('agent:output', {
        processId,
        chunk: data,
        threadId: proc?.threadId,
      });
    } catch {
      // webContents destroyed between check and send — safe to ignore
    }
  });

  processManager.on('stateChange', (processId: string, type: string, state: string) => {
    if (state === 'exited') {
      normalizers.delete(processId);
    }
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    if (state === 'running' || state === 'exited') {
      log.info(`[process:${type}] ${processId} → ${state}`);
    }
    const proc = processManager.get(processId);
    try {
      mainWindow.webContents.send('agent:state', {
        processId,
        type,
        state,
        threadId: proc?.threadId,
      });
    } catch {
      // webContents destroyed between check and send — safe to ignore
    }
  });
}
