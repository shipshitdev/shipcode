import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateWorktree = vi.hoisted(() =>
  vi.fn(async () => ({
    branch: 'shipcode/12-issue-chat',
    worktreePath: '/tmp/created-worktree',
    baseRef: 'origin/master',
    baseStale: false,
  })),
);
const mockGetIssue = vi.hoisted(() =>
  vi.fn(async () => ({
    number: 12,
    title: 'Cover issue chat',
    body: 'Issue body',
    state: 'open' as const,
  })),
);

vi.mock('@shipcode/git', () => ({
  WorktreeManager: class {
    create = mockCreateWorktree;
  },
}));

vi.mock('@shipcode/agents', () => ({
  GhCli: class {
    getIssue = mockGetIssue;
  },
}));

import { ensureIssueThread } from './ensure-issue-thread';

function makeProject() {
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
    defaultBranch: 'master',
    gitRemote: 'https://github.com/shipshitdev/shipcode.git',
  };
}

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'issue-12',
    issueNumber: 12,
    title: 'Cover issue chat',
    body: 'Issue body',
    threadId: null,
    ...overrides,
  };
}

function makeThread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Cover issue chat',
    prompt: 'Issue body',
    worktreeBranch: null,
    worktreePath: null,
    ...overrides,
  };
}

describe('ensureIssueThread', () => {
  beforeEach(() => {
    mockCreateWorktree.mockClear();
    mockGetIssue.mockClear();
    mockGetIssue.mockResolvedValue({
      number: 12,
      title: 'Cover issue chat',
      body: 'Issue body',
      state: 'open',
    });
  });

  it('creates a thread, links the issue, and materializes a worktree', async () => {
    const created = makeThread();
    const queries = {
      threads: {
        getById: vi.fn(() => created),
        getByProjectAndGithubIssue: vi.fn(() => null),
        create: vi.fn(() => created),
        updateIssueContent: vi.fn(),
        setGithubIssue: vi.fn(),
        setWorktree: vi.fn((threadId: string, branch: string, worktreePath: string) => {
          created.worktreeBranch = branch;
          created.worktreePath = worktreePath;
          created.id = threadId;
        }),
      },
      githubIssues: {
        linkThread: vi.fn(),
        updateState: vi.fn(),
        markClosedOnClose: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: null, worktreeBranchFormat: null })),
      },
      projects: {
        updateGitInfo: vi.fn(),
      },
    };

    const thread = await ensureIssueThread({
      queries: queries as never,
      project: makeProject() as never,
      issue: makeIssue() as never,
    });

    expect(queries.threads.create).toHaveBeenCalledWith(
      'project-1',
      'Issue body',
      'Cover issue chat',
      'pipeline',
    );
    expect(queries.githubIssues.linkThread).toHaveBeenCalledWith('issue-12', 'thread-1');
    expect(mockCreateWorktree).toHaveBeenCalledWith(12, 'Cover issue chat', 'master');
    expect(queries.projects.updateGitInfo).not.toHaveBeenCalled();
    expect(thread.worktreePath).toBe('/tmp/created-worktree');
  });

  it('heals a stale project defaultBranch when the worktree forked from a different ref', async () => {
    mockCreateWorktree.mockResolvedValueOnce({
      branch: 'shipcode/12-issue-chat',
      worktreePath: '/tmp/created-worktree',
      baseRef: 'origin/master',
      baseStale: false,
    });
    const created = makeThread();
    const queries = {
      threads: {
        getById: vi.fn(() => created),
        getByProjectAndGithubIssue: vi.fn(() => null),
        create: vi.fn(() => created),
        updateIssueContent: vi.fn(),
        setGithubIssue: vi.fn(),
        setWorktree: vi.fn(),
      },
      githubIssues: {
        linkThread: vi.fn(),
        updateState: vi.fn(),
        markClosedOnClose: vi.fn(),
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: null, worktreeBranchFormat: null })),
      },
      projects: {
        updateGitInfo: vi.fn(),
      },
    };

    await ensureIssueThread({
      queries: queries as never,
      project: { ...makeProject(), defaultBranch: 'develop' } as never,
      issue: makeIssue() as never,
    });

    expect(queries.projects.updateGitInfo).toHaveBeenCalledWith(
      'project-1',
      'https://github.com/shipshitdev/shipcode.git',
      'master',
    );
  });

  it('reuses an existing linked thread with a worktree', async () => {
    const existing = makeThread({
      worktreePath: '/tmp/existing-worktree',
      worktreeBranch: 'shipcode/12-issue-chat',
    });
    const queries = {
      threads: {
        getById: vi.fn(() => existing),
        getByProjectAndGithubIssue: vi.fn(),
        create: vi.fn(),
        updateIssueContent: vi.fn(),
        setGithubIssue: vi.fn(),
        setWorktree: vi.fn(),
      },
      githubIssues: {
        linkThread: vi.fn(),
        updateState: vi.fn(),
        markClosedOnClose: vi.fn(),
      },
      settings: {
        get: vi.fn(),
      },
    };

    const thread = await ensureIssueThread({
      queries: queries as never,
      project: makeProject() as never,
      issue: makeIssue({ threadId: 'thread-1' }) as never,
    });

    expect(queries.threads.create).not.toHaveBeenCalled();
    expect(mockCreateWorktree).not.toHaveBeenCalled();
    expect(thread.worktreePath).toBe('/tmp/existing-worktree');
  });

  it('refuses to create a worktree for a cached closed issue', async () => {
    const queries = {
      threads: { create: vi.fn() },
      githubIssues: { linkThread: vi.fn(), updateState: vi.fn(), markClosedOnClose: vi.fn() },
      settings: { get: vi.fn() },
      projects: { updateGitInfo: vi.fn() },
    };

    await expect(
      ensureIssueThread({
        queries: queries as never,
        project: makeProject() as never,
        issue: makeIssue({ state: 'closed' }) as never,
      }),
    ).rejects.toThrow('Issue #12 is closed on GitHub');
    expect(mockCreateWorktree).not.toHaveBeenCalled();
    expect(mockGetIssue).not.toHaveBeenCalled();
  });

  it('heals the cache and refuses a worktree when GitHub says the issue is closed', async () => {
    mockGetIssue.mockResolvedValueOnce({
      number: 12,
      title: 'Cover issue chat',
      body: 'Issue body',
      state: 'closed',
    });
    const queries = {
      threads: { create: vi.fn() },
      githubIssues: { linkThread: vi.fn(), updateState: vi.fn(), markClosedOnClose: vi.fn() },
      settings: { get: vi.fn() },
      projects: { updateGitInfo: vi.fn() },
    };

    await expect(
      ensureIssueThread({
        queries: queries as never,
        project: makeProject() as never,
        issue: makeIssue({ state: 'open' }) as never,
      }),
    ).rejects.toThrow('Issue #12 is closed on GitHub');
    expect(queries.githubIssues.updateState).toHaveBeenCalledWith('issue-12', 'closed');
    expect(queries.githubIssues.markClosedOnClose).toHaveBeenCalledWith('issue-12');
    expect(mockCreateWorktree).not.toHaveBeenCalled();
  });
});
