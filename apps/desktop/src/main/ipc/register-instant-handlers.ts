import crypto from 'node:crypto';
import os from 'node:os';
import { extractCodexThreadId } from '@shipcode/agents';
import {
  type InstantFixScope,
  type ReasoningEffort,
  resolveProviderReasoningEffort,
  stripAnsi,
} from '@shipcode/shared';
import log from '../logger.service';
import {
  getInteractiveTerminalSession,
  unregisterInteractiveTerminalSession,
} from '../terminal-session-registry';
import { assertPrdRewriteModelSupported } from './helpers';
import { getPrdAttachmentSessionSummary } from './prd-attachments';
import type { IpcHandlerDeps } from './types';

type InstantCli = 'claude' | 'codex';
type RunningInstantSession = {
  cli: InstantCli | 'shell';
  mode: 'run' | 'shell';
  processId: string;
  sessionId?: string;
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort;
  cwd?: string;
  isProcessingTurn?: boolean;
};

/** threadId → process metadata mapping for cancel/input/resize support. */
const runningInstants = new Map<string, RunningInstantSession>();
const FAILURE_OUTPUT_MAX = 8_000;
const TASK_CONTEXT_MAX = 6_000;

function formatInstantCliLabel(cli: InstantCli): string {
  return cli === 'claude' ? 'Claude' : 'Codex';
}

function buildAttachmentContext(attachmentSessionId?: string): string {
  if (!attachmentSessionId) return '';
  const session = getPrdAttachmentSessionSummary(attachmentSessionId);
  if (!session || session.attachments.length === 0) return '';
  const paths = session.attachments.map((attachment) => attachment.stagedPath);
  return `\n\nScreenshot files available at:\n${paths.join('\n')}\nUse the Read tool to view them.`;
}

function clampContextText(value: string | null | undefined, max = TASK_CONTEXT_MAX): string {
  const cleaned = stripAnsi(value ?? '').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}\n\n[truncated]`;
}

function clampFailureOutput(output: string): string {
  const cleaned = stripAnsi(output).trim();
  if (cleaned.length <= FAILURE_OUTPUT_MAX) return cleaned;
  return `[Earlier terminal output truncated]\n\n${cleaned.slice(-FAILURE_OUTPUT_MAX)}`;
}

function formatLatestPlanContext(
  plan: ReturnType<IpcHandlerDeps['queries']['plans']['getLatest']>,
) {
  if (!plan?.structured) return null;
  const lines = [
    `Objective: ${plan.structured.objective}`,
    `Plan version: ${plan.structured.version}`,
  ];
  if (plan.structured.steps.length > 0) {
    lines.push(
      'Steps:',
      ...plan.structured.steps.map((step) => `${step.order}. ${step.description}`),
    );
  }
  if (plan.structured.acceptanceCriteria.length > 0) {
    lines.push('Acceptance criteria:', ...plan.structured.acceptanceCriteria.map((c) => `- ${c}`));
  }
  return lines.join('\n');
}

function buildThreadFailurePrompt(args: {
  project: { name?: string | null; path: string };
  thread: ReturnType<IpcHandlerDeps['queries']['threads']['getById']>;
  issue: ReturnType<IpcHandlerDeps['queries']['githubIssues']['getByNumber']>;
  latestPlan: ReturnType<IpcHandlerDeps['queries']['plans']['getLatest']>;
  failureOutput: string;
  cwd: string;
}): string {
  const { project, thread, issue, latestPlan, failureOutput, cwd } = args;
  if (!thread) throw new Error('Thread not found');
  const latestPlanContext = formatLatestPlanContext(latestPlan);

  const sections = [
    'Fix this ShipCode task failure from the embedded terminal.',
    '',
    'Task context:',
    `- Project: ${project.name ?? 'Project'}`,
    `- Project path: ${project.path}`,
    `- Working directory for this terminal: ${cwd}`,
    `- Source thread: ${thread.id}`,
    `- Source status: ${thread.status}`,
    thread.worktreePath ? `- Pipeline worktree: ${thread.worktreePath}` : null,
    thread.worktreeBranch ? `- Pipeline branch: ${thread.worktreeBranch}` : null,
    thread.githubIssueNumber != null ? `- GitHub issue: #${thread.githubIssueNumber}` : null,
    issue?.title ? `- Issue title: ${issue.title}` : `- Thread title: ${thread.title}`,
    '',
    issue?.body
      ? ['Issue body:', clampContextText(issue.body)].join('\n')
      : ['Thread prompt:', clampContextText(thread.prompt)].join('\n'),
    '',
    latestPlanContext ? ['Latest plan:', latestPlanContext].join('\n') : null,
    '',
    'Failure output:',
    '```text',
    failureOutput,
    '```',
    '',
    'What to do:',
    '1. Diagnose the failure against the task context and current repo/worktree.',
    '2. Make the smallest correct code change needed.',
    '3. Run the relevant command, test, build, or verification again.',
    '4. Leave a concise summary of what changed and what command you reran.',
  ].filter((line): line is string => line != null);

  return sections.join('\n');
}

