import fs from 'node:fs';
import {
  checkCliModelCapabilities,
  DEFAULT_SKILLS,
  GhCli,
  inspectProjectSetup,
  StreamParser,
} from '@shipcode/agents';
import { type PipelineEmitter, syncThreadAndIssuePhase } from '@shipcode/pipeline';
import type { ShipCodePlan } from '@shipcode/shared';
import {
  assessCliSelectionAvailabilityFromCapabilities,
  clampError,
  DEFAULT_SETTINGS,
  type ExecutorModel,
  type GeneratorCli,
  type PipelinePhase,
  parseGithubProjectUrl,
  type ReasoningEffort,
  resolveEffectivePhaseReasoningEffort,
  resolveEffectivePhaseReasoningEffortForIssue,
  resolvePhaseModel,
  resolvePhaseModelForIssue,
  resolvePhaseModelId,
  resolvePhaseModelIdForIssue,
  SHIPCODE_CI_BLOCKED_LABEL,
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
    plannerReasoningEffort: resolveEffectivePhaseReasoningEffort(settings, project, 'planner'),
    reviewerReasoningEffort: resolveEffectivePhaseReasoningEffort(settings, project, 'reviewer'),
    verifierReasoningEffort: resolveEffectivePhaseReasoningEffort(settings, project, 'verifier'),
    executorReasoningEffort: resolveEffectivePhaseReasoningEffort(settings, project, 'executor'),
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

type PhaseModels = ReturnType<typeof resolveProjectPhaseModels>;

export async function assertCliPhaseModelsSupported(phaseModels: PhaseModels): Promise<void> {
  const capabilities = await checkCliModelCapabilities();
  const phases = [
    {
      label: 'Planner',
      provider: phaseModels.plannerModel,
      modelId: phaseModels.plannerModelId,
      effort: phaseModels.plannerReasoningEffort ?? DEFAULT_SETTINGS.plannerReasoningEffort,
    },
    {
      label: 'Reviewer',
      provider: phaseModels.reviewerModel,
      modelId: phaseModels.reviewerModelId,
      effort: phaseModels.reviewerReasoningEffort ?? DEFAULT_SETTINGS.reviewerReasoningEffort,
    },
    {
      label: 'Executor',
      provider: phaseModels.executorModel,
      modelId: phaseModels.executorModelId,
      effort: phaseModels.executorReasoningEffort ?? DEFAULT_SETTINGS.executorReasoningEffort,
    },
    {
      label: 'Verifier',
      provider: phaseModels.verifierModel,
      modelId: phaseModels.verifierModelId,
      effort: phaseModels.verifierReasoningEffort ?? DEFAULT_SETTINGS.verifierReasoningEffort,
    },
  ] satisfies Array<{
    label: string;
    provider: ExecutorModel;
    modelId: string | null;
    effort: ReasoningEffort;
  }>;

  for (const phase of phases) {
    const cliProvider = phase.provider;
    if (cliProvider === 'openrouter') continue;
    const selection = assessCliSelectionAvailabilityFromCapabilities(
      capabilities,
      cliProvider,
      phase.modelId,
      phase.effort,
    );
    if (!selection.available) throw new Error(`${phase.label}: ${selection.message}`);
  }
}

export async function assertPrdRewriteModelSupported(
  cli: GeneratorCli,
  modelId: string | null,
  effort: ReasoningEffort,
): Promise<void> {
  const capabilities = await checkCliModelCapabilities();
  const selection = assessCliSelectionAvailabilityFromCapabilities(
    capabilities,
    cli,
    modelId,
    effort ?? DEFAULT_SETTINGS.prdRewriteReasoningEffort,
  );
  if (!selection.available) {
    throw new Error(selection.message ?? `${cli} model selection is unavailable`);
  }
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
      queries.githubIssues.setCachedLabelPresence(issue.id, SHIPCODE_CI_BLOCKED_LABEL, false);
      await ghCli.setIssueLabelPresence(issue.issueNumber, SHIPCODE_CI_BLOCKED_LABEL, false);
    }
    queries.githubIssues.reconcileCompletedFromEvidence(issue.id);
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
  queries.githubIssues.reconcileCompletedFromEvidence(issue.id);

  if (feedback.ciBlocked !== issue.ciBlocked) {
    queries.githubIssues.setCachedLabelPresence(
      issue.id,
      SHIPCODE_CI_BLOCKED_LABEL,
      feedback.ciBlocked,
    );
    await ghCli.setIssueLabelPresence(
      issue.issueNumber,
      SHIPCODE_CI_BLOCKED_LABEL,
      feedback.ciBlocked,
    );
    if (feedback.ciBlocked) {
      notificationService.fire('ci_blocked', thread);
      chatNotificationService.fire('ci_blocked', thread);
    }
  } else if (feedback.ciBlocked) {
    queries.githubIssues.setCachedLabelPresence(issue.id, SHIPCODE_CI_BLOCKED_LABEL, true);
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
  if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  try {
    mainWindow.webContents.send('github:issues-updated', {
      projectId,
      issues: queries.githubIssues.list(projectId),
    });
  } catch {
    /* render frame disposed during HMR */
  }
}

type AttentionPhase = Extract<
  PipelinePhase,
  'clarifying' | 'approval' | 'completed' | 'failed' | 'idle'
>;

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
  syncThreadAndIssuePhase(
    queries.threads,
    queries.githubIssues,
    threadId,
    phase,
    errorMessage ?? undefined,
  );

  const issue = queries.githubIssues.getByThreadId(threadId);
  if (issue) sendGithubIssuesUpdated(mainWindow, queries, issue.projectId);

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
