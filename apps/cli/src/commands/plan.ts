import { sanitizeCliText } from '../adapters/cli-emitter';
import { requireOnboarding } from './guard';
import { loadIssuePipelineInput, startIssuePipeline } from './issue-pipeline';
import { waitForThreadTerminal } from './pipeline-wait';

/**
 * `shipcode plan <issue-number>`
 *
 * Run plan generation + review + revision only. Stops at approval.
 * Outputs final plan JSON to stdout. Pipeline writes to DB normally.
 */
export async function planCommand(issueNumber: string) {
  if (!requireOnboarding()) return;

  const { ctx, issue, num } = await loadIssuePipelineInput(issueNumber);

  console.log(`Issue: ${sanitizeCliText(issue.title)}`);
  console.log('Running plan generation...\n');

  // Force the approval gate so this command cannot auto-execute, and wait for
  // the background dispatch loop to reach a terminal status before reading DB.
  const { thread: started, restoreRequireApproval } = await startIssuePipeline(
    ctx,
    issue,
    undefined,
    { requireApproval: true },
  );
  try {
    await waitForThreadTerminal(ctx.threads, started.id);
  } finally {
    restoreRequireApproval();
  }

  const thread =
    ctx.threads.getById(started.id) ?? ctx.threads.getByProjectAndGithubIssue(ctx.project.id, num);
  if (!thread) {
    console.error('Thread not found after pipeline run.');
    process.exit(1);
  }

  const latestPlan = ctx.plans.getLatest(thread.id);
  if (latestPlan?.structured) {
    console.log('\n--- Plan Output ---');
    console.log(sanitizeCliText(JSON.stringify(latestPlan.structured, null, 2)));
  } else {
    console.log('\nNo plan generated (pipeline may have failed or entered clarification).');
  }

  console.log(`\nThread status: ${sanitizeCliText(thread.status)}`);
}
