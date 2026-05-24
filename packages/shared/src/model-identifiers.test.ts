import { describe, expect, it } from 'vitest';
import { isSyntheticResolvedModel, sanitizeResolvedModel } from './model-identifiers';

describe('model-identifiers', () => {
  it('treats <synthetic> as a placeholder resolved model', () => {
    expect(isSyntheticResolvedModel('<synthetic>')).toBe(true);
    expect(isSyntheticResolvedModel(' <synthetic> ')).toBe(true);
    expect(isSyntheticResolvedModel('claude-sonnet-4-6')).toBe(false);
  });

  it('sanitizes placeholder resolved models to null', () => {
    expect(sanitizeResolvedModel('<synthetic>')).toBeNull();
    expect(sanitizeResolvedModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(sanitizeResolvedModel(null)).toBeNull();
  });
});
