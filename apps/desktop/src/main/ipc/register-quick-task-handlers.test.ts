import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveQuickTitle, registerQuickTaskHandlers } from './register-quick-task-handlers';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
}));

const startQuickTaskOrQueue = vi.fn();

vi.mock('../pipeline-scheduler', () => ({
  PipelineScheduler: class {
    startQuickTaskOrQueue = startQuickTaskOrQueue;
  },
}));

vi.mock('./helpers', () => ({
  sendGithubIssuesUpdated: vi.fn(),
}));

import { sendGithubIssuesUpdated } from './helpers';

const ghCliCreateIssue = vi.fn();
vi.mock('@shipcode/git', () => ({
  GhCli: { createIssue: ghCliCreateIssue },
}));

describe('deriveQuickTitle', () => {
  it('returns the trimmed text when ≤60 chars', () => {
    expect(deriveQuickTitle('  short fix  ')).toBe('short fix');
  });

  it('cuts at last whitespace under 60 chars', () => {
    const title = deriveQuickTitle(
      'Fix the off-by-one error in the auth middleware token expiry check now',
    );
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith(' ')).toBe(false);
    expect(title.split(' ').every((w) => w.length > 0)).toBe(true);
  });

  it('hard-slices when no whitespace in first 60 chars', () => {
    const title = deriveQuickTitle('a'.repeat(80));
    expect(title.length).toBe(60);
  });
});

describe('registerQuickTaskHandlers', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
  } as unknown as IpcMain;

  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  };

  let queries: {
    projects: { getById: ReturnType<typeof vi.fn> };
    threads: {
      create: ReturnType<typeof vi.fn>;
      setGithubIssueNumber: ReturnType<typeof vi.fn>;
      recordFailure: ReturnType<typeof vi.fn>;
    };
    githubIssues: {
      insertQuickTask: ReturnType<typeof vi.fn>;
      updatePipelineStatus: ReturnType<typeof vi.fn>;
      list: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    startQuickTaskOrQueue.mockReset();

    queries = {
      projects: {
        getById: vi.fn(() => ({ id: 'p1', name: 'Repo', path: '/tmp/repo' })),
      },
      threads: {
        create: vi.fn(() => ({ id: 'thread-quick-1' })),
        setGithubIssueNumber: vi.fn(),
        recordFailure: vi.fn(),
      },
      githubIssues: {
        insertQuickTask: vi.fn(() => ({
          id: 'issue-quick-1',
          projectId: 'p1',
          issueNumber: -1,
          title: 'Fix auth middleware off-by-one',
          isQuickMode: true,
        })),
        updatePipelineStatus: vi.fn(),
        list: vi.fn(() => []),
      },
    };

    registerQuickTaskHandlers({
      ipcMain,
      mainWindow,
      queries,
      pipeline: {} as never,
      emitter: { emit: vi.fn() } as never,
    } as never);
  });

  it('creates thread + quick-task row, stamps thread issue number, dispatches scheduler', async () => {
    startQuickTaskOrQueue.mockResolvedValue(undefined);

    const handler = handlers.get('pipeline:create-quick-task');
    expect(handler).toBeDefined();

    const result = (await handler!(null, {
      projectId: 'p1',
      text: '  Fix auth middleware off-by-one  ',
    })) as { issue: { issueNumber: number } };

    expect(queries.projects.getById).toHaveBeenCalledWith('p1');
    expect(queries.threads.create).toHaveBeenCalledWith(
      'p1',
      'Fix auth middleware off-by-one',
      'Fix auth middleware off-by-one',
      'pipeline',
    );
    expect(queries.githubIssues.insertQuickTask).toHaveBeenCalledWith({
      projectId: 'p1',
      title: 'Fix auth middleware off-by-one',
      body: 'Fix auth middleware off-by-one',
      threadId: 'thread-quick-1',
    });
    expect(queries.threads.setGithubIssueNumber).toHaveBeenCalledWith('thread-quick-1', -1);
    expect(sendGithubIssuesUpdated).toHaveBeenCalled();

    // Wait microtask so the fire-and-forget scheduler call lands
    await new Promise((r) => setTimeout(r, 0));
    expect(startQuickTaskOrQueue).toHaveBeenCalledWith('p1', -1);
    expect(ghCliCreateIssue).not.toHaveBeenCalled();
    expect(result.issue.issueNumber).toBe(-1);
  });

  it('rejects when the project is missing', async () => {
    queries.projects.getById.mockReturnValueOnce(null);
    const handler = handlers.get('pipeline:create-quick-task');
    await expect(handler!(null, { projectId: 'missing', text: 'do thing' })).rejects.toThrow(
      /project missing not found/i,
    );
    expect(queries.threads.create).not.toHaveBeenCalled();
    expect(queries.githubIssues.insertQuickTask).not.toHaveBeenCalled();
  });

  it('rejects empty text', async () => {
    const handler = handlers.get('pipeline:create-quick-task');
    await expect(handler!(null, { projectId: 'p1', text: '   ' })).rejects.toThrow(
      /quick task text is empty/i,
    );
    expect(queries.threads.create).not.toHaveBeenCalled();
  });

  it('records failure on cache row + thread when scheduler launch throws', async () => {
    startQuickTaskOrQueue.mockRejectedValueOnce(new Error('scheduler boom'));
    const handler = handlers.get('pipeline:create-quick-task');

    await handler!(null, { projectId: 'p1', text: 'do thing' });

    // Wait for fire-and-forget catch
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(queries.githubIssues.updatePipelineStatus).toHaveBeenCalledWith(
      'issue-quick-1',
      'failed',
    );
    expect(queries.threads.recordFailure).toHaveBeenCalledWith(
      'thread-quick-1',
      expect.stringMatching(/scheduler boom/),
    );
  });
});
