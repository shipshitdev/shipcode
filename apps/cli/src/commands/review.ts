import { sanitizeCliText } from '../adapters/cli-emitter';
import { requireOnboarding } from './guard';
import { loadIssuePipelineInput, startIssuePipeline } from './issue-pipeline';

/**
 * `shipcode review <issue-number>`
 *
 * Run plan + adversarial review only. Output review findings as JSON.
 */
export async function reviewCommand(issueNumber: string) {
  if (!requireOnboarding()) return;

  const { ctx, issue, num } = await loadIssuePipelineInput(issueNumber);

  console.log(`Issue: ${sanitizeCliText(issue.title)}`);
  console.log('Running plan + review...\n');

  await startIssuePipeline(ctx, issue);

  // Retrieve review from DB — reviews are keyed by planId
  const thread = ctx.threads.getByProjectAndGithubIssue(ctx.project.id, num);
  if (!thread) {
    console.error('Thread not found after pipeline run.');
    process.exit(1);
  }

  const latestPlan = ctx.plans.getLatest(thread.id);
  if (latestPlan) {
    const review = ctx.reviews.getByPlanId(latestPlan.id);
    if (review) {
      console.log('\n--- Review Output ---');
      console.log(sanitizeCliText(JSON.stringify(review, null, 2)));
    } else {
      console.log('\nNo review generated (pipeline may have stopped before review phase).');
    }
  } else {
    console.log('\nNo plan generated (pipeline may have failed before plan phase).');
  }

  console.log(`\nThread status: ${sanitizeCliText(thread.status)}`);
}
