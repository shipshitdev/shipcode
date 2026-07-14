import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerProjectCodeBrowserHandlers } from './register-project-code-browser-handlers';

const logError = vi.hoisted(() => vi.fn());

vi.mock('../logger.service', () => ({
  default: {
    error: logError,
    warn: vi.fn(),
  },
}));

describe('registerProjectCodeBrowserHandlers', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
  } as unknown as IpcMain;
  const projects = { getById: vi.fn() };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerProjectCodeBrowserHandlers({
      ipcMain,
      queries: { projects } as never,
      buildGitVisualizerData: vi.fn(),
      parseDiffRecords: vi.fn(),
    });
  });

  it.each(['code:list-tree', 'code:read-file', 'code:file-diff'])(
    'logs full %s errors and exposes only the clamped first line',
    async (channel) => {
      const fullError = new Error(`${'x'.repeat(400)}\nstack trace`);
      projects.getById.mockImplementationOnce(() => {
        throw fullError;
      });
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`${channel} handler not registered`);

      await expect(
        handler(undefined, {
          projectId: 'project-1',
          worktreePath: '/tmp/worktree',
          relativePath: 'src/index.ts',
        }),
      ).rejects.toThrow(`${'x'.repeat(279)}…`);
      expect(logError).toHaveBeenCalledWith(`[${channel}]`, fullError);
    },
  );
});
