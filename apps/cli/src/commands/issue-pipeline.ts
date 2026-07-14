import { routeFromLabels } from '@shipcode/agents';
import { createPipeline, launchIssuePipeline } from '@shipcode/pipeline';
import { resolveIssuePhaseModels, resolveProviderReasoningEffort } from '@shipcode/shared';
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
  const cachedIssue = ctx.githubIssues.upsert({
    projectId: ctx.project.id,
    issueNumber: issue.number,
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
    assignee: issue.assignee,
    author: issue.author?.login ?? null,
    state: issue.state,
    updatedAt: issue.updatedAt ?? null,
  });

  const settings = ctx.settings.get();
  // Resolve the base phase models first so the executor effort override honors any
  // project-/issue-level executorReasoningEffort normalization, matching the other
  // phases. Feeding raw settings.executorReasoningEffort here would silently drop
  // those overrides for CLI-launched issues.
  const basePhaseModels = resolveIssuePhaseModels(settings, ctx.project, cachedIssue);
  const phaseModels = {
    ...basePhaseModels,
    executorModel: route.executorModel,
    executorModelId: route.executorModelOverride,
    executorReasoningEffort: resolveProviderReasoningEffort(
      route.executorModel,
      basePhaseModels.executorReasoningEffort,
      route.executorModelOverride,
    ).effective,
  };

  return launchIssuePipeline(
    {
      threads: ctx.threads,
      githubIssues: ctx.githubIssues,
      plans: ctx.plans,
      pipeline: createPipeline(ctx.pipelineDeps),
    },
    {
      project: ctx.project,
      issue: cachedIssue,
      phaseModels,
      executorModelOverride: route.executorModelOverride,
    },
  );
}
