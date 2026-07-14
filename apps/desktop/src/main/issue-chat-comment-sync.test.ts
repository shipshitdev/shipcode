import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listIssueComments: vi.fn(),
  sendIssueChatTurn: vi.fn(),
  isIssueChatSessionLive: vi.fn(() => true),
  logError: vi.fn(),
}));

vi.mock('@shipcode/agents', () => ({
  GhCli: vi.fn(function GhCli() {
    return {
      listIssueComments: mocks.listIssueComments,
    };
  }),
}));

vi.mock('./issue-chat-session', () => ({
  isIssueChatSessionLive: mocks.isIssueChatSessionLive,
  sendIssueChatTurn: mocks.sendIssueChatTurn,
}));

vi.mock('./logger.service', () => ({
  default: {
    error: mocks.logError,
  },
}));

import { startIssueChatCommentSync, stopIssueChatCommentSync } from './issue-chat-comment-sync';

function makeComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    author: 'octocat',
    authorAssociation: 'OWNER',
    body: '/ask explain this issue',
    createdAt: '2026-06-01T00:00:00.000Z',
    url: 'https://github.test/comment/1',
    ...overrides,
  };
}

function makeHarness() {
  return {
    threadId: 'thread-1',
    queries: {
      threads: {
        getById: vi.fn(() => ({
          id: 'thread-1',
          projectId: 'project-1',
          githubIssueNumber: 42,
        })),
      },
      projects: {
        getById: vi.fn(() => ({
          id: 'project-1',
          path: '/tmp/shipcode',
        })),
      },
      settings: {
        get: vi.fn(() => ({ githubPollingIntervalMs: 5_000 })),
      },
    },
    processManager: {},
    mainWindow: {},
  };
}

describe('issue chat comment sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.listIssueComments.mockReset();
    mocks.sendIssueChatTurn.mockReset();
    mocks.isIssueChatSessionLive.mockReturnValue(true);
    mocks.sendIssueChatTurn.mockResolvedValue({
      threadId: 'thread-1',
      promptId: 'prompt-1',
      responseId: 'response-1',
      round: 1,
      exitCode: 0,
      content: 'ok',
    });
    stopIssueChatCommentSync('thread-1');
  });

  afterEach(() => {
    stopIssueChatCommentSync('thread-1');
    vi.useRealTimers();
  });

  it('baselines existing comments and dispatches only new trusted marker comments once', async () => {
    const h = makeHarness();
    mocks.listIssueComments
      .mockResolvedValueOnce([
        makeComment({ id: 1, body: '/ask old prompt', createdAt: '2026-06-01T00:00:00.000Z' }),
        makeComment({ id: 2, body: 'plain old', createdAt: '2026-06-01T00:01:00.000Z' }),
      ])
      .mockResolvedValueOnce([
        makeComment({ id: 1, body: '/ask old prompt', createdAt: '2026-06-01T00:00:00.000Z' }),
        makeComment({ id: 2, body: 'plain old', createdAt: '2026-06-01T00:01:00.000Z' }),
        makeComment({ id: 3, body: 'plain new', createdAt: '2026-06-01T00:02:00.000Z' }),
        makeComment({
          id: 4,
          body: '/ask untrusted prompt',
          authorAssociation: 'CONTRIBUTOR',
          createdAt: '2026-06-01T00:03:00.000Z',
        }),
        makeComment({ id: 5, body: '/ask', createdAt: '2026-06-01T00:04:00.000Z' }),
        makeComment({
          id: 6,
          body: '@shipcode new prompt',
          createdAt: '2026-06-01T00:05:00.000Z',
        }),
      ]);

    startIssueChatCommentSync(h as never);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.sendIssueChatTurn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(mocks.listIssueComments).toHaveBeenCalledTimes(2);
    expect(mocks.sendIssueChatTurn).toHaveBeenCalledWith({
      args: {
        threadId: 'thread-1',
        speaker: 'github:octocat',
        text: 'GitHub issue comment from @octocat (untrusted user input):\n\nnew prompt',
      },
      queries: h.queries,
      processManager: h.processManager,
      mainWindow: h.mainWindow,
    });
  });

  it('retries a marker comment when dispatch fails without advancing the cursor', async () => {
    const h = makeHarness();
    mocks.sendIssueChatTurn.mockRejectedValueOnce(new Error('turn already running'));
    mocks.listIssueComments
      .mockResolvedValueOnce([
        makeComment({ id: 1, body: 'old', createdAt: '2026-06-01T00:00:00.000Z' }),
      ])
      .mockResolvedValueOnce([
        makeComment({ id: 1, body: 'old', createdAt: '2026-06-01T00:00:00.000Z' }),
        makeComment({ id: 2, body: '/ask retry me', createdAt: '2026-06-01T00:01:00.000Z' }),
      ])
      .mockResolvedValue([
        makeComment({ id: 1, body: 'old', createdAt: '2026-06-01T00:00:00.000Z' }),
        makeComment({ id: 2, body: '/ask retry me', createdAt: '2026-06-01T00:01:00.000Z' }),
      ]);

    startIssueChatCommentSync(h as never);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.logError).toHaveBeenCalledWith(
      expect.stringContaining('failed to dispatch comment 2'),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.sendIssueChatTurn).toHaveBeenCalledTimes(2);
  });

  it('stops the polling timer', async () => {
    const h = makeHarness();
    mocks.listIssueComments.mockResolvedValue([
      makeComment({ id: 1, body: 'old', createdAt: '2026-06-01T00:00:00.000Z' }),
    ]);

    startIssueChatCommentSync(h as never);
    await Promise.resolve();
    await Promise.resolve();
    expect(stopIssueChatCommentSync('thread-1')).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.listIssueComments).toHaveBeenCalledTimes(1);
  });
});