function buildClaudeShellEffort(
  reasoningEffort: ReasoningEffort | undefined,
  modelId?: string | null,
): 'medium' | 'high' | null {
  switch (resolveProviderReasoningEffort('claude', reasoningEffort ?? 'high', modelId).effective) {
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    default:
      return null;
  }
}

function buildClaudeAssistantArgs(args: {
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort;
  sessionId: string;
}): string[] {
  const effort = buildClaudeShellEffort(args.reasoningEffort, args.modelId);
  const thinkingArgs =
    effort === 'high'
      ? ['--max-thinking-tokens', '32000']
      : effort === 'medium'
        ? ['--max-thinking-tokens', '8000']
        : [];
  return [
    '-p',
    ...(args.modelId ? ['--model', args.modelId] : []),
    '--output-format',
    'stream-json',
    '--verbose',
    '--session-id',
    args.sessionId,
    '--allowedTools',
    'Edit,Write,Bash,Glob,Grep,Read',
    '--dangerously-skip-permissions',
    '--max-turns',
    '50',
    ...thinkingArgs,
  ];
}

function buildClaudeAssistantResumeArgs(args: {
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort;
  sessionId: string;
}): string[] {
  const effort = buildClaudeShellEffort(args.reasoningEffort, args.modelId);
  const thinkingArgs =
    effort === 'high'
      ? ['--max-thinking-tokens', '32000']
      : effort === 'medium'
        ? ['--max-thinking-tokens', '8000']
        : [];
  return [
    '-p',
    '--resume',
    args.sessionId,
    ...(args.modelId ? ['--model', args.modelId] : []),
    '--output-format',
    'stream-json',
    '--verbose',
    '--allowedTools',
    'Edit,Write,Bash,Glob,Grep,Read',
    '--dangerously-skip-permissions',
    '--max-turns',
    '50',
    ...thinkingArgs,
  ];
}

function buildCodexAssistantArgs(args: {
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort;
}): string[] {
  const effort = resolveProviderReasoningEffort(
    'codex',
    args.reasoningEffort ?? 'high',
    args.modelId,
  ).effective;
  return [
    ...(args.modelId ? ['-m', args.modelId] : []),
    '-c',
    `model_reasoning_effort=${effort}`,
    'exec',
    '-',
    '--sandbox',
    'workspace-write',
    '--json',
  ];
}

function buildCodexAssistantResumeArgs(args: {
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort;
  threadId: string;
}): string[] {
  const effort = resolveProviderReasoningEffort(
    'codex',
    args.reasoningEffort ?? 'high',
    args.modelId,
  ).effective;
  return [
    ...(args.modelId ? ['-m', args.modelId] : []),
    '-c',
    `model_reasoning_effort=${effort}`,
    'exec',
    'resume',
    args.threadId,
    '-',
    '--sandbox',
    'workspace-write',
    '--json',
  ];
}

