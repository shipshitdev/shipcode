import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ActivePipelineSummary,
  HeatmapQueryArgs,
  PipelineRunTimelineEntry,
  TerminalEventRecord,
  Thread,
} from '@shipcode/shared';
import {
  clampError,
  clarificationAnswerSchema,
  EXECUTION_PHASES,
  PAUSABLE_PIPELINE_PHASES,
  PIPELINE_PHASE,
  resolveExecutorModelForIssue,
  resolveRequireApproval,
  resolveRequireApprovalForIssue,
  resolveRevisionCount,
  resolveRevisionCountForIssue,
  resolveThreadPhasePresentation,
  stripAnsi,
} from '@shipcode/shared';

import { logEvent } from '../logger.service';
import {
  assertCliPhaseModelsSupported,
  resolveIssuePhaseModels,
  resolveProjectPhaseModels,
  transitionThreadPhase,
  tryParsePlan,
} from './helpers';
import { getRetryAction } from './retry-phase';
import type { IpcHandlerDeps } from './types';

const execFileAsync = promisify(execFile);
const AUTO_FIX_FAILURE_OUTPUT_MAX = 8_000;
const EXECUTION_RESUME_PROMPT_MAX = 24_000;
const EXECUTION_RESUME_GIT_OUTPUT_MAX = 12_000;
const EXECUTION_RESUME_TERMINAL_LIMIT = 120;
const RUN_TIMELINE_TERMINAL_LIMIT = 40;
const INTERRUPTED_EXECUTION_MARKERS = [
  'interrupted while ShipCode was closed',
  'interrupted by an app refresh',
  'Agent process stalled',
] as const;
const PAUSABLE_PHASE_SET = new Set<string>(PAUSABLE_PIPELINE_PHASES);
const EXECUTION_PHASE_SET = new Set<string>(EXECUTION_PHASES);

function clampAutoFixFailureOutput(output: string): string {
  const cleaned = stripAnsi(output).trim();
  if (cleaned.length <= AUTO_FIX_FAILURE_OUTPUT_MAX) return cleaned;

  const truncated = cleaned.slice(-AUTO_FIX_FAILURE_OUTPUT_MAX);
  return `[Earlier terminal output truncated for Auto Fix]\n\n${truncated}`;
}

