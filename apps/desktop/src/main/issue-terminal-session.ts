import fs from 'node:fs/promises';
import path from 'node:path';
import { WorktreeManager } from '@shipcode/git';
import {
  buildShipCodeRunContract,
  type GitHubIssueCacheRecord,
  PIPELINE_PHASE,
  type Project,
  type ReasoningEffort,
  resolveProviderReasoningEffort,
  THREAD_KIND,
  type Thread,
} from '@shipcode/shared';
import type { BrowserWindow } from 'electron';
import type { IpcHandlerDeps, Queries } from './ipc/types';
import { safeSend } from './safe-send';
import {
  completeInteractiveTerminalSession,
  registerInteractiveTerminalSession,
  touchInteractiveTerminalSession,
  unregisterInteractiveTerminalSession,
} from './terminal-session-registry';

type IssueTerminalProvider = 'claude' | 'codex';

export interface StartIssueTerminalArgs {
  projectId: string;
  issueNumber: number;
  provider: IssueTerminalProvider;
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort;
}

export interface StartIssueTerminalResult {
  threadId: string;
  processId: string;
  worktreePath: string;
  promptArtifactPath: string;
}

const PHASE = 'interactive_terminal';
const DEFAULT_SKILL = `# Issue Terminal Session

- GitHub issue is the source of truth.
- Work only in the assigned worktree.
- Use existing repository patterns.
- Make code changes directly when requested.
- Run relevant tests/checks.
- Save a final summary to the session-summary.md path from the prompt artifact.
- Include files changed, commands run, blockers, and a suggested GitHub comment.
`;

function providerLabel(provider: IssueTerminalProvider): 'claude-cli' | 'codex-cli' {
  return provider === 'claude' ? 'claude-cli' : 'codex-cli';
}

function sanitizeProcessName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function readIssueTerminalSkill(): Promise<string> {
  const candidates = [
    path.join(process.cwd(), 'skills', 'issue-terminal-session', 'SKILL.md'),
    path.join(process.cwd(), '..', '..', 'skills', 'issue-terminal-session', 'SKILL.md'),
  ];
  const skill = await Promise.any(
    candidates.map((candidate) => fs.readFile(candidate, 'utf8')),
  ).catch(() => DEFAULT_SKILL);
  return skill;
}

function buildPromptArtifact(input: {
  issue: GitHubIssueCacheRecord;
  project: Project;
  thread: Thread;
  worktreePath: string;
  summaryPath: string;
  skill: string;
}): string {
  const labels = input.issue.labels.length > 0 ? input.issue.labels.join(', ') : '(none)';
  return `# ShipCode Issue Terminal Session

${buildShipCodeRunContract({
  projectPath: input.project.path,
  worktreePath: input.worktreePath,
  baseBranch: input.project.defaultBranch,
  currentBranch: input.thread.worktreeBranch,
  githubIssueNumber: input.issue.issueNumber,
})}

## GitHub Issue

- Project: ${input.project.name}
- Repository: ${input.project.githubRepoFullName ?? input.project.gitRemote ?? '(unknown)'}
- Issue: #${input.issue.issueNumber}
- Title: ${input.issue.title}
- Labels: ${labels}
- Thread ID: ${input.thread.id}

## Assigned Worktree

- Summary artifact: ${input.summaryPath}

## Issue Body

${input.issue.body?.trim() || '(empty issue body)'}

## Session Skill

${input.skill}
`;
}

async function ensureIssueThread(input: {
  queries: Queries;
  project: Project;
  issue: GitHubIssueCacheRecord;
}): Promise<Thread> {
  const existing = input.issue.threadId
    ? input.queries.threads.getById(input.issue.threadId)
    : input.queries.threads.getByProjectAndGithubIssue(input.project.id, input.issue.issueNumber);
  let thread =
    existing ??
    input.queries.threads.create(
      input.project.id,
      input.issue.body ?? input.issue.title,
      input.issue.title,
      THREAD_KIND.pipeline,
    );

  input.queries.threads.updateIssueContent(
    thread.id,
    input.issue.body ?? input.issue.title,
    input.issue.title,
  );
  input.queries.threads.setGithubIssue(thread.id, input.issue.issueNumber, input.project.gitRemote);
  input.queries.githubIssues.linkThread(input.issue.id, thread.id);
  thread = input.queries.threads.getById(thread.id) ?? thread;

  if (thread.worktreePath) return thread;

  const settings = input.queries.settings.get();
  const worktreeManager = new WorktreeManager(input.project.path, {
    worktreeRoot: settings.worktreeRoot,
    branchFormat: settings.worktreeBranchFormat,
  });
  const created = await worktreeManager.create(
    input.issue.issueNumber,
    input.issue.title,
    input.project.defaultBranch,
  );
  input.queries.threads.setWorktree(thread.id, created.branch, created.worktreePath);
  return input.queries.threads.getById(thread.id) ?? thread;
}

