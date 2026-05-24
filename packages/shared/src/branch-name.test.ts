import { describe, expect, it } from 'vitest';
import { DEFAULT_BRANCH_FORMAT, formatIssueBranch, slugifyIssueTitle } from './branch-name';

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
      'ship/80-copy-branch-name-action',
    );
  });

  it('honors a custom branchFormat with {id} and {slug} tokens', () => {
    expect(formatIssueBranch(42, 'Add foo bar', 'feat/{id}-{slug}')).toBe('feat/42-add-foo-bar');
  });

  it('strips a trailing dash when the slug is empty', () => {
    expect(formatIssueBranch(7, '!!!')).toBe('ship/7');
  });

  it('treats null and empty-string formats as the default', () => {
    expect(formatIssueBranch(1, 'X', null)).toBe(formatIssueBranch(1, 'X'));
    expect(formatIssueBranch(1, 'X', '')).toBe(formatIssueBranch(1, 'X'));
  });

  it('exports the default template constant', () => {
    expect(DEFAULT_BRANCH_FORMAT).toBe('ship/{id}-{slug}');
  });
});
