import { describe, expect, it } from 'vitest';
import { truncate } from './truncate';

describe('truncate', () => {
  it.each([
    { value: 'short', maxLength: 5, suffix: undefined, expected: 'short' },
    { value: 'exact', maxLength: 5, suffix: undefined, expected: 'exact' },
    { value: 'overlong', maxLength: 5, suffix: undefined, expected: 'over…' },
    { value: 'overlong', maxLength: 6, suffix: '...', expected: 'ove...' },
    { value: 'overlong', maxLength: 2, suffix: '...', expected: '..' },
    { value: 'overlong', maxLength: 0, suffix: undefined, expected: '' },
  ])('truncates $value to at most $maxLength characters', (testCase) => {
    const result = truncate(testCase.value, testCase.maxLength, testCase.suffix);

    expect(result).toBe(testCase.expected);
    expect(result.length).toBeLessThanOrEqual(testCase.maxLength);
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid maximum length %s', (maxLength) => {
    expect(() => truncate('value', maxLength)).toThrow(RangeError);
  });
});