function buildCliArgs(input: {
  provider: IssueTerminalProvider;
  issueNumber: number;
  threadId: string;
  promptArtifactPath: string;
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort;
}): string[] {
  const instruction = `Read ${input.promptArtifactPath} and continue the GitHub issue workflow.`;
  if (input.provider === 'claude') {
    const args = [
      '--permission-mode',
      'acceptEdits',
      '--tools',
      'Edit,Write,Bash,Glob,Grep,Read',
      '--name',
      sanitizeProcessName(`shipcode-${input.issueNumber}-${input.threadId}`),
    ];
    if (input.modelId) args.push('--model', input.modelId);
    args.push(instruction);
    return args;
  }

  const args = ['-s', 'workspace-write', '-a', 'on-request', '--no-alt-screen'];
  if (input.modelId) args.push('-m', input.modelId);
  const effort = resolveProviderReasoningEffort(
    'codex',
    input.reasoningEffort ?? 'medium',
    input.modelId,
  ).effective;
  if (effort !== 'none' && effort !== 'minimal') {
    args.push('-c', `model_reasoning_effort=${effort}`);
  }
  args.push(instruction);
  return args;
}

function emitTerminalEvent(
  mainWindow: BrowserWindow,
  queries: Queries,
  threadId: string,
  event: Parameters<Queries['terminalEvents']['create']>[1],
): void {
  const record = queries.terminalEvents.create(threadId, event);
  safeSend(mainWindow, 'terminal:event', record);
}

async function importSessionSummary(input: {
  queries: Queries;
  threadId: string;
  provider: IssueTerminalProvider;
  modelId?: string | null;
  summaryPath: string;
  fallback: string;
}): Promise<{ summary: string; conversationId: string }> {
  let summary = input.fallback;
  try {
    const artifact = await fs.readFile(input.summaryPath, 'utf8');
    if (artifact.trim()) summary = artifact.trim();
  } catch {
    // Missing summary artifact is handled with the explicit fallback.
  }

  const row = input.queries.agentConversations.insert({
    threadId: input.threadId,
    phase: PHASE,
    speaker: input.provider,
    role: 'response',
    provider: providerLabel(input.provider),
    model: input.modelId ?? null,
    content: summary,
  });
  return { summary, conversationId: row.id };
}

