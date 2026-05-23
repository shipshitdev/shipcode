import { routeFromLabels } from '@shipcode/agents';
import { createPipeline } from '@shipcode/pipeline';
import type { CliContext } from '../context';
import { createCliContext } from '../context';
import { parseIssueNumber } from './issue-helpers';

type PipelineIssue = Awaited<ReturnType<CliContext['ghCli']['getIssue']>>;

export async function loadIssuePipelineInput(issueNumber: string) {
  const num = parseIssueNumber(issueNumber);
  const ctx = createCliContext(process.cwd());

  console.log(`Fetching issue #${num}...`);
  const issue = await ctx.ghCli.getIssue(num);

  return { ctx, issue, num };
}

export function resolveIssuePipelineRoute(labels: string[]) {
  const route = routeFromLabels(labels);

  return {
    executorModel: 'error' in route ? 'codex' : route.executorModel,
    executorModelOverride: 'error' in route ? null : (route.modelOverride ?? null),
  };
}

export async function startIssuePipeline(
  ctx: CliContext,
  issue: PipelineIssue,
  route = resolveIssuePipelineRoute(issue.labels),
) {
  return createPipeline(ctx.pipelineDeps).startFromGitHubIssue(
    ctx.project.id,
    ctx.project.path,
    issue,
    route.executorModel,
    { baseBranch: ctx.project.defaultBranch, executorModelOverride: route.executorModelOverride },
  );
}
