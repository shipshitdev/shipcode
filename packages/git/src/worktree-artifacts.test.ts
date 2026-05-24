import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listWorktreeArtifacts, pruneWorktreeArtifacts } from './worktree-artifacts';

describe('worktree artifact cleanup', () => {
  let tempRoot: string | null = null;

  afterEach(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { force: true, recursive: true });
      tempRoot = null;
    }
  });

  function makeWorktree(): string {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-artifacts-'));
    return tempRoot;
  }

  it('lists and removes only existing configured artifact paths', async () => {
    const worktreePath = makeWorktree();
    fs.mkdirSync(path.join(worktreePath, 'node_modules/pkg'), { recursive: true });
    fs.mkdirSync(path.join(worktreePath, '.next/cache'), { recursive: true });
    fs.writeFileSync(path.join(worktreePath, 'src.ts'), 'keep\n');

    await expect(
      listWorktreeArtifacts(worktreePath, ['node_modules', '.next', 'coverage']),
    ).resolves.toEqual([
      {
        relativePath: 'node_modules',
        absolutePath: path.join(worktreePath, 'node_modules'),
      },
      {
        relativePath: '.next',
        absolutePath: path.join(worktreePath, '.next'),
      },
    ]);

    await expect(
      pruneWorktreeArtifacts(worktreePath, ['node_modules', '.next', 'coverage']),
    ).resolves.toEqual({
      removed: ['node_modules', '.next'],
      missing: ['coverage'],
      failed: [],
    });
    expect(fs.existsSync(path.join(worktreePath, 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(worktreePath, '.next'))).toBe(false);
    expect(fs.existsSync(path.join(worktreePath, 'src.ts'))).toBe(true);
  });

  it('rejects artifact paths that escape the worktree', async () => {
    const worktreePath = makeWorktree();

    await expect(listWorktreeArtifacts(worktreePath, ['../node_modules'])).rejects.toThrow(
      'artifact path escapes worktree',
    );
    await expect(pruneWorktreeArtifacts(worktreePath, ['/tmp/node_modules'])).rejects.toThrow(
      'artifact path must be relative',
    );
  });
});
