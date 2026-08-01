import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SimpleGit } from 'simple-git';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertRegisteredWorktree,
  assertSafeWorktreeBranch,
  assertWorktreeCreateTarget,
  parseRegisteredWorktrees,
} from './worktree-safety';

describe('worktree safety', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('parses exact registered path and branch pairs', () => {
    expect(
      parseRegisteredWorktrees(`worktree /repo/project
HEAD abc123
branch refs/heads/main

worktree /safe/worktree
HEAD def456
branch refs/heads/ship/42
`),
    ).toEqual([
      { path: '/repo/project', branch: 'main' },
      { path: '/safe/worktree', branch: 'ship/42' },
    ]);
  });

  it('rejects traversal-shaped and option-shaped branch names', () => {
    expect(() => assertSafeWorktreeBranch('ship/42')).not.toThrow();
    expect(() => assertSafeWorktreeBranch('../escape')).toThrow(/safe Git ref/);
    expect(() => assertSafeWorktreeBranch('-force')).toThrow(/safe Git ref/);
  });

  it('rejects a create parent that resolves through an intermediate symlink', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'shipcode-create-symlink-'));
    tempRoots.push(root);
    const outside = path.join(root, 'outside');
    const configured = path.join(root, 'configured');
    mkdirSync(outside);
    symlinkSync(outside, configured, 'dir');

    expect(() =>
      assertWorktreeCreateTarget(
        path.join(configured, 'project'),
        path.join(configured, 'project', '42'),
      ),
    ).toThrow(/symlink/i);
    expect(() => assertWorktreeCreateTarget(outside, path.join(outside, '42'))).not.toThrow();
  });

  it('rejects an existing symlink ancestor above an existing real parent', () => {
    // The parent itself exists and lstats as a plain directory (readdir follows
    // the link), so only a full ancestor walk catches the escape.
    const root = mkdtempSync(path.join(os.tmpdir(), 'shipcode-create-ancestor-'));
    tempRoots.push(root);
    const outside = path.join(root, 'outside');
    const configured = path.join(root, 'configured');
    mkdirSync(path.join(outside, 'project'), { recursive: true });
    symlinkSync(outside, configured, 'dir');

    const parent = path.join(configured, 'project');
    expect(lstatSync(parent).isSymbolicLink()).toBe(false);
    expect(() => assertWorktreeCreateTarget(parent, path.join(parent, '42'))).toThrow(/symlink/i);
  });

  it('matches a registration spelled through an OS path alias root', async () => {
    // macOS registers `/private/var/…` while callers hold the `/var/…` spelling
    // of the same directory; both must resolve to the same registration.
    const root = mkdtempSync(path.join(os.tmpdir(), 'shipcode-alias-registration-'));
    tempRoots.push(root);
    const registeredPath = path.join(realpathSync.native(root), '42');
    const git = {
      raw: async () => `worktree ${registeredPath}\nHEAD abc123\nbranch refs/heads/ship/42\n`,
    } as unknown as SimpleGit;

    await expect(
      assertRegisteredWorktree({
        git,
        projectPath: root,
        worktreePath: path.join(root, '42'),
        branch: 'ship/42',
      }),
    ).resolves.toEqual({ path: registeredPath, branch: 'ship/42' });
  });
});
