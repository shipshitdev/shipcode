// Single source of truth for keyboard shortcuts.
//
// Consumed by:
//   - useGlobalKeyboard.ts (dispatches actions on keydown)
//   - CommandPalette.tsx   (renders glyph hints next to commands)
//   - SettingsPanel.tsx    (renders the Shortcuts reference page)
//
// If a new shortcut is added, wire it here first, then add an action mapping
// in useGlobalKeyboard.ts. Never hard-code a glyph string elsewhere.

export type ShortcutId =
  | 'command-palette'
  | 'toggle-terminal'
  | 'toggle-sidebar'
  | 'toggle-issue-detail'
  | 'instant-fix';

export type ShortcutCategory = 'Navigation' | 'Workspace';

export interface KeyCombo {
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  // Primary key (e.g. 'k', 'j', 'b'). Matched case-insensitively.
  key: string;
  // macOS produces composed glyphs when Option is held (e.g. Option+B → '∫').
  // If set, matchesShortcut accepts either `key` or `altKey` as a match.
  altKey?: string;
}

export interface ShortcutDef {
  id: ShortcutId;
  label: string;
  description: string;
  category: ShortcutCategory;
  // Human-readable glyph (⌘, ⌥, ⇧, ⌃). Displayed in UI.
  glyph: string;
  combo: KeyCombo;
}

export const SHORTCUTS: ShortcutDef[] = [
  {
    id: 'command-palette',
    label: 'Command Palette',
    description: 'Open the command palette',
    category: 'Navigation',
    glyph: '⌘K',
    combo: { meta: true, key: 'k' },
  },
  {
    id: 'toggle-sidebar',
    label: 'Toggle Sidebar',
    description: 'Show or hide the project sidebar',
    category: 'Workspace',
    glyph: '⌘B',
    combo: { meta: true, key: 'b' },
  },
  {
    id: 'toggle-issue-detail',
    label: 'Toggle Issue Detail',
    description: 'Show or hide the issue detail panel on the right',
    category: 'Workspace',
    glyph: '⌥⌘B',
    combo: { meta: true, alt: true, key: 'b', altKey: '∫' },
  },
  {
    id: 'toggle-terminal',
    label: 'Toggle Terminal',
    description: 'Show or hide the terminal drawer at the bottom',
    category: 'Workspace',
    glyph: '⌘J',
    combo: { meta: true, key: 'j' },
  },
  {
    id: 'instant-fix',
    label: 'Instant Fix',
    description: 'Open the instant fix modal for a quick CLI run',
    category: 'Navigation',
    glyph: '⇧⌘I',
    combo: { meta: true, shift: true, key: 'i' },
  },
];

export function matchesShortcut(event: KeyboardEvent, combo: KeyCombo): boolean {
  if (Boolean(combo.meta) !== event.metaKey) return false;
  if (Boolean(combo.alt) !== event.altKey) return false;
  if (Boolean(combo.shift) !== event.shiftKey) return false;
  if (Boolean(combo.ctrl) !== event.ctrlKey) return false;
  const pressed = event.key.toLowerCase();
  if (pressed === combo.key.toLowerCase()) return true;
  if (combo.altKey && event.key === combo.altKey) return true;
  return false;
}

export function getShortcut(id: ShortcutId): ShortcutDef {
  const found = SHORTCUTS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown shortcut id: ${id}`);
  return found;
}
