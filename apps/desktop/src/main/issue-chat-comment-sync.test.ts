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

import {
  buildGithubIssueChatTurn,
  stopIssueChatCommentSync,
  syncIssueChatCommentsOnce,
} from './issue-chat-comment-sync';

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
    },
    processManager: {},
    mainWindow: {},
  };
}

describe('issue chat comment sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it('extracts opt-in GitHub comment markers into untrusted chat turns', () => {
    expect(buildGithubIssueChatTurn(makeComment({ body: 'plain comment' }))).toBeNull();
    expect(buildGithubIssueChatTurn(makeComment({ body: '/ask' }))).toBeNull();
    expect(
      buildGithubIssueChatTurn(
        makeComment({ body: '/ask spend tokens', authorAssociation: 'CONTRIBUTOR' }),
      ),
    ).toBeNull();
    expect(buildGithubIssueChatTurn(makeComment({ body: '@shipcode draft a plan' }))).toEqual({
      speaker: 'github:octocat',
      text: 'GitHub issue comment from @octocat (untrusted user input):\n\ndraft a plan',
    });
  });

  it('baselines existing comments and dispatches only new marker comments once', async () => {
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
        makeComment({ id: 4, body: '/ask new prompt', createdAt: '2026-06-01T00:03:00.000Z' }),
      ]);

    await expect(syncIssueChatCommentsOnce({ ...h, baselineOnly: true } as never)).resolves.toEqual(
      {
        checked: 2,
        dispatched: 0,
        ignored: 2,
        lastSeenCommentId: 2,
      },
    );
    expect(mocks.sendIssueChatTurn).not.toHaveBeenCalled();

    await expect(syncIssueChatCommentsOnce(h as never)).resolves.toEqual({
      checked: 4,
      dispatched: 1,
      ignored: 1,
      lastSeenCommentId: 4,
    });
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

  it('does not advance the marker cursor when dispatch fails', async () => {
    const h = makeHarness();
    mocks.sendIssueChatTurn.mockRejectedValueOnce(new Error('turn already running'));
    mocks.listIssueComments
      .mockResolvedValueOnce([
        makeComment({ id: 1, body: 'old', createdAt: '2026-06-01T00:00:00.000Z' }),
      ])
      .mockResolvedValueOnce([
        makeComment({ id: 1, body: 'old', createdAt: '2026-06-01T00:00:00.000Z' }),
        makeComment({ id: 2, body: '/ask retry me', createdAt: '2026-06-01T00:01:00.000Z' }),
      ]);

    await syncIssueChatCommentsOnce({ ...h, baselineOnly: true } as never);
    await expect(syncIssueChatCommentsOnce(h as never)).resolves.toMatchObject({
      dispatched: 0,
      lastSeenCommentId: 1,
    });
    expect(mocks.logError).toHaveBeenCalledWith(
      expect.stringContaining('failed to dispatch comment 2'),
    );
  });

  it('stops without polling when the chat session is no longer live', async () => {
    mocks.isIssueChatSessionLive.mockReturnValue(false);

    await expect(syncIssueChatCommentsOnce(makeHarness() as never)).resolves.toEqual({
      checked: 0,
      dispatched: 0,
      ignored: 0,
      lastSeenCommentId: null,
    });
    expect(mocks.listIssueComments).not.toHaveBeenCalled();
  });
});
