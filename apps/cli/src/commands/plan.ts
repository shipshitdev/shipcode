import { routeFromLabels } from '@shipcode/agents';
import { createPipeline } from '@shipcode/pipeline';
import { createCliContext } from '../context';
import { requireOnboarding } from './guard';

/**
 * `shipcode plan <issue-number>`
 *
 * Run plan generation + review + revision only. Stops at awaiting_approval.
 * Outputs final plan JSON to stdout. Pipeline writes to DB normally.
 */
export async function planCommand(issueNumber: string) {
  if (!requireOnboarding()) return;

  const num = parseInt(issueNumber, 10);
  if (Number.isNaN(num)) {
    console.error('Invalid issue number:', issueNumber);
    process.exit(1);
  }

  const ctx = createCliContext(process.cwd());

  console.log(`Fetching issue #${num}...`);
  const issue = await ctx.ghCli.getIssue(num);

  const route = routeFromLabels(issue.labels);
  const executorModel = 'error' in route ? 'claude' : route.executorModel;
  const executorModelOverride = 'error' in route ? null : (route.modelOverride ?? null);

  console.log(`Issue: ${issue.title}`);
  console.log('Running plan generation...\n');

  const pipeline = createPipeline(ctx.pipelineDeps);

  await pipeline.startFromGitHubIssue(
    ctx.project.id,
    ctx.project.path,
    { number: issue.number, title: issue.title, body: issue.body, labels: issue.labels },
    executorModel,
    { baseBranch: ctx.project.defaultBranch, executorModelOverride },
  );

  // Retrieve the generated plan from DB
  const thread = ctx.threads.getByProjectAndGithubIssue(ctx.project.id, num);
  if (!thread) {
    console.error('Thread not found after pipeline run.');
    process.exit(1);
  }

  const latestPlan = ctx.plans.getLatest(thread.id);
  if (latestPlan?.structured) {
    console.log('\n--- Plan Output ---');
    console.log(JSON.stringify(latestPlan.structured, null, 2));
  } else {
    console.log('\nNo plan generated (pipeline may have failed or entered clarification).');
  }

  console.log(`\nThread status: ${thread.status}`);
}
