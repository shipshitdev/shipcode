import { describe, expect, it } from 'vitest';
import {
  buildCheckSummaries,
  buildUnresolvedReviewComments,
  type PullRequestReviewData,
} from './pr-parsers';

describe('buildCheckSummaries', () => {
  it('returns only failed check runs and status contexts', () => {
    const commits: PullRequestReviewData['commits'] = {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  null,
                  {
                    __typename: 'CheckRun',
                    name: 'queued',
                    status: 'QUEUED',
                  },
                  {
                    __typename: 'CheckRun',
                    name: 'lint',
                    status: 'COMPLETED',
                    conclusion: 'SUCCESS',
                  },
                  {
                    __typename: 'CheckRun',
                    name: 'unit',
                    status: 'COMPLETED',
                    conclusion: 'FAILURE',
                    detailsUrl: 'https://github.com/checks/unit',
                    checkSuite: { workflowRun: { workflow: { name: 'CI' } } },
                  },
                  {
                    __typename: 'StatusContext',
                    context: 'deploy',
                    state: 'PENDING',
                  },
                  {
                    __typename: 'StatusContext',
                    context: 'CodeRabbit',
                    state: 'ERROR',
                    targetUrl: 'https://github.com/status/coderabbit',
                  },
                ],
              },
            },
          },
        },
      ],
    };

    expect(buildCheckSummaries(commits)).toEqual([
      {
        name: 'unit',
        status: 'failed',
        conclusion: 'failure',
        detailsUrl: 'https://github.com/checks/unit',
        workflowName: 'CI',
      },
      {
        name: 'CodeRabbit',
        status: 'failed',
        conclusion: 'error',
        detailsUrl: 'https://github.com/status/coderabbit',
        workflowName: null,
      },
    ]);
  });

  it('preserves fallback values for sparse failed contexts', () => {
    const commits: PullRequestReviewData['commits'] = {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  { __typename: 'CheckRun', status: 'COMPLETED' },
                  { __typename: 'StatusContext' },
                ],
              },
            },
          },
        },
      ],
    };

    expect(buildCheckSummaries(commits)).toEqual([
      {
        name: 'check',
        status: 'failed',
        conclusion: null,
        detailsUrl: null,
        workflowName: null,
      },
      {
        name: 'status',
        status: 'failed',
        conclusion: null,
        detailsUrl: null,
        workflowName: null,
      },
    ]);
    expect(buildCheckSummaries(null)).toEqual([]);
  });
});

describe('buildUnresolvedReviewComments', () => {
  it('maps the latest comment from current unresolved threads', () => {
    const reviewThreads: PullRequestReviewData['reviewThreads'] = {
      nodes: [
        null,
        {
          isResolved: false,
          isOutdated: false,
          comments: {
            nodes: [
              {
                body: 'first',
                url: 'https://github.com/comment/1',
                createdAt: '2026-07-18T00:00:00Z',
              },
              {
                body: 'latest',
                url: 'https://github.com/comment/2',
                createdAt: '2026-07-19T00:00:00Z',
                path: 'packages/agents/src/github/gh-cli.ts',
                line: 123,
                author: { login: 'reviewer' },
              },
            ],
          },
        },
        {
          isResolved: true,
          comments: { nodes: [] },
        },
        {
          isOutdated: true,
          comments: { nodes: [] },
        },
      ],
    };

    expect(buildUnresolvedReviewComments(reviewThreads)).toEqual({
      comments: [
        {
          author: 'reviewer',
          body: 'latest',
          url: 'https://github.com/comment/2',
          createdAt: '2026-07-19T00:00:00Z',
          path: 'packages/agents/src/github/gh-cli.ts',
          line: 123,
        },
      ],
      count: 1,
    });
  });

  it('counts unresolved threads even when their latest comment is incomplete', () => {
    const reviewThreads: PullRequestReviewData['reviewThreads'] = {
      nodes: [
        {
          comments: {
            nodes: [
              {
                body: 'missing URL',
                createdAt: '2026-07-19T00:00:00Z',
              },
            ],
          },
        },
        {
          comments: {
            nodes: [
              {
                body: 'actionable',
                url: 'https://github.com/comment/3',
                createdAt: '2026-07-19T00:00:00Z',
              },
            ],
          },
        },
      ],
    };

    expect(buildUnresolvedReviewComments(reviewThreads)).toEqual({
      comments: [
        {
          author: null,
          body: 'actionable',
          url: 'https://github.com/comment/3',
          createdAt: '2026-07-19T00:00:00Z',
          path: null,
          line: null,
        },
      ],
      count: 2,
    });
    expect(buildUnresolvedReviewComments(undefined)).toEqual({ comments: [], count: 0 });
  });
});