function captureCodexThreadId(
  processManager: IpcHandlerDeps['processManager'],
  processId: string,
  onThreadId: (id: string) => void,
) {
  let buf = '';
  const outputHandler = (pid: string, data: string) => {
    if (pid !== processId) return;
    buf += data;
    const threadId = extractCodexThreadId(buf);
    if (threadId) {
      processManager.removeListener('output', outputHandler);
      onThreadId(threadId);
    }
  };
  processManager.on('output', outputHandler);
  const exitHandler = (pid: string) => {
    if (pid !== processId) return;
    processManager.removeListener('output', outputHandler);
    processManager.removeListener('exit', exitHandler);
  };
  processManager.on('exit', exitHandler);
}

function registerExitTracking(
  processManager: IpcHandlerDeps['processManager'],
  queries: IpcHandlerDeps['queries'],
  threadId: string,
  processId: string,
  cli: InstantCli | 'shell',
  mode: 'run' | 'shell',
) {
  const exitHandler = (exitedProcessId: string, exitCode: number) => {
    if (exitedProcessId !== processId) return;
    processManager.removeListener('exit', exitHandler);
    // Skip status update if session was already removed (e.g. by instant:cancel)
    const session = runningInstants.get(threadId);
    if (!session) return;
    // For shell mode, only clean up on final exit (run mode cleans up always)
    if (mode === 'run') {
      runningInstants.delete(threadId);
    }
    queries.threads.updateStatus(
      threadId,
      exitCode === 0 ? 'completed' : 'failed',
      exitCode === 0 ? undefined : `Process exited with code ${exitCode}`,
    );
    log.info(`[instant] ${mode} thread ${threadId} (${cli}) exited with code ${exitCode}`);
  };
  processManager.on('exit', exitHandler);
}

