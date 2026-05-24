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

  it('rejects mismatched modifier keys before matching the shortcut key', () => {
    expect(
      matchesShortcut(new KeyboardEvent('keydown', { key: 'k' }), { meta: true, key: 'k' }),
    ).toBe(false);
    expect(
      matchesShortcut(new KeyboardEvent('keydown', { key: 'k', altKey: true }), { key: 'k' }),
    ).toBe(false);
    expect(
      matchesShortcut(new KeyboardEvent('keydown', { key: 'k', shiftKey: true }), { key: 'k' }),
    ).toBe(false);
    expect(
      matchesShortcut(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }), { key: 'k' }),
    ).toBe(false);
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
    expect(getShortcut('open-project-terminal')).toMatchObject({
      label: 'Open Terminal',
      glyph: '⇧⌘T',
    });

    expect(() => getShortcut('unknown-shortcut' as never)).toThrow('Unknown shortcut id');
  });

  it('registers every board-scoped shortcut for the help surface', () => {
    const boardShortcuts = [
      ['board-focus-next', 'Next Card', 'J', 'j'],
      ['board-focus-previous', 'Previous Card', 'K', 'k'],
      ['board-focus-left', 'Previous Column', 'H', 'h'],
      ['board-focus-right', 'Next Column', 'L', 'l'],
      ['board-open-focused', 'Open Focused Card', 'Enter', 'Enter'],
      ['board-start-focused', 'Start Focused Card', 'E', 'e'],
      ['board-comment-focused', 'Comment on Focused Card', 'C', 'c'],
    ] as const;

    expect(boardShortcuts.map(([id]) => getShortcut(id))).toEqual(
      boardShortcuts.map(([, label, glyph, key]) =>
        expect.objectContaining({
          label,
          category: 'Board',
          scope: 'board',
          glyph,
          combo: { key },
        }),
      ),
    );
  });
});
