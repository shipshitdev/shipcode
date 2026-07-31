import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
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
});
