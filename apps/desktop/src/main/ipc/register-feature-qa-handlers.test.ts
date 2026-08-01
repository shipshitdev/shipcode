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
const mockAssertRegistered = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@shipcode/git', () => ({
  WorktreeManager: class {
    assertRegistered = mockAssertRegistered;
  },
}));

vi.mock('electron', () => ({
  shell: {
    openPath: vi.fn(async () => ''),
  },
}));

vi.mock('@shipcode/agents', () => ({
  inspectProjectSetup: mockInspectProjectSetup,
  ServerLifecycleManager: class {
    readonly logger: (message: string) => void;

    constructor(_processManager: unknown, logger: (message: string) => void) {
      this.logger = logger;
    }

    start = (...args: unknown[]) => {
      this.logger('server ready\n');
      return mockLifecycleStart(...args);
    };
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
          worktreeBranch: 'shipcode/thread-1',
          worktreePath: '/tmp/worktree',
        })),
      },
      settings: {
        get: vi.fn(() => ({ worktreeRoot: null, worktreeBranchFormat: null })),
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
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.mocked(shell.openPath).mockClear();
    mockInspectProjectSetup.mockReset();
    mockLifecycleStart.mockReset();
    mockLifecycleStop.mockReset();
    mockAssertRegistered.mockClear();
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
    vi.restoreAllMocks();
  });

  it('lists thread results and returns the latest feature result', () => {
    const results = [
      {
        featureId: 'issue-42',
        status: 'passed',
        summary: 'passed',
        runAt: new Date().toISOString(),
        evidencePaths: [],
        flowResults: [],
      },
    ] satisfies FeatureQaResult[];
    const deps = makeDeps(results);

    registerFeatureQaHandlers(deps as never);
    const list = handlers.get('feature-qa:list-by-thread');
    if (!list) throw new Error('feature QA query handlers not registered');

    expect(list(undefined, { threadId: 'thread-1' })).toBe(results);
    expect(deps.queries.featureQaResults.listByThread).toHaveBeenCalledWith('thread-1');
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

  it('collects assertion evidence paths and skips empty optional evidence lists', async () => {
    const assertionEvidencePath = path.join(tempDir, 'assertion.png');
    writeFileSync(assertionEvidencePath, 'png');
    const deps = makeDeps([
      {
        featureId: 'issue-42',
        status: 'failed',
        summary: 'failed',
        runAt: new Date().toISOString(),
        flowResults: [
          {
            id: 'flow-1',
            title: 'Flow 1',
            status: 'failed',
            summary: 'failed',
            assertions: [
              {
                id: 'assertion-1',
                title: 'Missing button',
                status: 'failed',
                message: 'button missing',
                evidencePath: assertionEvidencePath,
              },
              {
                id: 'assertion-2',
                title: 'No evidence',
                status: 'passed',
                message: 'ok',
                evidencePath: null,
              },
            ],
          },
          {
            id: 'flow-2',
            title: 'Flow 2',
            status: 'passed',
            summary: 'passed',
          },
        ],
      },
    ] as never);

    registerFeatureQaHandlers(deps as never);
    const handler = handlers.get('feature-qa:open-evidence');
    if (!handler) throw new Error('feature-qa:open-evidence handler not registered');

    await handler(undefined, { threadId: 'thread-1', path: assertionEvidencePath });

    expect(shell.openPath).toHaveBeenCalledWith(tempDir);
  });

  it('rejects shell failures when opening attached evidence', async () => {
    const evidencePath = path.join(tempDir, 'screenshot.png');
    writeFileSync(evidencePath, 'png');
    vi.mocked(shell.openPath).mockResolvedValueOnce('Finder refused');
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

    await expect(handler(undefined, { threadId: 'thread-1', path: evidencePath })).rejects.toThrow(
      'Finder refused',
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
      { workspaceRoot: null, projectPath: '/tmp/project' },
    );
    expect(console.info).toHaveBeenCalledWith('[manual-qa:thread-1] server ready');

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
    vi.mocked(deps.processManager.get).mockReturnValueOnce(null as never);

    registerFeatureQaHandlers(deps as never);
    const start = handlers.get('feature-qa:start-server');
    const get = handlers.get('feature-qa:get-server');
    if (!start || !get) throw new Error('manual QA server handlers not registered');

    await start(undefined, { projectId: 'project-1', threadId: 'thread-1' });
    expect(get(undefined, { threadId: 'thread-1' })).toBeNull();

    vi.mocked(deps.queries.projects.getById).mockReturnValueOnce(null as never);
    await expect(
      start(undefined, { projectId: 'missing-project', threadId: 'thread-1' }),
    ).rejects.toThrow('Project missing-project not found');

    vi.mocked(deps.queries.threads.getById).mockReturnValueOnce({
      id: 'thread-1',
      projectId: 'other-project',
      worktreeBranch: 'shipcode/thread-1',
      worktreePath: '/tmp/worktree',
    });
    await expect(
      start(undefined, { projectId: 'project-1', threadId: 'thread-1' }),
    ).rejects.toThrow('Thread thread-1 not found for project project-1');

    vi.mocked(deps.queries.threads.getById).mockReturnValueOnce({
      id: 'thread-1',
      projectId: 'project-1',
      worktreeBranch: 'shipcode/thread-1',
      worktreePath: null as never,
    });
    await expect(
      start(undefined, { projectId: 'project-1', threadId: 'thread-1' }),
    ).rejects.toThrow('Thread has no worktree for manual QA');

    mockInspectProjectSetup.mockReturnValueOnce({ contract: {} });
    await expect(
      start(undefined, { projectId: 'project-1', threadId: 'thread-1' }),
    ).rejects.toThrow('Configure a Runtime QA start command');
  });

  it('treats stopping a missing manual QA server as a no-op', async () => {
    const deps = makeDeps([]);

    registerFeatureQaHandlers(deps as never);
    const stop = handlers.get('feature-qa:stop-server');
    if (!stop) throw new Error('manual QA stop handler not registered');

    await expect(stop(undefined, { threadId: 'missing-thread' })).resolves.toBeUndefined();

    expect(mockLifecycleStop).not.toHaveBeenCalled();
  });
});
