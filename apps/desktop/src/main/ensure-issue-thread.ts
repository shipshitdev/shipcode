import { GhCli } from '@shipcode/agents';
import { WorktreeManager } from '@shipcode/git';
import {
  type GitHubIssueCacheRecord,
  type Project,
  THREAD_KIND,
  type Thread,
} from '@shipcode/shared';
import type { Queries } from './ipc/types';

export async function ensureIssueThread(input: {
  queries: Queries;
  project: Project;
  issue: GitHubIssueCacheRecord;
}): Promise<Thread> {
  await assertIssueIsOpenForWorktree(input);

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
  persistResolvedDefaultBranch(input, created.baseRef);
  return input.queries.threads.getById(thread.id) ?? thread;
}

function persistResolvedDefaultBranch(
  input: { queries: Queries; project: Project },
  baseRef: string | undefined,
): void {
  const resolved = baseRef?.replace(/^origin\//, '').trim();
  if (!resolved || resolved === input.project.defaultBranch) return;
  input.queries.projects.updateGitInfo(input.project.id, input.project.gitRemote, resolved);
}

async function assertIssueIsOpenForWorktree(input: {
  queries: Queries;
  project: Project;
  issue: GitHubIssueCacheRecord;
}): Promise<void> {
  if (input.issue.state === 'closed') {
    throw closedIssueWorktreeError(input.issue.issueNumber);
  }

  const live = await new GhCli(input.project.path).getIssue(input.issue.issueNumber);
  if (live.state !== 'closed') return;

  input.queries.githubIssues.updateState(input.issue.id, 'closed');
  input.queries.githubIssues.markClosedOnClose(input.issue.id);
  throw closedIssueWorktreeError(input.issue.issueNumber);
}

function closedIssueWorktreeError(issueNumber: number): Error {
  return new Error(
    `Issue #${issueNumber} is closed on GitHub. Reopen it before starting a conversation.`,
  );
}
