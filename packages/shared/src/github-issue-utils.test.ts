import { describe, expect, it } from 'vitest';
import { isRealGithubIssueNumber } from './github-issue-utils';

describe('isRealGithubIssueNumber', () => {
  it('returns true for positive integers', () => {
    expect(isRealGithubIssueNumber(1)).toBe(true);
    expect(isRealGithubIssueNumber(42)).toBe(true);
    expect(isRealGithubIssueNumber(99999)).toBe(true);
  });

  it('returns false for zero, negatives, null, undefined, NaN, Infinity', () => {
    expect(isRealGithubIssueNumber(0)).toBe(false);
    expect(isRealGithubIssueNumber(-1)).toBe(false);
    expect(isRealGithubIssueNumber(-99)).toBe(false);
    expect(isRealGithubIssueNumber(null)).toBe(false);
    expect(isRealGithubIssueNumber(undefined)).toBe(false);
    expect(isRealGithubIssueNumber(Number.NaN)).toBe(false);
    expect(isRealGithubIssueNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isRealGithubIssueNumber(Number.NEGATIVE_INFINITY)).toBe(false);
  });
});
