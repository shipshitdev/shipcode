import type { Thread } from '@shipcode/shared';
import type { CliContext } from '../context';

export { parseIssueNumberOrExit as parseIssueNumber } from './issue-number';

export function getThreadForIssueOrExit(ctx: CliContext, issueNumber: number): Thread {
  const thread = ctx.threads.getByProjectAndGithubIssue(ctx.project.id, issueNumber);
  if (!thread) {
    console.error(`No thread found for issue #${issueNumber} in this project.`);
    process.exit(1);
  }
  return thread;
}
