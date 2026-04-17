import { describe, expect, it } from 'vitest';
import { getShortcut, matchesShortcut } from './shortcuts';

describe('shortcuts', () => {
  it('matches standard meta shortcuts case-insensitively', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'K',
      metaKey: true,
    });

    expect(matchesShortcut(event, { meta: true, key: 'k' })).toBe(true);
    expect(matchesShortcut(event, { meta: true, key: 'j' })).toBe(false);
  });

  it('matches option-composed alt glyphs for issue detail toggle', () => {
    const event = new KeyboardEvent('keydown', {
      key: '∫',
      metaKey: true,
      altKey: true,
    });

    expect(matchesShortcut(event, { meta: true, alt: true, key: 'b', altKey: '∫' })).toBe(true);
  });

  it('returns configured shortcuts and throws for unknown ids', () => {
    expect(getShortcut('toggle-terminal')).toMatchObject({
      label: 'Toggle Terminal',
      glyph: '⌘J',
    });

    expect(() => getShortcut('unknown-shortcut' as never)).toThrow('Unknown shortcut id');
  });
});
