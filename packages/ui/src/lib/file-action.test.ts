import { describe, expect, it } from 'vitest';
import {
  diffActionVariant,
  fileActionColor,
  fileActionIcon,
  planFileActionVariant,
  sideBySideFileActionColor,
  sideBySideFileActionIcon,
} from './file-action';

describe('file action display helpers', () => {
  it('maps known diff actions to variants, colors, and icons', () => {
    expect(diffActionVariant('create')).toBe('success');
    expect(diffActionVariant('delete')).toBe('danger');
    expect(diffActionVariant('modify')).toBe('warning');

    expect(fileActionColor('create')).toBe('text-success');
    expect(fileActionColor('delete')).toBe('text-danger');
    expect(fileActionColor('modify')).toBe('text-warning');

    expect(fileActionIcon('create')).toBe('+');
    expect(fileActionIcon('delete')).toBe('-');
    expect(fileActionIcon('modify')).toBe('~');
  });

  it('uses default display values for unknown actions', () => {
    expect(diffActionVariant('copy')).toBe('default');
    expect(planFileActionVariant('copy')).toBe('default');
    expect(fileActionColor('copy')).toBe('text-secondary');
    expect(fileActionIcon('copy')).toBe('~');
    expect(sideBySideFileActionColor('copy')).toBe('text-secondary');
    expect(sideBySideFileActionIcon('copy')).toBe('~');
  });

  it('special-cases rename actions in plan and side-by-side views', () => {
    expect(planFileActionVariant('rename')).toBe('accent');
    expect(sideBySideFileActionColor('rename')).toBe('text-accent');
    expect(sideBySideFileActionIcon('rename')).toBe('→');
  });
});