function clampResumeText(value: string, max: number, label: string): string {
  const cleaned = stripAnsi(value).trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}\n\n[${label} truncated after ${max} chars]`;
}

function isInterruptedExecutionThread(thread: Thread): boolean {
  if (
    thread.status === PIPELINE_PHASE.paused &&
    thread.pausedPhase &&
    EXECUTION_PHASE_SET.has(thread.pausedPhase)
  ) {
    return true;
  }
  if (
    thread.failurePhase !== PIPELINE_PHASE.executing &&
    thread.status !== PIPELINE_PHASE.executing
  ) {
    return false;
  }
  return INTERRUPTED_EXECUTION_MARKERS.some((marker) => thread.lastError?.includes(marker));
}

function formatTerminalResumeLine(record: TerminalEventRecord): string | null {
  const event = record.event;
  switch (event.kind) {
    case 'text':
    case 'raw':
    case 'thinking':
      return event.content;
    case 'error':
      return `[error] ${event.message}`;
    case 'lifecycle':
      return `[lifecycle] ${event.message}`;
    case 'tool_start':
      return `[tool:start] ${event.name}: ${event.summary}`;
    case 'tool_end':
      return `[tool:end] ${event.name}${event.exitCode === undefined ? '' : ` exit=${event.exitCode}`}${
        event.outputSummary ? ` ${event.outputSummary}` : ''
      }`;
    case 'turn_start':
      return `[turn:start] ${event.turn}`;
    case 'turn_end':
      return `[turn:end] ${event.turn}`;
    case 'action':
      return `[action] ${event.label}`;
    case 'clarification_requested':
      return `[clarification_requested] ${event.summary}`;
    case 'clarification_answered':
      return `[clarification_answered] ${event.questionCount} answers`;
    case 'done':
      return '[done]';
    default:
      return null;
  }
}

async function readGitResumeOutput(cwd: string, args: string[], label: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: EXECUTION_RESUME_GIT_OUTPUT_MAX * 4,
    });
    return clampResumeText(String(stdout), EXECUTION_RESUME_GIT_OUTPUT_MAX, label);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `[Unable to read ${label}: ${message}]`;
  }
}

async function buildExecutionResumeContext(
  thread: Thread,
  queries: IpcHandlerDeps['queries'],
): Promise<string | null> {
  if (!isInterruptedExecutionThread(thread) || !thread.worktreePath) return null;

  const isPaused = thread.status === PIPELINE_PHASE.paused;
  const interruptedPhase = isPaused ? thread.pausedPhase : (thread.failurePhase ?? thread.status);
  const checkpoint = queries.checkpoints.getLatest(thread.id);
  const diffBase = checkpoint?.commitSha ?? 'HEAD';
  const [status, changedFiles, diffStat, diffExcerpt] = await Promise.all([
    readGitResumeOutput(thread.worktreePath, ['status', '--short'], 'git status'),
    readGitResumeOutput(
      thread.worktreePath,
      ['diff', '--name-only', diffBase, '--'],
      'changed files',
    ),
    readGitResumeOutput(thread.worktreePath, ['diff', '--stat', diffBase, '--'], 'diff stat'),
    readGitResumeOutput(thread.worktreePath, ['diff', diffBase, '--'], 'diff excerpt'),
  ]);
  const terminalTail = queries.terminalEvents
    .listByThread(thread.id, EXECUTION_RESUME_TERMINAL_LIMIT)
    .flatMap((event) => {
      const line = formatTerminalResumeLine(event);
      return line?.trim() ? [line] : [];
    })
    .join('\n');

  const sections = [
    '<interrupted_run_context>',
    isPaused
      ? 'The previous execution was paused by the user. This is a semantic resume, not a clean restart.'
      : 'The previous execution was interrupted. This is a semantic resume, not a clean restart.',
    '',
    `Interrupted phase: ${interruptedPhase ?? thread.status}`,
    `Last error: ${thread.lastError ?? (isPaused ? 'Paused by user' : 'Unknown interruption')}`,
    `Worktree: ${thread.worktreePath}`,
    checkpoint
      ? `Checkpoint before execution: ${checkpoint.label} (${checkpoint.commitSha.slice(0, 12)})`
      : 'Checkpoint before execution: none recorded; using HEAD as the diff base.',
    '',
    '<current_git_status>',
    status || 'Clean',
    '</current_git_status>',
    '',
    '<changed_files_since_checkpoint>',
    changedFiles || 'No changed files detected',
    '</changed_files_since_checkpoint>',
    '',
    '<diff_stat_since_checkpoint>',
    diffStat || 'No diff stat available',
    '</diff_stat_since_checkpoint>',
    '',
    '<diff_excerpt_since_checkpoint>',
    diffExcerpt || 'No diff available',
    '</diff_excerpt_since_checkpoint>',
    '',
    '<terminal_tail>',
    clampResumeText(terminalTail || 'No terminal events recorded', 8_000, 'terminal tail'),
    '</terminal_tail>',
    '',
    'Resume instructions:',
    '- Treat the current worktree as WIP from the interrupted agent.',
    '- Inspect and preserve useful changes before continuing.',
    '- Continue the approved plan from remaining work; fix incomplete or broken edits.',
    '- Do not reset or recreate the worktree unless the WIP is clearly wrong.',
    '</interrupted_run_context>',
  ].join('\n');

  return `\n\n${clampResumeText(sections, EXECUTION_RESUME_PROMPT_MAX, 'resume context')}`;
}

export function registerPipelineHandlers({
  ipcMain,
  mainWindow,
  queries,
  pipeline,
  emitter,
  notificationService,
}: IpcHandlerDeps): void {
  const resolveEffectiveRequireApproval = (threadId: string) => {
    const thread = queries.threads.getById(threadId);
    if (!thread) return queries.settings.get().requireApproval;

    const settings = queries.settings.get();
    const project = queries.projects.getById(thread.projectId);
    if (!project) return settings.requireApproval;

    const issue =
      thread.githubIssueNumber != null
        ? queries.githubIssues.getByNumber(project.id, thread.githubIssueNumber)
        : null;

    return issue
      ? resolveRequireApprovalForIssue(settings, project, issue)
      : resolveRequireApproval(settings, project);
  };

  const buildActivePipelineSummaries = (
    summaries: ReturnType<typeof pipeline.listActive>,
  ): ActivePipelineSummary[] => {
    if (summaries.length === 0) return [];
    const settings = queries.settings.get();
    return summaries.map((summary) => {
      const thread = queries.threads.getById(summary.threadId);
      const project = thread ? queries.projects.getById(thread.projectId) : null;
      const latestPlanStatus = thread ? (queries.plans.getLatest(thread.id)?.status ?? null) : null;
      const phasePresentation =
        thread != null
          ? resolveThreadPhasePresentation(settings, project, thread, summary.phase)
          : null;

      return {
        threadId: summary.threadId,
        projectId: thread?.projectId ?? '',
        projectName: project?.name ?? 'Unknown project',
        threadTitle: thread?.title ?? summary.threadId,
        phase: summary.phase,
        approvedAwaitingExecution:
          summary.phase === PIPELINE_PHASE.approval && latestPlanStatus === 'approved',
        startedAt: summary.startedAt,
        activeProcessId: summary.activeProcessId,
        githubIssueNumber: thread?.githubIssueNumber ?? null,
        modelProvider: phasePresentation?.provider ?? null,
        model: phasePresentation?.model ?? null,
        reasoningEffort: phasePresentation?.effort ?? null,
      };
    });
  };

  ipcMain.handle('verification:get', (_event, { threadId }: { threadId: string }) => {
    return queries.verifications.getLatest(threadId);
  });

  ipcMain.handle('task-graph:get-latest', (_event, { threadId }: { threadId: string }) => {
    return queries.taskGraphs?.getLatestByThread(threadId) ?? null;
  });

  ipcMain.handle(
    'terminal:list',
    (_event, { threadId, limit }: { threadId: string; limit?: number }) => {
      const persisted = queries.terminalEvents.listByThread(threadId, limit);
      if (persisted.length > 0) return persisted;

      const fallback: import('@shipcode/shared').TerminalEventRecord[] = [];
      const latestPlan = queries.plans.getLatest(threadId);
      if (latestPlan?.rawOutput) {
        fallback.push({
          id: `fallback-plan-${latestPlan.id}`,
          threadId,
          createdAt: latestPlan.createdAt,
          event: { kind: 'raw', content: latestPlan.rawOutput },
        });
      }

      const latestReview = latestPlan ? queries.reviews.getByPlanId(latestPlan.id) : null;
      if (latestReview?.rawOutput) {
        fallback.push({
          id: `fallback-review-${latestReview.id}`,
          threadId,
          createdAt: latestReview.createdAt,
          event: { kind: 'raw', content: latestReview.rawOutput },
        });
      }

      const latestVerification = queries.verifications.getLatest(threadId);
      if (latestVerification?.rawOutput) {
        fallback.push({
          id: `fallback-verification-${latestVerification.id}`,
          threadId,
          createdAt: latestVerification.createdAt,
          event: { kind: 'raw', content: latestVerification.rawOutput },
        });
      }

      return fallback
        .sort((a, b) =>
          a.createdAt === b.createdAt
            ? a.id.localeCompare(b.id)
            : a.createdAt.localeCompare(b.createdAt),
        )
        .slice(-(limit ?? fallback.length));
    },
  );

  ipcMain.handle('pipeline:start', async (_event, { threadId }: { threadId: string }) => {
    const thread = queries.threads.getById(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const project = queries.projects.getById(thread.projectId);
    if (!project) throw new Error(`Project ${thread.projectId} not found`);
    const settings = queries.settings.get();
    const phaseModels = resolveProjectPhaseModels(settings, project);
    await assertCliPhaseModelsSupported(phaseModels);
    queries.threads.setPhaseModels(threadId, phaseModels);

    const baseBranch = project.defaultBranch;
    let forkPointSha = '';
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', baseBranch], {
        cwd: project.path,
        encoding: 'utf8',
      });
      forkPointSha = stdout.trim();
    } catch {
      // baseBranch may not exist locally; forkPointSha stays empty
    }

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
      clarificationHistory: [],
      baseBranch,
      forkPointSha,
    });
    logEvent('pipeline:start-context', {
      threadId,
      source: 'pipeline:start',
      projectPath: project.path,
      githubIssueNumber: thread.githubIssueNumber ?? null,
      autonomous: false,
      requireApproval: resolveRequireApproval(settings, project),
      reviewRound: thread.reviewRound,
    });

    queries.threads.resetFailureTracking(threadId);
    queries.plans.supersedeAll(threadId);
    queries.threads.clearClarification(threadId);
    await pipeline.startPlanGeneration(threadId, thread.prompt, project.path, null);
  });

  ipcMain.handle(
    'pipeline:answer-clarification',
    async (
      _event,
      {
        threadId,
        answers,
      }: {
        threadId: string;
        answers: import('@shipcode/shared').ClarificationAnswer[];
      },
    ) => {
      const thread = queries.threads.getById(threadId);
      if (!thread || thread.status !== PIPELINE_PHASE.clarifying) return;
      if (!thread.clarificationRequest) {
        throw new Error('No pending clarification request found for this task');
      }

      const normalizedAnswers = answers.map((answer) => clarificationAnswerSchema.parse(answer));
      const answersByQuestionId = new Map(
        normalizedAnswers.map((answer) => [answer.questionId, answer]),
      );
      for (const question of thread.clarificationRequest.questions) {
        const answer = answersByQuestionId.get(question.id);
        if (!answer) {
          throw new Error(`Missing answer for "${question.title}"`);
        }

        const selectedChoice =
          answer.selectedChoiceId != null
            ? (new Map(question.choices.map((choice) => [choice.id, choice])).get(
                answer.selectedChoiceId,
              ) ?? null)
            : null;
        const hasFreeform = Boolean(answer.freeformText?.trim());

        if (answer.selectedChoiceId && !selectedChoice) {
          throw new Error(`Invalid option selected for "${question.title}"`);
        }
        if (hasFreeform && !question.allowFreeform) {
          throw new Error(`"${question.title}" does not accept freeform notes`);
        }
        if (!selectedChoice && !hasFreeform) {
          throw new Error(`Provide a selection or note for "${question.title}"`);
        }
      }

      const project = queries.projects.getById(thread.projectId);
      if (!project) throw new Error(`Project ${thread.projectId} not found`);

      queries.threads.resolveClarification(
        threadId,
        thread.clarificationRequest,
        normalizedAnswers,
      );
      emitter.emit({
        type: 'terminal:event',
        threadId,
        event: {
          kind: 'clarification_answered',
          questionCount: normalizedAnswers.length,
        },
      });

      const issue = thread.githubIssueNumber
        ? queries.githubIssues.getByNumber(project.id, thread.githubIssueNumber)
        : null;
      pipeline.rehydrateContext(threadId, project.path, issue?.title);
      const context = pipeline.getContext(threadId);
      if (context) {
        const answeredClarification = {
          request: thread.clarificationRequest,
          answers: normalizedAnswers,
        };
        const existingHistory = context.clarificationHistory ?? [];
        context.clarificationHistory =
          existingHistory.at(-1)?.request.id === answeredClarification.request.id
            ? existingHistory
            : [...existingHistory, answeredClarification];
        context.clarificationRequest = thread.clarificationRequest;
        context.clarificationAnswers = normalizedAnswers;
        context.clarificationRound = thread.clarificationRound;
      }

      await pipeline.startPlanGeneration(
        threadId,
        thread.prompt,
        project.path,
        thread.worktreePath,
      );
    },
  );

  ipcMain.handle('pipeline:approve', async (_event, { threadId }: { threadId: string }) => {
    const thread = queries.threads.getById(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const latestPlan = queries.plans.getLatest(threadId);
    if (!latestPlan) throw new Error('No plan available to approve');
    if (thread.status !== PIPELINE_PHASE.approval) {
      throw new Error(`This task is no longer in approval. Current status: ${thread.status}.`);
    }
    if (latestPlan.status === 'approved') {
      throw new Error('Approval is already confirmed. Waiting for an execution slot.');
    }
    if (latestPlan.status !== PIPELINE_PHASE.approval) {
      throw new Error(
        `This plan is no longer in approval. Current plan status: ${latestPlan.status}.`,
      );
    }

    let structured = latestPlan.structured;
    if (!structured) {
      structured = tryParsePlan(latestPlan.rawOutput ?? '');
      if (structured) {
        logEvent('pipeline:plan-parse-fallback', {
          threadId,
          planId: latestPlan.id,
          source: 'pipeline:approve',
        });
      }
    }
    if (structured) {
      if (!latestPlan.structured) {
        queries.plans.updateStructured(latestPlan.id, structured);
      }
      queries.plans.updateStatus(latestPlan.id, 'approved');

      const project = queries.projects.getById(thread.projectId);
      if (project) {
        const issue = thread.githubIssueNumber
          ? queries.githubIssues.getByNumber(project.id, thread.githubIssueNumber)
          : null;
        pipeline.rehydrateContext(threadId, project.path, issue?.title);
        logEvent('pipeline:start-context', {
          threadId,
          source: 'pipeline:approve',
          projectPath: project.path,
          githubIssueNumber: thread.githubIssueNumber ?? null,
          autonomous: thread.autonomous,
          requireApproval: resolveEffectiveRequireApproval(threadId),
          reviewRound: thread.reviewRound,
        });
      }

      notificationService.dismissByThread(threadId);
      await pipeline.startExecution(threadId, structured);
    } else {
      const errorMessage = 'No plan available to approve';
      notificationService.dismissByThread(threadId);
      transitionThreadPhase(mainWindow, queries, emitter, {
        threadId,
        phase: PIPELINE_PHASE.failed,
        errorMessage,
      });
      throw new Error(errorMessage);
    }
  });

  ipcMain.handle(
    'pipeline:reject',
    async (_event, { threadId, feedback }: { threadId: string; feedback: string }) => {
      const thread = queries.threads.getById(threadId);
      if (!thread) return;

      const project = queries.projects.getById(thread.projectId);
      if (!project) return;

      const issue = thread.githubIssueNumber
        ? queries.githubIssues.getByNumber(project.id, thread.githubIssueNumber)
        : null;
      pipeline.rehydrateContext(threadId, project.path, issue?.title);

      queries.plans.supersedeAll(threadId);
      const revisedPrompt = `${thread.prompt}\n\nFeedback from review:\n${feedback}`;
      notificationService.dismissByThread(threadId);
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
    let structured = latestPlan?.structured ?? null;
    if (!structured && latestPlan) {
      structured = tryParsePlan(latestPlan.rawOutput ?? '');
      if (structured) {
        logEvent('pipeline:plan-parse-fallback', {
          threadId,
          planId: latestPlan.id,
          source: 'pipeline:stabilize',
        });
      }
    }
    if (!structured) {
      throw new Error('No approved plan found for stabilization');
    }
    if (!latestPlan?.structured && latestPlan) {
      queries.plans.updateStructured(latestPlan.id, structured);
    }

    pipeline.rehydrateContext(threadId, project.path, issue.title);
    notificationService.dismissByThread(threadId);
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

  const emitTerminalEvent = (
    threadId: string,
    event: Parameters<typeof queries.terminalEvents.create>[1],
  ) => {
    const runId = queries.threads.getById(threadId)?.currentRunId ?? null;
    const record = runId
      ? queries.terminalEvents.create(threadId, event, runId)
      : queries.terminalEvents.create(threadId, event);
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:event', record);
    }
    return record;
  };

  ipcMain.handle('pipeline:pause', (_event, { threadId }: { threadId: string }) => {
    const thread = queries.threads.getById(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);
    if (!PAUSABLE_PHASE_SET.has(thread.status)) {
      throw new Error(`Cannot pause task while in ${thread.status} phase`);
    }

    emitTerminalEvent(threadId, {
      kind: 'lifecycle',
      message: `Paused by user during ${thread.status}. Resume will continue from persisted worktree state.`,
    });
    pipeline.pause(threadId);
  });

  function getLatestStructuredPlan(threadId: string) {
    const latestPlan = queries.plans.getLatest(threadId);
    const structuredPlan = latestPlan?.structured;
    if (!latestPlan || !structuredPlan) {
      throw new Error('No structured plan found for paused task');
    }
    return { latestPlan, structuredPlan };
  }

  function buildRevisionResumeFeedback(planId: string): string {
    const review = queries.reviews.getByPlanId(planId);
    if (review?.structured) {
      const suggestedChanges = review.structured.suggestedChanges.join('\n');
      const findings = review.structured.findings
        .map(
          (finding) =>
            `[${finding.severity}] ${finding.description}${
              finding.suggestion ? ` - ${finding.suggestion}` : ''
            }`,
        )
        .join('\n');
      return [suggestedChanges, findings ? `Findings:\n${findings}` : null]
        .filter(Boolean)
        .join('\n\n');
    }
    if (review?.rawOutput?.trim()) return review.rawOutput.trim();
    return 'Resume the interrupted revision pass using the latest plan and reviewer context.';
  }

  ipcMain.handle('pipeline:resume', async (_event, { threadId }: { threadId: string }) => {
    if (pipeline.listActive().some((summary) => summary.threadId === threadId)) {
      throw new Error('Task is already running');
    }

    const thread = queries.threads.getById(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);
    if (thread.status !== PIPELINE_PHASE.paused) {
      throw new Error(`Cannot resume task while in ${thread.status} phase`);
    }
    if (!thread.pausedPhase || !PAUSABLE_PHASE_SET.has(thread.pausedPhase)) {
      throw new Error('Paused task is missing a resumable phase');
    }

    const project = queries.projects.getById(thread.projectId);
    if (!project) throw new Error(`Project ${thread.projectId} not found`);
    const issue =
      thread.githubIssueNumber != null
        ? queries.githubIssues.getByNumber(project.id, thread.githubIssueNumber)
        : null;

    pipeline.rehydrateContext(threadId, project.path, issue?.title);
    notificationService.dismissByThread(threadId);
    logEvent('pipeline:start-context', {
      threadId,
      source: 'pipeline:resume',
      projectPath: project.path,
      githubIssueNumber: thread.githubIssueNumber ?? null,
      autonomous: thread.autonomous,
      requireApproval: resolveEffectiveRequireApproval(threadId),
      reviewRound: thread.reviewRound,
    });

    emitTerminalEvent(threadId, {
      kind: 'lifecycle',
      message: `Resuming paused task from ${thread.pausedPhase}.`,
    });

    if (thread.pausedPhase === PIPELINE_PHASE.planning) {
      await pipeline.startPlanGeneration(
        threadId,
        thread.prompt,
        project.path,
        thread.worktreePath,
      );
      return;
    }

    const { latestPlan, structuredPlan } = getLatestStructuredPlan(threadId);

    if (thread.pausedPhase === PIPELINE_PHASE.reviewing) {
      await pipeline.startReview(threadId, structuredPlan);
      return;
    }

    if (thread.pausedPhase === PIPELINE_PHASE.revising) {
      await pipeline.startRevision(
        threadId,
        structuredPlan,
        buildRevisionResumeFeedback(latestPlan.id),
      );
      return;
    }

    if (thread.pausedPhase === PIPELINE_PHASE.executing) {
      const context = pipeline.getContext(threadId);
      const resumeContext = await buildExecutionResumeContext(thread, queries);
      if (context && resumeContext) {
        context.executionResumeContext = resumeContext;
      }
      await pipeline.startExecution(threadId, structuredPlan);
      return;
    }

    if (thread.pausedPhase === PIPELINE_PHASE.testing) {
      await pipeline.startTesting(threadId);
      return;
    }

    if (thread.pausedPhase === PIPELINE_PHASE.verifying) {
      await pipeline.startVerification(threadId);
      return;
    }

    if (thread.pausedPhase === PIPELINE_PHASE.shipping) {
      await pipeline.startCommitAndPush(threadId);
      return;
    }

    throw new Error(`Unsupported paused phase: ${thread.pausedPhase}`);
  });

  const retryPipelineThread = async (
    threadId: string,
    source: 'pipeline:retry' | 'pipeline:auto-fix',
  ) => {
    if (pipeline.listActive().some((summary) => summary.threadId === threadId)) {
      throw new Error('Stop the active pipeline before retrying');
    }

    const thread = queries.threads.getById(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    // Clear any previous closed marker so a retried thread doesn't stay classified as closed.
    if (thread.doneAt) {
      queries.threads.clearDoneAt(threadId);
    }

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
    notificationService.dismissByThread(threadId);
    logEvent('pipeline:start-context', {
      threadId,
      source,
      projectPath: project.path,
      githubIssueNumber: thread.githubIssueNumber ?? null,
      autonomous: thread.autonomous,
      requireApproval: resolveEffectiveRequireApproval(threadId),
      reviewRound: thread.reviewRound,
    });

    const latestPlan = queries.plans.getLatest(threadId);
    let structured = latestPlan?.structured ?? null;
    if (!structured && latestPlan) {
      structured = tryParsePlan(latestPlan.rawOutput ?? '');
      if (structured) {
        logEvent('pipeline:plan-parse-fallback', {
          threadId,
          planId: latestPlan.id,
          source,
        });
      }
    }
    if (structured) {
      if (!latestPlan?.structured && latestPlan) {
        queries.plans.updateStructured(latestPlan.id, structured);
      }
      const latestVerification = queries.verifications.getLatest(threadId);
      const retryAction = getRetryAction(thread, latestPlan, latestVerification);
      const attachExecutionResumeContext = async () => {
        const context = pipeline.getContext(threadId);
        if (!context) return;
        const resumeContext = await buildExecutionResumeContext(thread, queries);
        if (!resumeContext) return;
        context.executionResumeContext = resumeContext;
        emitTerminalEvent(threadId, {
          kind: 'lifecycle',
          message: 'Retry is resuming from interrupted worktree state.',
        });
      };
      if (retryAction === 'review') {
        if (latestPlan) queries.plans.updateStatus(latestPlan.id, 'pending_review');
        await pipeline.startReview(threadId, structured);
      } else if (retryAction === 'execute') {
        if (latestPlan?.status === 'superseded') {
          queries.plans.updateStatus(latestPlan.id, 'approved');
        }
        await attachExecutionResumeContext();
        await pipeline.startExecution(threadId, structured);
      } else if (retryAction === 'verify') {
        await pipeline.startVerification(threadId);
      } else if (retryAction === 'commit_and_push') {
        await pipeline.startCommitAndPush(threadId);
      } else {
        const retryCtx = pipeline.getContext(threadId);
        if (retryCtx && latestPlan?.rawOutput) {
          retryCtx.previousPlanRawOutput = latestPlan.rawOutput;
        }
        queries.plans.supersedeAll(threadId);
        await pipeline.startPlanGeneration(
          threadId,
          thread.prompt,
          project.path,
          thread.worktreePath,
        );
      }
      return;
    }

    // Smart retry: walk backward through plan history before re-planning.
    // 1. Check current thread for an earlier plan with structured content.
    const fallbackPlan = queries.plans.getLatestStructured(threadId);
    // 2. Cross-thread: check other threads for the same issue.
    const borrowedPlan =
      fallbackPlan ??
      (thread.githubIssueNumber
        ? queries.plans.getLatestStructuredForIssue(project.id, thread.githubIssueNumber)
        : null);

    if (borrowedPlan?.structured) {
      // Clone the plan into the current thread with corrected threadId/version.
      const nextVersion = queries.plans.getMaxVersion(threadId) + 1;
      const clonedStructured = {
        ...borrowedPlan.structured,
        threadId,
        version: nextVersion,
      };
      queries.plans.supersedeAll(threadId);
      const clonedPlan = queries.plans.create(
        threadId,
        borrowedPlan.rawOutput,
        clonedStructured,
        nextVersion,
      );
      // Borrowed plans always go to review — they came from a different context.
      queries.plans.updateStatus(clonedPlan.id, 'pending_review');
      await pipeline.startReview(threadId, clonedStructured);
      return;
    }

    // No structured plan exists anywhere — restart planning from scratch.
    const failedPlan = queries.plans.getLatest(threadId);
    const ctx = pipeline.getContext(threadId);
    if (ctx && failedPlan?.rawOutput) {
      ctx.previousPlanRawOutput = failedPlan.rawOutput;
    }

    queries.plans.supersedeAll(threadId);
    await pipeline.startPlanGeneration(threadId, thread.prompt, project.path, thread.worktreePath);
  };

  ipcMain.handle('pipeline:retry', async (_event, { threadId }: { threadId: string }) => {
    await retryPipelineThread(threadId, 'pipeline:retry');
  });

  ipcMain.handle(
    'pipeline:auto-fix',
    async (_event, { threadId, failureOutput }: { threadId: string; failureOutput: string }) => {
      if (pipeline.listActive().some((summary) => summary.threadId === threadId)) {
        throw new Error('Stop the active pipeline before auto-fixing');
      }

      const thread = queries.threads.getById(threadId);
      if (!thread) throw new Error(`Thread ${threadId} not found`);

      const clippedOutput = clampAutoFixFailureOutput(failureOutput);
      if (!clippedOutput) throw new Error('No failure output available for Auto Fix');

      const checkpoint = queries.checkpoints.getLatest(threadId);
      if (!thread.worktreePath || !checkpoint) {
        const reason = !thread.worktreePath
          ? 'No worktree exists yet; rerunning from the latest pipeline state.'
          : 'No checkpoint exists yet; rerunning from the latest pipeline state.';
        emitTerminalEvent(threadId, {
          kind: 'lifecycle',
          message: `Auto Fix fallback: ${reason}`,
        });
        emitTerminalEvent(threadId, {
          kind: 'raw',
          content: ['[Auto Fix] Captured failure output', '', clippedOutput].join('\n'),
        });
        queries.threads.updateStatus(
          threadId,
          PIPELINE_PHASE.failed,
          ['Auto Fix requested from terminal failure output.', reason, '', clippedOutput].join(
            '\n',
          ),
        );
        await retryPipelineThread(threadId, 'pipeline:auto-fix');
        return;
      }

      emitTerminalEvent(threadId, {
        kind: 'lifecycle',
        message: `Auto Fix restoring checkpoint ${checkpoint.label} (${checkpoint.commitSha.slice(0, 12)})`,
      });
      emitTerminalEvent(threadId, {
        kind: 'raw',
        content: ['[Auto Fix] Captured failure output', '', clippedOutput].join('\n'),
      });

      try {
        await execFileAsync('git', ['reset', '--hard', checkpoint.commitSha], {
          cwd: thread.worktreePath,
          timeout: 15_000,
        });
        await execFileAsync('git', ['clean', '-fd'], {
          cwd: thread.worktreePath,
          timeout: 15_000,
        });
      } catch (error) {
        const clamped = clampError(error);
        emitTerminalEvent(threadId, {
          kind: 'error',
          message: `Auto Fix checkpoint restore failed: ${clamped}`,
        });
        throw new Error(clamped);
      }

      const retryContext = [
        'Auto Fix requested from terminal failure output.',
        `Restored checkpoint ${checkpoint.label} (${checkpoint.commitSha}).`,
        '',
        clippedOutput,
      ].join('\n');
      queries.threads.updateStatus(threadId, PIPELINE_PHASE.failed, retryContext);

      await retryPipelineThread(threadId, 'pipeline:auto-fix');
    },
  );

  ipcMain.handle('pipeline:skip-review', async (_event, { threadId }: { threadId: string }) => {
    const thread = queries.threads.getById(threadId);
    const latestPlan = queries.plans.getLatest(threadId);
    if (latestPlan) {
      queries.plans.updateStatus(latestPlan.id, 'approval');
    }
    logEvent('pipeline:approval-gate', {
      threadId,
      outcome: 'approval',
      reviewDecision: 'approve',
      planVersion: latestPlan?.version ?? null,
      requireApproval: resolveEffectiveRequireApproval(threadId),
      autonomous: thread?.autonomous ?? false,
      reviewRound: thread?.reviewRound ?? 0,
      revisionCount:
        thread?.projectId && thread.githubIssueNumber != null
          ? resolveRevisionCountForIssue(
              queries.settings.get(),
              queries.projects.getById(thread.projectId),
              queries.githubIssues.getByNumber(thread.projectId, thread.githubIssueNumber),
            )
          : resolveRevisionCount(
              queries.settings.get(),
              thread?.projectId ? queries.projects.getById(thread.projectId) : null,
            ),
      hasCriticalOrMajor: false,
      reasons: ['manualSkipReview'],
    });
    transitionThreadPhase(mainWindow, queries, emitter, {
      threadId,
      phase: PIPELINE_PHASE.approval,
    });
  });

  const GH_TIMEOUT_MS = 30_000;
  const createPrInFlight = new Set<string>();

  ipcMain.handle('pipeline:create-pr', async (_event, { threadId }: { threadId: string }) => {
    if (createPrInFlight.has(threadId)) {
      throw new Error('PR creation already in progress for this thread');
    }
    createPrInFlight.add(threadId);

    try {
      const thread = queries.threads.getById(threadId);
      if (!thread) throw new Error(`Thread ${threadId} not found`);

      const project = queries.projects.getById(thread.projectId);
      if (!project) throw new Error(`Project ${thread.projectId} not found`);

      if (!thread.worktreeBranch) {
        throw new Error('No branch available for this run');
      }
      if (thread.githubPrNumber) {
        throw new Error('A pull request already exists for this thread');
      }
      if (thread.status !== PIPELINE_PHASE.completed) {
        throw new Error('Can only create a PR for a completed run');
      }

      const branch = thread.worktreeBranch;
      const baseBranch = thread.baseBranch ?? project.defaultBranch;
      const cwd = thread.worktreePath ?? project.path;

      const latestPlan = queries.plans.getLatest(threadId);
      const title = latestPlan?.structured?.objective ?? thread.title;
      const body = [
        '## Summary',
        '',
        `*Automation run: ${thread.title}*`,
        '',
        '---',
        '*Autonomous implementation by ShipCode*',
      ].join('\n');

      // Check for an existing PR on this branch (mirrors execution-phases.ts pattern).
      const { stdout: existingPrJson } = await execFileAsync(
        'gh',
        ['pr', 'list', '--state', 'all', '--head', branch, '--json', 'number,url', '--limit', '1'],
        { cwd, encoding: 'utf-8', timeout: GH_TIMEOUT_MS },
      );
      const existingPrs = JSON.parse(existingPrJson) as Array<{ number: number; url: string }>;
      const existingPr = existingPrs[0];

      let prNumber: number;
      let prUrl: string;

      if (existingPr) {
        prNumber = existingPr.number;
        prUrl = existingPr.url;
      } else {
        const { stdout: prOutput } = await execFileAsync(
          'gh',
          [
            'pr',
            'create',
            '--draft',
            '--title',
            title,
            '--body',
            body,
            '--head',
            branch,
            '--base',
            baseBranch,
          ],
          { cwd, encoding: 'utf-8', timeout: GH_TIMEOUT_MS },
        );
        const prMatch = prOutput.match(/\/pull\/(\d+)/);
        if (!prMatch) {
          throw new Error(`Failed to parse pull request number from gh output: ${prOutput}`);
        }
        prNumber = Number.parseInt(prMatch[1], 10);
        prUrl = prOutput.trim();
      }

      queries.threads.setGithubPr(threadId, prNumber);

      return { prNumber, prUrl };
    } catch (err) {
      throw new Error(clampError(err));
    } finally {
      createPrInFlight.delete(threadId);
    }
  });

  ipcMain.handle('pipeline:list-active', (): ActivePipelineSummary[] => {
    return buildActivePipelineSummaries(pipeline.listActive());
  });

  ipcMain.handle(
    'dashboard:get-overview',
    (
      _event,
      {
        activityLimit,
        activityOffset,
        recentLimit,
        recentOffset,
      }: {
        activityLimit?: number;
        activityOffset?: number;
        recentLimit?: number;
        recentOffset?: number;
      } = {},
    ) => {
      const running = buildActivePipelineSummaries(pipeline.listActive());

      return {
        stats: queries.dashboard.getStats(),
        running,
        activity: queries.activity.listRecent(activityLimit ?? 50, undefined, activityOffset ?? 0),
        activityTotal: queries.activity.countRecent(),
        recent: queries.dashboard.getRecentTasks(recentLimit ?? 20, recentOffset ?? 0),
        recentTotal: queries.dashboard.countRecentTasks(),
      };
    },
  );

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

  ipcMain.handle(
    'costs:list-for-issue',
    (_event, { projectId, issueNumber }: { projectId: string; issueNumber: number }) => {
      return queries.costs.listTasksForIssue(projectId, issueNumber);
    },
  );

  // Per-attempt provider invocation log. Drives the "Attempts" sub-table in
  // the issue Costs tab so users can see which model served each phase, what
  // it cost, and how a run failed without scraping the terminal log.
  ipcMain.handle('pipeline-steps:list-by-thread', (_event, { threadId }: { threadId: string }) => {
    return queries.pipelineSteps.listByThread(threadId);
  });

  ipcMain.handle(
    'prompt-telemetry:list-by-thread',
    (_event, { threadId }: { threadId: string }) => {
      return queries.promptTelemetry.listByThread(threadId);
    },
  );

  ipcMain.handle('pipeline-analytics:get-overview', () => {
    return queries.pipelineAnalytics.getOverview();
  });

  ipcMain.handle('pipeline-analytics:get-thread', (_event, { threadId }: { threadId: string }) => {
    return queries.pipelineAnalytics.getThread(threadId);
  });

  ipcMain.handle(
    'pipeline-runs:list-by-thread',
    (
      _event,
      { threadId, terminalLimit }: { threadId: string; terminalLimit?: number },
    ): PipelineRunTimelineEntry[] => {
      const requestedLimit = Number.isFinite(terminalLimit)
        ? (terminalLimit as number)
        : RUN_TIMELINE_TERMINAL_LIMIT;
      const limit = Math.max(5, Math.min(requestedLimit, 120));
      const thread = queries.threads.getById(threadId);
      const runs = queries.pipelineRuns.listByThread(threadId);
      const runIds = new Set(runs.map((run) => run.id));
      const phaseLogs = queries.phaseLogs.listByThread(threadId);
      const steps = queries.pipelineSteps.listByThread(threadId);
      const phasesByRun = new Map(
        runs.map((run) => [run.id, phaseLogs.filter((phase) => phase.runId === run.id)]),
      );
      const stepsByRun = new Map(
        runs.map((run) => [run.id, steps.filter((step) => step.runId === run.id)]),
      );
      const retryDepth = (runId: string): number => {
        let depth = 0;
        let cursor = runs.find((run) => run.id === runId)?.retryOfRunId ?? null;
        const seen = new Set<string>([runId]);
        while (cursor && runIds.has(cursor) && !seen.has(cursor)) {
          seen.add(cursor);
          depth += 1;
          cursor = runs.find((run) => run.id === cursor)?.retryOfRunId ?? null;
        }
        return depth;
      };

      return runs.map((run) => ({
        run,
        isCurrent: thread?.currentRunId === run.id,
        retryDepth: retryDepth(run.id),
        phaseTimeline: phasesByRun.get(run.id) ?? [],
        steps: stepsByRun.get(run.id) ?? [],
        terminalEvents: queries.terminalEvents.listByRun(run.id, limit),
      }));
    },
  );

  // GitHub-style contribution heatmap (cost / tokens / runs / PRs). One IPC
  // serves three surfaces: global Costs dashboard, per-project Insights tab,
  // and per-issue CostsTab embedded mini-heatmap. Scope discriminates which
  // filter applies — see HeatmapQueries for semantics.
  ipcMain.handle('activity-heatmap:query', (_event, args: HeatmapQueryArgs) => {
    return queries.heatmap.byScope(args);
  });
}
