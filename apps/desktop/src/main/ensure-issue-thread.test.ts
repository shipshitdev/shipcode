import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateWorktree = vi.hoisted(() =>
  vi.fn(async () => ({
    branch: 'shipcode/12-issue-chat',
    worktreePath: '/tmp/created-worktree',
  })),
);

vi.mock('@shipcode/git', () => ({
  WorktreeManager: class {
    create = mockCreateWorktree;
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
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: null, worktreeBranchFormat: null })),
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
    expect(thread.worktreePath).toBe('/tmp/created-worktree');
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
});
