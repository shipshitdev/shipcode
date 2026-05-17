import fs from 'node:fs';
import path from 'node:path';
import {
  applyTriageRulesOnce,
  checkProjectReadiness,
  enhancePrdDraft,
  fetchProjectPriorities,
  fetchProjectStatuses,
  GhCli,
  type IssueTriageRecommendation,
  normalizeStatusOption,
  triageGitHubIssues,
} from '@shipcode/agents';
import type {
  ExecutorModel,
  GitHubIssueCacheRecord,
  GitHubIssueComment,
  IssuePipelineStatus,
  ReasoningEffort,
} from '@shipcode/shared';
import {
  agentLabelForExecutor,
  clampError,
  deriveGithubIssueUrl,
  ISSUE_PIPELINE_STATUS,
  isAgentRoutingLabel,
  isRealGithubIssueNumber,
  PIPELINE_PHASE,
  parseGithubProjectUrl,
  parseGithubRemote,
  pipelineStatusFromLabels,
  SHIPCODE_DEFAULT_LABELS,
} from '@shipcode/shared';
import { syncIssuePipelineLabelSoon } from '../github-pipeline-label-sync';
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
const STALE_LINK_THREAD_STATUSES = new Set<string>([
  PIPELINE_PHASE.failed,
  PIPELINE_PHASE.completed,
  PIPELINE_PHASE.idle,
]);

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
  const labelStatus = pipelineStatusFromLabels(issue.labels);
  if (thread) {
    if (STALE_LINK_THREAD_STATUSES.has(thread.status)) {
      return thread.status === PIPELINE_PHASE.idle
        ? ISSUE_PIPELINE_STATUS.todo
        : (thread.status as IssuePipelineStatus);
    }
    if (labelStatus !== null) return labelStatus;
    return thread.status === PIPELINE_PHASE.idle
      ? ISSUE_PIPELINE_STATUS.todo
      : (thread.status as IssuePipelineStatus);
  }
  if (labelStatus !== null) return labelStatus;
  if (issue.pipelineStatus === ISSUE_PIPELINE_STATUS.queued) return ISSUE_PIPELINE_STATUS.queued;
  return issue.linkedPrNumber != null
    ? ISSUE_PIPELINE_STATUS.completed
    : ISSUE_PIPELINE_STATUS.todo;
}

function updateIssuePipelineStatus(
  projectPath: string,
  queries: IpcHandlerDeps['queries'],
  issue: Pick<GitHubIssueCacheRecord, 'id' | 'issueNumber'>,
  status: IssuePipelineStatus,
  source: string,
): void {
  queries.githubIssues.updatePipelineStatus(issue.id, status);
  syncIssuePipelineLabelSoon({
    projectPath,
    issueNumber: issue.issueNumber,
    status,
    source,
  });
}

function syncOpenIssueState(
  queries: IpcHandlerDeps['queries'],
  issue: GitHubIssueCacheRecord,
  projectPath?: string,
): GitHubIssueCacheRecord | null {
  const labelStatus = pipelineStatusFromLabels(issue.labels);
  const thread = resolveCanonicalIssueThread(queries, issue);
  if (thread && issue.threadId !== thread.id) {
    queries.githubIssues.linkThread(issue.id, thread.id);
  }

  const pipelineStatus = resolveOpenIssuePipelineStatus(issue, thread);

  queries.githubIssues.updateState(issue.id, 'open');
  queries.githubIssues.updatePipelineStatus(issue.id, pipelineStatus);
  queries.githubIssues.clearArchivedAt(issue.id);

  if (projectPath && labelStatus !== null) {
    syncIssuePipelineLabelSoon({
      projectPath,
      issueNumber: issue.issueNumber,
      status: pipelineStatus,
      source: 'github:refresh-issues',
    });
  }

  return queries.githubIssues.getByNumber(issue.projectId, issue.issueNumber);
}

function getActiveIssueById(
  queries: IpcHandlerDeps['queries'],
  projectId: string,
  issueId: string,
): GitHubIssueCacheRecord | null {
  return queries.githubIssues.list(projectId).find((issue) => issue.id === issueId) ?? null;
}

