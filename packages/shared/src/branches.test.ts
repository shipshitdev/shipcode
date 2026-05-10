import { describe, expect, it } from 'vitest';
import { normalizeBranches } from './branches';

describe('normalizeBranches', () => {
  it('1. empty list returns empty output', () => {
    expect(normalizeBranches({ raw: [], defaultBranch: 'main' })).toEqual([]);
  });

  it('2. only local main', () => {
    expect(normalizeBranches({ raw: ['main'], defaultBranch: 'main' })).toEqual(['main']);
  });

  it('3. pins project default before common fallbacks', () => {
    expect(
      normalizeBranches({
        raw: ['main', 'develop', 'feat/x'],
        defaultBranch: 'develop',
      }),
    ).toEqual(['develop', 'main', 'feat/x']);
  });

  it('4. local dedupes matching remote, remote-only keeps prefix', () => {
    expect(
      normalizeBranches({
        raw: ['main', 'remotes/origin/main', 'remotes/origin/foo'],
        defaultBranch: 'main',
      }),
    ).toEqual(['main', 'origin/foo']);
  });

  it('5. HEAD pointer entries are filtered out', () => {
    expect(
      normalizeBranches({
        raw: ['remotes/origin/HEAD -> origin/main', 'main'],
        defaultBranch: 'main',
      }),
    ).toEqual(['main']);
  });

  it('6. shipcode/* local branches are filtered', () => {
    expect(
      normalizeBranches({
        raw: ['shipcode/abc123', 'main'],
        defaultBranch: 'main',
      }),
    ).toEqual(['main']);
  });

  it('7. multi-remote distinct branches both preserved with prefix', () => {
    expect(
      normalizeBranches({
        raw: ['remotes/upstream/bar', 'remotes/origin/bar'],
        defaultBranch: 'main',
      }),
    ).toEqual(['origin/bar', 'upstream/bar']);
  });

  it('8. shipcode/* filtered when other locals exist', () => {
    expect(
      normalizeBranches({
        raw: ['main', 'shipcode/t1'],
        defaultBranch: 'main',
      }),
    ).toEqual(['main']);
  });

  it('9. trunk as default is pinned first', () => {
    expect(
      normalizeBranches({
        raw: ['trunk', 'main'],
        defaultBranch: 'trunk',
      }),
    ).toEqual(['trunk', 'main']);
  });

  it('10. multi-remote + common sort + alphabetical rest', () => {
    expect(
      normalizeBranches({
        raw: ['develop', 'main', 'master', 'z-branch', 'a-branch', 'remotes/origin/legacy'],
        defaultBranch: 'main',
      }),
    ).toEqual(['main', 'master', 'develop', 'a-branch', 'z-branch', 'origin/legacy']);
  });

  it('11. detached HEAD marker is filtered out', () => {
    expect(
      normalizeBranches({
        raw: ['(HEAD detached at 9a73b4c)', 'main', 'feat/x'],
        defaultBranch: 'main',
      }),
    ).toEqual(['main', 'feat/x']);
  });

  it('12. remote-only default branch is pinned first; shipcode/* filtered from remote branchPart', () => {
    expect(
      normalizeBranches({
        raw: ['remotes/origin/trunk', 'feat/x'],
        defaultBranch: 'origin/trunk',
      }),
    ).toEqual(['origin/trunk', 'feat/x']);

    expect(
      normalizeBranches({
        raw: ['remotes/origin/shipcode/t1', 'main'],
        defaultBranch: 'main',
      }),
    ).toEqual(['main']);
  });

  it('13. ship/{N}-slug branches are filtered (ShipCode worktree branches)', () => {
    expect(
      normalizeBranches({
        raw: ['main', 'ship/42-add-keyboard-shortcut', 'ship/7-fix-bug'],
        defaultBranch: 'main',
      }),
    ).toEqual(['main']);
  });

  it('14. feat/something is NOT filtered (user branches)', () => {
    expect(
      normalizeBranches({
        raw: ['main', 'feat/my-feature', 'feat/42-api-hardening'],
        defaultBranch: 'main',
      }),
    ).toEqual(['main', 'feat/42-api-hardening', 'feat/my-feature']);
  });

  it('15. remote ship/{N}-slug branches are also filtered', () => {
    expect(
      normalizeBranches({
        raw: ['main', 'remotes/origin/ship/42-add-shortcut'],
        defaultBranch: 'main',
      }),
    ).toEqual(['main']);
  });

  it('16. filters empty, detached, remote HEAD, and malformed remote entries', () => {
    expect(
      normalizeBranches({
        raw: [
          '',
          '(no branch, rebasing main)',
          'remotes/origin/HEAD',
          'remotes/origin',
          'remotes/origin/feature',
          'main',
        ],
        defaultBranch: 'main',
      }),
    ).toEqual(['main', 'origin/feature']);
  });
});
