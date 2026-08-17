import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRANCH_FORMAT,
  formatIssueBranch,
  isShipCodeBranch,
  SHIPCODE_BRANCH_PREFIX,
  slugifyIssueTitle,
} from './branch-name';

describe('slugifyIssueTitle', () => {
  it('lowercases, replaces non-alphanumerics with dashes, trims edges', () => {
    expect(slugifyIssueTitle('Add Linear Integration!')).toBe('add-linear-integration');
  });

  it('clamps to 48 chars', () => {
    const long = 'a'.repeat(80);
    expect(slugifyIssueTitle(long)).toHaveLength(48);
  });

  it('returns empty string when input has no alphanumerics', () => {
    expect(slugifyIssueTitle('!!!---!!!')).toBe('');
  });
});

describe('formatIssueBranch', () => {
  it('uses default format when none supplied', () => {
    expect(formatIssueBranch(80, 'Copy branch name action')).toBe(
      'shipcode/80-copy-branch-name-action',
    );
  });

  it('honors a custom branchFormat with {id} and {slug} tokens', () => {
    expect(formatIssueBranch(42, 'Add foo bar', 'feat/{id}-{slug}')).toBe('feat/42-add-foo-bar');
  });

  it('strips a trailing dash when the slug is empty', () => {
    expect(formatIssueBranch(7, '!!!')).toBe('shipcode/7');
  });

  it('treats null and empty-string formats as the default', () => {
    expect(formatIssueBranch(1, 'X', null)).toBe(formatIssueBranch(1, 'X'));
    expect(formatIssueBranch(1, 'X', '')).toBe(formatIssueBranch(1, 'X'));
  });

  it('exports the default template constant', () => {
    expect(DEFAULT_BRANCH_FORMAT).toBe('shipcode/{id}-{slug}');
    expect(SHIPCODE_BRANCH_PREFIX).toBe('shipcode/');
  });
});

describe('isShipCodeBranch', () => {
  it('matches the shipcode/ prefix for issue and non-issue worktrees', () => {
    expect(isShipCodeBranch('shipcode/x')).toBe(true);
    expect(isShipCodeBranch('shipcode/42-add-keyboard-shortcut')).toBe(true);
    expect(isShipCodeBranch('shipcode/thread-1')).toBe(true);
  });

  it('still matches legacy ship/{id} issue branches', () => {
    expect(isShipCodeBranch('ship/12-x')).toBe(true);
    expect(isShipCodeBranch('ship/7')).toBe(true);
  });

  it('rejects lookalike and user branches', () => {
    expect(isShipCodeBranch('shipyard/x')).toBe(false);
    expect(isShipCodeBranch('ship/abc')).toBe(false);
    expect(isShipCodeBranch('main')).toBe(false);
    expect(isShipCodeBranch('feat/42-api-hardening')).toBe(false);
    expect(isShipCodeBranch('')).toBe(false);
  });

  it('anchors at the start so nested names do not match', () => {
    expect(isShipCodeBranch('user/shipcode/x')).toBe(false);
    expect(isShipCodeBranch('release/ship/12-x')).toBe(false);
  });
});
