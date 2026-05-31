import fs from 'node:fs/promises';
import path from 'node:path';
import { WorktreeManager } from '@shipcode/git';
import {
  buildShipCodeRunContract,
  PIPELINE_PHASE,
  resolveProviderReasoningEffort,
  THREAD_KIND,
  type Thread,
} from '@shipcode/shared';
import { sanitizeCliText } from '../adapters/cli-emitter';
import { createCliContext } from '../context';
import { parseIssueNumber } from './issue-helpers';

type Provider = 'claude' | 'codex';
type ManagedTerminalProcess = ReturnType<
  ReturnType<typeof createCliContext>['processManager']['spawn']
>;

function parseProvider(raw: unknown): Provider {
  if (raw === 'claude' || raw === 'codex') return raw;
  console.error('Invalid provider. Use --provider claude or --provider codex.');
  process.exit(1);
}

async function ensureThreadAndWorktree(
  ctx: ReturnType<typeof createCliContext>,
  issueNumber: number,
): Promise<Thread> {
  const issue = ctx.githubIssues.getByNumber(ctx.project.id, issueNumber);
  if (!issue) {
    console.error(`Issue #${issueNumber} is not cached. Refresh issues in ShipCode first.`);
    process.exit(1);
  }

  let thread =
    ctx.threads.getByProjectAndGithubIssue(ctx.project.id, issueNumber) ??
    ctx.threads.create(
      ctx.project.id,
      issue.body ?? issue.title,
      issue.title,
      THREAD_KIND.pipeline,
    );
  ctx.threads.updateIssueContent(thread.id, issue.body ?? issue.title, issue.title);
  ctx.threads.setGithubIssue(thread.id, issueNumber, ctx.project.gitRemote);
  ctx.githubIssues.linkThread(issue.id, thread.id);
  thread = ctx.threads.getById(thread.id) ?? thread;

  if (thread.worktreePath) return thread;
  const settings = ctx.settings.get();
  const manager = new WorktreeManager(ctx.project.path, {
    worktreeRoot: settings.worktreeRoot,
    branchFormat: settings.worktreeBranchFormat,
  });
  const created = await manager.create(issueNumber, issue.title, ctx.project.defaultBranch);
  ctx.threads.setWorktree(thread.id, created.branch, created.worktreePath);
  return ctx.threads.getById(thread.id) ?? thread;
}

function buildArgs(provider: Provider, promptArtifactPath: string, modelId?: string): string[] {
  const instruction = `Read ${promptArtifactPath} and continue the GitHub issue workflow.`;
  if (provider === 'claude') {
    return [
      '--permission-mode',
      'acceptEdits',
      '--tools',
      'Edit,Write,Bash,Glob,Grep,Read',
      ...(modelId ? ['--model', modelId] : []),
      instruction,
    ];
  }
  const effort = resolveProviderReasoningEffort('codex', 'medium', modelId).effective;
  return [
    '-s',
    'workspace-write',
    '-a',
    'on-request',
    '--no-alt-screen',
    ...(modelId ? ['-m', modelId] : []),
    ...(effort !== 'none' && effort !== 'minimal'
      ? ['-c', `model_reasoning_effort=${effort}`]
      : []),
    instruction,
  ];
}

