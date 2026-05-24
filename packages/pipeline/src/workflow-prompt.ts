import { renderTemplate, type TemplateContext } from './template-renderer';
import type { PipelineContext, PipelineDeps } from './types';

function buildWorkflowTemplateContext(
  context: PipelineContext,
  deps: PipelineDeps,
  phase: TemplateContext['phase'],
  extras: Partial<
    Pick<TemplateContext, 'plan' | 'review' | 'diff' | 'acceptanceCriteria' | 'testOutput'>
  > = {},
): TemplateContext {
  const thread = deps.threads.getById(context.threadId);
  const issue =
    context.projectId && context.githubIssueNumber != null
      ? deps.githubIssues.getByNumber(context.projectId, context.githubIssueNumber)
      : null;

  return {
    issue: {
      number: context.githubIssueNumber ?? issue?.issueNumber ?? 0,
      title: context.githubIssueTitle ?? issue?.title ?? thread?.title ?? '',
      body: issue?.body ?? thread?.prompt ?? '',
      labels: issue?.labels ?? [],
      state: issue?.state === 'closed' ? 'closed' : 'open',
    },
    attempt: {
      number: context.retryCount + context.testRetries + context.verificationRetries + 1,
      ...(thread?.lastError ? { prior_failure_reason: thread.lastError } : {}),
    },
    phase,
    ...extras,
  };
}

export function renderWorkflowPromptTemplate(
  context: PipelineContext,
  deps: PipelineDeps,
  phase: TemplateContext['phase'],
  extras: Partial<
    Pick<TemplateContext, 'plan' | 'review' | 'diff' | 'acceptanceCriteria' | 'testOutput'>
  > = {},
): string | null {
  const template = context.workflowPolicy.promptTemplate?.trim();
  if (!template) return null;
  return renderTemplate(template, buildWorkflowTemplateContext(context, deps, phase, extras));
}
