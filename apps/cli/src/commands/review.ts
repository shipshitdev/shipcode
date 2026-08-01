import { PIPELINE_PHASE } from '@shipcode/shared';
import { sanitizeCliText } from '../adapters/cli-emitter';
import { markCliFailure } from '../exit-code';
import { requireOnboarding } from './guard';
import { loadIssuePipelineInput, startIssuePipeline } from './issue-pipeline';
import { waitForThreadTerminal } from './pipeline-wait';

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
  if (latestPlan) {
    const review = ctx.reviews.getByPlanId(latestPlan.id);
    if (review) {
      console.log('\n--- Review Output ---');
      console.log(sanitizeCliText(JSON.stringify(review, null, 2)));
    } else {
      console.log('\nNo review generated (pipeline may have stopped before review phase).');
      markCliFailure();
    }
  } else {
    console.log('\nNo plan generated (pipeline may have failed before plan phase).');
    markCliFailure();
  }

  console.log(`\nThread status: ${sanitizeCliText(thread.status)}`);
  if (thread.status === PIPELINE_PHASE.failed) markCliFailure();
}
