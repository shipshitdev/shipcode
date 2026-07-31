import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IpcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  let tempRoot: string;

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'code-browser-'));
    registerProjectCodeBrowserHandlers({
      ipcMain,
      queries: { projects } as never,
      buildGitVisualizerData: vi.fn(async () => ({
        project: { id: 'project-1', path: tempRoot },
        branches: [],
        worktrees: [],
      })) as never,
      parseDiffRecords: vi.fn(),
    });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it.each([
    'code:list-tree',
    'code:read-file',
    'code:file-diff',
  ])('logs full %s errors and exposes only the clamped first line', async (channel) => {
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
  });

  it('refuses to read files reached only via a worktree symlink escape', async () => {
    const worktree = path.join(tempRoot, 'worktree');
    const secret = path.join(tempRoot, 'secret.txt');
    fs.mkdirSync(worktree);
    fs.writeFileSync(secret, 'top-secret\n', 'utf8');
    fs.symlinkSync(secret, path.join(worktree, 'escape.txt'));

    projects.getById.mockReturnValue({
      id: 'project-1',
      path: worktree,
    });

    const handler = handlers.get('code:read-file');
    if (!handler) throw new Error('code:read-file handler not registered');

    await expect(
      handler(undefined, {
        projectId: 'project-1',
        worktreePath: worktree,
        relativePath: 'escape.txt',
      }),
    ).rejects.toThrow(/Path escapes worktree|escapes worktree/i);

    // Ensure the secret content never leaked into the error path either.
    await expect(
      handler(undefined, {
        projectId: 'project-1',
        worktreePath: worktree,
        relativePath: 'escape.txt',
      }),
    ).rejects.not.toThrow(/top-secret/);
  });

  it('reads a normal in-worktree file', async () => {
    const worktree = path.join(tempRoot, 'worktree-ok');
    fs.mkdirSync(worktree);
    await fsp.writeFile(path.join(worktree, 'readme.md'), '# hello\n', 'utf8');

    projects.getById.mockReturnValue({
      id: 'project-1',
      path: worktree,
    });

    const handler = handlers.get('code:read-file');
    if (!handler) throw new Error('code:read-file handler not registered');

    const result = (await handler(undefined, {
      projectId: 'project-1',
      worktreePath: worktree,
      relativePath: 'readme.md',
    })) as { content: string; truncated: boolean };

    expect(result.content).toContain('# hello');
    expect(result.truncated).toBe(false);
  });
});
