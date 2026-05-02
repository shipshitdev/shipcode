import { routeFromLabels } from '@shipcode/agents';
import { createPipeline } from '@shipcode/pipeline';
import { createCliContext } from '../context';
import { requireOnboarding } from './guard';
import { parseIssueNumberOrExit } from './issue-number';

export async function runCommand(issueNumber: string) {
  if (!requireOnboarding()) return;

  const num = parseIssueNumberOrExit(issueNumber);
  const ctx = createCliContext(process.cwd());

  console.log(`Fetching issue #${num}...`);
  const issue = await ctx.ghCli.getIssue(num);

  const route = routeFromLabels(issue.labels);
  const executorModel = 'error' in route ? 'claude' : route.executorModel;
  const executorModelOverride = 'error' in route ? null : (route.modelOverride ?? null);

  console.log(`Issue: ${issue.title}`);
  console.log(
    `Model: ${executorModel}${executorModelOverride ? ` (${executorModelOverride})` : ''}`,
  );
  console.log(`Starting pipeline...\n`);

  const pipeline = createPipeline(ctx.pipelineDeps);

  await pipeline.startFromGitHubIssue(
    ctx.project.id,
    ctx.project.path,
    { number: issue.number, title: issue.title, body: issue.body, labels: issue.labels },
    executorModel,
    { baseBranch: ctx.project.defaultBranch, executorModelOverride },
  );

  console.log('\nPipeline started. Watching for completion...');
}
