import { routeFromLabels } from '@shipcode/agents';
import { createPipeline } from '@shipcode/pipeline';
import { sanitizeCliText } from '../adapters/cli-emitter';
import { createCliContext } from '../context';
import { requireOnboarding } from './guard';
import { parseIssueNumber } from './issue-helpers';

/**
 * `shipcode review <issue-number>`
 *
 * Run plan + adversarial review only. Output review findings as JSON.
 */
export async function reviewCommand(issueNumber: string) {
  if (!requireOnboarding()) return;

  const num = parseIssueNumber(issueNumber);
  const ctx = createCliContext(process.cwd());

  console.log(`Fetching issue #${num}...`);
  const issue = await ctx.ghCli.getIssue(num);

  const route = routeFromLabels(issue.labels);
  const executorModel = 'error' in route ? 'codex' : route.executorModel;
  const executorModelOverride = 'error' in route ? null : (route.modelOverride ?? null);

  console.log(`Issue: ${sanitizeCliText(issue.title)}`);
  console.log('Running plan + review...\n');

  const pipeline = createPipeline(ctx.pipelineDeps);

  await pipeline.startFromGitHubIssue(
    ctx.project.id,
    ctx.project.path,
    { number: issue.number, title: issue.title, body: issue.body, labels: issue.labels },
    executorModel,
    { baseBranch: ctx.project.defaultBranch, executorModelOverride },
  );

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