export function registerInstantHandlers({
  ipcMain,
  queries,
  processManager,
}: IpcHandlerDeps): void {
  // --- Startup cleanup: delete instant threads older than 7 days ---
  const deleted = queries.threads.deleteOlderThan('instant', 7);
  if (deleted > 0) {
    log.info(`[instant] cleaned up ${deleted} instant threads older than 7 days`);
  }

  // --- Ensure the hidden __instant__ project exists ---
  queries.projects.getOrCreateInstantProject(os.homedir());

  // --- instant:run ---
  ipcMain.handle(
    'instant:run',
    async (
      _event,
      args: {
        projectId?: string;
        prompt: string;
        scope: InstantFixScope;
        cli: 'claude' | 'codex';
        modelId?: string | null;
        reasoningEffort?: ReasoningEffort;
        attachmentSessionId?: string;
        customSystemPrompt?: string;
      },
    ) => {
      await assertPrdRewriteModelSupported(
        args.cli,
        args.modelId ?? null,
        args.reasoningEffort ?? 'high',
      );

      // 1. Resolve cwd and projectId
      let cwd: string;
      let projectId: string;

      if (args.scope === 'user') {
        cwd = os.homedir();
        const instantProject = queries.projects.getOrCreateInstantProject(os.homedir());
        projectId = instantProject.id;
      } else {
        if (!args.projectId) throw new Error('projectId is required for project/custom scope');
        const project = queries.projects.getById(args.projectId);
        if (!project) throw new Error(`Project not found: ${args.projectId}`);
        cwd = project.path;
        projectId = project.id;
      }

      // 2. Build prompt
      let fullPrompt = args.prompt;
      if (args.scope === 'custom' && args.customSystemPrompt) {
        fullPrompt = `${args.customSystemPrompt}\n\n${args.prompt}`;
      }

      // 3. Resolve attachments
      fullPrompt += buildAttachmentContext(args.attachmentSessionId);

      // 4. Create thread
      const title = args.prompt.slice(0, 60);
      const thread = queries.threads.create(projectId, fullPrompt, title, 'instant');

      // 5. Build CLI args (prompt piped via stdin, not argv)
      let cliArgs: string[];
      if (args.cli === 'claude') {
        const effectiveEffort = resolveProviderReasoningEffort(
          'claude',
          args.reasoningEffort ?? 'high',
          args.modelId,
        ).effective;
        const thinkingArgs =
          effectiveEffort === 'medium'
            ? ['--max-thinking-tokens', '8000']
            : effectiveEffort === 'high'
              ? ['--max-thinking-tokens', '32000']
              : [];
        if (args.scope === 'user') {
          cliArgs = [
            '-p',
            ...(args.modelId ? ['--model', args.modelId] : []),
            '--output-format',
            'stream-json',
            '--verbose',
            '--allowedTools',
            'Read,Glob,Grep',
            ...thinkingArgs,
          ];
        } else {
          cliArgs = [
            '-p',
            ...(args.modelId ? ['--model', args.modelId] : []),
            '--output-format',
            'stream-json',
            '--verbose',
            '--allowedTools',
            'Edit,Write,Bash,Glob,Grep,Read',
            '--dangerously-skip-permissions',
            ...thinkingArgs,
          ];
        }
      } else {
        const sandbox = args.scope === 'user' ? 'read-only' : 'workspace-write';
        const effectiveEffort = resolveProviderReasoningEffort(
          'codex',
          args.reasoningEffort ?? 'high',
          args.modelId,
        ).effective;
        cliArgs = [
          ...(args.modelId ? ['-m', args.modelId] : []),
          '-c',
          `model_reasoning_effort=${effectiveEffort}`,
          'exec',
          '-',
          '--sandbox',
          sandbox,
          '--json',
        ];
      }

      // 6. Spawn process (prompt piped via stdin)
      const proc = processManager.spawnWithStdin(
        args.cli,
        args.cli,
        cliArgs,
        cwd,
        fullPrompt,
        thread.id,
      );
      runningInstants.set(thread.id, {
        processId: proc.id,
        cli: args.cli,
        mode: 'run',
      });

      log.info(
        `[instant] started ${args.cli} run for thread ${thread.id} (scope=${args.scope}, cwd=${cwd})`,
      );

      // 7. Listen for exit to update thread status and clean up map
      registerExitTracking(processManager, queries, thread.id, proc.id, args.cli, 'run');

      return { threadId: thread.id };
    },
  );

  ipcMain.handle(
    'instant:shell-start',
    async (
      _event,
      args: {
        projectId?: string | null;
        cli: InstantCli;
        modelId?: string | null;
        reasoningEffort?: ReasoningEffort;
        initialPrompt?: string;
        attachmentSessionId?: string;
      },
    ) => {
      await assertPrdRewriteModelSupported(
        args.cli,
        args.modelId ?? null,
        args.reasoningEffort ?? 'high',
      );

      let projectId: string;
      let cwd: string;
      if (args.projectId) {
        const project = queries.projects.getById(args.projectId);
        if (!project) throw new Error(`Project not found: ${args.projectId}`);
        projectId = project.id;
        cwd = project.path;
      } else {
        const instantProject = queries.projects.getOrCreateInstantProject(os.homedir());
        projectId = instantProject.id;
        cwd = os.homedir();
      }

      const initialPrompt = `${args.initialPrompt?.trim() ?? ''}${buildAttachmentContext(
        args.attachmentSessionId,
      )}`.trim();
      const title = initialPrompt
        ? initialPrompt.slice(0, 60)
        : `${formatInstantCliLabel(args.cli)} assistant`;
      const thread = queries.threads.create(projectId, initialPrompt, title, 'instant');

      const sessionId = args.cli === 'claude' ? crypto.randomUUID() : undefined;
      const cliArgs =
        args.cli === 'claude'
          ? buildClaudeAssistantArgs({
              modelId: args.modelId,
              reasoningEffort: args.reasoningEffort,
              sessionId: sessionId!,
            })
          : buildCodexAssistantArgs({
              modelId: args.modelId,
              reasoningEffort: args.reasoningEffort,
            });

      const proc = processManager.spawnWithStdin(
        args.cli,
        args.cli,
        cliArgs,
        cwd,
        initialPrompt || 'hello',
        thread.id,
      );

      const session: RunningInstantSession = {
        processId: proc.id,
        cli: args.cli,
        mode: 'shell',
        sessionId,
        modelId: args.modelId,
        reasoningEffort: args.reasoningEffort,
        cwd,
      };
      runningInstants.set(thread.id, session);

      if (args.cli === 'codex') {
        captureCodexThreadId(processManager, proc.id, (threadId) => {
          session.sessionId = threadId;
        });
      }

      log.info(`[instant] started ${args.cli} assistant for thread ${thread.id} (cwd=${cwd})`);

      registerExitTracking(processManager, queries, thread.id, proc.id, args.cli, 'shell');

      return { threadId: thread.id };
    },
  );

  ipcMain.handle(
    'instant:fix-thread-failure',
    async (_event, args: { threadId: string; failureOutput: string }) => {
      const sourceThread = queries.threads.getById(args.threadId);
      if (!sourceThread) throw new Error(`Thread ${args.threadId} not found`);

      const project = queries.projects.getById(sourceThread.projectId);
      if (!project) throw new Error(`Project ${sourceThread.projectId} not found`);

      const failureOutput = clampFailureOutput(args.failureOutput);
      if (!failureOutput) throw new Error('No failure output available');

      const issue =
        sourceThread.githubIssueNumber != null
          ? queries.githubIssues.getByNumber(project.id, sourceThread.githubIssueNumber)
          : null;
      const latestPlan = queries.plans.getLatest(sourceThread.id);
      const cwd = sourceThread.worktreePath || project.path;
      const prompt = buildThreadFailurePrompt({
        project,
        thread: sourceThread,
        issue,
        latestPlan,
        failureOutput,
        cwd,
      });
      const cli: InstantCli = sourceThread.executorModel === 'claude' ? 'claude' : 'codex';
      const title =
        `Fix ${sourceThread.githubIssueNumber != null ? `#${sourceThread.githubIssueNumber}` : sourceThread.title}`.slice(
          0,
          80,
        );
      const thread = queries.threads.create(project.id, prompt, title, 'instant');

      const proc =
        cli === 'claude'
          ? processManager.spawnWithStdin(
              'claude',
              'claude',
              [
                '-p',
                '--output-format',
                'stream-json',
                '--verbose',
                '--allowedTools',
                'Edit,Write,Bash,Glob,Grep,Read',
                '--dangerously-skip-permissions',
              ],
              cwd,
              prompt,
              thread.id,
            )
          : processManager.spawnWithStdin(
              'codex',
              'codex',
              [
                '-a',
                'never',
                '-c',
                'model_reasoning_effort=high',
                'exec',
                '-',
                '--sandbox',
                'workspace-write',
                '--json',
              ],
              cwd,
              prompt,
              thread.id,
            );

      runningInstants.set(thread.id, {
        processId: proc.id,
        cli,
        mode: 'run',
      });
      registerExitTracking(processManager, queries, thread.id, proc.id, cli, 'run');
      log.info(
        `[instant] started ${cli} terminal fix for source thread ${sourceThread.id} as ${thread.id} (cwd=${cwd})`,
      );

      return { threadId: thread.id, cli, title };
    },
  );

  // --- instant:bare-shell — spawns the user's login shell (no AI CLI) ---
  ipcMain.handle('instant:bare-shell', async (_event, args: { projectId: string }) => {
    const project = queries.projects.getById(args.projectId);
    if (!project) throw new Error(`Project not found: ${args.projectId}`);

    const userShell = process.env.SHELL || '/bin/zsh';
    const title = `Terminal — ${project.name ?? project.path.split('/').pop()}`;
    const thread = queries.threads.create(project.id, '', title, 'instant');

    const proc = processManager.spawn('shell', userShell, ['-l'], project.path, thread.id, {
      outputMode: 'raw',
    });

    runningInstants.set(thread.id, {
      processId: proc.id,
      cli: 'shell',
      mode: 'shell',
    });

    log.info(`[instant] started bare shell for thread ${thread.id} (cwd=${project.path})`);

    registerExitTracking(processManager, queries, thread.id, proc.id, 'shell', 'shell');

    return { threadId: thread.id };
  });

  ipcMain.handle(
    'instant:shell-input',
    (_event, { threadId, data }: { threadId: string; data: string }) => {
      const session = runningInstants.get(threadId);
      if (!session) {
        const interactiveSession = getInteractiveTerminalSession(threadId);
        if (interactiveSession) processManager.write(interactiveSession.processId, data);
        return;
      }
      if (session.mode !== 'shell') return;

      // Bare shell sessions still use PTY stdin
      if (session.cli === 'shell') {
        processManager.write(session.processId, data);
        return;
      }

      if (session.isProcessingTurn) {
        log.warn(`[instant] follow-up blocked — turn still running for thread ${threadId}`);
        return;
      }

      if (!session.sessionId) {
        log.warn(`[instant] follow-up blocked — no session ID yet for thread ${threadId}`);
        return;
      }

      const followupPrompt = data.replace(/\n$/, '');
      if (!followupPrompt) return;

      // Kill any previous process still running for this thread
      const prevProc = processManager.get(session.processId);
      if (prevProc && prevProc.state !== 'exited') {
        processManager.kill(session.processId);
      }

      session.isProcessingTurn = true;

      const cliArgs =
        session.cli === 'claude'
          ? buildClaudeAssistantResumeArgs({
              modelId: session.modelId,
              reasoningEffort: session.reasoningEffort,
              sessionId: session.sessionId,
            })
          : buildCodexAssistantResumeArgs({
              modelId: session.modelId,
              reasoningEffort: session.reasoningEffort,
              threadId: session.sessionId,
            });

      const proc = processManager.spawnWithStdin(
        session.cli,
        session.cli,
        cliArgs,
        session.cwd!,
        followupPrompt,
        threadId,
      );

      session.processId = proc.id;

      if (session.cli === 'codex') {
        captureCodexThreadId(processManager, proc.id, (newThreadId) => {
          session.sessionId = newThreadId;
        });
      }

      const exitHandler = (exitedProcessId: string) => {
        if (exitedProcessId !== proc.id) return;
        processManager.removeListener('exit', exitHandler);
        session.isProcessingTurn = false;
      };
      processManager.on('exit', exitHandler);

      log.info(`[instant] resumed ${session.cli} session for thread ${threadId}`);
    },
  );

  ipcMain.handle(
    'instant:shell-resize',
    (_event, { threadId, cols, rows }: { threadId: string; cols: number; rows: number }) => {
      const session = runningInstants.get(threadId);
      const safeCols = Number.isFinite(cols) ? Math.max(1, Math.floor(cols)) : 1;
      const safeRows = Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 1;
      if (!session) {
        const interactiveSession = getInteractiveTerminalSession(threadId);
        if (interactiveSession)
          processManager.resize(interactiveSession.processId, safeCols, safeRows);
        return;
      }
      if (session.mode !== 'shell') return;
      processManager.resize(session.processId, safeCols, safeRows);
    },
  );

  // --- instant:cancel ---
  ipcMain.handle('instant:cancel', (_event, { threadId }: { threadId: string }) => {
    const session = runningInstants.get(threadId);
    if (session) {
      processManager.kill(session.processId);
      runningInstants.delete(threadId);
      queries.threads.updateStatus(threadId, 'failed', 'Cancelled by user');
      log.info(`[instant] cancelled ${session.mode} thread ${threadId}`);
      return;
    }
    const interactiveSession = getInteractiveTerminalSession(threadId);
    if (interactiveSession) {
      processManager.kill(interactiveSession.processId);
      unregisterInteractiveTerminalSession(threadId);
      queries.threads.updateStatus(threadId, 'failed', 'Cancelled by user');
      log.info(`[instant] cancelled interactive terminal thread ${threadId}`);
    }
  });

  // --- instant:list ---
  ipcMain.handle('instant:list', () => {
    return queries.threads.listInstant();
  });

  // --- instant:cleanup ---
  ipcMain.handle('instant:cleanup', () => {
    const count = queries.threads.deleteOlderThan('instant', 7);
    return { deleted: count };
  });
}
