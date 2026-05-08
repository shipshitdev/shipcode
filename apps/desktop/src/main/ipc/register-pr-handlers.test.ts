import fs from 'node:fs/promises';
import { GhCli } from '@shipcode/agents';
import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPullRequestHandlers } from './register-pr-handlers';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('@shipcode/agents', () => ({
  GhCli: vi.fn(),
}));

vi.mock('../logger.service', () => ({
  default: {
    info: vi.fn(),
  },
}));

function makeDeps(
  project: { id: string; path: string } | null = { id: 'project-1', path: '/repo' },
) {
  return {
    ipcMain: {
      handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
        handlers.set(channel, listener);
      }),
    } as unknown as IpcMain,
    queries: {
      projects: {
        getById: vi.fn(() => project),
      },
      githubIssues: {
        getByLinkedPrNumber: vi.fn(() => ({ threadId: 'thread-1' })),
      },
      diffs: {
        list: vi.fn(() => [{ id: 'diff-1', filePath: 'src/app.ts' }]),
      },
    },
  };
}

describe('registerPullRequestHandlers', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    vi.mocked(GhCli).mockImplementation(function MockGhCli() {
      return {
        listPullRequests: vi.fn(async () => [{ number: 12, title: 'Fix branch' }]),
        getPullRequestDetail: vi.fn(async () => ({ number: 12, title: 'Fix branch' })),
      };
    } as never);
  });

  it('lists pull requests with the selected filter and rejects missing projects', async () => {
    registerPullRequestHandlers(makeDeps() as never);

    const listHandler = handlers.get('github:list-prs');
    if (!listHandler) throw new Error('github:list-prs handler missing');

    await expect(
      listHandler(undefined, { projectId: 'project-1', filter: 'closed', limit: 5 }),
    ).resolves.toEqual([{ number: 12, title: 'Fix branch' }]);
    expect(GhCli).toHaveBeenCalledWith('/repo');

    handlers.clear();
    registerPullRequestHandlers(makeDeps(null) as never);
    const missingHandler = handlers.get('github:list-prs');
    if (!missingHandler) throw new Error('github:list-prs handler missing');

    await expect(missingHandler(undefined, { projectId: 'missing' })).rejects.toThrow(
      'Project not found: missing',
    );
  });

  it('loads pull request detail with linked thread diffs or an empty diff list', async () => {
    const deps = makeDeps();
    registerPullRequestHandlers(deps as never);

    const detailHandler = handlers.get('github:get-pr-detail');
    if (!detailHandler) throw new Error('github:get-pr-detail handler missing');

    await expect(
      detailHandler(undefined, { projectId: 'project-1', prNumber: 12 }),
    ).resolves.toEqual({
      number: 12,
      title: 'Fix branch',
      linkedThreadId: 'thread-1',
      diffs: [{ id: 'diff-1', filePath: 'src/app.ts' }],
    });

    deps.queries.githubIssues.getByLinkedPrNumber.mockReturnValueOnce(
      null as unknown as { threadId: string },
    );
    await expect(
      detailHandler(undefined, { projectId: 'project-1', prNumber: 12 }),
    ).resolves.toEqual({
      number: 12,
      title: 'Fix branch',
      linkedThreadId: null,
      diffs: [],
    });
  });

  it('loads skill content from disk and returns null when missing', async () => {
    const readSpy = vi.spyOn(fs, 'readFile');
    readSpy
      .mockResolvedValueOnce('skill body' as never)
      .mockRejectedValueOnce(new Error('missing'));
    registerPullRequestHandlers(makeDeps() as never);

    const handler = handlers.get('skills:load-content');
    if (!handler) throw new Error('skills:load-content handler missing');

    await expect(handler(undefined, { name: 'writing-prds' })).resolves.toBe('skill body');
    await expect(handler(undefined, { name: 'missing-skill' })).resolves.toBeNull();

    readSpy.mockRestore();
  });
});
