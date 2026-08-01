import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORKTREE_ROOT, WORKTREE_DIR } from './constants';
import {
  assertWorkspaceSafe,
  expandWorktreeRoot,
  projectSlug,
  resolveWorktreeParent,
} from './worktree-path';

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
    expect(base?.length).toBeLessThanOrEqual(48);
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

describe('assertWorkspaceSafe', () => {
  const tempRoots: string[] = [];

  function createRepository(name: string): { projectPath: string; worktreePath: string } {
    const root = mkdtempSync(path.join(os.tmpdir(), `shipcode-${name}-`));
    tempRoots.push(root);
    const projectPath = path.join(root, 'project');
    const worktreePath = path.join(root, 'worktree');
    mkdirSync(projectPath);
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: projectPath });
    execFileSync('git', ['config', 'user.email', 'shipcode@example.test'], { cwd: projectPath });
    execFileSync('git', ['config', 'user.name', 'ShipCode Tests'], { cwd: projectPath });
    writeFileSync(path.join(projectPath, 'README.md'), `${name}\n`);
    execFileSync('git', ['add', 'README.md'], { cwd: projectPath });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: projectPath });
    execFileSync('git', ['worktree', 'add', '-b', `shipcode/${name}`, worktreePath], {
      cwd: projectPath,
    });
    return { projectPath, worktreePath };
  }

  afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('passes for a worktree under the configured root', () => {
    expect(() =>
      assertWorkspaceSafe({
        workspacePath: '/tmp/wt/shipcode-abc123/t-01',
        workspaceRoot: '/tmp/wt',
      }),
    ).not.toThrow();
  });

  it('throws when path escapes the root via traversal', () => {
    expect(() =>
      assertWorkspaceSafe({
        workspacePath: '/tmp/wt/../etc/passwd',
        workspaceRoot: '/tmp/wt',
      }),
    ).toThrow(/traversal|non-canonical/i);
  });

  it('throws when resolved path is outside the root', () => {
    expect(() =>
      assertWorkspaceSafe({
        workspacePath: '/etc/shadow',
        workspaceRoot: '/tmp/wt',
      }),
    ).toThrow(/under workspaceRoot/);
  });

  it('throws when the basename has shell metacharacters', () => {
    expect(() =>
      assertWorkspaceSafe({
        workspacePath: '/tmp/wt/$(rm -rf)',
        workspaceRoot: '/tmp/wt',
      }),
    ).toThrow(/basename must match/);
  });

  it('throws on relative workspacePath', () => {
    expect(() =>
      assertWorkspaceSafe({
        workspacePath: 'relative/dir',
        workspaceRoot: '/tmp/wt',
      }),
    ).toThrow(/absolute/);
  });

  it('skips prefix check in project-local mode but enforces basename', () => {
    expect(() =>
      assertWorkspaceSafe({
        workspacePath: '/anywhere/proj/.shipcode/worktrees/t-01',
        workspaceRoot: '',
      }),
    ).not.toThrow();
    expect(() =>
      assertWorkspaceSafe({
        workspacePath: '/anywhere/proj/.shipcode/worktrees/$(bad)',
        workspaceRoot: '',
      }),
    ).toThrow(/basename/);
  });

  it('expands ~ in workspaceRoot', () => {
    const home = os.homedir();
    expect(() =>
      assertWorkspaceSafe({
        workspacePath: path.join(home, 'wt/proj/t-01'),
        workspaceRoot: '~/wt',
      }),
    ).not.toThrow();
  });

  it('uses default root when workspaceRoot is null', () => {
    const home = os.homedir();
    expect(() =>
      assertWorkspaceSafe({
        workspacePath: path.join(home, '.shipcode/worktrees/proj/t-01'),
        workspaceRoot: null,
      }),
    ).not.toThrow();
    expect(() =>
      assertWorkspaceSafe({
        workspacePath: '/tmp/elsewhere/t-01',
        workspaceRoot: null,
      }),
    ).toThrow(/under workspaceRoot/);
  });

  it('accepts an exact linked-worktree registration after the configured root changes', () => {
    const { projectPath, worktreePath } = createRepository('valid-worktree');

    expect(() =>
      assertWorkspaceSafe({
        workspacePath: worktreePath,
        workspaceRoot: '/a/different/root',
        projectPath,
      }),
    ).not.toThrow();
  });

  it('accepts a worktree under an OS-aliased temp root spelled either way', () => {
    // macOS resolves os.tmpdir() through /var -> /private/var, so the caller's
    // lexical path and Git's persisted canonical path differ. Both must pass.
    const { projectPath, worktreePath } = createRepository('alias-root');
    const realWorktreePath = realpathSync.native(worktreePath);

    for (const candidate of new Set([worktreePath, realWorktreePath])) {
      expect(() =>
        assertWorkspaceSafe({
          workspacePath: candidate,
          workspaceRoot: path.dirname(candidate),
          projectPath,
        }),
      ).not.toThrow();
    }
  });

  it('rejects a worktree reached through a user-created symlinked parent', () => {
    // Canonicalization alone would accept this: the link resolves to the real
    // registered worktree. Only the ancestor walk catches the redirect.
    const { projectPath, worktreePath } = createRepository('symlinked-parent');
    const realRoot = path.dirname(worktreePath);
    const linkedRoot = path.join(realRoot, 'linked-root');
    symlinkSync(realRoot, linkedRoot, 'dir');

    expect(() =>
      assertWorkspaceSafe({
        workspacePath: path.join(linkedRoot, path.basename(worktreePath)),
        workspaceRoot: linkedRoot,
        projectPath,
      }),
    ).toThrow(/must not resolve through symlinks/i);
  });

  it('rejects a symlink alias that does not match the Git-registered path', () => {
    const { projectPath, worktreePath } = createRepository('symlink-escape');
    const aliasPath = path.join(path.dirname(worktreePath), 'worktree-alias');
    symlinkSync(worktreePath, aliasPath, 'dir');

    expect(() =>
      assertWorkspaceSafe({
        workspacePath: aliasPath,
        workspaceRoot: path.dirname(aliasPath),
        projectPath,
      }),
    ).toThrow(/symlink|registered path/i);
  });

  it('rejects a linked worktree belonging to a foreign repository', () => {
    const trusted = createRepository('trusted-repository');
    const foreign = createRepository('foreign-repository');

    expect(() =>
      assertWorkspaceSafe({
        workspacePath: foreign.worktreePath,
        workspaceRoot: path.dirname(foreign.worktreePath),
        projectPath: trusted.projectPath,
      }),
    ).toThrow(/foreign Git repository/i);
  });

  it('rejects crafted Git metadata outside the trusted worktree registry', () => {
    const trusted = createRepository('trusted-registry');
    const root = path.dirname(trusted.projectPath);
    const fakeWorkspace = path.join(root, 'fake-workspace');
    const fakeAdmin = path.join(root, 'fake-admin');
    mkdirSync(fakeWorkspace);
    mkdirSync(fakeAdmin);
    writeFileSync(path.join(fakeWorkspace, '.git'), `gitdir: ${fakeAdmin}\n`);
    writeFileSync(path.join(fakeAdmin, 'commondir'), `${path.join(trusted.projectPath, '.git')}\n`);
    writeFileSync(path.join(fakeAdmin, 'gitdir'), `${path.join(fakeWorkspace, '.git')}\n`);
    writeFileSync(path.join(fakeAdmin, 'HEAD'), 'ref: refs/heads/shipcode/fake\n');

    expect(() =>
      assertWorkspaceSafe({
        workspacePath: fakeWorkspace,
        workspaceRoot: root,
        projectPath: trusted.projectPath,
      }),
    ).toThrow(/admin directory is not registered/i);
  });
});
