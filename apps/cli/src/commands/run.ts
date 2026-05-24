import { sanitizeCliText } from '../adapters/cli-emitter';
import { requireOnboarding } from './guard';
import {
  loadIssuePipelineInput,
  resolveIssuePipelineRoute,
  startIssuePipeline,
} from './issue-pipeline';

export async function runCommand(issueNumber: string) {
  if (!requireOnboarding()) return;

  const { ctx, issue } = await loadIssuePipelineInput(issueNumber);
  const route = resolveIssuePipelineRoute(issue.labels);

  console.log(`Issue: ${sanitizeCliText(issue.title)}`);
  console.log(
    `Model: ${route.executorModel}${route.executorModelOverride ? ` (${route.executorModelOverride})` : ''}`,
  );
  console.log(`Starting pipeline...\n`);

  await startIssuePipeline(ctx, issue, route);

  console.log('\nPipeline started. Watching for completion...');
}
