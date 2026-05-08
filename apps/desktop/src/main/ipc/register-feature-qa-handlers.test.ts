import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FeatureQaResult } from '@shipcode/shared';
import type { IpcMain } from 'electron';
import { shell } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const mockInspectProjectSetup = vi.hoisted(() => vi.fn());
const mockLifecycleStart = vi.hoisted(() => vi.fn());
const mockLifecycleStop = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  shell: {
    openPath: vi.fn(async () => ''),
  },
}));

vi.mock('@shipcode/agents/source', () => ({
  inspectProjectSetup: mockInspectProjectSetup,
  ServerLifecycleManager: class {
    start = mockLifecycleStart;
    stop = mockLifecycleStop;
  },
}));

const { registerFeatureQaHandlers } = await import('./register-feature-qa-handlers');

function makeDeps(results: FeatureQaResult[]) {
  return {
    ipcMain: {
      handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
        handlers.set(channel, listener);
      }),
    } as unknown as IpcMain,
    processManager: { get: vi.fn() },
    queries: {
      featureQaResults: {
        listByThread: vi.fn(() => results),
        latestByFeature: vi.fn(),
      },
      projects: {
        getById: vi.fn(() => ({
          id: 'project-1',
          path: '/tmp/project',
        })),
      },
      threads: {
        getById: vi.fn(() => ({
          id: 'thread-1',
          projectId: 'project-1',
          worktreePath: '/tmp/worktree',
        })),
      },
    },
  };
}

