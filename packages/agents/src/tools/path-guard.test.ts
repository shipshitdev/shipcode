import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertPathInWorktree, PathGuardError } from './path-guard';

let wt: string;
let outside: string;

async function makeTempDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

beforeEach(async () => {
  wt = await makeTempDir('shipcode-wt-');
  outside = await makeTempDir('shipcode-outside-');
  // Seed a file inside the worktree for mustExist tests
  await fs.writeFile(path.join(wt, 'inside.txt'), 'hi', 'utf-8');
  // Seed a subdirectory
  await fs.mkdir(path.join(wt, 'sub'), { recursive: true });
  await fs.writeFile(path.join(wt, 'sub', 'nested.txt'), 'hi', 'utf-8');
  // Seed something outside the worktree we might try to reach
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf-8');
});

afterEach(async () => {
  await fs.rm(wt, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe('assertPathInWorktree', () => {
  describe('happy paths', () => {
    it('accepts a relative path inside the worktree', async () => {
      const resolved = await assertPathInWorktree('inside.txt', wt, { mustExist: true });
      expect(resolved).toContain('inside.txt');
      expect(resolved).toMatch(new RegExp(`^${await fs.realpath(wt)}`));
    });

    it('accepts a nested relative path', async () => {
      const resolved = await assertPathInWorktree('sub/nested.txt', wt, { mustExist: true });
      expect(resolved).toContain('nested.txt');
    });

    it('accepts creating a new file inside the worktree (mustExist: false)', async () => {
      const resolved = await assertPathInWorktree('new.txt', wt);
      expect(resolved).toContain('new.txt');
      // The new file does not exist yet
      await expect(fs.stat(resolved)).rejects.toThrow();
    });

    it('accepts creating a file in a new subdirectory (walks up to find existing ancestor)', async () => {
      const resolved = await assertPathInWorktree('new-dir/new-file.txt', wt);
      expect(resolved).toContain(path.join('new-dir', 'new-file.txt'));
    });

    it('accepts the worktree root itself for create-capable operations', async () => {
      const resolved = await assertPathInWorktree('.', wt);
      expect(resolved).toBe(await fs.realpath(wt));
    });

    it('handles trailing separators on worktree and candidate directories', async () => {
      const resolved = await assertPathInWorktree('sub', `${wt}${path.sep}`, { mustExist: true });

      expect(resolved).toBe(await fs.realpath(path.join(wt, 'sub')));
    });
  });

  describe('path escapes', () => {
    it('rejects absolute paths outside the worktree', async () => {
      await expect(
        assertPathInWorktree(path.join(outside, 'secret.txt'), wt, { mustExist: true }),
      ).rejects.toThrow(PathGuardError);
    });

    it('rejects ../ relative escapes', async () => {
      await expect(
        assertPathInWorktree('../outside/secret.txt', wt, { mustExist: false }),
      ).rejects.toThrow(PathGuardError);
    });

    it('rejects deeply nested ../../../ escapes', async () => {
      await expect(assertPathInWorktree('sub/../../../../etc/passwd', wt)).rejects.toThrow(
        PathGuardError,
      );
    });
  });

  describe('symlink TOCTOU', () => {
    it('rejects a symlink inside the worktree that points OUTSIDE', async () => {
      // This is the TOCTOU mitigation: the symlink was created AFTER
      // the worktree existed, so a check at tool-registration time
      // would miss it. We resolve realpath at access time.
      const linkPath = path.join(wt, 'escape-link.txt');
      await fs.symlink(path.join(outside, 'secret.txt'), linkPath);

      await expect(
        assertPathInWorktree('escape-link.txt', wt, { mustExist: true }),
      ).rejects.toThrow(PathGuardError);
    });

    it('rejects a symlinked directory that points outside', async () => {
      const linkPath = path.join(wt, 'outside-dir');
      await fs.symlink(outside, linkPath);

      await expect(
        assertPathInWorktree('outside-dir/secret.txt', wt, { mustExist: true }),
      ).rejects.toThrow(PathGuardError);
    });

    it('accepts a symlink that points to another path INSIDE the worktree', async () => {
      const target = path.join(wt, 'inside.txt');
      const linkPath = path.join(wt, 'alias.txt');
      await fs.symlink(target, linkPath);

      const resolved = await assertPathInWorktree('alias.txt', wt, { mustExist: true });
      // Resolved to the real target, which is still inside the worktree
      expect(resolved).toContain('inside.txt');
    });
  });

  describe('input validation', () => {
    it('throws if worktreePath is not absolute', async () => {
      await expect(assertPathInWorktree('foo.txt', 'relative-worktree')).rejects.toThrow(
        /absolute/,
      );
    });

    it('throws if worktreePath does not exist', async () => {
      await expect(assertPathInWorktree('foo.txt', '/nonexistent/worktree/path')).rejects.toThrow(
        PathGuardError,
      );
    });

    it('throws mustExist=true on a non-existent file', async () => {
      await expect(
        assertPathInWorktree('never-created.txt', wt, { mustExist: true }),
      ).rejects.toThrow(PathGuardError);
    });
  });
});