export async function startIssueTerminalSession({
  args,
  queries,
  processManager,
  mainWindow,
}: {
  args: StartIssueTerminalArgs;
  queries: Queries;
  processManager: IpcHandlerDeps['processManager'];
  mainWindow: BrowserWindow;
}): Promise<StartIssueTerminalResult> {
  const project = queries.projects.getById(args.projectId);
  if (!project) throw new Error(`Project not found: ${args.projectId}`);
  const issue = queries.githubIssues.getByNumber(args.projectId, args.issueNumber);
  if (!issue) throw new Error(`GitHub issue #${args.issueNumber} is not cached for this project`);

  const thread = await ensureIssueThread({ queries, project, issue });
  if (!thread.worktreePath) {
    throw new Error(`Thread ${thread.id} has no worktree path after setup`);
  }
  if (!thread.worktreeBranch) {
    throw new Error(`Thread ${thread.id} has no worktree branch after setup`);
  }
  const settings = queries.settings.get();
  const worktreeManager = new WorktreeManager(project.path, {
    worktreeRoot: settings.worktreeRoot,
    branchFormat: settings.worktreeBranchFormat,
  });
  await worktreeManager.assertRegistered(thread.worktreePath, thread.worktreeBranch);

  const runDir = path.join(thread.worktreePath, '.shipcode', 'runs', thread.id);
  const promptArtifactPath = path.join(runDir, 'terminal-prompt.md');
  const summaryPath = path.join(runDir, 'session-summary.md');
  await fs.mkdir(runDir, { recursive: true });
  const skill = await readIssueTerminalSkill();
  const prompt = buildPromptArtifact({
    issue,
    project,
    thread,
    worktreePath: thread.worktreePath,
    summaryPath,
    skill,
  });
  await fs.writeFile(promptArtifactPath, prompt, 'utf8');

  queries.agentConversations.insert({
    threadId: thread.id,
    phase: PHASE,
    speaker: 'shipcode',
    role: 'prompt',
    provider: providerLabel(args.provider),
    model: args.modelId ?? null,
    content: prompt,
  });
  queries.threads.updateStatus(thread.id, PIPELINE_PHASE.executing);
  emitTerminalEvent(mainWindow, queries, thread.id, {
    kind: 'lifecycle',
    message: `Starting interactive ${args.provider} session for issue #${args.issueNumber}`,
  });

  const cliArgs = buildCliArgs({
    provider: args.provider,
    issueNumber: args.issueNumber,
    threadId: thread.id,
    promptArtifactPath,
    modelId: args.modelId ?? null,
    reasoningEffort: args.reasoningEffort,
  });
  const managed = processManager.spawn(
    args.provider,
    args.provider,
    cliArgs,
    thread.worktreePath,
    thread.id,
    {
      outputMode: 'raw',
      workspaceRoot: settings.worktreeRoot,
      projectPath: project.path,
    },
  );

  registerInteractiveTerminalSession({
    processId: managed.id,
    threadId: thread.id,
    cwd: thread.worktreePath,
    provider: args.provider,
    mode: 'interactive',
    startedAt: Date.now(),
    lastEventAt: Date.now(),
    exitCode: null,
  });

  const onOutput = (processId: string, chunk: string) => {
    if (processId !== managed.id) return;
    touchInteractiveTerminalSession(thread.id);
    emitTerminalEvent(mainWindow, queries, thread.id, { kind: 'raw', content: chunk });
  };
  const onExit = (processId: string, exitCode: number) => {
    if (processId !== managed.id) return;
    processManager.off('output', onOutput);
    processManager.off('exit', onExit);
    completeInteractiveTerminalSession(thread.id, exitCode);
    emitTerminalEvent(mainWindow, queries, thread.id, {
      kind: 'lifecycle',
      message: `Interactive ${args.provider} session exited with code ${exitCode}`,
    });
    const fallback = `Interactive ${args.provider} session exited with code ${exitCode}.
Prompt artifact: ${promptArtifactPath}
Worktree: ${thread.worktreePath}
Terminal output is available in the session transcript.`;
    void importSessionSummary({
      queries,
      threadId: thread.id,
      provider: args.provider,
      modelId: args.modelId ?? null,
      summaryPath,
      fallback,
    })
      .then(() => {
        queries.threads.updateStatus(
          thread.id,
          exitCode === 0 ? PIPELINE_PHASE.completed : PIPELINE_PHASE.failed,
          exitCode === 0 ? undefined : `Interactive ${args.provider} exited with code ${exitCode}`,
        );
      })
      .finally(() => unregisterInteractiveTerminalSession(thread.id));
  };
  processManager.on('output', onOutput);
  processManager.on('exit', onExit);

  return {
    threadId: thread.id,
    processId: managed.id,
    worktreePath: thread.worktreePath,
    promptArtifactPath,
  };
}

export async function summarizeIssueTerminalSession(
  queries: Queries,
  threadId: string,
): Promise<{ summary: string; conversationId: string }> {
  const thread = queries.threads.getById(threadId);
  if (!thread?.worktreePath) throw new Error(`Thread ${threadId} has no worktree path`);
  const latestPrompt = queries.agentConversations
    .listByThread(threadId, { phase: PHASE, role: 'prompt' })
    .at(-1);
  const provider = latestPrompt?.provider === 'codex-cli' ? 'codex' : 'claude';
  const summaryPath = path.join(
    thread.worktreePath,
    '.shipcode',
    'runs',
    threadId,
    'session-summary.md',
  );
  return importSessionSummary({
    queries,
    threadId,
    provider,
    summaryPath,
    fallback: `Interactive terminal session summary is not available yet.
Worktree: ${thread.worktreePath}
Terminal output is available in the session transcript.`,
  });
}

export function buildIssueTerminalGithubComment(queries: Queries, threadId: string): string {
  const thread = queries.threads.getById(threadId);
  const conversations = queries.agentConversations.listByThread(threadId, {
    phase: PHASE,
    role: 'response',
  });
  const latest = conversations.at(-1);
  const issueLabel = thread?.githubIssueNumber ? `#${thread.githubIssueNumber}` : 'the issue';
  const body = latest?.content.trim() || 'Interactive terminal session completed.';
  return `ShipCode interactive terminal update for ${issueLabel}:

${body}`;
}