describe('registerFeatureQaHandlers', () => {
  let tempDir: string;

  beforeEach(() => {
    handlers.clear();
    tempDir = path.join(os.tmpdir(), `shipcode-feature-qa-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    vi.mocked(shell.openPath).mockClear();
    mockInspectProjectSetup.mockReturnValue({
      contract: {
        runtimeQa: {
          server: {
            command: 'bun',
            args: ['dev'],
            port: 5173,
          },
        },
      },
    });
    mockLifecycleStart.mockResolvedValue({
      processId: 'process-1',
      baseUrl: 'http://127.0.0.1:5173',
      port: 5173,
    });
    mockLifecycleStop.mockResolvedValue(undefined);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('opens the containing directory for attached evidence files', async () => {
    const evidencePath = path.join(tempDir, 'screenshot.png');
    writeFileSync(evidencePath, 'png');
    const deps = makeDeps([
      {
        featureId: 'issue-42',
        status: 'failed',
        summary: 'failed',
        runAt: new Date().toISOString(),
        evidencePaths: [evidencePath],
        flowResults: [],
      },
    ]);

    registerFeatureQaHandlers(deps as never);
    const handler = handlers.get('feature-qa:open-evidence');
    if (!handler) throw new Error('feature-qa:open-evidence handler not registered');

    await handler(undefined, { threadId: 'thread-1', path: evidencePath });

    expect(shell.openPath).toHaveBeenCalledWith(tempDir);
  });

  it('rejects evidence paths that are not attached to the thread', async () => {
    const evidencePath = path.join(tempDir, 'screenshot.png');
    writeFileSync(evidencePath, 'png');
    const deps = makeDeps([]);

    registerFeatureQaHandlers(deps as never);
    const handler = handlers.get('feature-qa:open-evidence');
    if (!handler) throw new Error('feature-qa:open-evidence handler not registered');

    await expect(handler(undefined, { threadId: 'thread-1', path: evidencePath })).rejects.toThrow(
      'Evidence path is not attached',
    );
  });

  it('opens attached evidence directories directly and rejects missing attached paths', async () => {
    const evidenceDir = path.join(tempDir, 'screenshots');
    mkdirSync(evidenceDir);
    const missingPath = path.join(tempDir, 'missing.png');
    const deps = makeDeps([
      {
        featureId: 'issue-42',
        status: 'failed',
        summary: 'failed',
        runAt: new Date().toISOString(),
        evidencePaths: [evidenceDir],
        flowResults: [
          {
            id: 'flow-1',
            title: 'Flow 1',
            status: 'failed',
            summary: 'failed',
            evidencePaths: [missingPath],
            assertions: [],
          },
        ],
      },
    ] as never);

    registerFeatureQaHandlers(deps as never);
    const handler = handlers.get('feature-qa:open-evidence');
    if (!handler) throw new Error('feature-qa:open-evidence handler not registered');

    await handler(undefined, { threadId: 'thread-1', path: evidenceDir });

    expect(shell.openPath).toHaveBeenCalledWith(evidenceDir);
    await expect(handler(undefined, { threadId: 'thread-1', path: missingPath })).rejects.toThrow(
      'Evidence path no longer exists',
    );
  });

  it('starts, reuses, reports, and stops a configured manual QA server', async () => {
    const deps = makeDeps([]);
    vi.mocked(deps.processManager.get).mockReturnValue({ state: 'running' });

    registerFeatureQaHandlers(deps as never);
    const start = handlers.get('feature-qa:start-server');
    const get = handlers.get('feature-qa:get-server');
    const stop = handlers.get('feature-qa:stop-server');
    if (!start || !get || !stop) throw new Error('manual QA server handlers not registered');

    await expect(
      start(undefined, { projectId: 'project-1', threadId: 'thread-1' }),
    ).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:5173',
      port: 5173,
    });
    expect(mockLifecycleStart).toHaveBeenCalledWith(
      { command: 'bun', args: ['dev'], port: 5173 },
      '/tmp/worktree',
      expect.any(AbortSignal),
      'thread-1',
    );

    await expect(
      start(undefined, { projectId: 'project-1', threadId: 'thread-1' }),
    ).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:5173',
      port: 5173,
    });
    expect(mockLifecycleStart).toHaveBeenCalledTimes(1);
    expect(get(undefined, { threadId: 'thread-1' })).toEqual({
      baseUrl: 'http://127.0.0.1:5173',
      port: 5173,
    });

    await stop(undefined, { threadId: 'thread-1' });

    expect(mockLifecycleStop).toHaveBeenCalledWith({
      processId: 'process-1',
      baseUrl: 'http://127.0.0.1:5173',
      port: 5173,
    });
    expect(get(undefined, { threadId: 'thread-1' })).toBeNull();
  });

  it('evicts exited manual QA servers and validates start-server prerequisites', async () => {
    const deps = makeDeps([]);
    vi.mocked(deps.processManager.get).mockReturnValueOnce(null);

    registerFeatureQaHandlers(deps as never);
    const start = handlers.get('feature-qa:start-server');
    const get = handlers.get('feature-qa:get-server');
    if (!start || !get) throw new Error('manual QA server handlers not registered');

    await start(undefined, { projectId: 'project-1', threadId: 'thread-1' });
    expect(get(undefined, { threadId: 'thread-1' })).toBeNull();

    vi.mocked(deps.queries.projects.getById).mockReturnValueOnce(null);
    await expect(
      start(undefined, { projectId: 'missing-project', threadId: 'thread-1' }),
    ).rejects.toThrow('Project missing-project not found');

    vi.mocked(deps.queries.threads.getById).mockReturnValueOnce({
      id: 'thread-1',
      projectId: 'other-project',
      worktreePath: '/tmp/worktree',
    });
    await expect(
      start(undefined, { projectId: 'project-1', threadId: 'thread-1' }),
    ).rejects.toThrow('Thread thread-1 not found for project project-1');

    vi.mocked(deps.queries.threads.getById).mockReturnValueOnce({
      id: 'thread-1',
      projectId: 'project-1',
      worktreePath: null,
    });
    await expect(
      start(undefined, { projectId: 'project-1', threadId: 'thread-1' }),
    ).rejects.toThrow('Thread has no worktree for manual QA');

    mockInspectProjectSetup.mockReturnValueOnce({ contract: {} });
    await expect(
      start(undefined, { projectId: 'project-1', threadId: 'thread-1' }),
    ).rejects.toThrow('Configure a Runtime QA start command');
  });
});
