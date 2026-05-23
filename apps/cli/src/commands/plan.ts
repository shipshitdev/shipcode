import { sanitizeCliText } from '../adapters/cli-emitter';
import { requireOnboarding } from './guard';
import { loadIssuePipelineInput, startIssuePipeline } from './issue-pipeline';

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

  await startIssuePipeline(ctx, issue);

  // Retrieve the generated plan from DB
  const thread = ctx.threads.getByProjectAndGithubIssue(ctx.project.id, num);
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
