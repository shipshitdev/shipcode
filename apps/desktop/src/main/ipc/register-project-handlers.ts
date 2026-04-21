import { exec } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import {
  checkCliProviderUsage,
  checkDesktopApps,
  checkIntegrationStatus,
  checkSystemHealthWithAuth,
  detectProjectSetup,
  GhCli,
  inspectProjectSetup,
  validateOpenRouterModel,
  writeProjectSetup,
} from '@shipcode/agents';
import { GitService, WorktreeManager } from '@shipcode/git';
import type {
  AppSettings,
  DesktopAppHealthMap,
  OnboardingRepo,
  ProjectOpenTarget,
  ShipCodePlan,
} from '@shipcode/shared';
import { clampError, parseGithubRemote, validateGithubProjectUrl } from '@shipcode/shared';
import { dialog, shell } from 'electron';
import log from '../logger.service';
import { isSafeExternalUrl } from '../security';
import { enrichProjectPath, enrichProjectPaths, sendGithubIssuesUpdated } from './helpers';
import type { IpcHandlerDeps } from './types';

const execAsync = promisify(exec);
const PROJECT_OPEN_TARGET_ORDER: ProjectOpenTarget[] = [
  'cursor',
  'finder',
  'terminal',
  'ghostty',
  'vscode',
];

const PROJECT_OPEN_APP_NAMES: Record<ProjectOpenTarget, string> = {
  cursor: 'Cursor',
  finder: 'Finder',
  terminal: 'Terminal',
  ghostty: 'Ghostty',
  vscode: 'Visual Studio Code',
};

const STARTER_ISSUE_TITLE = 'Ship your first change with ShipCode';

function buildStarterIssueBody(repoFullName: string): string {
  return [
    `## Objective`,
    `Run ShipCode end-to-end on \`${repoFullName}\` with one tiny, safe change.`,
    '',
    `## Task`,
    `Choose one low-risk improvement in this repository and ship it through the full loop: plan, execute, verify, and open a PR.`,
    '',
    `Good starter scopes:`,
    `- add or improve a tooltip, empty state, or button label`,
    `- fix a typo or tighten a README / docs section`,
    `- add a tiny guardrail or validation for an obvious edge case`,
    '',
    `## Acceptance Criteria`,
    `- keep the change intentionally small`,
    `- avoid architecture work, dependency upgrades, or broad refactors`,
    `- preserve existing behavior except for the targeted improvement`,
    `- pass the repo's existing verify/test/typecheck flow`,
    `- open a PR with a concise explanation of the change`,
    '',
    `## Constraints`,
    `- prefer the smallest diff that still demonstrates the ShipCode workflow`,
    `- if there is any uncertainty, bias toward docs or UI copy over code-heavy work`,
  ].join('\n');
}

async function resolveGithubRepoIdentity(
  projectPath: string,
  gitRemote: string | null,
  repoArg?: Pick<OnboardingRepo, 'id' | 'name'> | null,
): Promise<{ githubRepoId: string; githubRepoFullName: string } | null> {
  if (repoArg?.id && repoArg?.name) {
    return { githubRepoId: repoArg.id, githubRepoFullName: repoArg.name };
  }
  if (!parseGithubRemote(gitRemote)) return null;
  try {
    const ghCli = new GhCli(projectPath);
    return await ghCli.getRepoMetadata();
  } catch (error) {
    log.warn('[project:add] failed to resolve GitHub repo metadata:', error);
    return null;
  }
}

async function ensureStarterIssue({
  mainWindow,
  queries,
  projectId,
}: {
  mainWindow: import('electron').BrowserWindow;
  queries: IpcHandlerDeps['queries'];
  projectId: string;
}): Promise<void> {
  const project = queries.projects.getById(projectId);
  if (!project?.githubRepoFullName || project.starterIssueCreatedAt) return;

  const existingProject = queries.projects.getByGithubRepoIdentity(
    project.githubRepoId,
    project.githubRepoFullName,
  );
  if (
    existingProject &&
    existingProject.id !== projectId &&
    existingProject.starterIssueCreatedAt
  ) {
    queries.projects.markStarterIssueSeeded(projectId, {
      starterIssueNumber: existingProject.starterIssueNumber,
      starterIssueCreatedAt: existingProject.starterIssueCreatedAt,
    });
    return;
  }

  try {
    const ghCli = new GhCli(project.path);
    const issue = await ghCli.createIssue({
      title: STARTER_ISSUE_TITLE,
      body: buildStarterIssueBody(project.githubRepoFullName),
      labels: [],
    });

    queries.githubIssues.upsert({
      projectId: project.id,
      issueNumber: issue.number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      assignee: issue.assignee,
      state: issue.state,
    });
    queries.projects.markStarterIssueSeeded(project.id, {
      starterIssueNumber: issue.number,
      starterIssueCreatedAt: new Date().toISOString(),
    });
    sendGithubIssuesUpdated(mainWindow, queries, project.id);
  } catch (error) {
    log.warn('[project:add] failed to seed starter issue:', error);
  }
}

