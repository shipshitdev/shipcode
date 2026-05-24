import { describe, expect, it } from 'vitest';
import { isRealGithubIssueNumber, stripIssueTitlePriorityPrefix } from './github-issue-utils';

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

describe('stripIssueTitlePriorityPrefix', () => {
  it('removes leading priority tokens without touching normal titles', () => {
    expect(stripIssueTitlePriorityPrefix('P3: ShipCode cloud test runner')).toBe(
      'ShipCode cloud test runner',
    );
    expect(stripIssueTitlePriorityPrefix('[P1] Fix approval routing')).toBe('Fix approval routing');
    expect(stripIssueTitlePriorityPrefix('P2 - Add board sync')).toBe('Add board sync');
    expect(stripIssueTitlePriorityPrefix('Ship P3 metadata')).toBe('Ship P3 metadata');
  });
});
