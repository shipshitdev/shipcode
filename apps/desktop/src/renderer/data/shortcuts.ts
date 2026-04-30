// Single source of truth for keyboard shortcuts.
//
// Consumed by:
//   - useGlobalKeyboard.ts (dispatches actions on keydown)
//   - CommandPalette.tsx   (renders glyph hints next to commands)
//   - SettingsPanel.tsx    (renders the Shortcuts reference page)
//
// If a new global shortcut is added, wire it here first, then add an action
// mapping in useGlobalKeyboard.ts. Board-scoped shortcuts are dispatched by
// the board itself but still live here for the help surface.

export type ShortcutId =
  | 'command-palette'
  | 'toggle-terminal'
  | 'toggle-sidebar'
  | 'toggle-issue-detail'
  | 'open-project-terminal'
  | 'new-issue'
  | 'board-focus-next'
  | 'board-focus-previous'
  | 'board-focus-left'
  | 'board-focus-right'
  | 'board-open-focused'
  | 'board-start-focused'
  | 'board-comment-focused';

export type ShortcutCategory = 'Navigation' | 'Workspace' | 'Board';
export type ShortcutScope = 'global' | 'board';

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
  scope?: ShortcutScope;
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
    id: 'open-project-terminal',
    label: 'Open Terminal',
    description: 'Open the configured terminal in the current project',
    category: 'Navigation',
    glyph: '⇧⌘T',
    combo: { meta: true, shift: true, key: 't' },
  },
  {
    id: 'new-issue',
    label: 'New Issue',
    description: 'Create a new GitHub issue / PRD',
    category: 'Navigation',
    glyph: '⌘N',
    combo: { meta: true, key: 'n' },
  },
  {
    id: 'board-focus-next',
    label: 'Next Card',
    description: 'Move focus down in the current kanban column',
    category: 'Board',
    scope: 'board',
    glyph: 'J',
    combo: { key: 'j' },
  },
  {
    id: 'board-focus-previous',
    label: 'Previous Card',
    description: 'Move focus up in the current kanban column',
    category: 'Board',
    scope: 'board',
    glyph: 'K',
    combo: { key: 'k' },
  },
  {
    id: 'board-focus-left',
    label: 'Previous Column',
    description: 'Move focus to the prior kanban column',
    category: 'Board',
    scope: 'board',
    glyph: 'H',
    combo: { key: 'h' },
  },
  {
    id: 'board-focus-right',
    label: 'Next Column',
    description: 'Move focus to the next kanban column',
    category: 'Board',
    scope: 'board',
    glyph: 'L',
    combo: { key: 'l' },
  },
  {
    id: 'board-open-focused',
    label: 'Open Focused Card',
    description: 'Open the focused kanban card',
    category: 'Board',
    scope: 'board',
    glyph: 'Enter',
    combo: { key: 'Enter' },
  },
  {
    id: 'board-start-focused',
    label: 'Start Focused Card',
    description: 'Start the focused kanban card when it is eligible',
    category: 'Board',
    scope: 'board',
    glyph: 'E',
    combo: { key: 'e' },
  },
  {
    id: 'board-comment-focused',
    label: 'Comment on Focused Card',
    description: 'Open comments for the focused kanban card',
    category: 'Board',
    scope: 'board',
    glyph: 'C',
    combo: { key: 'c' },
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
