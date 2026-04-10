import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { expandWorktreeRoot, projectSlug, resolveWorktreeParent } from './worktree-path';
import { DEFAULT_WORKTREE_ROOT, WORKTREE_DIR } from './constants';

describe('expandWorktreeRoot', () => {
  it('returns default (~/.shipcode/worktrees) for null', () => {
    const expected = path.join(os.homedir(), DEFAULT_WORKTREE_ROOT.slice(2));
    expect(expandWorktreeRoot(null)).toBe(expected);
  });

  it('returns default for undefined', () => {
    const expected = path.join(os.homedir(), DEFAULT_WORKTREE_ROOT.slice(2));
    expect(expandWorktreeRoot(undefined)).toBe(expected);
  });

  it("returns 'project-local' sentinel for empty string", () => {
    expect(expandWorktreeRoot('')).toBe('project-local');
  });

  it('expands bare ~ to homedir', () => {
    expect(expandWorktreeRoot('~')).toBe(os.homedir());
  });

  it('expands ~/foo to <home>/foo', () => {
    expect(expandWorktreeRoot('~/foo')).toBe(path.join(os.homedir(), 'foo'));
  });

  it('expands ~/nested/path', () => {
    expect(expandWorktreeRoot('~/a/b/c')).toBe(path.join(os.homedir(), 'a/b/c'));
  });

  it('resolves absolute paths', () => {
    expect(expandWorktreeRoot('/tmp/shipcode')).toBe('/tmp/shipcode');
  });

  it('throws on ~user/… (tilde-user not supported)', () => {
    expect(() => expandWorktreeRoot('~alice/foo')).toThrow(/~user/);
  });

  it('throws on relative paths', () => {
    expect(() => expandWorktreeRoot('relative/path')).toThrow(/absolute or ~/);
  });

  it('throws on single dot / traversal-style relative paths', () => {
    expect(() => expandWorktreeRoot('./foo')).toThrow();
  });
});

describe('projectSlug', () => {
  it('is deterministic for the same path', () => {
    const a = projectSlug('/home/alice/projects/shipcode');
    const b = projectSlug('/home/alice/projects/shipcode');
    expect(a).toBe(b);
  });

  it('disambiguates two projects with the same basename', () => {
    const a = projectSlug('/home/alice/a/shipcode');
    const b = projectSlug('/home/alice/b/shipcode');
    expect(a).not.toBe(b);
    // But the basename prefix is identical
    expect(a.startsWith('shipcode-')).toBe(true);
    expect(b.startsWith('shipcode-')).toBe(true);
  });

  it('sanitizes non-alphanumeric characters in basename', () => {
    const slug = projectSlug('/home/alice/my project (v2)');
    // Spaces and parens replaced with dashes; hash appended
    expect(slug).toMatch(/^my-project--v2--[0-9a-f]{6}$/);
  });

  it('truncates very long basenames', () => {
    const long = 'a'.repeat(200);
    const slug = projectSlug(`/home/alice/${long}`);
    const [base] = slug.split(/-[0-9a-f]{6}$/);
    expect(base!.length).toBeLessThanOrEqual(48);
  });
});

describe('resolveWorktreeParent', () => {
  it('returns <project>/.shipcode/worktrees for empty-string worktreeRoot', () => {
    expect(resolveWorktreeParent('/tmp/my-proj', '')).toBe(path.join('/tmp/my-proj', WORKTREE_DIR));
  });

  it('returns <home>/.shipcode/worktrees/<slug> for null worktreeRoot', () => {
    const got = resolveWorktreeParent('/tmp/my-proj', null);
    expect(got.startsWith(path.join(os.homedir(), DEFAULT_WORKTREE_ROOT.slice(2)))).toBe(true);
    expect(path.basename(got)).toBe(projectSlug('/tmp/my-proj'));
  });

  it('returns <absolute>/<slug> for a custom absolute worktreeRoot', () => {
    const got = resolveWorktreeParent('/tmp/my-proj', '/mnt/fast/wt');
    expect(got).toBe(path.join('/mnt/fast/wt', projectSlug('/tmp/my-proj')));
  });

  it('propagates expandWorktreeRoot validation errors', () => {
    expect(() => resolveWorktreeParent('/tmp/my-proj', 'relative/path')).toThrow();
  });
});
