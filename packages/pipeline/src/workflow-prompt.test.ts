import { describe, expect, it, vi } from 'vitest';
import { renderWorkflowPromptTemplate } from './workflow-prompt';

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    threads: {
      getById: vi.fn(() => ({
        title: 'Thread title',
        prompt: 'Thread prompt',
        lastError: 'Tests failed',
      })),
    },
    githubIssues: {
      getByNumber: vi.fn(() => ({
        issueNumber: 42,
        title: 'Issue title',
        body: 'Issue body',
        labels: ['bug'],
        state: 'closed',
      })),
    },
    ...overrides,
  };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    threadId: 'thread-1',
    projectId: 'project-1',
    githubIssueNumber: 42,
    githubIssueTitle: null,
    retryCount: 1,
    testRetries: 2,
    verificationRetries: 3,
    workflowPolicy: {
      promptTemplate:
        'Issue #{{ issue.number }} {{ issue.title }} {{ issue.state }} {{ attempt.number }} {{ attempt.prior_failure_reason }} {{ phase }}',
    },
    ...overrides,
  };
}

describe('renderWorkflowPromptTemplate', () => {
  it('renders workflow prompt context from GitHub issue and thread state', () => {
    const out = renderWorkflowPromptTemplate(makeContext() as never, makeDeps() as never, 'verify');

    expect(out).toBe('Issue #42 Issue title closed 7 Tests failed verify');
  });

  it('returns null when no trimmed workflow prompt template exists', () => {
    expect(
      renderWorkflowPromptTemplate(
        makeContext({ workflowPolicy: { promptTemplate: '   ' } }) as never,
        makeDeps() as never,
        'plan',
      ),
    ).toBeNull();
  });

  it('falls back to thread fields and open issue defaults when no issue row exists', () => {
    const deps = makeDeps({
      githubIssues: { getByNumber: vi.fn(() => null) },
      threads: {
        getById: vi.fn(() => ({
          title: 'Thread title',
          prompt: 'Thread prompt',
        })),
      },
    });
    const out = renderWorkflowPromptTemplate(
      makeContext({
        projectId: null,
        githubIssueNumber: null,
        workflowPolicy: {
          promptTemplate: '{{ issue.number }}|{{ issue.title }}|{{ issue.body }}|{{ issue.state }}',
        },
      }) as never,
      deps as never,
      'plan',
    );

    expect(out).toBe('0|Thread title|Thread prompt|open');
  });
});
