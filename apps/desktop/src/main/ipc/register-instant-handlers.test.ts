import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerInstantHandlers } from './register-instant-handlers';

vi.mock('../logger.service', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function makeThread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Fix terminal failure',
    prompt: 'Original task prompt',
    status: 'failed',
    kind: 'pipeline',
    worktreeBranch: 'shipcode/thread-1',
    worktreePath: '/tmp/repo/.shipcode/worktrees/thread-1',
    executorModel: 'codex',
    githubIssueNumber: 42,
    ...overrides,
  };
}

describe('registerInstantHandlers', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
  } as unknown as IpcMain;

  let queries: {
    projects: {
      getOrCreateInstantProject: ReturnType<typeof vi.fn>;
      getById: ReturnType<typeof vi.fn>;
    };
    threads: {
      deleteOlderThan: ReturnType<typeof vi.fn>;
      getById: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      updateStatus: ReturnType<typeof vi.fn>;
    };
    githubIssues: {
      getByNumber: ReturnType<typeof vi.fn>;
    };
    plans: {
      getLatest: ReturnType<typeof vi.fn>;
    };
  };
  let processManager: {
    spawnWithStdin: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();

    queries = {
      projects: {
        getOrCreateInstantProject: vi.fn(() => ({ id: 'instant-project' })),
        getById: vi.fn(() => ({
          id: 'project-1',
          name: 'ShipCode',
          path: '/tmp/repo',
        })),
      },
      threads: {
        deleteOlderThan: vi.fn(() => 0),
        getById: vi.fn(() => makeThread()),
        create: vi.fn(() => ({ id: 'thread-fix-1' })),
        updateStatus: vi.fn(),
      },
      githubIssues: {
        getByNumber: vi.fn(() => ({
          id: 'issue-42',
          title: 'Broken terminal run',
          body: 'Issue body with task context',
        })),
      },
      plans: {
        getLatest: vi.fn(() => ({
          structured: {
            objective: 'Fix the task',
            version: 2,
            steps: [{ order: 1, description: 'Repair terminal failure' }],
            acceptanceCriteria: ['Terminal fix runs verification'],
          },
        })),
      },
    };
    processManager = {
      spawnWithStdin: vi.fn(() => ({ id: 'proc-1' })),
      on: vi.fn(),
    };

    registerInstantHandlers({
      ipcMain,
      queries,
      processManager,
    } as never);
  });

  it('starts an embedded fix session in the source thread worktree with task context', async () => {
    const handler = handlers.get('instant:fix-thread-failure');
    if (!handler) throw new Error('instant:fix-thread-failure handler not registered');

    const result = await handler(undefined, {
      threadId: 'thread-1',
      failureOutput: 'ERROR codex_core::session: failed to record rollout items',
    });

    expect(queries.threads.create).toHaveBeenCalledWith(
      'project-1',
      expect.stringContaining('Issue body with task context'),
      'Fix #42',
      'instant',
    );
    expect(processManager.spawnWithStdin).toHaveBeenCalledWith(
      'codex',
      'codex',
      expect.arrayContaining(['exec', '-', '--sandbox', 'workspace-write']),
      '/tmp/repo/.shipcode/worktrees/thread-1',
      expect.stringContaining('ERROR codex_core::session: failed to record rollout items'),
      'thread-fix-1',
    );
    expect(result).toEqual({ threadId: 'thread-fix-1', cli: 'codex', title: 'Fix #42' });
  });
});
