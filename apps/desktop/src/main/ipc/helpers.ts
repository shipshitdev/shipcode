import fs from 'node:fs';
import {
  checkCliModelCapabilities,
  checkSystemHealth,
  DEFAULT_SKILLS,
  GhCli,
  inspectProjectSetup,
  StreamParser,
  validateProjectStatusField,
} from '@shipcode/agents';
import {
  buildPullRequestFeedbackFindingInputs,
  type GhSyncDeps,
  type PipelineEmitter,
  syncThreadAndIssuePhase,
} from '@shipcode/pipeline';
import type { ShipCodePlan } from '@shipcode/shared';
import {
  assessCliSelectionAvailabilityFromCapabilities,
  CLI_PROVIDER_LABELS,
  type CliModelCapabilities,
  clampError,
  DEFAULT_SETTINGS,
  type ExecutorModel,
  type GeneratorCli,
  type GitHubIssueCacheRecord,
  ISSUE_PIPELINE_STATUS,
  isPipelineStateLabel,
  type PhaseCliProvider,
  type PipelinePhase,
  parseGithubProjectUrl,
  pipelineLabelForStatus,
  type ReasoningEffort,
  resolveEffectivePhaseReasoningEffort,
  resolveIssuePhaseModels,
  resolvePhaseModel,
  resolvePhaseModelId,
  SHIPCODE_CI_BLOCKED_LABEL,
  SHIPCODE_PIPELINE_LABELS,
  type SystemHealth,
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

/**
 * Projects whose GitHub Projects-v2 board has already been probed this session.
 * A repo with no associated board legitimately resolves to `githubProjectUrl: null`,
 * so without this guard every `github:refresh-issues` (fired on nearly every UI
 * action) would re-run `gh repo view … projectsV2` forever for board-less repos.
 * Session-scoped: a probe runs at most once per project per app launch, and a manual
 * URL clear re-arms detection so the documented "clearing resumes auto-detect" holds.
 */
const githubProjectBoardChecked = new Set<string>();

export function hasCheckedGithubProjectBoard(projectId: string): boolean {
  return githubProjectBoardChecked.has(projectId);
}

export function markGithubProjectBoardChecked(projectId: string): void {
  githubProjectBoardChecked.add(projectId);
}

export async function persistGithubProjectConfiguration({
  queries,
  projectId,
  projectPath,
  projectUrl,
  source,
}: {
  queries: Queries;
  projectId: string;
  projectPath: string;
  projectUrl: string | null;
  source: string;
}): Promise<void> {
  queries.projects.updateGithubProjectUrl(projectId, projectUrl);
  if (!projectUrl) {
    queries.projects.clearGithubStatusMapping(projectId);
    // A manual clear should let auto-detection run again on the next refresh.
    githubProjectBoardChecked.delete(projectId);
    return;
  }

  try {
    const validation = await validateProjectStatusField({
      cwd: projectPath,
      projectUrl,
      onWarn: (message: string, err?: unknown) =>
        log.warn(`[${source}] status validation:`, message, err),
    });
    if (validation.mapping) {
      queries.projects.setGithubStatusMapping(projectId, validation.mapping);
    } else {
      queries.projects.clearGithubStatusMapping(projectId);
    }

    if (validation.ok && validation.mapping) {
      const ghCli = new GhCli(projectPath);
      await ghCli.ensureLabels([...SHIPCODE_PIPELINE_LABELS]);
      log.info(`[${source}] status mapping auto-detected`, { mapping: validation.mapping });
      return;
    }

    log.info(`[${source}] status auto-detection partial/failed`, {
      ok: validation.ok,
      reason: validation.reason,
      available: validation.availableOptions,
    });
  } catch (err) {
    log.warn(`[${source}] status field validation error:`, err);
  }
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

export { resolveIssuePhaseModels };

type PhaseModels = ReturnType<typeof resolveProjectPhaseModels>;

function assertCliSelectionSupported(
  capabilities: Record<PhaseCliProvider, CliModelCapabilities>,
  systemHealth: SystemHealth,
  label: string,
  provider: PhaseCliProvider,
  modelId: string | null,
  effort: ReasoningEffort,
): void {
  const providerCapabilities = capabilities[provider];
  const installedVersion = systemHealth[provider]?.version;
  const versionLabel = installedVersion ? ` ${installedVersion}` : '';
  const modelLabel = modelId ?? 'the configured default model';

  // Codex publishes an authoritative local catalog. Falling back to ShipCode's
  // curated list when that command is missing or fails must not be treated as
  // proof that a stale CLI can serve a newly curated model.
  if (provider === 'codex' && modelId && providerCapabilities.source !== 'catalog') {
    throw new Error(
      `${label}: ${CLI_PROVIDER_LABELS.codex}${versionLabel} cannot confirm it serves ${modelLabel}. ${providerCapabilities.error ?? 'The installed CLI did not return a model catalog.'}`,
    );
  }

  const selection = assessCliSelectionAvailabilityFromCapabilities(
    capabilities,
    provider,
    modelId,
    effort,
  );
  if (!selection.available) {
    throw new Error(
      `${label}: ${CLI_PROVIDER_LABELS[provider]}${versionLabel} cannot serve ${modelLabel}. ${selection.message}`,
    );
  }
}

export async function assertCliPhaseModelsSupported(phaseModels: PhaseModels): Promise<void> {
  const [capabilities, systemHealth] = await Promise.all([
    checkCliModelCapabilities(),
    checkSystemHealth(),
  ]);
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
    assertCliSelectionSupported(
      capabilities,
      systemHealth,
      phase.label,
      cliProvider,
      phase.modelId,
      phase.effort,
    );
  }
}

export async function assertPrdRewriteModelSupported(
  cli: GeneratorCli,
  modelId: string | null,
  effort: ReasoningEffort,
): Promise<void> {
  const [capabilities, systemHealth] = await Promise.all([
    checkCliModelCapabilities(),
    checkSystemHealth(),
  ]);
  assertCliSelectionSupported(
    capabilities,
    systemHealth,
    'PRD rewrite',
    cli,
    modelId,
    effort ?? DEFAULT_SETTINGS.prdRewriteReasoningEffort,
  );
}

export function resolvePrdRewriteContext(
  settings: Pick<
    ReturnType<Queries['settings']['get']>,
    'prdRewriteCli' | 'prdRewriteClaudeModel' | 'prdRewriteCodexModel' | 'prdRewriteReasoningEffort'
  >,
) {
  return {
    cli: settings.prdRewriteCli,
    modelId:
      settings.prdRewriteCli === 'claude'
        ? settings.prdRewriteClaudeModel
        : settings.prdRewriteCodexModel,
    reasoningEffort: settings.prdRewriteReasoningEffort,
  };
}

export function tryParsePlan(rawOutput: string): ShipCodePlan | null {
  if (!rawOutput) return null;
  const parser = new StreamParser();
  parser.feed(rawOutput);
  const result = parser.extractPlan();
  return result.success ? result.data : null;
}

type LinkedPullRequestFeedback = Awaited<ReturnType<GhCli['getPullRequestFeedback']>>;
const PR_REVIEW_PIPELINE_STATUSES = new Set<import('@shipcode/shared').IssuePipelineStatus>([
  ISSUE_PIPELINE_STATUS.needsReview,
  ISSUE_PIPELINE_STATUS.readyToMerge,
]);

function resolveLinkedPullRequestPipelineStatus(
  feedback: Pick<
    LinkedPullRequestFeedback,
    'isDraft' | 'state' | 'reviewDecision' | 'reviewRequestCount'
  >,
) {
  if (feedback.state === 'MERGED') return ISSUE_PIPELINE_STATUS.completed;
  if (feedback.state === 'CLOSED') return ISSUE_PIPELINE_STATUS.executing;
  if (feedback.isDraft) return ISSUE_PIPELINE_STATUS.executing;
  if (
    feedback.reviewDecision === 'CHANGES_REQUESTED' ||
    feedback.reviewDecision === 'REVIEW_REQUIRED' ||
    feedback.reviewRequestCount > 0
  ) {
    return ISSUE_PIPELINE_STATUS.needsReview;
  }
  if (feedback.reviewDecision === 'APPROVED') return ISSUE_PIPELINE_STATUS.readyToMerge;
  return ISSUE_PIPELINE_STATUS.completed;
}

async function syncCachedIssuePipelineLabel(
  ghSync: GhSyncDeps | undefined,
  project: import('@shipcode/shared').Project,
  issue: GitHubIssueCacheRecord,
  queries: Queries,
  status: import('@shipcode/shared').IssuePipelineStatus,
): Promise<void> {
  const targetLabel = pipelineLabelForStatus(status);
  const staleLabels = new Set(issue.labels.filter(isPipelineStateLabel));
  const currentStatusLabel = pipelineLabelForStatus(issue.pipelineStatus);
  if (currentStatusLabel) staleLabels.add(currentStatusLabel);

  // Update the local SQLite cache synchronously for instant UI feedback;
  // the actual GitHub write (labels + Projects v2 Status field) is
  // delegated to the shared gh-sync queue below so it never races other
  // writers for the same issue.
  for (const label of staleLabels) {
    if (label === targetLabel) continue;
    queries.githubIssues.setCachedLabelPresence(issue.id, label, false);
  }
  if (targetLabel) {
    queries.githubIssues.setCachedLabelPresence(issue.id, targetLabel, true);
  }

  if (!ghSync) return;
  await ghSync.syncToGithub({
    projectPath: project.path,
    projectUrl: project.githubProjectUrl,
    issueNumber: issue.issueNumber,
    pipelineStatus: status,
    statusMapping: project.githubStatusMapping,
  });
}

export async function syncLinkedPullRequestFeedback(
  project: import('@shipcode/shared').Project,
  issue: import('@shipcode/shared').GitHubIssueCacheRecord,
  queries: Queries,
  notificationService: NotificationService,
  chatNotificationService: ChatNotificationService,
  ghSync?: GhSyncDeps,
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
    if (thread?.id && queries.reviewFindings) {
      queries.reviewFindings.supersedeOpen({ threadId: thread.id, source: 'ci' });
      queries.reviewFindings.supersedeOpen({ threadId: thread.id, source: 'pr_review' });
    }
    queries.githubIssues.reconcileCompletedFromEvidence(issue.id);
    if (PR_REVIEW_PIPELINE_STATUSES.has(issue.pipelineStatus)) {
      queries.githubIssues.updatePipelineStatus(issue.id, ISSUE_PIPELINE_STATUS.completed);
      await syncCachedIssuePipelineLabel(
        ghSync,
        project,
        issue,
        queries,
        ISSUE_PIPELINE_STATUS.completed,
      );
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
  queries.githubIssues.reconcileCompletedFromEvidence(issue.id);
  const reviewStatus = resolveLinkedPullRequestPipelineStatus(feedback);
  if (issue.pipelineStatus !== reviewStatus) {
    queries.githubIssues.updatePipelineStatus(issue.id, reviewStatus);
  }
  await syncCachedIssuePipelineLabel(ghSync, project, issue, queries, reviewStatus);
  if (queries.reviewFindings) {
    const latestPlan = queries.plans.getLatest(thread.id);
    const findings = buildPullRequestFeedbackFindingInputs({
      projectId: project.id,
      threadId: thread.id,
      planId: latestPlan?.id ?? null,
      runId: thread.currentRunId ?? null,
      prNumber: feedback.number,
      worktreePath: thread.worktreePath ?? null,
      branch: thread.worktreeBranch ?? null,
      commitSha: null,
      failingChecks: feedback.failingChecks,
      unresolvedReviewComments: feedback.unresolvedReviewComments,
    });
    queries.reviewFindings.syncOpenForPullRequestFeedback({ threadId: thread.id, findings });
  }

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
    const message = clampError(err);
    log.warn(`[${source}] project attach failed for #${issueNumber}: ${message}`);
    return message;
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
  ghSync?: GhSyncDeps,
) {
  syncThreadAndIssuePhase(
    queries.threads,
    queries.githubIssues,
    threadId,
    phase,
    errorMessage ?? undefined,
    ghSync,
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
