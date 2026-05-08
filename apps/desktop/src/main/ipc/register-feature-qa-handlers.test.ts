import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FeatureQaResult } from '@shipcode/shared';
import type { IpcMain } from 'electron';
import { shell } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  shell: {
    openPath: vi.fn(async () => ''),
  },
}));

vi.mock('@shipcode/agents/source', () => ({
  inspectProjectSetup: vi.fn(),
  ServerLifecycleManager: class {},
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
      projects: { getById: vi.fn() },
      threads: { getById: vi.fn() },
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
});
