import { useEffect } from 'react';
import { getShortcut, matchesShortcut, SHORTCUTS, type ShortcutId } from '../data/shortcuts';
import { useAppStore } from '../stores/app-store';

export function useGlobalKeyboard() {
  const toggleCommandPalette = useAppStore((s) => s.toggleCommandPalette);
  const toggleTerminal = useAppStore((s) => s.toggleTerminal);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleIssueDetail = useAppStore((s) => s.toggleIssueDetail);
  const openInstantFixModal = useAppStore((s) => s.openInstantFixModal);
  const openCreateIssueModal = useAppStore((s) => s.openCreateIssueModal);

  useEffect(() => {
    const actions: Record<ShortcutId, () => void> = {
      'command-palette': toggleCommandPalette,
      'toggle-terminal': toggleTerminal,
      'toggle-sidebar': toggleSidebar,
      'toggle-issue-detail': toggleIssueDetail,
      'instant-fix': openInstantFixModal,
      'new-issue': openCreateIssueModal,
    };

    const handler = (e: KeyboardEvent) => {
      // Suppress shortcuts when typing in input fields, except ⌘K (command palette)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        const paletteCombo = getShortcut('command-palette').combo;
        if (!matchesShortcut(e, paletteCombo)) return;
      }

      for (const shortcut of SHORTCUTS) {
        if (matchesShortcut(e, shortcut.combo)) {
          e.preventDefault();
          actions[shortcut.id]();
          return;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    toggleCommandPalette,
    toggleTerminal,
    toggleSidebar,
    toggleIssueDetail,
    openInstantFixModal,
    openCreateIssueModal,
  ]);
}