export async function terminalCommand(
  issueRaw: string,
  options: { provider?: string; model?: string },
): Promise<void> {
  const issueNumber = parseIssueNumber(issueRaw);
  const provider = parseProvider(options.provider ?? 'claude');
  const ctx = createCliContext(process.cwd());
  const thread = await ensureThreadAndWorktree(ctx, issueNumber);
  if (!thread.worktreePath) throw new Error(`Thread ${thread.id} has no worktree path`);
  const worktreePath = thread.worktreePath;

  const issue = ctx.githubIssues.getByNumber(ctx.project.id, issueNumber);
  if (!issue) throw new Error(`Issue #${issueNumber} is not cached`);
  const runDir = path.join(worktreePath, '.shipcode', 'runs', thread.id);
  const promptArtifactPath = path.join(runDir, 'terminal-prompt.md');
  const summaryPath = path.join(runDir, 'session-summary.md');
  await fs.mkdir(runDir, { recursive: true });
  const prompt = `# ShipCode Issue Terminal Session

${buildShipCodeRunContract({
  projectPath: ctx.project.path,
  worktreePath,
  baseBranch: ctx.project.defaultBranch,
  currentBranch: thread.worktreeBranch,
  githubIssueNumber: issue.issueNumber,
})}

Issue: #${issue.issueNumber} ${issue.title}
Summary artifact: ${summaryPath}

## Issue Body

${issue.body || '(empty issue body)'}

Before exiting, write files changed, commands run, blockers, and a suggested GitHub comment to the summary artifact.
`;
  await fs.writeFile(promptArtifactPath, prompt, 'utf8');
  ctx.agentConversations.insert({
    threadId: thread.id,
    phase: 'interactive_terminal',
    speaker: 'shipcode',
    role: 'prompt',
    provider: provider === 'claude' ? 'claude-cli' : 'codex-cli',
    model: options.model ?? null,
    content: prompt,
  });
  ctx.threads.updateStatus(thread.id, PIPELINE_PHASE.executing);

  const wasRaw = process.stdin.isTTY ? process.stdin.isRaw : false;
  let managed: ManagedTerminalProcess | null = null;
  let inputAttached = false;
  let rawModeSet = false;
  const pendingOutput: Array<{ processId: string; chunk: string }> = [];
  let pendingExit: { processId: string; exitCode: number } | null = null;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      ctx.processManager.off('output', onOutput);
      ctx.processManager.off('exit', onExit);
      if (inputAttached) {
        process.stdin.off('data', onInput);
        inputAttached = false;
      }
      if (rawModeSet && process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw);
        rawModeSet = false;
      }
    };

    const settle = (exitCode: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      const fallback = `Interactive ${provider} session exited with code ${exitCode}.
Prompt artifact: ${promptArtifactPath}
Worktree: ${worktreePath}
Terminal output is available in the session transcript.`;
      fs.readFile(summaryPath, 'utf8')
        .then((content) => content.trim() || fallback)
        .catch(() => fallback)
        .then((summary) => {
          ctx.agentConversations.insert({
            threadId: thread.id,
            phase: 'interactive_terminal',
            speaker: provider,
            role: 'response',
            provider: provider === 'claude' ? 'claude-cli' : 'codex-cli',
            model: options.model ?? null,
            content: summary,
          });
          ctx.threads.updateStatus(
            thread.id,
            exitCode === 0 ? PIPELINE_PHASE.completed : PIPELINE_PHASE.failed,
            exitCode === 0 ? undefined : `Interactive ${provider} exited with code ${exitCode}`,
          );
          resolve();
        });
    };

    const onOutput = (processId: string, chunk: string) => {
      if (!managed) {
        pendingOutput.push({ processId, chunk });
        return;
      }
      if (processId !== managed.id) return;
      process.stdout.write(sanitizeCliText(chunk));
      ctx.terminalEvents.create(thread.id, { kind: 'raw', content: chunk });
    };
    const onExit = (processId: string, exitCode: number) => {
      if (!managed) {
        pendingExit = { processId, exitCode };
        return;
      }
      if (processId !== managed.id) return;
      settle(exitCode);
    };
    const onInput = (chunk: Buffer) => {
      if (managed) ctx.processManager.write(managed.id, chunk.toString());
    };

    ctx.processManager.on('output', onOutput);
    ctx.processManager.on('exit', onExit);

    try {
      managed = ctx.processManager.spawn(
        provider,
        provider,
        buildArgs(provider, promptArtifactPath, options.model),
        worktreePath,
        thread.id,
        { outputMode: 'raw' },
      );
    } catch (error) {
      cleanup();
      reject(error);
      return;
    }

    for (const event of pendingOutput) onOutput(event.processId, event.chunk);
    if (pendingExit) {
      onExit(pendingExit.processId, pendingExit.exitCode);
      return;
    }

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      rawModeSet = true;
    }
    process.stdin.resume();
    process.stdin.on('data', onInput);
    inputAttached = true;
  });
}

export async function terminalSummaryCommand(issueRaw: string): Promise<void> {
  const issueNumber = parseIssueNumber(issueRaw);
  const ctx = createCliContext(process.cwd());
  const thread = ctx.threads.getByProjectAndGithubIssue(ctx.project.id, issueNumber);
  if (!thread) {
    console.error(`No thread found for issue #${issueNumber}.`);
    process.exit(1);
  }
  const rows = ctx.agentConversations.listByThread(thread.id, {
    phase: 'interactive_terminal',
    role: 'response',
  });
  console.log(
    sanitizeCliText(rows.at(-1)?.content ?? 'No interactive terminal summary saved yet.'),
  );
}

export async function terminalCommentCommand(
  issueRaw: string,
  options: { post?: boolean },
): Promise<void> {
  const issueNumber = parseIssueNumber(issueRaw);
  const ctx = createCliContext(process.cwd());
  const thread = ctx.threads.getByProjectAndGithubIssue(ctx.project.id, issueNumber);
  if (!thread) {
    console.error(`No thread found for issue #${issueNumber}.`);
    process.exit(1);
  }
  const rows = ctx.agentConversations.listByThread(thread.id, {
    phase: 'interactive_terminal',
    role: 'response',
  });
  const body = `ShipCode interactive terminal update for #${issueNumber}:

${rows.at(-1)?.content ?? 'Interactive terminal session completed.'}`;
  if (!options.post) {
    console.log(sanitizeCliText(body));
    return;
  }
  await ctx.ghCli.addIssueComment(issueNumber, body);
  console.log(`Posted comment to issue #${issueNumber}.`);
}
