import type { Thread } from '@shipcode/shared';
import type { CliContext } from '../context';
import { parseIssueNumberOrExit } from './issue-number';

export function parseIssueNumber(issueNumber: string): number {
  return parseIssueNumberOrExit(issueNumber);
}

export function getThreadForIssueOrExit(ctx: CliContext, issueNumber: number): Thread {
  const thread = ctx.threads.getByProjectAndGithubIssue(ctx.project.id, issueNumber);
  if (!thread) {
    console.error(`No thread found for issue #${issueNumber} in this project.`);
    process.exit(1);
  }
  return thread;
}
