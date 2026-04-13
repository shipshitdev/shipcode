import { describe, expect, it } from 'vitest';
import { getStatusBadgeVariant } from './status-variant';

describe('getStatusBadgeVariant', () => {
  it.each([
    ['completed', 'success'],
    ['failed', 'danger'],
    ['awaiting_approval', 'warning'],
    ['planning', 'accent'],
    ['reviewing', 'accent'],
    ['revising', 'accent'],
    ['executing', 'accent'],
    ['testing', 'accent'],
    ['verifying', 'accent'],
    ['shipping', 'accent'],
    ['todo', 'default'],
    ['queued', 'default'],
    ['idle', 'default'],
  ] as const)('maps %s to %s', (status, variant) => {
    expect(getStatusBadgeVariant(status)).toBe(variant);
  });
});
