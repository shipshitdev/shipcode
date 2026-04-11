import { type IpcMain, type BrowserWindow, dialog, shell } from 'electron';
import type {
  ProjectQueries,
  ThreadQueries,
  PlanQueries,
  ReviewQueries,
  DiffQueries,
  SettingsQueries,
  VerificationQueries,
  GitHubIssueQueries,
  ActivityQueries,
  NotificationsQueries,
  DashboardQueries,
  CostsQueries,
  SkillsQueries,
} from '@shipcode/db';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import type { ProcessManager, PhaseSkillKey } from '@shipcode/agents';
import {
  checkSystemHealthWithAuth,
  checkGhAuth,
  GhCli,
  enhancePrdDraft,
  validateSkill,
  DEFAULT_SKILLS,
  PHASE_SKILL_KEYS,
} from '@shipcode/agents';
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
  activity: ActivityQueries;
  notifications: NotificationsQueries;
  dashboard: DashboardQueries;
  costs: CostsQueries;
  skills: SkillsQueries;
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
    console.log(`[startup] reset orphaned thread ${thread.id} → failed`);
  }

  // === Project handlers ===
  // `project:list` returns the full registry (including archived projects).
  // The sidebar uses `project:list-visible` for the filtered list; Titlebar,
  // IssueDetail, and ThreadPanel continue to use `project:list` so they can
  // resolve archived projects that are still navigable via deep links.
  ipcMain.handle('project:list', () => {
    return queries.projects.list();
  });

  ipcMain.handle('project:list-visible', () => {
    return queries.projects.listVisible();
  });

  ipcMain.handle('project:list-archived', () => {
    return queries.projects.listArchived();
  });

  ipcMain.handle('project:add', async (_event, { path: projectPath }: { path: string }) => {
    const project = queries.projects.add(projectPath);

    // Detect git info
    try {
      const git = new GitService(projectPath);
      const remote = await git.getRemoteUrl();
      const branch = await git.getDefaultBranch();
      queries.projects.updateGitInfo(project.id, remote, branch);
      return { ...project, gitRemote: remote, defaultBranch: branch };
    } catch {
      return project;
    }
  });

  ipcMain.handle('project:remove', async (_event, { projectId }: { projectId: string }) => {
    // Fast pre-check: bail early without running slow worktree cleanup if the
    // project clearly has active work. The final safety guarantee comes from
    // `removeIfIdle()`'s atomic DELETE below.
    if (queries.projects.hasLiveWork(projectId)) {
      throw new Error(
        'Cannot remove a project with active work. Stop running pipelines and dismiss notifications first.',
      );
    }

    // Worktree cleanup — fail closed on errors. The previous implementation
    // silently swallowed cleanup failures and deleted the project row anyway,
    // leaving orphaned worktrees on disk with no registry entry to recover
    // them. Now we collect real failures and throw before any DB mutation.
    const project = queries.projects.getById(projectId);
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
    const removed = queries.projects.removeIfIdle(projectId);
    if (!removed) {
      throw new Error(
        'New work appeared during cleanup. Project not removed. Retry after stopping pipelines.',
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
    const archived = queries.projects.archiveIfIdle(projectId);
    if (!archived) {
      throw new Error(
        'Cannot archive a project with active work. Stop running pipelines and dismiss notifications first.',
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

  // === Plan handlers ===
  ipcMain.handle('plan:get', (_event, { threadId }: { threadId: string }) => {
    return queries.plans.getLatest(threadId);
  });

  ipcMain.handle('plan:list', (_event, { threadId }: { threadId: string }) => {
    return queries.plans.list(threadId);
  });

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

    const ghCli = new GhCli(project.path);
    const issues = await ghCli.listAllIssues();

    // Upsert all issues into cache
    for (const issue of issues) {
      queries.githubIssues.upsert({
        projectId,
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
        assignee: issue.assignee,
        state: issue.state,
      });
    }

    const cached = queries.githubIssues.list(projectId);
    mainWindow.webContents.send('github:issues-updated', { projectId, issues: cached });
    return cached;
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

      return queries.githubIssues.getByNumber(projectId, issue.number);
    },
  );

  ipcMain.handle(
    'github:edit-issue-body',
    async (
      _event,
      { projectId, issueNumber, body }: { projectId: string; issueNumber: number; body: string },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const ghCli = new GhCli(project.path);
      await ghCli.editIssueBody(issueNumber, body);

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
        if (thread && !['failed', 'completed'].includes(thread.status)) {
          throw new Error(`Issue #${issueNumber} already has active thread`);
        }
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

      // Start pipeline — pass existing threadId, not projectId
      console.log(
        `[pipeline] starting issue #${issue.issueNumber} "${issue.title}" (thread ${thread.id}, executor: ${issue.executorModel})`,
      );
      try {
        await pipeline.startFromGitHubIssue(
          thread.id,
          project.path,
          { number: issue.issueNumber, title: issue.title, body: issue.body, labels: issue.labels },
          issue.executorModel,
          { baseBranch: project.defaultBranch },
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

      queries.githubIssues.updatePipelineStatus(issue.id, 'todo');
      const allIssues = queries.githubIssues.list(projectId);
      mainWindow.webContents.send('github:issues-updated', { projectId, issues: allIssues });
    },
  );

  ipcMain.handle(
    'github:set-executor',
    (
      _event,
      {
        projectId,
        issueNumber,
        model,
      }: { projectId: string; issueNumber: number; model: ExecutorModel },
    ) => {
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      // Widened from claude|codex only after Tier 1 added the OpenRouter
      // HTTP provider. Keep the explicit runtime whitelist so unknown
      // values still fail loud — we don't want the renderer to smuggle
      // arbitrary strings past the type system.
      if (model !== 'claude' && model !== 'codex' && model !== 'openrouter') {
        throw new Error(`Invalid executor model: ${model}`);
      }

      queries.githubIssues.updateExecutorModel(issue.id, model);
      const allIssues = queries.githubIssues.list(projectId);
      mainWindow.webContents.send('github:issues-updated', { projectId, issues: allIssues });
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  // === Project + base-branch handlers ===

  ipcMain.handle('project:get', (_event, { projectId }: { projectId: string }) => {
    return queries.projects.getById(projectId);
  });

  ipcMain.handle('git:list-branches', async (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    const git = new GitService(project.path);
    return git.listBranches(project.defaultBranch);
  });

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
      return queries.projects.getById(projectId)!;
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

    // Worktree is created lazily in startExecution; baseBranch must be seeded
    // here so startExecution can resolve which branch to fork from.
    pipeline.initializeContext(threadId, {
      projectPath: project.path,
      worktreePath: null,
      baseBranch: project.defaultBranch,
    });

    await pipeline.startPlanGeneration(threadId, thread.prompt, project.path, null);
  });

  ipcMain.handle('pipeline:approve', async (_event, { threadId }: { threadId: string }) => {
    const latestPlan = queries.plans.getLatest(threadId);
    if (latestPlan?.structured) {
      queries.plans.updateStatus(latestPlan.id, 'approved');
      await pipeline.startExecution(threadId, latestPlan.structured);
    } else {
      // No structured plan — just mark as executing anyway
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

  ipcMain.handle('pipeline:cancel', (_event, { threadId }: { threadId: string }) => {
    pipeline.cancel(threadId);
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
  ipcMain.handle(
    'skills:list-for-view',
    (_event, { projectId }: { projectId: string | null }) => {
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
    },
  );

  ipcMain.handle(
    'skills:read',
    (
      _event,
      { projectId, phase }: { projectId: string | null; phase: PhaseSkillKey },
    ) => {
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
    (
      _event,
      { projectId, phase }: { projectId: string | null; phase: PhaseSkillKey },
    ) => {
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
        console.error('[ai:enhance-prd]', err);
        // Short, prompt-free message crosses the IPC boundary to the renderer.
        const short =
          err instanceof Error ? err.message.split('\n')[0].slice(0, 300) : 'Enhancement failed';
        throw new Error(short);
      }
    },
  );

  // === Agent output forwarding to renderer ===
  processManager.on('output', (processId: string, data: string) => {
    if (mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('agent:output', { processId, chunk: data });
  });

  processManager.on('stateChange', (processId: string, type: string, state: string) => {
    if (state === 'running' || state === 'exited') {
      console.log(`[process:${type}] ${processId} → ${state}`);
    }
    if (mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('agent:state', { processId, type, state });
  });
}
