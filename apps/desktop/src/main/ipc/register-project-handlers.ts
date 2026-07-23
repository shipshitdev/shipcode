import { exec, execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  checkCliProviderUsage,
  checkDesktopApps,
  checkIntegrationStatus,
  checkSystemHealthWithAuth,
  clearPoolExhausted,
  detectProjectSetup,
  GhCli,
  inspectProjectSetup,
  validateOpenRouterModel,
  writeProjectSetup,
} from '@shipcode/agents';
import {
  type CheckpointRef,
  captureCheckpoint,
  deleteAllCheckpointRefs,
  deleteThreadCheckpointRefs,
  GitService,
  parseCheckpointTurn,
  restoreCheckpoint,
  WorktreeManager,
} from '@shipcode/git';
import type {
  AppSettings,
  DesktopAppHealthMap,
  DiffRecord,
  GitVisualizerData,
  GitWorktreeSummary,
  OnboardingRepo,
  Project,
  ProjectOpenTarget,
  ShipCodePlan,
  TerminalOpenTarget,
  TriageRuleDraft,
} from '@shipcode/shared';
import {
  clampError,
  DEFAULT_SETTINGS,
  PIPELINE_PHASE,
  parseGithubRemote,
  parseUnifiedDiff,
  resolveModelAlias,
  resolvePhaseModel,
  SHIPCODE_DEFAULT_LABELS,
  TRIAGE_RULE_LIMIT,
  validateGithubProjectUrl,
} from '@shipcode/shared';
import { resolveWorktreeParent } from '@shipcode/shared/worktree-path';
import { app, dialog, shell } from 'electron';
import { runAutoCommitWorkflow, runCleanupAnalyze, runCleanupApply } from '../git-workflows';
import { applyLaunchAtLoginSetting } from '../launch-at-login';
import log from '../logger.service';
import { NotificationCredentialStore } from '../notification-credential-store';
import { isSafeExternalUrl } from '../security';
import { configureMainTelemetry, getTelemetryStatus } from '../telemetry';
import { isWorktreeLocked, withWorktreeLock } from '../worktree-locks';
import {
  enrichProjectPath,
  enrichProjectPaths,
  persistGithubProjectConfiguration,
  sendGithubIssuesUpdated,
} from './helpers';
import { registerProjectCodeBrowserHandlers } from './register-project-code-browser-handlers';
import type { IpcHandlerDeps } from './types';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const PROJECT_OPEN_TARGET_ORDER: ProjectOpenTarget[] = [
  'cursor',
  'finder',
  'terminal',
  'ghostty',
  'vscode',
  't3code',
];
const TERMINAL_OPEN_TARGET_ORDER: TerminalOpenTarget[] = ['terminal', 'ghostty'];

const PROJECT_OPEN_APP_NAMES: Record<ProjectOpenTarget, string> = {
  cursor: 'Cursor',
  finder: 'Finder',
  terminal: 'Terminal',
  ghostty: 'Ghostty',
  vscode: 'Visual Studio Code',
  t3code: 'T3 Code',
};

const STARTER_ISSUE_TITLE = 'Ship your first change with ShipCode';

function normalizeSettingsModelPatch(
  settings: AppSettings,
  patch: Partial<AppSettings>,
): Partial<AppSettings> {
  const triageProvider = patch.triageModel ?? settings.triageModel;
  const autoCommitProvider = patch.autoCommitProvider ?? settings.autoCommitProvider;

  return {
    ...patch,
    ...(patch.triageModelId !== undefined
      ? { triageModelId: resolveModelAlias(triageProvider, patch.triageModelId) }
      : {}),
    ...(patch.prdRewriteClaudeModel !== undefined
      ? {
          prdRewriteClaudeModel: resolveModelAlias('claude', patch.prdRewriteClaudeModel),
        }
      : {}),
    ...(patch.prdRewriteCodexModel !== undefined
      ? { prdRewriteCodexModel: resolveModelAlias('codex', patch.prdRewriteCodexModel) }
      : {}),
    ...(patch.openrouterPlannerModel !== undefined
      ? {
          openrouterPlannerModel: resolveModelAlias('openrouter', patch.openrouterPlannerModel),
        }
      : {}),
    ...(patch.openrouterReviewerModel !== undefined
      ? {
          openrouterReviewerModel: resolveModelAlias('openrouter', patch.openrouterReviewerModel),
        }
      : {}),
    ...(patch.openrouterExecutorModel !== undefined
      ? {
          openrouterExecutorModel: resolveModelAlias('openrouter', patch.openrouterExecutorModel),
        }
      : {}),
    ...(patch.openrouterVerifierModel !== undefined
      ? {
          openrouterVerifierModel: resolveModelAlias('openrouter', patch.openrouterVerifierModel),
        }
      : {}),
    ...(patch.openrouterDefaultPaidModel !== undefined
      ? {
          openrouterDefaultPaidModel:
            resolveModelAlias('openrouter', patch.openrouterDefaultPaidModel) ??
            patch.openrouterDefaultPaidModel,
        }
      : {}),
    ...(patch.openrouterDefaultFreeModel !== undefined
      ? {
          openrouterDefaultFreeModel:
            resolveModelAlias('openrouter', patch.openrouterDefaultFreeModel) ??
            patch.openrouterDefaultFreeModel,
        }
      : {}),
    ...(patch.openrouterExplicitFallback !== undefined
      ? {
          openrouterExplicitFallback:
            resolveModelAlias('openrouter', patch.openrouterExplicitFallback) ??
            patch.openrouterExplicitFallback,
        }
      : {}),
    ...(patch.autoCommitModel !== undefined
      ? {
          autoCommitModel:
            resolveModelAlias(autoCommitProvider, patch.autoCommitModel) ?? patch.autoCommitModel,
        }
      : {}),
  };
}

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

