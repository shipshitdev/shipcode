import type { GitHubPrCheckSummary, GitHubPrReviewCommentSummary } from '@shipcode/shared';

type CheckRunContext = {
  __typename: 'CheckRun';
  name?: string;
  conclusion?: string | null;
  status?: string | null;
  detailsUrl?: string | null;
  checkSuite?: {
    workflowRun?: { workflow?: { name?: string | null } | null } | null;
  } | null;
};

type StatusContext = {
  __typename: 'StatusContext';
  context?: string;
  state?: string | null;
  targetUrl?: string | null;
};

export interface PullRequestReviewData {
  commits?: {
    nodes?: ReadonlyArray<{
      commit?: {
        statusCheckRollup?: {
          contexts?: {
            nodes?: ReadonlyArray<CheckRunContext | StatusContext | null>;
          } | null;
        } | null;
      } | null;
    }>;
  } | null;
  reviewThreads?: {
    nodes?: ReadonlyArray<{
      isResolved?: boolean;
      isOutdated?: boolean;
      comments?: {
        nodes?: ReadonlyArray<{
          body?: string;
          url?: string;
          createdAt?: string;
          path?: string | null;
          line?: number | null;
          author?: { login?: string | null } | null;
        }>;
      } | null;
    } | null>;
  } | null;
}

export function buildCheckSummaries(
  commits: PullRequestReviewData['commits'],
): GitHubPrCheckSummary[] {
  const failingChecks: GitHubPrCheckSummary[] = [];
  const contexts = commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];

  for (const node of contexts) {
    if (!node) continue;
    if (node.__typename === 'CheckRun') {
      const status = (node.status ?? '').toUpperCase();
      const conclusion = (node.conclusion ?? '').toUpperCase();
      const summary: GitHubPrCheckSummary = {
        name: node.name ?? 'check',
        status:
          status !== 'COMPLETED'
            ? 'pending'
            : conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' || conclusion === 'SKIPPED'
              ? 'success'
              : 'failed',
        conclusion: node.conclusion?.toLowerCase() ?? null,
        detailsUrl: node.detailsUrl ?? null,
        workflowName: node.checkSuite?.workflowRun?.workflow?.name ?? null,
      };
      if (summary.status === 'failed') failingChecks.push(summary);
      continue;
    }

    const state = (node.state ?? '').toUpperCase();
    const summary: GitHubPrCheckSummary = {
      name: node.context ?? 'status',
      status: state === 'SUCCESS' ? 'success' : state === 'PENDING' ? 'pending' : 'failed',
      conclusion: node.state?.toLowerCase() ?? null,
      detailsUrl: node.targetUrl ?? null,
      workflowName: null,
    };
    if (summary.status === 'failed') failingChecks.push(summary);
  }

  return failingChecks;
}

export interface UnresolvedReviewComments {
  comments: GitHubPrReviewCommentSummary[];
  count: number;
}

export function buildUnresolvedReviewComments(
  reviewThreads: PullRequestReviewData['reviewThreads'],
): UnresolvedReviewComments {
  const unresolvedThreads = (reviewThreads?.nodes ?? []).filter(
    (thread) => !!thread && !thread.isResolved && !thread.isOutdated,
  );
  const comments = unresolvedThreads
    .map((thread) => {
      const threadComments = thread.comments?.nodes ?? [];
      const comment = threadComments[threadComments.length - 1];
      if (!comment?.url || !comment.body || !comment.createdAt) return null;
      return {
        author: comment.author?.login ?? null,
        body: comment.body,
        url: comment.url,
        createdAt: comment.createdAt,
        path: comment.path ?? null,
        line: comment.line ?? null,
      } satisfies GitHubPrReviewCommentSummary;
    })
    .filter((comment): comment is GitHubPrReviewCommentSummary => !!comment);

  return {
    comments,
    count: unresolvedThreads.length,
  };
}