function mergeTriageLabels(
  currentLabels: string[],
  recommendation: IssueTriageRecommendation,
): string[] {
  const next = currentLabels.filter(
    (label) =>
      !isAgentRoutingLabel(label) &&
      !label.startsWith('complexity:') &&
      !label.startsWith('blast:'),
  );
  const labels = [...recommendation.suggestedLabels];
  if (recommendation.suggestedAgent && !labels.some(isAgentRoutingLabel)) {
    labels.push(agentLabelForExecutor(recommendation.suggestedAgent));
  }
  return Array.from(new Set([...next, ...labels]));
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
        const triageRules = queries.triageRules?.list(projectId) ?? [];
        const githubRemoteRef = parseGithubRemote(project.gitRemote);
        let githubRepoFullName =
          project.githubRepoFullName ??
          (githubRemoteRef ? `${githubRemoteRef.owner}/${githubRemoteRef.repo}` : null);
        if (!project.githubRepoFullName) {
          try {
            const metadata = await ghCli.getRepoMetadata();
            githubRepoFullName = metadata.githubRepoFullName;
            queries.projects.updateGithubRepoIdentity(project.id, metadata);
          } catch (err) {
            log.warn('[github:refresh-issues] repo identity backfill failed', err);
          }
        }
        const issues = await ghCli.listAllIssues();
        logEvent('github:refresh-issues:listAllIssues', {
          projectId,
          issueCount: issues.length,
          elapsedMs: Date.now() - startedAt,
        });

        // Batch upsert in a single transaction to avoid per-issue WAL overhead.
        const newIssues: Array<{ number: number; url: string; record: GitHubIssueCacheRecord }> =
          [];
        queries.githubIssues.runInTransaction(() => {
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
              updatedAt: issue.updatedAt ?? null,
            });
            if (record.state === 'closed') {
              queries.githubIssues.markClosedOnClose(record.id);
            } else if (record.state === 'open') {
              syncOpenIssueState(queries, record, project.path);
            }

            if (!existingIssue && record.state === 'open' && !record.rulesAppliedAt) {
              newIssues.push({ number: issue.number, url: issue.url, record });
            }
          }
        });
        await Promise.all(
          newIssues.map((issue) =>
            attachIssueToConfiguredProjectBoard(
              project,
              ghCli,
              issue.number,
              issue.url,
              'github:refresh-issues',
            ),
          ),
        );

        await Promise.all(
          newIssues.map(async ({ record }) => {
            const result = await applyTriageRulesOnce({
              issue: record,
              rules: triageRules,
              ghCli,
              markApplied: (issueId) => queries.githubIssues.markTriageRulesApplied(issueId),
              recordFailure: (issueId, reason) =>
                queries.githubIssues.recordTriageRulesFailure(issueId, reason),
              onWarn: (message, err) => log.warn(message, err),
            });

            if (result.status !== 'applied') return;

            const refreshedIssue = result.refreshedIssue;
            queries.githubIssues.upsert({
              projectId,
              issueNumber: refreshedIssue.number,
              title: refreshedIssue.title,
              body: refreshedIssue.body,
              labels: refreshedIssue.labels,
              assignee: refreshedIssue.assignee,
              state: refreshedIssue.state,
              updatedAt: refreshedIssue.updatedAt ?? null,
            });
          }),
        );

        const staleApprovalCount = force ? queries.githubIssues.resetStaleApproval(projectId) : 0;
        if (staleApprovalCount > 0) {
          logEvent('github:refresh-issues:stale-awaiting-approval-reset', {
            projectId,
            count: staleApprovalCount,
          });
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
          let archivedIssueNumbers = new Set<number>();
          try {
            const priorityResult = await fetchProjectPriorities({
              cwd: project.path,
              projectUrl: project.githubProjectUrl,
              repoFullName: githubRepoFullName ?? undefined,
              onWarn: (msg, err) => log.warn(msg, err),
            });
            archivedIssueNumbers = priorityResult.archivedIssueNumbers;
            const now = new Date().toISOString();
            for (const cachedIssue of cachedAfterIssueSync) {
              const p = priorityResult.priorities.get(cachedIssue.issueNumber) ?? {
                rank: null,
                raw: null,
              };
              queries.githubIssues.setPriority({
                id: cachedIssue.id,
                rank: p.rank,
                raw: p.raw,
                fetchedAt: now,
              });
              queries.githubIssues.setIssueType({
                id: cachedIssue.id,
                issueType: priorityResult.issueTypes?.get(cachedIssue.issueNumber) ?? null,
              });
            }
          } catch (err) {
            log.warn('[github:refresh-issues] priority sync failed', err);
          }

          // GH Projects v2 Status field sync — updates local pipeline_status
          // for non-agent-loop issues where GH board is source of truth.
          if (project.githubStatusMapping) {
            try {
              const statuses = await fetchProjectStatuses({
                cwd: project.path,
                projectUrl: project.githubProjectUrl,
                repoFullName: githubRepoFullName ?? undefined,
                onWarn: (msg, err) => log.warn(msg, err),
              });
              const ACTIVE_PIPELINE_STATUSES = new Set<IssuePipelineStatus>([
                ISSUE_PIPELINE_STATUS.queued,
                ISSUE_PIPELINE_STATUS.planning,
                ISSUE_PIPELINE_STATUS.clarifying,
                ISSUE_PIPELINE_STATUS.approval,
                ISSUE_PIPELINE_STATUS.reviewing,
                ISSUE_PIPELINE_STATUS.revising,
                ISSUE_PIPELINE_STATUS.executing,
                ISSUE_PIPELINE_STATUS.testing,
                ISSUE_PIPELINE_STATUS.verifying,
                ISSUE_PIPELINE_STATUS.shipping,
                ISSUE_PIPELINE_STATUS.paused,
                ISSUE_PIPELINE_STATUS.failed,
              ]);
              for (const cachedIssue of cachedAfterIssueSync) {
                // Pipeline labels are the exact ShipCode state; board columns are only macro status.
                if (pipelineStatusFromLabels(cachedIssue.labels)) continue;
                // Never override an issue actively being worked by the pipeline.
                if (ACTIVE_PIPELINE_STATUSES.has(cachedIssue.pipelineStatus)) continue;
                if (cachedIssue.isQuickMode) continue;

                const s = statuses.get(cachedIssue.issueNumber);
                if (!s?.raw) continue;

                const { macroColumn } = normalizeStatusOption(s.raw, project.githubStatusMapping);
                let targetStatus: IssuePipelineStatus | null = null;
                if (macroColumn === 'todo') targetStatus = ISSUE_PIPELINE_STATUS.todo;
                else if (macroColumn === 'in_progress') targetStatus = ISSUE_PIPELINE_STATUS.queued;
                else if (macroColumn === 'human_review') targetStatus = null;
                else if (macroColumn === 'deferred') targetStatus = ISSUE_PIPELINE_STATUS.deferred;
                else if (macroColumn === 'done') targetStatus = ISSUE_PIPELINE_STATUS.closed;

                if (targetStatus && targetStatus !== cachedIssue.pipelineStatus) {
                  updateIssuePipelineStatus(
                    project.path,
                    queries,
                    cachedIssue,
                    targetStatus,
                    'github:refresh-issues',
                  );
                }
              }
            } catch (err) {
              log.warn('[github:refresh-issues] status sync failed', err);
            }
          }

          // Sync archive state from GitHub Project board
          if (archivedIssueNumbers.size > 0) {
            const idsToArchive = cachedAfterIssueSync.flatMap((candidate) =>
              archivedIssueNumbers.has(candidate.issueNumber) ? [candidate.id] : [],
            );
            if (idsToArchive.length > 0) {
              queries.githubIssues.archiveIssues(idsToArchive);
              log.info(
                `[github:refresh-issues] archived ${idsToArchive.length} issue(s) synced from GitHub Project`,
              );
            }
          }
        }
        await Promise.all(
          cachedAfterIssueSync.flatMap((issue) => {
            if (!issue.threadId) return [];
            if (
              !force &&
              issue.prLastSyncAt &&
              Date.now() - new Date(issue.prLastSyncAt).getTime() < PR_FEEDBACK_SYNC_TTL_MS
            ) {
              return [];
            }
            return [
              syncLinkedPullRequestFeedback(
                project,
                issue,
                queries,
                notificationService,
                chatNotificationService,
              ).catch((err) => {
                log.warn(
                  `[github:refresh-issues] PR feedback sync failed for #${issue.issueNumber}:`,
                  err,
                );
              }),
            ];
          }),
        );

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

  ipcMain.handle('github:triage-issues', async (_event, { projectId }: { projectId: string }) => {
    const project = queries.projects.getById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    if (!fs.existsSync(project.path)) {
      throw new Error(
        `Project path no longer exists: ${project.path}. Re-add the repository from a valid path.`,
      );
    }

    const settings = queries.settings.get();
    const ghCli = new GhCli(project.path);
    const candidates = queries.githubIssues
      .list(projectId)
      .filter(
        (issue) =>
          issue.state === 'open' &&
          issue.pipelineStatus === ISSUE_PIPELINE_STATUS.todo &&
          !issue.threadId &&
          !issue.isQuickMode &&
          isRealGithubIssueNumber(issue.issueNumber),
      );

    if (candidates.length === 0) {
      return {
        provider: settings.triageModel,
        modelId: settings.triageModelId,
        resolvedModel: settings.triageModelId,
        consideredCount: 0,
        appliedCount: 0,
        skippedCount: 0,
        threshold: settings.triageAutoApplyThreshold,
        issues: [],
      };
    }

    await ghCli.ensureLabels(SHIPCODE_DEFAULT_LABELS);
    const result = await triageGitHubIssues({
      cwd: project.path,
      issues: candidates,
      settings,
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    const candidatesByNumber = new Map(candidates.map((issue) => [issue.issueNumber, issue]));
    const threshold = settings.triageAutoApplyThreshold;
    let appliedCount = 0;
    const summaries = [];

    const triageResults = await Promise.all(
      result.recommendations.map(async (recommendation) => {
        const issue = candidatesByNumber.get(recommendation.issueNumber);
        if (!issue) return null;
        const applied = false;
        if (applied) {
          const nextLabels = mergeTriageLabels(issue.labels, recommendation);
          await ghCli.syncIssueLabels(issue.issueNumber, nextLabels, { removeAgentLabels: true });
          const refreshedIssue = await ghCli.getIssue(issue.issueNumber);
          queries.githubIssues.upsert({
            projectId,
            issueNumber: refreshedIssue.number,
            title: refreshedIssue.title,
            body: refreshedIssue.body,
            labels: refreshedIssue.labels,
            assignee: refreshedIssue.assignee,
            state: refreshedIssue.state,
          });
        }
        return {
          issueNumber: recommendation.issueNumber,
          confidence: recommendation.confidence,
          applied,
          suggestedLabels: recommendation.suggestedLabels,
          suggestedAgent: recommendation.suggestedAgent,
          shouldStart: recommendation.shouldStart,
          needsHuman: recommendation.needsHuman,
          rationale: recommendation.rationale,
        };
      }),
    );
    for (const summary of triageResults) {
      if (!summary) continue;
      if (summary.applied) appliedCount += 1;
      summaries.push(summary);
    }

    sendGithubIssuesUpdated(mainWindow, queries, projectId);
    return {
      provider: result.provider,
      modelId: result.modelId,
      resolvedModel: result.resolvedModel,
      consideredCount: candidates.length,
      appliedCount,
      skippedCount: Math.max(0, summaries.length - appliedCount),
      threshold,
      issues: summaries,
    };
  });

  ipcMain.handle(
    'github:archive-issue',
    async (
      _event,
      {
        projectId,
        issueId,
        issueNumber,
      }: { projectId: string; issueId: string; issueNumber: number },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const issue = getActiveIssueById(queries, projectId, issueId);
      if (!issue) throw new Error(`Issue ${issueId} not found in project ${projectId}`);

      // Close + archive on GitHub only for real GitHub issues.
      if (isRealGithubIssueNumber(issue.issueNumber)) {
        const ghCli = new GhCli(project.path);
        if (issue.state !== 'closed') {
          await ghCli.closeIssue(issue.issueNumber);
        }
        try {
          await ghCli.archiveProjectItems(issue.issueNumber);
        } catch (err) {
          log.warn('[github:archive-issue] project board archive failed after GitHub close:', err);
          throw new Error(
            `Issue #${issue.issueNumber} was closed on GitHub but could not be archived from the GitHub project board.`,
          );
        }
        queries.githubIssues.updateState(issue.id, 'closed');
      }

      try {
        updateIssuePipelineStatus(
          project.path,
          queries,
          issue,
          ISSUE_PIPELINE_STATUS.closed,
          'github:archive-issue',
        );
        queries.githubIssues.archiveIssues([issue.id]);
      } catch (err) {
        log.error('[github:archive-issue] DB archive failed:', err);
        throw new Error(
          `Issue #${issueNumber} could not be archived locally. Refresh the board to sync.`,
        );
      }

      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return { archivedCount: 1 };
    },
  );

  ipcMain.handle(
    'issue:mark-done',
    async (
      _event,
      {
        projectId,
        issueId,
        issueNumber,
      }: { projectId: string; issueId: string; issueNumber: number },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      // Automation issues are renderer-only (no github_issue_cache row).
      // Their issueId follows the pattern "automation:<threadId>".
      if (issueId.startsWith('automation:')) {
        const threadId = issueId.slice('automation:'.length);
        queries.threads.markDone(threadId);
        sendGithubIssuesUpdated(mainWindow, queries, projectId);
        return;
      }

      const issue = getActiveIssueById(queries, projectId, issueId);
      if (!issue) throw new Error(`Issue ${issueId} not found in project ${projectId}`);
      if (issue.issueNumber !== issueNumber) {
        throw new Error(`Issue ${issueId} no longer matches #${issueNumber}`);
      }

      if (isRealGithubIssueNumber(issue.issueNumber) && issue.state !== 'closed') {
        const ghCli = new GhCli(project.path);
        await ghCli.closeIssue(issue.issueNumber);
        queries.githubIssues.updateState(issue.id, 'closed');
      }

      updateIssuePipelineStatus(
        project.path,
        queries,
        issue,
        ISSUE_PIPELINE_STATUS.closed,
        'issue:mark-done',
      );
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
    },
  );

  ipcMain.handle(
    'github:mark-done',
    async (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in project ${projectId}`);
      assertRealGithubIssue(issue, 'close on GitHub');

      const thread = issue.threadId ? queries.threads.getById(issue.threadId) : null;
      const hasCompletionEvidence =
        issue.linkedPrNumber != null || thread?.status === PIPELINE_PHASE.completed;

      if (issue.state === 'closed') {
        queries.githubIssues.updateState(issue.id, 'closed');
        updateIssuePipelineStatus(
          project.path,
          queries,
          issue,
          ISSUE_PIPELINE_STATUS.closed,
          'github:mark-done',
        );
      } else if (hasCompletionEvidence) {
        queries.githubIssues.updateState(issue.id, 'open');
        updateIssuePipelineStatus(
          project.path,
          queries,
          issue,
          ISSUE_PIPELINE_STATUS.completed,
          'github:mark-done',
        );
      } else {
        const ghCli = new GhCli(project.path);
        await ghCli.closeIssue(issueNumber);
        queries.githubIssues.updateState(issue.id, 'closed');
        updateIssuePipelineStatus(
          project.path,
          queries,
          issue,
          ISSUE_PIPELINE_STATUS.closed,
          'github:mark-done',
        );
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
      updateIssuePipelineStatus(
        project.path,
        queries,
        issue,
        ISSUE_PIPELINE_STATUS.closed,
        'github:close-issue',
      );
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

      syncOpenIssueState(queries, issue, project.path);
      sendGithubIssuesUpdated(mainWindow, queries, projectId);
    },
  );

  ipcMain.handle(
    'github:update-issue-metadata',
    async (
      _event,
      {
        projectId,
        issueNumber,
        issueType,
        priority,
      }: {
        projectId: string;
        issueNumber: number;
        issueType?: string | null;
        priority?: string | null;
      },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in project ${projectId}`);
      assertRealGithubIssue(issue, 'update metadata');

      const ghCli = new GhCli(project.path);
      const metadata: Record<string, string> = {};
      if (issueType !== undefined) metadata.issueType = issueType ?? '';
      if (priority !== undefined) metadata.priority = priority ?? '';

      if (Object.keys(metadata).length > 0) {
        const warnings = await ghCli.setIssueProjectMetadata({
          issueNumber,
          projectUrl: project.githubProjectUrl,
          metadata,
        });
        if (warnings.length > 0) {
          throw new Error(warnings.join('; '));
        }
      }

      if (issueType !== undefined) {
        queries.githubIssues.setIssueType({ id: issue.id, issueType: issueType ?? null });
      }

      if (priority !== undefined) {
        const rank =
          priority === 'P0'
            ? 'p0'
            : priority === 'P1'
              ? 'p1'
              : priority === 'P2'
                ? 'p2'
                : priority === 'P3'
                  ? 'p3'
                  : null;
        queries.githubIssues.setPriority({
          id: issue.id,
          rank,
          raw: priority,
          fetchedAt: new Date().toISOString(),
        });
      }

      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return queries.githubIssues.getByNumber(projectId, issueNumber);
    },
  );

  ipcMain.handle(
    'github:archive-all-done',
    async (_event, { projectId }: { projectId: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const closedIssues = queries.githubIssues.listClosed(projectId);
      const githubClosedIssues = closedIssues.filter(
        (i) => !i.isQuickMode && isRealGithubIssueNumber(i.issueNumber),
      );
      const localClosedIssueIds = closedIssues.flatMap((issue) =>
        issue.isQuickMode || !isRealGithubIssueNumber(issue.issueNumber) ? [issue.id] : [],
      );
      const ghCli = new GhCli(project.path);
      const succeededIds: string[] = [];
      let failedCount = 0;
      const localAutomationArchivedCount = queries.threads.archiveClosedAutomationRuns(projectId);

      const archiveResults = await Promise.all(
        githubClosedIssues.map(async (issue) => {
          try {
            if (issue.state !== 'closed') {
              await ghCli.closeIssue(issue.issueNumber);
            }
            await ghCli.archiveProjectItems(issue.issueNumber);
            return { issueId: issue.id, ok: true };
          } catch (err) {
            log.warn(`[github:archive-all-done] archive #${issue.issueNumber} failed:`, err);
            return { issueId: issue.id, ok: false };
          }
        }),
      );
      for (const result of archiveResults) {
        if (result.ok) succeededIds.push(result.issueId);
        else failedCount++;
      }

      const archivedIssueIds = [...localClosedIssueIds, ...succeededIds];
      if (archivedIssueIds.length > 0) {
        queries.githubIssues.archiveIssues(archivedIssueIds);
      }

      sendGithubIssuesUpdated(mainWindow, queries, projectId);
      return {
        archivedCount: archivedIssueIds.length + localAutomationArchivedCount,
        failedCount,
      };
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
        prdMetadata,
      }: {
        projectId: string;
        title: string;
        body: string;
        labels?: string[];
        prdMetadata?: {
          estimatedComplexity: import('@shipcode/shared').PrdEstimatedComplexity;
          blastRadius: import('@shipcode/shared').PrdBlastRadius;
        };
      },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const ghCli = new GhCli(project.path);
      const issue = await ghCli.createIssue({ title, body, labels });
      let projectAttachWarning: string | null = null;

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

      if (parseGithubProjectUrl(project.githubProjectUrl) && issue.url) {
        projectAttachWarning = await attachIssueToConfiguredProjectBoard(
          project,
          ghCli,
          issue.number,
          issue.url,
          'github:create-issue',
        );
        if (prdMetadata) {
          try {
            const warnings = await ghCli.setIssueProjectMetadata({
              issueNumber: issue.number,
              projectUrl: project.githubProjectUrl,
              metadata: {
                issueType: 'Feature',
                status: 'Todo',
                priority: 'P3',
                complexity: prdMetadata.estimatedComplexity,
                blastRadius: prdMetadata.blastRadius,
              },
            });
            if (warnings.length > 0) {
              projectAttachWarning = [projectAttachWarning, ...warnings].filter(Boolean).join('; ');
            }
            const createdRecord = queries.githubIssues.getByNumber(projectId, issue.number);
            if (createdRecord) {
              queries.githubIssues.setIssueType({ id: createdRecord.id, issueType: 'Feature' });
              queries.githubIssues.setPriority({
                id: createdRecord.id,
                rank: 'p3',
                raw: 'P3',
                fetchedAt: new Date().toISOString(),
              });
            }
          } catch (err) {
            log.warn(`[github:create-issue] project metadata failed for #${issue.number}:`, err);
            projectAttachWarning = [projectAttachWarning, clampError(err)]
              .filter(Boolean)
              .join('; ');
          }
        }
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
        prdMetadata,
      }: {
        projectId: string;
        issueNumber: number;
        title: string;
        body: string;
        labels?: string[];
        prdMetadata?: {
          estimatedComplexity: import('@shipcode/shared').PrdEstimatedComplexity;
          blastRadius: import('@shipcode/shared').PrdBlastRadius;
        };
      },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      const cachedIssue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!cachedIssue) throw new Error(`Issue #${issueNumber} not found in project ${projectId}`);
      assertRealGithubIssue(cachedIssue, 'edit on GitHub');

      const ghCli = new GhCli(project.path);
      await ghCli.editIssue({ issueNumber, title, body, labels });
      if (prdMetadata) {
        await attachIssueToConfiguredProjectBoard(
          project,
          ghCli,
          issueNumber,
          deriveGithubIssueUrl(project.gitRemote, issueNumber),
          'github:edit-issue-body',
        );
        try {
          await ghCli.setIssueProjectMetadata({
            issueNumber,
            projectUrl: project.githubProjectUrl,
            metadata: {
              issueType: 'Feature',
              complexity: prdMetadata.estimatedComplexity,
              blastRadius: prdMetadata.blastRadius,
            },
          });
        } catch (err) {
          log.warn(`[github:edit-issue-body] project metadata failed for #${issueNumber}:`, err);
        }
      }

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

      const projectUrl = project.githubProjectUrl;
      if (!projectUrl) {
        throw new Error('No GitHub Projects v2 URL set. Paste a board URL above and save first.');
      }
      const parsed = parseGithubProjectUrl(projectUrl);
      if (!parsed) {
        throw new Error('No GitHub Projects v2 URL set. Paste a board URL above and save first.');
      }

      const issues = queries.githubIssues
        .list(projectId)
        .filter((i) => !i.isQuickMode && isRealGithubIssueNumber(i.issueNumber));
      const ghCli = new GhCli(project.path);
      const githubRemoteRef = parseGithubRemote(project.gitRemote);
      let githubRepoFullName =
        project.githubRepoFullName ??
        (githubRemoteRef ? `${githubRemoteRef.owner}/${githubRemoteRef.repo}` : null);
      if (!project.githubRepoFullName) {
        try {
          const metadata = await ghCli.getRepoMetadata();
          githubRepoFullName = metadata.githubRepoFullName;
          queries.projects.updateGithubRepoIdentity(project.id, metadata);
        } catch (err) {
          log.warn('[github:sync-to-project-board] repo identity backfill failed', err);
        }
      }

      let attached = 0;
      let alreadyPresent = 0;
      let failed = 0;
      const errors: string[] = [];

      const attachResults = await Promise.all(
        issues.map(async (issue) => {
          const issueUrl = deriveGithubIssueUrl(project.gitRemote, issue.issueNumber);
          if (!issueUrl) {
            return {
              status: 'failed' as const,
              error: `#${issue.issueNumber}: could not derive issue URL from git remote`,
            };
          }
          try {
            const result = await ghCli.addIssueToProject({
              projectNumber: parsed.number,
              owner: parsed.owner,
              issueUrl,
            });
            return {
              status: result.alreadyPresent ? ('already-present' as const) : ('attached' as const),
            };
          } catch (err) {
            log.warn(`[github:sync-to-project-board] #${issue.issueNumber} failed:`, err);
            return {
              status: 'failed' as const,
              error: `#${issue.issueNumber}: ${clampError(err)}`,
            };
          }
        }),
      );
      for (const result of attachResults) {
        if (result.status === 'attached') attached += 1;
        else if (result.status === 'already-present') alreadyPresent += 1;
        else if (result.status === 'failed') {
          failed += 1;
          errors.push(result.error);
        }
      }

      try {
        const priorityResult = await fetchProjectPriorities({
          cwd: project.path,
          projectUrl,
          repoFullName: githubRepoFullName ?? undefined,
          onWarn: (msg, err) => log.warn(msg, err),
        });
        const now = new Date().toISOString();
        for (const issue of issues) {
          const p = priorityResult.priorities.get(issue.issueNumber) ?? {
            rank: null,
            raw: null,
          };
          queries.githubIssues.setPriority({
            id: issue.id,
            rank: p.rank,
            raw: p.raw,
            fetchedAt: now,
          });
          queries.githubIssues.setIssueType({
            id: issue.id,
            issueType: priorityResult.issueTypes?.get(issue.issueNumber) ?? null,
          });
        }
        const refreshedIssues = queries.githubIssues.list(projectId);
        mainWindow.webContents.send('github:issues-updated', {
          projectId,
          issues: refreshedIssues,
        });
      } catch (err) {
        log.warn('[github:sync-to-project-board] priority sync failed', err);
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
    'github:check-project-readiness',
    async (_event, { projectId }: { projectId: string }) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);
      if (!fs.existsSync(project.path)) {
        throw new Error(
          `Project path no longer exists: ${project.path}. Re-add the repository from a valid path.`,
        );
      }

      const report = await checkProjectReadiness({
        cwd: project.path,
        projectUrl: project.githubProjectUrl,
        repairLabels: true,
        onWarn: (msg, err) => log.warn(msg, err),
      });

      if (report.statusMapping) {
        queries.projects.setGithubStatusMapping(projectId, report.statusMapping);
      } else if (project.githubProjectUrl) {
        queries.projects.clearGithubStatusMapping(projectId);
      }

      log.info(
        `[github:check-project-readiness] project=${projectId} ok=${report.ok} items=${report.items.length} labelsCreated=${report.labelSync.created.length}`,
      );
      return report;
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

  // Auto-run: count eligible todo issues for the "Run (X)" button
  ipcMain.handle(
    'github:auto-run-count',
    (
      _event,
      {
        projectId,
        priorities,
        maxTasks,
      }: { projectId: string; priorities: Array<'p0' | 'p1' | 'p2' | 'p3'>; maxTasks: number },
    ) => {
      const total = queries.githubIssues.countEligibleTodo(projectId, priorities);
      return { count: maxTasks > 0 ? Math.min(total, maxTasks) : total };
    },
  );

  // Auto-run: batch-enqueue all eligible todo issues by priority
  ipcMain.handle(
    'github:auto-run',
    async (
      _event,
      {
        projectId,
        priorities,
        maxTasks,
      }: {
        projectId: string;
        priorities: Array<'p0' | 'p1' | 'p2' | 'p3'>;
        maxTasks: number;
      },
    ) => {
      const project = queries.projects.getById(projectId);
      if (!project) throw new Error(`Project ${projectId} not found`);

      let eligible = queries.githubIssues.getEligibleTodoIssues(projectId, priorities);
      if (maxTasks > 0) eligible = eligible.slice(0, maxTasks);
      let started = 0;
      let queued = 0;

      const runResults = await Promise.all(
        eligible.map(async (issue) => {
          try {
            const issueUrl = deriveGithubIssueUrl(project.gitRemote, issue.issueNumber);
            const ghCliForAttach = new GhCli(project.path);
            await attachIssueToConfiguredProjectBoard(
              project,
              ghCliForAttach,
              issue.issueNumber,
              issueUrl,
              'github:auto-run',
            );
            const result = await scheduler.startOrQueue(projectId, issue.issueNumber);
            return result.queued ? 'queued' : 'started';
          } catch (err) {
            log.error(`[auto-run] failed to enqueue issue #${issue.issueNumber}:`, err);
            return 'failed';
          }
        }),
      );
      started = runResults.filter((result) => result === 'started').length;
      queued = runResults.filter((result) => result === 'queued').length;

      log.info(
        `[auto-run] batch complete: ${started} started, ${queued} queued out of ${eligible.length} eligible`,
      );
      return { started, queued };
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

  const VALID_PHASE_ROLES = new Set(['planner', 'reviewer', 'executor', 'verifier'] as const);
  type PhaseRole = 'planner' | 'reviewer' | 'executor' | 'verifier';
  function assertPhaseRole(phase: string): asserts phase is PhaseRole {
    if (!VALID_PHASE_ROLES.has(phase as PhaseRole)) {
      throw new Error(`Invalid phase role: ${phase}`);
    }
  }

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
      assertPhaseRole(phase);
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
      assertPhaseRole(phase);
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
      assertPhaseRole(phase);
      const issue = queries.githubIssues.getByNumber(projectId, issueNumber);
      if (!issue) throw new Error(`Issue #${issueNumber} not found in cache`);
      const trimmed = modelId.trim();
      if (trimmed && !/^[a-zA-Z0-9._:/@-]+$/.test(trimmed)) {
        throw new Error(`Invalid model ID: ${trimmed}`);
      }
      queries.githubIssues.updatePhaseModelIdOverride(issue.id, phase, trimmed || null);
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
      assertPhaseRole(phase);
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
      assertPhaseRole(phase);
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
      assertPhaseRole(phase);
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
          'Goals, Non-Goals, User Stories, System Specification, Functional Requirements, ' +
          'Non-Functional Requirements, Feature Phase Breakdown, Success Criteria, Out of Scope, ' +
          'Dependencies, Verification Plan, Risks & Open Questions. Feature Phase Breakdown must contain exactly three ordered phases.';
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