function resolveProjectOpenTarget(
  settings: AppSettings,
  desktopApps: DesktopAppHealthMap,
  requested: ProjectOpenTarget | 'default',
): ProjectOpenTarget {
  if (requested !== 'default') {
    return requested;
  }

  if (desktopApps[settings.projectOpenTarget].available) {
    return settings.projectOpenTarget;
  }

  const fallback = PROJECT_OPEN_TARGET_ORDER.find((target) => desktopApps[target].available);
  if (!fallback) {
    throw new Error('No supported project opener app is available');
  }
  return fallback;
}

async function openProjectPath(projectPath: string, target: ProjectOpenTarget): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Project opener actions are currently supported on macOS only');
  }

  if (target === 'finder') {
    const openError = await shell.openPath(projectPath);
    if (openError) throw new Error(openError);
    return;
  }

  const appName = PROJECT_OPEN_APP_NAMES[target];
  await execAsync(
    `open -a "${appName.replace(/"/g, '\\"')}" "${projectPath.replace(/"/g, '\\"')}"`,
    {
      timeout: 10_000,
    },
  );
}

export function registerProjectHandlers({
  ipcMain,
  mainWindow,
  queries,
  pipeline,
  chatNotificationService,
}: IpcHandlerDeps): void {
  ipcMain.handle('project:list', () => {
    return enrichProjectPaths(queries.projects.list());
  });

  ipcMain.handle('project:list-visible', () => {
    return enrichProjectPaths(queries.projects.listVisible());
  });

  ipcMain.handle('project:list-archived', () => {
    return enrichProjectPaths(queries.projects.listArchived());
  });

  ipcMain.handle(
    'project:add',
    async (
      _event,
      {
        path: projectPath,
        repo,
      }: {
        path: string;
        repo?: Pick<OnboardingRepo, 'id' | 'name'> | null;
      },
    ) => {
      const project = queries.projects.add(projectPath, {
        githubRepoId: repo?.id ?? null,
        githubRepoFullName: repo?.name ?? null,
      });

      try {
        const git = new GitService(projectPath);
        const remote = await git.getRemoteUrl();
        const branch = await git.getDefaultBranch();
        queries.projects.updateGitInfo(project.id, remote, branch);

        const repoIdentity = await resolveGithubRepoIdentity(projectPath, remote, repo);
        if (repoIdentity) {
          queries.projects.updateGithubRepoIdentity(project.id, repoIdentity);
          await ensureStarterIssue({ mainWindow, queries, projectId: project.id });
        }

        return enrichProjectPath(queries.projects.getById(project.id));
      } catch {
        return enrichProjectPath(queries.projects.getById(project.id));
      }
    },
  );

  ipcMain.handle(
    'project:detect-setup',
    async (_event, { projectId, path: projectPath }: { projectId?: string; path?: string }) => {
      const resolvedPath =
        projectPath ?? (projectId ? queries.projects.getById(projectId)?.path : null) ?? null;
      if (!resolvedPath) {
        throw new Error('Project path not found for setup detection');
      }
      return detectProjectSetup(resolvedPath);
    },
  );

  ipcMain.handle('project:get-setup', async (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    return detectProjectSetup(project.path);
  });

  ipcMain.handle(
    'project:save-setup',
    async (
      _event,
      {
        projectId,
        contract,
      }: {
        projectId: string;
        contract: import('@shipcode/shared').RepoSetupContract;
      },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      const saved = writeProjectSetup(project.path, contract);
      return inspectProjectSetup(project.path) ?? saved;
    },
  );

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
        // Preserve the new path even if git metadata refresh fails.
      }

      return enrichProjectPath(queries.projects.getById(projectId));
    },
  );

  ipcMain.handle('project:remove', async (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    const ignoreAttentionOnly = project ? !fs.existsSync(project.path) : false;

    if (queries.projects.hasLiveWork(projectId, { ignoreAttentionOnly })) {
      throw new Error(
        ignoreAttentionOnly
          ? 'Cannot remove this missing project while a pipeline is still active. Stop running pipelines first.'
          : 'Cannot remove a project with active work. Stop running pipelines and dismiss notifications first.',
      );
    }

    if (project) {
      const appSettings = queries.settings.get();
      const worktreeManager = new WorktreeManager(project.path, {
        worktreeRoot: appSettings.worktreeRoot,
      });
      const threads = queries.threads.list(projectId);
      const failures: string[] = [];
      for (const thread of threads) {
        if (thread.worktreePath && thread.worktreeBranch) {
          const result = await worktreeManager.remove(thread.worktreePath, thread.worktreeBranch);
          if (result.error) {
            failures.push(`${thread.worktreePath}: ${result.error}`);
          }
        }
      }
      if (failures.length > 0) {
        throw new Error(
          `Failed to clean up ${failures.length} worktree(s). Project not removed:\n${failures.join('\n')}`,
        );
      }
    }

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

  ipcMain.handle('project:archive', async (_event, { projectId }: { projectId: string }) => {
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

  ipcMain.handle('thread:list', (_event, { projectId }: { projectId: string }) => {
    return queries.threads.list(projectId);
  });

  ipcMain.handle('thread-panel:get-data', async (_event, { projectId }: { projectId: string }) => {
    const project = enrichProjectPath(queries.projects.getById(projectId));
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const git = new GitService(project.path);

    return {
      project,
      settings: queries.settings.get(),
      threads: queries.threads.list(projectId),
      branches: await git.listBranches(project.defaultBranch),
    };
  });

  ipcMain.handle(
    'thread:create',
    (_event, { projectId, prompt }: { projectId: string; prompt: string }) => {
      const title = prompt.length > 60 ? `${prompt.substring(0, 60)}...` : prompt;
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
        if (!queries.githubIssues.resetToTodo(issue.id)) {
          queries.githubIssues.reconcileCompletedFromEvidence(issue.id);
        }
        mainWindow.webContents.send('github:issues-updated', {
          projectId: issue.projectId,
          issues: queries.githubIssues.list(issue.projectId),
        });
      }

      mainWindow.webContents.send('pipeline:phase', { threadId, phase: 'idle' });
      return { restored: true as const, checkpoint };
    },
  );

  ipcMain.handle('plan:get', (_event, { threadId }: { threadId: string }) => {
    return queries.plans.getLatest(threadId);
  });

  ipcMain.handle('plan:get-by-id', (_event, { planId }: { planId: string }) => {
    return queries.plans.getById(planId);
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
    (_event, { planId, structured }: { planId: string; structured: ShipCodePlan }) => {
      queries.plans.updateStructured(planId, structured);
    },
  );

  ipcMain.handle('review:get', (_event, { planId }: { planId: string }) => {
    return queries.reviews.getByPlanId(planId);
  });

  ipcMain.handle('review:list-by-plans', (_event, { planIds }: { planIds: string[] }) => {
    return queries.reviews.listByPlanIds(planIds);
  });

  ipcMain.handle('diff:list', (_event, { threadId }: { threadId: string }) => {
    return queries.diffs.list(threadId);
  });

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

  ipcMain.handle('settings:get', () => {
    return queries.settings.get();
  });

  ipcMain.handle('settings:set', (_event, patch: Partial<AppSettings>) => {
    queries.settings.set(patch);
  });

  ipcMain.handle('health:check', async (_event, { force = false }: { force?: boolean } = {}) => {
    return checkSystemHealthWithAuth({ force });
  });

  ipcMain.handle(
    'provider-usage:check',
    async (_event, { force = false }: { force?: boolean } = {}) => {
      return checkCliProviderUsage({ force });
    },
  );

  ipcMain.handle(
    'integrations:check',
    async (_event, { force = false }: { force?: boolean } = {}) => {
      return checkIntegrationStatus(queries.settings.get(), { force });
    },
  );

  ipcMain.handle(
    'integrations:validate-openrouter-model',
    async (_event, { modelId }: { modelId: string }) => {
      return validateOpenRouterModel(queries.settings.get(), modelId);
    },
  );

  ipcMain.handle('dialog:open-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle('shell:open-external', async (_event, { url }: { url: string }) => {
    const validated = isSafeExternalUrl(url);
    if (!validated.ok) return;
    await shell.openExternal(validated.href);
  });

  ipcMain.handle('project:get', (_event, { projectId }: { projectId: string }) => {
    return enrichProjectPath(queries.projects.getById(projectId));
  });

  ipcMain.handle(
    'project:open-path',
    async (
      _event,
      { projectId, target }: { projectId: string; target: ProjectOpenTarget | 'default' },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      if (!fs.existsSync(project.path)) {
        throw new Error(`Project folder does not exist: ${project.path}`);
      }

      const desktopApps = await checkDesktopApps();
      const resolvedTarget = resolveProjectOpenTarget(queries.settings.get(), desktopApps, target);
      const app = desktopApps[resolvedTarget];
      if (!app.available) {
        throw new Error(app.error ?? `${app.label} is not available`);
      }

      await openProjectPath(project.path, resolvedTarget);
    },
  );

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
    'integrations:test-chat',
    async (
      _event,
      { provider, projectId }: { provider: 'discord' | 'telegram'; projectId?: string | null },
    ) => {
      return chatNotificationService.sendTest(provider, projectId ?? null);
    },
  );

  ipcMain.handle(
    'project:set-default-branch',
    async (_event, { projectId, branch }: { projectId: string; branch: string }) => {
      if (!branch || typeof branch !== 'string') throw new Error('branch is required');
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const git = new GitService(project.path);
      const branches = await git.listBranches(project.defaultBranch);
      if (!branches.includes(branch)) {
        throw new Error(`Branch '${branch}' not found in project ${project.name}`);
      }

      queries.projects.updateDefaultBranch(projectId, branch);
      const updated = enrichProjectPath(queries.projects.getById(projectId));
      if (!updated) throw new Error(`Project ${projectId} not found after default branch update`);
      return updated;
    },
  );

  ipcMain.handle(
    'project:set-github-project-url',
    async (_event, { projectId, url }: { projectId: string; url: string | null }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const result = validateGithubProjectUrl(url);
      if (!result.ok) {
        log.warn('[ipc] project:set-github-project-url rejected', {
          projectId,
          reason: result.reason,
        });
        throw new Error(clampError(result.reason));
      }

      queries.projects.updateGithubProjectUrl(projectId, result.value);
      const updated = enrichProjectPath(queries.projects.getById(projectId));
      if (!updated) throw new Error(`Project ${projectId} not found after GitHub URL update`);
      return updated;
    },
  );

  ipcMain.handle(
    'project:set-notification-routing',
    async (
      _event,
      {
        projectId,
        routing,
      }: {
        projectId: string;
        routing: {
          discordRouting: import('@shipcode/shared').Project['discordRouting'];
          discordWebhookUrlOverride: import('@shipcode/shared').Project['discordWebhookUrlOverride'];
          telegramRouting: import('@shipcode/shared').Project['telegramRouting'];
          telegramChatIdOverride: import('@shipcode/shared').Project['telegramChatIdOverride'];
        };
      },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      queries.projects.updateNotificationRouting(projectId, routing);
      const updated = enrichProjectPath(queries.projects.getById(projectId));
      if (!updated) {
        throw new Error(`Project ${projectId} not found after notification routing update`);
      }
      return updated;
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
          revisionCountOverride: import('@shipcode/shared').Project['revisionCountOverride'];
          requireApprovalOverride: import('@shipcode/shared').Project['requireApprovalOverride'];
          prdQualityGate: import('@shipcode/shared').Project['prdQualityGate'];
        };
      },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      queries.projects.updateModelOverrides(projectId, overrides);
      const updated = enrichProjectPath(queries.projects.getById(projectId));
      if (!updated) throw new Error(`Project ${projectId} not found after model override update`);
      return updated;
    },
  );

  ipcMain.handle(
    'project:set-notify-github-user',
    (_event, { projectId, handle }: { projectId: string; handle: string | null }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      queries.projects.updateNotifyGithubUser(projectId, handle);
      const updated = enrichProjectPath(queries.projects.getById(projectId));
      if (!updated)
        throw new Error(`Project ${projectId} not found after notify github user update`);
      return updated;
    },
  );
}
