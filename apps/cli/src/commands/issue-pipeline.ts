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

export interface StartIssuePipelineResult {
  thread: Awaited<ReturnType<typeof launchIssuePipeline>>;
  /** Call after the pipeline has finished so temporary approval forcing is undone. */
  restoreRequireApproval: () => void;
}

export async function startIssuePipeline(
  ctx: CliContext,
  issue: PipelineIssue,
  route = resolveIssuePipelineRoute(issue.labels),
  options: { requireApproval?: boolean } = {},
): Promise<StartIssuePipelineResult> {
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

  const previousApproval = cachedIssue.requireApprovalOverride ?? null;
  let approvalForced = false;
  if (options.requireApproval === true) {
    // Force the approval gate so CLI plan/review cannot auto-execute. Leave the
    // override in place until the caller finishes waiting for terminal status.
    ctx.githubIssues.updateRequireApprovalOverride(cachedIssue.id, true);
    approvalForced = true;
  }

  const settings = ctx.settings.get();
  // Resolve the base phase models first so the executor effort override honors any
  // project-/issue-level executorReasoningEffort normalization, matching the other
  // phases. Feeding raw settings.executorReasoningEffort here would silently drop
  // those overrides for CLI-launched issues.
  const basePhaseModels = resolveIssuePhaseModels(
    settings,
    ctx.project,
    approvalForced ? { ...cachedIssue, requireApprovalOverride: true } : cachedIssue,
  );
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

  try {
    const thread = await launchIssuePipeline(
      {
        threads: ctx.threads,
        githubIssues: ctx.githubIssues,
        plans: ctx.plans,
        pipeline: createPipeline(ctx.pipelineDeps),
      },
      {
        project: ctx.project,
        issue: approvalForced ? { ...cachedIssue, requireApprovalOverride: true } : cachedIssue,
        phaseModels,
        executorModelOverride: route.executorModelOverride,
      },
    );

    return {
      thread,
      restoreRequireApproval: () => {
        if (!approvalForced) return;
        ctx.githubIssues.updateRequireApprovalOverride(cachedIssue.id, previousApproval);
        approvalForced = false;
      },
    };
  } catch (error) {
    if (approvalForced) {
      ctx.githubIssues.updateRequireApprovalOverride(cachedIssue.id, previousApproval);
      approvalForced = false;
    }
    throw error;
  }
}