function parseDiffRecords(diff: string, threadId: string): DiffRecord[] {
  const now = new Date().toISOString();
  return parseUnifiedDiff(diff).map((record, index) => {
    return {
      id: `${threadId}:${index}:${record.filePath}`,
      threadId,
      ...record,
      createdAt: now,
    };
  });
}

async function buildGitVisualizerData(
  project: Project,
  queries: IpcHandlerDeps['queries'],
): Promise<GitVisualizerData> {
  const settings = queries.settings.get();
  const git = new GitService(project.path);
  const manager = new WorktreeManager(project.path, {
    worktreeRoot: settings.worktreeRoot,
  });
  const threads = queries.threads.list(project.id);
  const threadByWorktreePath = new Map(
    threads.flatMap((thread) =>
      thread.worktreePath ? [[thread.worktreePath, thread] as const] : [],
    ),
  );
  const threadByBranch = new Map(
    threads.flatMap((thread) =>
      thread.worktreeBranch ? [[thread.worktreeBranch, thread] as const] : [],
    ),
  );

  const shipcodeWorktrees = await manager.list();
  const entries: Array<{ kind: GitWorktreeSummary['kind']; path: string; branch: string | null }> =
    [
      { kind: 'main', path: project.path, branch: null },
      ...shipcodeWorktrees.map((worktree) => ({
        kind: 'shipcode' as const,
        path: worktree.path,
        branch: worktree.branch,
      })),
    ];

  const worktrees = await Promise.all(
    entries.map(async (entry) => {
      const compareRef =
        entry.kind === 'main' ? `origin/${project.defaultBranch}` : project.defaultBranch;
      const status = await git.getStatus(entry.path, compareRef);
      const thread =
        entry.kind === 'shipcode'
          ? (threadByWorktreePath.get(entry.path) ?? threadByBranch.get(entry.branch ?? ''))
          : null;
      const issue = thread ? queries.githubIssues.getByThreadId(thread.id) : null;

      return {
        id: entry.kind === 'main' ? `main:${project.id}` : `worktree:${entry.path}`,
        kind: entry.kind,
        path: entry.path,
        branch: entry.branch ?? status.branch,
        commitHash: status.commitHash,
        isDirty: status.isDirty,
        untrackedCount: status.untrackedCount,
        stagedCount: status.stagedCount,
        modifiedCount: status.modifiedCount,
        aheadCount: status.aheadCount,
        behindCount: status.behindCount,
        compareRef: status.compareRef,
        preCommitHookPath: status.preCommitHookPath,
        threadId: thread?.id ?? null,
        issueNumber: issue?.issueNumber ?? thread?.githubIssueNumber ?? null,
        title: issue?.title ?? thread?.title ?? null,
        status: thread?.status ?? null,
      } satisfies GitWorktreeSummary;
    }),
  );

  return {
    project,
    branches: await git.listBranches(project.defaultBranch),
    worktrees,
  };
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function getRelinkedWorktreePath(
  worktreePath: string,
  oldParent: string,
  newParent: string,
): string | null {
  if (!isPathInside(oldParent, worktreePath)) return null;
  return path.join(newParent, path.relative(path.resolve(oldParent), path.resolve(worktreePath)));
}

interface RelinkWorktreeEntry {
  path: string;
  branch: string;
  threadId: string | null;
}

async function repairProjectWorktreesAfterRelink(
  project: Project,
  nextProjectPath: string,
  queries: IpcHandlerDeps['queries'],
): Promise<void> {
  const settings = queries.settings.get();
  const manager = new WorktreeManager(nextProjectPath, {
    worktreeRoot: settings.worktreeRoot,
  });
  const oldParent = resolveWorktreeParent(project.path, settings.worktreeRoot);
  const nextParent = resolveWorktreeParent(nextProjectPath, settings.worktreeRoot);
  const threads = queries.threads.list(project.id);
  const entries = new Map<string, RelinkWorktreeEntry>();

  for (const thread of threads) {
    if (!thread.worktreePath || !thread.worktreeBranch) continue;
    entries.set(thread.worktreePath, {
      path: thread.worktreePath,
      branch: thread.worktreeBranch,
      threadId: thread.id,
    });
  }

  try {
    for (const worktree of await manager.list()) {
      const existing = entries.get(worktree.path);
      entries.set(worktree.path, {
        path: worktree.path,
        branch: worktree.branch,
        threadId: existing?.threadId ?? null,
      });
    }
  } catch (error) {
    log.warn('[project:relink-path] worktree list failed during relink:', error);
  }

  await Promise.all(
    [...entries.values()].map(async (entry) => {
      const currentPath = entry.path;
      const relinkedPath = getRelinkedWorktreePath(currentPath, oldParent, nextParent);
      const currentExists = fs.existsSync(currentPath);
      const relinkedExists = relinkedPath ? fs.existsSync(relinkedPath) : false;

      if (currentExists) {
        try {
          await manager.repair([{ path: currentPath, branch: entry.branch }]);
        } catch (error) {
          log.warn(`[project:relink-path] worktree repair failed for ${currentPath}:`, error);
        }

        if (relinkedPath && path.resolve(relinkedPath) !== path.resolve(currentPath)) {
          try {
            await fsp.mkdir(path.dirname(relinkedPath), { recursive: true });
            await manager.move(currentPath, relinkedPath, entry.branch);
            if (entry.threadId) {
              queries.threads.setWorktree(entry.threadId, entry.branch, relinkedPath);
            }
          } catch (error) {
            log.warn(
              `[project:relink-path] worktree move failed for ${currentPath} -> ${relinkedPath}:`,
              error,
            );
          }
        }
        return;
      }

      if (relinkedPath && relinkedExists) {
        try {
          await manager.repair([{ path: relinkedPath, branch: entry.branch }]);
        } catch (error) {
          log.warn(`[project:relink-path] worktree repair failed for ${relinkedPath}:`, error);
        }
        if (entry.threadId) {
          queries.threads.setWorktree(entry.threadId, entry.branch, relinkedPath);
        }
        return;
      }

      if (relinkedPath && entry.threadId) {
        queries.threads.clearWorktree(entry.threadId);
      }
    }),
  );
}

async function resolveGithubRepoIdentity(
  projectPath: string,
  gitRemote: string | null,
  repoArg?: Pick<OnboardingRepo, 'id' | 'name'> | null,
): Promise<{
  githubRepoId: string;
  githubRepoFullName: string;
  githubProjectUrl: string | null;
} | null> {
  if (!repoArg && !parseGithubRemote(gitRemote)) return null;
  try {
    const ghCli = new GhCli(projectPath);
    const metadata = await ghCli.getRepoMetadata();
    return {
      githubRepoId: repoArg?.id ?? metadata.githubRepoId,
      githubRepoFullName: repoArg?.name ?? metadata.githubRepoFullName,
      githubProjectUrl: metadata.githubProjectUrl,
    };
  } catch (error) {
    log.warn('[project:add] failed to resolve GitHub repo metadata:', error);
    return repoArg?.id && repoArg.name
      ? {
          githubRepoId: repoArg.id,
          githubRepoFullName: repoArg.name,
          githubProjectUrl: null,
        }
      : null;
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

async function runProjectGithubOnboarding({
  mainWindow,
  queries,
  projectId,
  projectPath,
}: {
  mainWindow: import('electron').BrowserWindow;
  queries: IpcHandlerDeps['queries'];
  projectId: string;
  projectPath: string;
}): Promise<void> {
  const project = queries.projects.getById(projectId);
  if (!project?.githubRepoFullName) return;

  try {
    const ghCli = new GhCli(projectPath);
    const labelResult = await ghCli.ensureLabels(SHIPCODE_DEFAULT_LABELS);
    log.info(
      `[project:add] ShipCode label readiness created=${labelResult.created.length} alreadyPresent=${labelResult.alreadyPresent.length} failed=${labelResult.failed.length}`,
    );
  } catch (error) {
    log.warn('[project:add] failed to ensure ShipCode labels:', error);
  }

  await ensureStarterIssue({ mainWindow, queries, projectId });
}

function enqueueProjectGithubOnboarding({
  mainWindow,
  queries,
  projectId,
  projectPath,
}: {
  mainWindow: import('electron').BrowserWindow;
  queries: IpcHandlerDeps['queries'];
  projectId: string;
  projectPath: string;
}): void {
  setTimeout(() => {
    void runProjectGithubOnboarding({ mainWindow, queries, projectId, projectPath }).catch(
      (error) => {
        log.warn('[project:add] failed to complete GitHub onboarding:', error);
      },
    );
  }, 0);
}

async function resolveProjectGithubIdentityAndOnboard({
  mainWindow,
  queries,
  projectId,
  projectPath,
  remote,
  repo,
}: {
  mainWindow: import('electron').BrowserWindow;
  queries: IpcHandlerDeps['queries'];
  projectId: string;
  projectPath: string;
  remote: string | null;
  repo?: Pick<OnboardingRepo, 'id' | 'name'> | null;
}): Promise<void> {
  const repoIdentity = await resolveGithubRepoIdentity(projectPath, remote, repo);
  if (!repoIdentity) return;

  queries.projects.updateGithubRepoIdentity(projectId, {
    githubRepoId: repoIdentity.githubRepoId,
    githubRepoFullName: repoIdentity.githubRepoFullName,
  });
  if (repoIdentity.githubProjectUrl) {
    await persistGithubProjectConfiguration({
      queries,
      projectId,
      projectPath,
      projectUrl: repoIdentity.githubProjectUrl,
      source: 'project:add',
    });
  }
  enqueueProjectGithubOnboarding({ mainWindow, queries, projectId, projectPath });
}

function resolveProjectOpenTarget(
  settings: AppSettings,
  desktopApps: DesktopAppHealthMap,
  requested: ProjectOpenTarget | 'default' | 'default-terminal',
): ProjectOpenTarget {
  if (requested === 'default-terminal') {
    const preferred = settings.terminalOpenTarget ?? DEFAULT_SETTINGS.terminalOpenTarget;
    if (desktopApps[preferred].available) {
      return preferred;
    }

    const fallback = TERMINAL_OPEN_TARGET_ORDER.find((target) => desktopApps[target].available);
    if (!fallback) {
      throw new Error('No supported terminal app is available');
    }
    return fallback;
  }

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
  if (target === 'terminal') {
    await execFileAsync('open', ['-a', appName, projectPath], { timeout: 10_000 });
    return;
  }

  if (target === 'ghostty') {
    await execFileAsync('open', ['-na', appName, '--args', `--working-directory=${projectPath}`], {
      timeout: 10_000,
    });
    return;
  }

  await execFileAsync('open', ['-a', appName, projectPath], { timeout: 10_000 });
}

export function registerProjectHandlers({
  ipcMain,
  mainWindow,
  queries,
  pipeline,
  chatNotificationService,
  notificationCredentials,
  automationScheduler,
  onProjectsChanged,
}: IpcHandlerDeps): void {
  const credentialStore =
    notificationCredentials ?? new NotificationCredentialStore(queries.settings);
  registerProjectCodeBrowserHandlers({
    ipcMain,
    queries,
    buildGitVisualizerData,
    parseDiffRecords,
  });

  const cleanupTrackedWorktrees = async (project: Project): Promise<void> => {
    const appSettings = queries.settings.get();
    const worktreeManager = new WorktreeManager(project.path, {
      worktreeRoot: appSettings.worktreeRoot,
    });
    const threads = queries.threads.list(project.id);
    const failures = (
      await Promise.all(
        threads.flatMap((thread) =>
          thread.worktreePath && thread.worktreeBranch
            ? [
                worktreeManager
                  .remove(thread.worktreePath, thread.worktreeBranch)
                  .then((result) =>
                    result.error ? `${thread.worktreePath}: ${result.error}` : null,
                  ),
              ]
            : [],
        ),
      )
    ).flatMap((failure) => (failure ? [failure] : []));

    // Checkpoint refs are meaningless once the project's worktrees are gone
    // (#212). Best-effort: a stale ref must never block project teardown.
    try {
      await deleteAllCheckpointRefs(project.path);
    } catch (error) {
      log.warn(`[cleanup] checkpoint ref cleanup failed for ${project.path}:`, error);
    }

    if (failures.length > 0) {
      throw new Error(`Failed to clean up ${failures.length} worktree(s):\n${failures.join('\n')}`);
    }
  };

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
      // The new project may carry a WORKFLOW.md; attach its watcher now.
      onProjectsChanged?.();

      try {
        const git = new GitService(projectPath);
        const remote = await git.getRemoteUrl();
        const branch = await git.getDefaultBranch();
        queries.projects.updateGitInfo(project.id, remote, branch);

        if ((repo?.id && repo.name) || parseGithubRemote(remote)) {
          await resolveProjectGithubIdentityAndOnboard({
            mainWindow,
            queries,
            projectId: project.id,
            projectPath,
            remote,
            repo,
          });
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

      await repairProjectWorktreesAfterRelink(project, projectPath, queries);
      queries.projects.updatePath(projectId, projectPath);
      // Watch the relinked path and drop the watcher on the stale one.
      onProjectsChanged?.();

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
      try {
        await cleanupTrackedWorktrees(project);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const removeMessage = message.replace(
          /^(Failed to clean up \d+ worktree\(s\)):\n/,
          '$1. Project not removed:\n',
        );
        throw new Error(
          removeMessage === message
            ? `${message.replace(/:$/, '')}. Project not removed.`
            : removeMessage,
        );
      }
    }

    // Snapshot which automations will be fully cascade-deleted by this project
    // removal (their only target is this project) BEFORE the delete — afterwards
    // the rows are gone. Multi-repo automations whose primary is this project are
    // reassigned to a surviving target inside removeIfIdle, so they are NOT in
    // this list. Read is race-free with the delete below: both are synchronous
    // and adjacent, and the reassignment never touches these cascade-only rows.
    const cascadingAutomationIds = queries.automations.listCascadingProjectRemoval(projectId);

    const removed = queries.projects.removeIfIdle(projectId, { ignoreAttentionOnly });
    if (!removed) {
      throw new Error(
        ignoreAttentionOnly
          ? 'A pipeline became active during cleanup. Project not removed. Retry after it stops.'
          : 'New work appeared during cleanup. Project not removed. Retry after stopping pipelines.',
      );
    }
    // Cancel in-memory cron jobs for automations that cascaded away, so no zombie
    // job keeps firing no-ops until the app restarts.
    for (const automationId of cascadingAutomationIds) {
      automationScheduler?.unschedule(automationId);
    }
    // Stop watching the removed project's WORKFLOW.md.
    onProjectsChanged?.();
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
    if (queries.projects.hasLiveWork(projectId, { ignoreAttentionOnly })) {
      throw new Error(
        ignoreAttentionOnly
          ? 'Cannot archive this missing project while a pipeline is still active. Stop running pipelines first.'
          : 'Cannot archive a project with active work. Stop running pipelines and dismiss notifications first.',
      );
    }

    if (project) {
      try {
        await cleanupTrackedWorktrees(project);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const archiveMessage = message.replace(
          /^(Failed to clean up \d+ worktree\(s\)):\n/,
          '$1. Project not archived:\n',
        );
        throw new Error(
          archiveMessage === message
            ? `${message.replace(/:$/, '')}. Project not archived.`
            : archiveMessage,
        );
      }
    }

    const archived = queries.projects.archiveIfIdle(projectId, { ignoreAttentionOnly });
    if (!archived) {
      throw new Error(
        ignoreAttentionOnly
          ? 'Cannot archive this missing project while a pipeline is still active. Stop running pipelines first.'
          : 'Cannot archive a project with active work. Stop running pipelines and dismiss notifications first.',
      );
    }
    // Archived projects drop out of listVisible(); stop watching this one.
    onProjectsChanged?.();
  });

  ipcMain.handle('project:unarchive', (_event, { projectId }: { projectId: string }) => {
    queries.projects.unarchive(projectId);
    // Unarchived projects re-enter listVisible(); attach their watcher again.
    onProjectsChanged?.();
  });

  ipcMain.handle(
    'project:set-name',
    async (_event, { projectId, name }: { projectId: string; name: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const trimmed = name.trim();
      if (!trimmed) {
        throw new Error('Project name is required');
      }

      queries.projects.updateName(projectId, trimmed);
      const updated = enrichProjectPath(queries.projects.getById(projectId));
      if (!updated) throw new Error(`Project ${projectId} not found after name update`);
      return updated;
    },
  );

  ipcMain.handle('thread:list', (_event, { projectId }: { projectId: string }) => {
    return queries.threads.list(projectId);
  });

  ipcMain.handle('thread-panel:get-data', async (_event, { projectId }: { projectId: string }) => {
    const project = enrichProjectPath(queries.projects.getById(projectId));
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const git = new GitService(project.path);
    const threads = queries.threads.list(projectId);

    return {
      project,
      settings: credentialStore.getRendererSettings(),
      threads,
      latestPlanStatusByThreadId: (() => {
        const threadIds = threads.map((t) => t.id);
        const statusMap = queries.plans.getLatestStatusByThreadIds(threadIds);
        return Object.fromEntries(threads.map((t) => [t.id, statusMap.get(t.id) ?? null]));
      })(),
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

  ipcMain.handle('thread:mark-done', (_event, { threadId }: { threadId: string }) => {
    const thread = queries.threads.getById(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const MARKABLE_STATUSES: ReadonlySet<string> = new Set([
      PIPELINE_PHASE.failed,
      PIPELINE_PHASE.completed,
      PIPELINE_PHASE.idle,
    ]);
    if (!MARKABLE_STATUSES.has(thread.status)) {
      throw new Error(`Cannot close thread while in ${thread.status} phase`);
    }

    queries.threads.markDone(threadId);
  });

  ipcMain.handle(
    'thread:set-done-status',
    (_event, { threadId, status }: { threadId: string; status: 'completed' | 'closed' }) => {
      const thread = queries.threads.getById(threadId);
      if (!thread) throw new Error(`Thread ${threadId} not found`);
      if (thread.status !== PIPELINE_PHASE.completed) {
        throw new Error(`Cannot change done status while in ${thread.status} phase`);
      }

      if (status === 'closed') {
        queries.threads.markDone(threadId);
      } else {
        queries.threads.clearDoneAt(threadId);
      }

      const updated = queries.threads.getById(threadId);
      if (!updated) throw new Error(`Thread ${threadId} not found after status update`);
      return updated;
    },
  );

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

      try {
        // Rollback pruning (#212, #328): refs AND their DB rows newer than the
        // restored turn represent an abandoned future timeline and must be
        // dropped together — leaving rows behind lets a later capture reuse the
        // turn number and silently resolve the stale row to unrelated content.
        // Prune BEFORE the pre-restore snapshot below so the snapshot's ref
        // (which claims the next free turn, i.e. one higher than everything
        // remaining) is never caught by this prune and stays recoverable.
        const restoredTurn = checkpoint.refName ? parseCheckpointTurn(checkpoint.refName) : null;
        if (restoredTurn !== null) {
          await deleteThreadCheckpointRefs(thread.worktreePath, threadId, {
            newerThanTurn: restoredTurn,
          });
          queries.checkpoints.deleteNewerThan(threadId, restoredTurn);
        }

        // Pre-restore safety snapshot: the restore below runs `git reset --hard`,
        // which reverts EVERY uncommitted change in the worktree — including
        // manual edits the user made between attempts — not just the files
        // created after the target checkpoint. Snapshot the current worktree
        // state first so nothing is silently lost; it surfaces in the checkpoint
        // list as "Before restore" and is restorable like any other checkpoint.
        // Best-effort: a snapshot failure must never block the restore the user
        // explicitly asked for, so ref capture and row insert each fail soft.
        let preRestore: CheckpointRef | null = null;
        try {
          preRestore = await captureCheckpoint(thread.worktreePath, threadId);
        } catch (snapshotError) {
          log.warn(
            `[checkpoint:restore] pre-restore snapshot failed for thread ${threadId}:`,
            snapshotError,
          );
        }
        try {
          queries.checkpoints.create({
            threadId,
            projectId: thread.projectId,
            phase: checkpoint.phase,
            reason: 'pre_restore',
            label: 'Before restore',
            branch: thread.worktreeBranch,
            commitSha: preRestore?.commitSha ?? checkpoint.commitSha,
            refName: preRestore?.refName ?? null,
          });
        } catch (rowError) {
          log.warn(
            `[checkpoint:restore] failed to record pre-restore checkpoint for thread ${threadId}:`,
            rowError,
          );
        }

        // Ref-backed restore (#212): reproduce the checkpoint's full captured
        // filesystem state (including then-uncommitted work). Legacy rows and
        // missing refs fall back to the commit-SHA hard reset.
        let restoredFromRef = false;
        if (checkpoint.refName) {
          try {
            await restoreCheckpoint(thread.worktreePath, checkpoint.refName);
            restoredFromRef = true;
          } catch (refError) {
            log.warn(
              `[checkpoint:restore] ref restore failed for ${checkpoint.refName}; falling back to commit SHA:`,
              refError,
            );
          }
        }
        if (!restoredFromRef) {
          await execAsync(`git reset --hard ${checkpoint.commitSha}`, {
            cwd: thread.worktreePath,
            timeout: 15_000,
          });
          await execAsync('git clean -fd', {
            cwd: thread.worktreePath,
            timeout: 15_000,
          });
        }
      } catch (error) {
        throw new Error(clampError(error));
      }

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

      mainWindow.webContents.send('pipeline:phase', { threadId, phase: PIPELINE_PHASE.idle });
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
    return credentialStore.getRendererSettings();
  });

  ipcMain.handle('settings:set', (_event, patch: Partial<AppSettings>) => {
    const previousSettings = queries.settings.get();
    const normalizedPatch = normalizeSettingsModelPatch(previousSettings, patch);
    try {
      credentialStore.set(normalizedPatch);
    } catch (error) {
      log.warn('[settings:set] secure credential update failed:', error);
      throw new Error(clampError(error));
    }
    if (normalizedPatch.launchAtLogin !== undefined) {
      try {
        applyLaunchAtLoginSetting(app, normalizedPatch.launchAtLogin);
      } catch (error) {
        credentialStore.set({ launchAtLogin: previousSettings.launchAtLogin });
        log.warn(
          '[settings:set] launch at login update failed:',
          error instanceof Error ? (error.stack ?? error.message) : error,
        );
        throw new Error(clampError(error));
      }
    }
    void configureMainTelemetry(queries.settings.get()).catch((err) => {
      log.warn('[telemetry] reconfigure failed:', err);
    });
  });

  ipcMain.handle('telemetry:get-status', () => {
    return getTelemetryStatus(queries.settings.get());
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

  ipcMain.handle('provider-usage:reset-claude-pool', async () => {
    clearPoolExhausted();
    return { ok: true };
  });

  ipcMain.handle(
    'integrations:check',
    async (_event, { force = false }: { force?: boolean } = {}) => {
      let mainSettings: AppSettings;
      try {
        mainSettings = credentialStore.getMainSettings();
      } catch (error) {
        log.warn('[integrations:check] credential decryption unavailable:', error);
        mainSettings = {
          ...queries.settings.get(),
          discordWebhookUrl: null,
          telegramBotToken: null,
        };
      }
      return checkIntegrationStatus(mainSettings, { force });
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

  // ── Filesystem explorer for Add Project ──────────────────────────────

  ipcMain.handle('fs:resolve-start-dir', () => {
    const settings = queries.settings.get();
    const raw = settings.addProjectStartsIn;
    let resolvedPath: string;
    if (!raw) {
      resolvedPath = os.homedir();
    } else if (raw === '~') {
      resolvedPath = os.homedir();
    } else if (raw.startsWith('~/')) {
      resolvedPath = path.join(os.homedir(), raw.slice(2));
    } else if (path.isAbsolute(raw)) {
      resolvedPath = raw;
    } else {
      resolvedPath = os.homedir();
    }
    if (!fs.existsSync(resolvedPath)) {
      resolvedPath = os.homedir();
    }
    return { resolvedPath };
  });

  ipcMain.handle('fs:list-directories', async (_event, { dirPath }: { dirPath: string }) => {
    try {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({ name: e.name, absolutePath: path.join(dirPath, e.name) }));
      return { entries: dirs, error: null };
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return { entries: [], error: 'not-found' as const };
      }
      return { entries: [], error: 'permission-denied' as const };
    }
  });

  ipcMain.handle('shell:open-external', async (_event, { url }: { url: string }) => {
    const validated = isSafeExternalUrl(url);
    if (!validated.ok) return;
    await shell.openExternal(validated.href);
  });

  ipcMain.handle('project:get', (_event, { projectId }: { projectId: string }) => {
    return enrichProjectPath(queries.projects.getById(projectId));
  });

  ipcMain.handle('project:list-triage-rules', (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    const triageRules = queries.triageRules;
    if (!triageRules) throw new Error('Triage rules are unavailable');
    try {
      return triageRules.list(projectId);
    } catch (err) {
      log.warn('[project:list-triage-rules] failed:', err);
      throw new Error(clampError(err));
    }
  });

  ipcMain.handle(
    'project:replace-triage-rules',
    (_event, { projectId, rules }: { projectId: string; rules: TriageRuleDraft[] }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      const triageRules = queries.triageRules;
      if (!triageRules) throw new Error('Triage rules are unavailable');
      if (!Array.isArray(rules)) {
        throw new Error('Triage rules must be an array');
      }
      if (rules.length > TRIAGE_RULE_LIMIT) {
        throw new Error(`A project can have at most ${TRIAGE_RULE_LIMIT} triage rules`);
      }
      try {
        return triageRules.replaceForProject(projectId, rules);
      } catch (err) {
        log.warn('[project:replace-triage-rules] failed:', err);
        throw new Error(clampError(err));
      }
    },
  );

  ipcMain.handle(
    'project:open-path',
    async (
      _event,
      {
        projectId,
        target,
      }: { projectId: string; target: ProjectOpenTarget | 'default' | 'default-terminal' },
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

  ipcMain.handle('git:visualizer-data', async (_event, { projectId }: { projectId: string }) => {
    const project = enrichProjectPath(queries.projects.getById(projectId));
    if (!project) throw new Error(`Project ${projectId} not found`);
    return buildGitVisualizerData(project, queries);
  });

  ipcMain.handle(
    'git:worktree-diff',
    async (_event, { projectId, worktreePath }: { projectId: string; worktreePath: string }) => {
      const project = enrichProjectPath(queries.projects.getById(projectId));
      if (!project) throw new Error(`Project ${projectId} not found`);

      const data = await buildGitVisualizerData(project, queries);
      const worktree = data.worktrees.find((entry) => entry.path === worktreePath);
      if (!worktree) {
        throw new Error('Worktree not found for this project');
      }

      const git = new GitService(project.path);
      const diff = await git.getDiffAgainstHead(worktree.path);
      return parseDiffRecords(diff, worktree.threadId ?? worktree.id);
    },
  );

  ipcMain.handle(
    'git:auto-commit',
    async (_event, { projectId, worktreePath }: { projectId: string; worktreePath: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      if (isWorktreeLocked(worktreePath)) {
        throw new Error('Auto-commit already running for this worktree');
      }
      // Refuse if any pipeline is currently active in this worktree.
      const activeForWorktree = pipeline.listActive().find((s) => s.worktreePath === worktreePath);
      if (activeForWorktree) {
        throw new Error('Pipeline is active in this worktree — cannot auto-commit');
      }
      const settings = queries.settings.get();
      const apiKey =
        settings.autoCommitProvider === 'openrouter' ? process.env.OPENROUTER_API_KEY : undefined;
      if (settings.autoCommitProvider === 'openrouter' && !apiKey) {
        throw new Error('OPENROUTER_API_KEY is not set');
      }
      const controller = new AbortController();
      try {
        return await withWorktreeLock(worktreePath, () =>
          runAutoCommitWorkflow({
            project,
            worktreePath,
            apiKey,
            provider: settings.autoCommitProvider,
            model:
              resolveModelAlias(settings.autoCommitProvider, settings.autoCommitModel) ??
              settings.autoCommitModel,
            mode: settings.autoCommitMode,
            signal: controller.signal,
          }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`[git:auto-commit] failed: ${message}`);
        throw new Error(clampError(message));
      }
    },
  );

  ipcMain.handle('git:cleanup-analyze', async (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    const settings = queries.settings.get();
    try {
      return await runCleanupAnalyze({
        project,
        criteria: settings.cleanupCriteria,
        activeSummaries: pipeline.listActive(),
        managedBranches: queries.threads
          .list(project.id)
          .flatMap((thread) => (thread.worktreeBranch ? [thread.worktreeBranch] : [])),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`[git:cleanup-analyze] failed: ${message}`);
      throw new Error(clampError(message));
    }
  });

  ipcMain.handle(
    'git:cleanup-apply',
    async (_event, { projectId, itemIds }: { projectId: string; itemIds: string[] }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      const settings = queries.settings.get();
      try {
        const analyzed = await runCleanupAnalyze({
          project,
          criteria: settings.cleanupCriteria,
          activeSummaries: pipeline.listActive(),
          managedBranches: queries.threads
            .list(project.id)
            .flatMap((thread) => (thread.worktreeBranch ? [thread.worktreeBranch] : [])),
        });
        const applied = await runCleanupApply({
          project,
          items: analyzed.items,
          itemIds,
          lockFor: withWorktreeLock,
        });
        // Checkpoint refs for removed worktrees are stale (#212). CleanupItem
        // carries no threadId, so match worktreePath back to its thread.
        // Best-effort — ref cleanup must never fail the apply result.
        const succeededIds = new Set(applied.succeeded);
        const removedWorktreePaths = new Set(
          analyzed.items.flatMap((item) =>
            succeededIds.has(item.id) &&
            (item.kind === 'worktree-merged-pr' ||
              item.kind === 'worktree-closed-pr' ||
              item.kind === 'worktree-no-pr-clean')
              ? [item.worktreePath]
              : [],
          ),
        );
        if (removedWorktreePaths.size > 0) {
          for (const thread of queries.threads.list(project.id)) {
            if (!thread.worktreePath || !removedWorktreePaths.has(thread.worktreePath)) continue;
            try {
              await deleteThreadCheckpointRefs(project.path, thread.id);
            } catch (error) {
              log.warn(
                `[git:cleanup-apply] checkpoint ref cleanup failed for ${thread.id}:`,
                error,
              );
            }
          }
        }
        return applied;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`[git:cleanup-apply] failed: ${message}`);
        throw new Error(clampError(message));
      }
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
    'project:refresh-git-remote',
    async (_event, { projectId }: { projectId: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const git = new GitService(project.path);
      const remote = await git.getRemoteUrl();
      const changed = remote !== project.gitRemote;
      if (changed) {
        queries.projects.updateGitRemote(projectId, remote);
      }
      const updated = enrichProjectPath(queries.projects.getById(projectId));
      if (!updated) throw new Error(`Project ${projectId} not found after remote refresh`);
      return { project: updated, remote, changed };
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

      await persistGithubProjectConfiguration({
        queries,
        projectId,
        projectPath: project.path,
        projectUrl: result.value,
        source: 'project:set-github-project-url',
      });

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
    'project:set-require-approval',
    (
      _event,
      {
        projectId,
        requireApproval,
      }: {
        projectId: string;
        requireApproval: boolean;
      },
    ) => {
      if (typeof requireApproval !== 'boolean') {
        throw new Error(`Invalid requireApproval value: ${String(requireApproval)}`);
      }
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      queries.projects.updateRequireApprovalOverride(projectId, requireApproval);
      const updated = enrichProjectPath(queries.projects.getById(projectId));
      if (!updated) {
        throw new Error(`Project ${projectId} not found after approval update`);
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
          pipelineSpeedProfileOverride: import('@shipcode/shared').Project['pipelineSpeedProfileOverride'];
          prdQualityGate: import('@shipcode/shared').Project['prdQualityGate'];
        };
      },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const settings = queries.settings.get();
      const candidateProject = { ...project, ...overrides };
      const normalizedOverrides = {
        ...overrides,
        plannerModelIdOverride: resolveModelAlias(
          resolvePhaseModel(settings, candidateProject, 'planner'),
          overrides.plannerModelIdOverride,
        ),
        reviewerModelIdOverride: resolveModelAlias(
          resolvePhaseModel(settings, candidateProject, 'reviewer'),
          overrides.reviewerModelIdOverride,
        ),
        executorModelIdOverride: resolveModelAlias(
          resolvePhaseModel(settings, candidateProject, 'executor'),
          overrides.executorModelIdOverride,
        ),
        verifierModelIdOverride: resolveModelAlias(
          resolvePhaseModel(settings, candidateProject, 'verifier'),
          overrides.verifierModelIdOverride,
        ),
      };
      queries.projects.updateModelOverrides(projectId, normalizedOverrides);
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
