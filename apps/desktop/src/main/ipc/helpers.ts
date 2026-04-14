import fs from 'node:fs';
import { DEFAULT_SKILLS, GhCli, StreamParser } from '@shipcode/agents';
import { inspectProjectSetup } from '@shipcode/agents/source';
import type { PipelineEmitter } from '@shipcode/pipeline';
import type { ShipCodePlan } from '@shipcode/shared';
import {
  clampError,
  type IssuePipelineStatus,
  type PipelinePhase,
  parseGithubProjectUrl,
  resolvePhaseModel,
  resolvePhaseModelForIssue,
  resolvePhaseModelId,
  resolvePhaseModelIdForIssue,
  resolvePhaseReasoningEffort,
} from '@shipcode/shared';
import type { BrowserWindow } from 'electron';
import type { ChatNotificationService } from '../chat-notification-service';
import log from '../logger.service';
import type { NotificationService } from '../notification-service';
import type { Queries } from './types';

export function enrichProjectPath(project: import('@shipcode/shared').Project | null) {
  if (!project) return null;
  const setup = inspectProjectSetup(project.path);
  return {
    ...project,
    pathExists: fs.existsSync(project.path),
    setupStatus: setup.status,
    setupPath: setup.path,
    setupError: setup.error,
  };
}

export function enrichProjectPaths(projects: import('@shipcode/shared').Project[]) {
  return projects.map((project) => {
    const setup = inspectProjectSetup(project.path);
    return {
      ...project,
      pathExists: fs.existsSync(project.path),
      setupStatus: setup.status,
      setupPath: setup.path,
      setupError: setup.error,
    };
  });
}

export function resolveProjectPhaseModels(
  settings: ReturnType<Queries['settings']['get']>,
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

export function resolveIssuePhaseModels(
  settings: ReturnType<Queries['settings']['get']>,
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

export function tryParsePlan(rawOutput: string): ShipCodePlan | null {
  if (!rawOutput) return null;
  const parser = new StreamParser();
  parser.feed(rawOutput);
  const result = parser.extractPlan();
  return result.success ? result.data : null;
}

export async function syncLinkedPullRequestFeedback(
  project: import('@shipcode/shared').Project,
  issue: import('@shipcode/shared').GitHubIssueCacheRecord,
  queries: Queries,
  notificationService: NotificationService,
  chatNotificationService: ChatNotificationService,
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
      chatNotificationService.fire('ci_blocked', thread);
    }
  } else if (feedback.ciBlocked) {
    queries.githubIssues.setCachedLabelPresence(issue.id, 'blocked:ci', true);
  }
}

export async function attachIssueToConfiguredProjectBoard(
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

export function sendGithubIssuesUpdated(
  mainWindow: BrowserWindow,
  queries: Queries,
  projectId: string,
) {
  mainWindow.webContents.send('github:issues-updated', {
    projectId,
    issues: queries.githubIssues.list(projectId),
  });
}

type AttentionPhase = Extract<PipelinePhase, 'awaiting_approval' | 'completed' | 'failed' | 'idle'>;

function mapPhaseToIssueStatus(phase: AttentionPhase): IssuePipelineStatus {
  return phase === 'idle' ? 'todo' : phase;
}

export function transitionThreadPhase(
  mainWindow: BrowserWindow,
  queries: Queries,
  emitter: PipelineEmitter,
  {
    threadId,
    phase,
    errorMessage = null,
  }: {
    threadId: string;
    phase: AttentionPhase;
    errorMessage?: string | null;
  },
) {
  queries.threads.updateStatus(threadId, phase, errorMessage ?? undefined);

  const issue = queries.githubIssues.getByThreadId(threadId);
  if (issue) {
    queries.githubIssues.updatePipelineStatus(issue.id, mapPhaseToIssueStatus(phase));
    sendGithubIssuesUpdated(mainWindow, queries, issue.projectId);
  }

  emitter.emit({ type: 'pipeline:phase', threadId, phase });
}

export function buildSkillRow(
  queries: Queries,
  phase: import('@shipcode/shared').PhaseSkillKey,
  projectId: string | null,
) {
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
