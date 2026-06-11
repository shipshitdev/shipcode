import crypto from 'node:crypto';
import { extractCodexThreadId, resolveCliText, StreamParser } from '@shipcode/agents';
import { WorktreeManager } from '@shipcode/git';
import {
  clampError,
  type GitHubIssueCacheRecord,
  type Project,
  type ReasoningEffort,
  resolveProviderReasoningEffort,
  stripAnsi,
  type Thread,
} from '@shipcode/shared';
import type { BrowserWindow } from 'electron';
import type { IpcHandlerDeps, Queries } from './ipc/types';
import log from './logger.service';

type IssueChatProvider = 'claude' | 'codex';

export interface StartIssueChatArgs {
  threadId: string;
  provider: IssueChatProvider;
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort;
}

export interface StartIssueChatResult {
  threadId: string;
  provider: IssueChatProvider;
  modelId: string | null;
  sessionId: string | null;
  reasoningEffort: ReasoningEffort | null;
  worktreePath: string;
  reattached: boolean;
  activeProcessId: string | null;
}

export interface IssueChatSessionMetadataResult {
  threadId: string;
  provider: IssueChatProvider;
  sessionId: string | null;
  modelId: string | null;
  reasoningEffort: ReasoningEffort | null;
  worktreePath: string;
}

export interface SendIssueChatTurnArgs {
  threadId: string;
  text: string;
  speaker?: string;
}

export interface SendIssueChatTurnResult {
  threadId: string;
  promptId: string;
  responseId: string;
  round: number;
  exitCode: number;
  content: string;
}

export interface StopIssueChatResult {
  threadId: string;
  stopped: boolean;
}

interface IssueChatSession {
  threadId: string;
  provider: IssueChatProvider;
  modelId: string | null;
  reasoningEffort?: ReasoningEffort;
  cwd: string;
  sessionId: string | null;
  activeProcessId: string | null;
  isProcessingTurn: boolean;
}

const ISSUE_CHAT_PHASE = 'issue_chat';
const sessions = new Map<string, IssueChatSession>();

function providerLabel(provider: IssueChatProvider): 'claude-cli' | 'codex-cli' {
  return provider === 'claude' ? 'claude-cli' : 'codex-cli';
}

function ensureIssueChatProvider(provider: string): IssueChatProvider {
  if (provider === 'claude' || provider === 'codex') return provider;
  throw new Error(`Issue chat provider must be claude or codex, got ${provider}`);
}

function normalizeSpeaker(input: string | undefined): string {
  const trimmed = input?.trim();
  return trimmed ? trimmed.slice(0, 80) : 'user';
}

function normalizeReasoningEffort(input: string | null | undefined): ReasoningEffort | undefined {
  if (input === 'low' || input === 'medium' || input === 'high') return input;
  return undefined;
}

function buildClaudeThinkingArgs(
  reasoningEffort: ReasoningEffort | undefined,
  modelId: string | null,
): string[] {
  const effort = resolveProviderReasoningEffort(
    'claude',
    reasoningEffort ?? 'high',
    modelId,
  ).effective;
  if (effort === 'high') return ['--max-thinking-tokens', '32000'];
  if (effort === 'medium') return ['--max-thinking-tokens', '8000'];
  return [];
}

function buildClaudeArgs(session: IssueChatSession): {
  args: string[];
  pendingSessionId: string | null;
} {
  const modelArgs = session.modelId ? ['--model', session.modelId] : [];
  const common = [
    ...modelArgs,
    '--output-format',
    'stream-json',
    '--verbose',
    '--allowedTools',
    'Edit,Write,Bash,Glob,Grep,Read',
    '--max-turns',
    '50',
    ...buildClaudeThinkingArgs(session.reasoningEffort, session.modelId),
  ];
  if (session.sessionId) {
    return { args: ['-p', '--resume', session.sessionId, ...common], pendingSessionId: null };
  }
  const sessionId = crypto.randomUUID();
  return { args: ['-p', ...common, '--session-id', sessionId], pendingSessionId: sessionId };
}

function buildCodexArgs(session: IssueChatSession): string[] {
  const effort = resolveProviderReasoningEffort(
    'codex',
    session.reasoningEffort ?? 'high',
    session.modelId,
  ).effective;
  const prefix = [
    ...(session.modelId ? ['-m', session.modelId] : []),
    '-c',
    `model_reasoning_effort=${effort}`,
    'exec',
  ];
  const suffix = ['--sandbox', 'workspace-write', '--json'];
  return session.sessionId
    ? [...prefix, 'resume', session.sessionId, '-', ...suffix]
    : [...prefix, '-', ...suffix];
}

function buildTurnPrompt(input: {
  project: Project;
  issue: GitHubIssueCacheRecord | null;
  thread: Thread;
  worktreePath: string;
  text: string;
  includeContext: boolean;
  previousTurns: Array<{ speaker: string; role: 'prompt' | 'response'; content: string }>;
}): string {
  if (!input.includeContext) return input.text;

  const issue = input.issue;
  const previousTranscript = input.previousTurns
    .slice(-20)
    .map((turn) => {
      const label = turn.role === 'prompt' ? turn.speaker : 'assistant';
      return `### ${label}\n${turn.content.trim() || '(empty)'}`;
    })
    .join('\n\n')
    .slice(-8_000);

  return `# ShipCode Issue Chat Session

You are continuing a multi-turn agent conversation scoped to this issue thread and worktree.

## Context

- Project: ${input.project.name}
- Repository: ${input.project.githubRepoFullName ?? input.project.gitRemote ?? '(unknown)'}
- Thread ID: ${input.thread.id}
- Worktree path: ${input.worktreePath}
- Branch: ${input.thread.worktreeBranch ?? '(unknown)'}
${issue ? `- GitHub issue: #${issue.issueNumber}` : ''}
${issue ? `- Issue title: ${issue.title}` : `- Thread title: ${input.thread.title}`}

## Issue Body

${issue?.body?.trim() || input.thread.prompt?.trim() || '(empty)'}

${
  previousTranscript
    ? `## Previous Issue Chat Transcript

The visible audit transcript below may be more complete than the provider-owned session window. Treat it as bounded context for this fresh provider session.

${previousTranscript}
`
    : ''
}

## User Turn

${input.text}
`;
}

function emitTerminalEvent(
  mainWindow: BrowserWindow,
  queries: Queries,
  threadId: string,
  event: Parameters<Queries['terminalEvents']['create']>[1],
): void {
  const record = queries.terminalEvents.create(threadId, event);
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('terminal:event', record);
  }
}

function nextRound(queries: Queries, threadId: string): number {
  const existing = queries.agentConversations.listByThread(threadId, {
    phase: ISSUE_CHAT_PHASE,
    role: 'prompt',
  });
  return existing.reduce((max, row) => Math.max(max, row.round), 0) + 1;
}

async function ensureThreadWorktree(input: {
  queries: Queries;
  thread: Thread;
  project: Project;
}): Promise<Thread> {
  if (input.thread.worktreePath) return input.thread;
  if (input.thread.githubIssueNumber == null) {
    throw new Error(`Thread ${input.thread.id} is not linked to a GitHub issue`);
  }

  const issue = input.queries.githubIssues.getByNumber(
    input.project.id,
    input.thread.githubIssueNumber,
  );
  const settings = input.queries.settings.get();
  const worktreeManager = new WorktreeManager(input.project.path, {
    worktreeRoot: settings.worktreeRoot,
    branchFormat: settings.worktreeBranchFormat,
  });
  const created = await worktreeManager.create(
    input.thread.githubIssueNumber,
    issue?.title ?? input.thread.title,
    input.project.defaultBranch,
  );
  input.queries.threads.setWorktree(input.thread.id, created.branch, created.worktreePath);
  return (
    input.queries.threads.getById(input.thread.id) ?? {
      ...input.thread,
      worktreeBranch: created.branch,
      worktreePath: created.worktreePath,
    }
  );
}

function resolveResponseContent(rawOutput: string, exitCode: number, provider: IssueChatProvider) {
  const cleanRaw = StreamParser.stripSystemEvents(rawOutput);
  const content = resolveCliText(cleanRaw).trim() || stripAnsi(cleanRaw).trim();
  if (exitCode === 0) return content || `${provider} completed without text output.`;

  const excerpt = (content || stripAnsi(cleanRaw).trim()).slice(0, 2_000);
  return `[error] ${provider} exited with code ${exitCode}${excerpt ? `\n\n${excerpt}` : ''}`;
}

function parseModelAndUsage(provider: IssueChatProvider, rawOutput: string) {
  const parser = new StreamParser();
  parser.feed(rawOutput);
  return {
    model:
      provider === 'codex'
        ? (parser.extractCodexModel() ?? parser.extractModel())
        : parser.extractModel(),
    usage: parser.extractUsage(),
  };
}

export async function startIssueChatSession({
  args,
  queries,
}: {
  args: StartIssueChatArgs;
  queries: Queries;
}): Promise<StartIssueChatResult> {
  const provider = ensureIssueChatProvider(args.provider);
  const existing = sessions.get(args.threadId);
  if (existing) {
    if (existing.provider !== provider) {
      throw new Error(`Issue chat already started for ${args.threadId} with ${existing.provider}`);
    }
    return {
      threadId: existing.threadId,
      provider: existing.provider,
      modelId: existing.modelId,
      sessionId: existing.sessionId,
      reasoningEffort: existing.reasoningEffort ?? null,
      worktreePath: existing.cwd,
      reattached: true,
      activeProcessId: existing.activeProcessId,
    };
  }

  const thread = queries.threads.getById(args.threadId);
  if (!thread) throw new Error(`Thread not found: ${args.threadId}`);
  const project = queries.projects.getById(thread.projectId);
  if (!project) throw new Error(`Project not found: ${thread.projectId}`);
  const materializedThread = await ensureThreadWorktree({ queries, thread, project });
  if (!materializedThread.worktreePath) {
    throw new Error(`Thread ${thread.id} has no worktree path after setup`);
  }
  const persisted = queries.issueChatSessions.getByThread(args.threadId);
  if (persisted && persisted.provider !== provider) {
    throw new Error(
      `Issue chat was previously started with ${persisted.provider}; choose ${persisted.provider} to resume`,
    );
  }
  const modelId = args.modelId ?? persisted?.model ?? null;
  const reasoningEffort =
    args.reasoningEffort ?? normalizeReasoningEffort(persisted?.reasoningEffort) ?? null;
  const sessionId = persisted?.sessionId ?? null;

  sessions.set(args.threadId, {
    threadId: args.threadId,
    provider,
    modelId,
    reasoningEffort: reasoningEffort ?? undefined,
    cwd: materializedThread.worktreePath,
    sessionId,
    activeProcessId: null,
    isProcessingTurn: false,
  });
  queries.issueChatSessions.upsert({
    threadId: args.threadId,
    provider,
    sessionId,
    cwd: materializedThread.worktreePath,
    model: modelId,
    reasoningEffort,
  });

  return {
    threadId: args.threadId,
    provider,
    modelId,
    sessionId,
    reasoningEffort,
    worktreePath: materializedThread.worktreePath,
    reattached: sessionId != null,
    activeProcessId: null,
  };
}

export function getIssueChatSessionMetadata({
  threadId,
  queries,
}: {
  threadId: string;
  queries: Queries;
}): IssueChatSessionMetadataResult | null {
  const live = sessions.get(threadId);
  if (live) {
    return {
      threadId,
      provider: live.provider,
      sessionId: live.sessionId,
      modelId: live.modelId,
      reasoningEffort: live.reasoningEffort ?? null,
      worktreePath: live.cwd,
    };
  }

  const persisted = queries.issueChatSessions.getByThread(threadId);
  if (!persisted) return null;
  return {
    threadId,
    provider: persisted.provider,
    sessionId: persisted.sessionId,
    modelId: persisted.model,
    reasoningEffort: normalizeReasoningEffort(persisted.reasoningEffort) ?? null,
    worktreePath: persisted.cwd,
  };
}

export async function sendIssueChatTurn({
  args,
  queries,
  processManager,
  mainWindow,
}: {
  args: SendIssueChatTurnArgs;
  queries: Queries;
  processManager: IpcHandlerDeps['processManager'];
  mainWindow: BrowserWindow;
}): Promise<SendIssueChatTurnResult> {
  const session = sessions.get(args.threadId);
  if (!session) throw new Error(`Issue chat is not started for thread ${args.threadId}`);
  if (session.isProcessingTurn) {
    throw new Error(`Issue chat turn already running for thread ${args.threadId}`);
  }

  const text = args.text.trim();
  if (!text) throw new Error('Issue chat turn text is required');

  const thread = queries.threads.getById(args.threadId);
  if (!thread) throw new Error(`Thread not found: ${args.threadId}`);
  const project = queries.projects.getById(thread.projectId);
  if (!project) throw new Error(`Project not found: ${thread.projectId}`);
  const issue =
    thread.githubIssueNumber != null
      ? queries.githubIssues.getByNumber(project.id, thread.githubIssueNumber)
      : null;
  const previousTurns = queries.agentConversations.listByThread(args.threadId, {
    phase: ISSUE_CHAT_PHASE,
  });
  const round = nextRound(queries, args.threadId);
  const promptRow = queries.agentConversations.insert({
    threadId: args.threadId,
    phase: ISSUE_CHAT_PHASE,
    round,
    speaker: normalizeSpeaker(args.speaker),
    role: 'prompt',
    provider: providerLabel(session.provider),
    model: session.modelId,
    content: text,
  });

  const fullPrompt = buildTurnPrompt({
    project,
    issue,
    thread,
    worktreePath: session.cwd,
    text,
    includeContext: session.sessionId == null,
    previousTurns,
  });
  const command =
    session.provider === 'claude'
      ? buildClaudeArgs(session)
      : { args: buildCodexArgs(session), pendingSessionId: null };
  session.isProcessingTurn = true;

  emitTerminalEvent(mainWindow, queries, args.threadId, {
    kind: 'lifecycle',
    message: `Starting issue chat turn ${round} with ${session.provider}`,
  });

  let rawOutput = '';
  let exitCode = 127;
  let managed: ReturnType<IpcHandlerDeps['processManager']['spawnWithStdin']> | null = null;

  try {
    managed = processManager.spawnWithStdin(
      session.provider,
      session.provider,
      command.args,
      session.cwd,
      fullPrompt,
      args.threadId,
    );
    session.activeProcessId = managed.id;

    exitCode = await new Promise<number>((resolve) => {
      const onOutput = (processId: string, chunk: string) => {
        if (!managed || processId !== managed.id) return;
        rawOutput += chunk;
      };
      const onExit = (processId: string, code: number) => {
        if (!managed || processId !== managed.id) return;
        processManager.off('output', onOutput);
        processManager.off('exit', onExit);
        resolve(code);
      };
      processManager.on('output', onOutput);
      processManager.on('exit', onExit);
    });
  } catch (error) {
    rawOutput = clampError(error, 2_000);
    exitCode = 127;
  } finally {
    session.activeProcessId = null;
    session.isProcessingTurn = false;
  }

  if (session.provider === 'codex') {
    session.sessionId = extractCodexThreadId(rawOutput) ?? session.sessionId;
  } else if (command.pendingSessionId && exitCode === 0) {
    session.sessionId = command.pendingSessionId;
  }
  if (session.sessionId) {
    try {
      queries.issueChatSessions.updateSessionId(args.threadId, session.sessionId);
    } catch (error) {
      log.error('[issue-chat] session metadata persistence failed:', error);
    }
  }

  const responseContent = resolveResponseContent(rawOutput, exitCode, session.provider);
  const { model, usage } = parseModelAndUsage(session.provider, rawOutput);
  const responseRow = queries.agentConversations.insert({
    threadId: args.threadId,
    phase: ISSUE_CHAT_PHASE,
    round,
    speaker: session.provider,
    role: 'response',
    parentId: promptRow.id,
    provider: providerLabel(session.provider),
    model: model ?? session.modelId,
    content: responseContent,
    tokensIn: usage?.inputTokens ?? null,
    tokensOut: usage?.outputTokens ?? null,
    costUsd: usage?.costUsd ?? null,
  });

  if (usage) {
    try {
      queries.threads.addTokenUsage(
        args.threadId,
        usage.inputTokens,
        usage.outputTokens,
        usage.costUsd,
      );
    } catch (error) {
      log.error('[issue-chat] token usage persistence failed:', error);
    }
  }

  emitTerminalEvent(mainWindow, queries, args.threadId, {
    kind: 'lifecycle',
    message: `Issue chat turn ${round} exited with code ${exitCode}`,
  });

  if (exitCode !== 0) {
    throw new Error(clampError(responseContent));
  }

  return {
    threadId: args.threadId,
    promptId: promptRow.id,
    responseId: responseRow.id,
    round,
    exitCode,
    content: responseContent,
  };
}

export function stopIssueChatSession({
  threadId,
  queries,
  processManager,
  mainWindow,
}: {
  threadId: string;
  queries: Queries;
  processManager: IpcHandlerDeps['processManager'];
  mainWindow: BrowserWindow;
}): StopIssueChatResult {
  const session = sessions.get(threadId);
  if (!session) return { threadId, stopped: false };
  if (session.activeProcessId) {
    processManager.kill(session.activeProcessId);
  }
  sessions.delete(threadId);
  emitTerminalEvent(mainWindow, queries, threadId, {
    kind: 'lifecycle',
    message: 'Issue chat session stopped',
  });
  return { threadId, stopped: true };
}

export function stopIssueChatSessionIfLive(
  threadId: string,
  processManager: IpcHandlerDeps['processManager'],
): boolean {
  const session = sessions.get(threadId);
  if (!session) return false;
  if (session.activeProcessId) processManager.kill(session.activeProcessId);
  sessions.delete(threadId);
  return true;
}

export function isIssueChatSessionLive(threadId: string): boolean {
  return sessions.has(threadId);
}
