import { useEffect } from 'react';
import { matchesShortcut, SHORTCUTS, type ShortcutId } from '../data/shortcuts';
import { useAppStore } from '../stores/app-store';

export function useGlobalKeyboard() {
  const toggleCommandPalette = useAppStore((s) => s.toggleCommandPalette);
  const toggleTerminal = useAppStore((s) => s.toggleTerminal);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleIssueDetail = useAppStore((s) => s.toggleIssueDetail);

  useEffect(() => {
    const actions: Record<ShortcutId, () => void> = {
      'command-palette': toggleCommandPalette,
      'toggle-terminal': toggleTerminal,
      'toggle-sidebar': toggleSidebar,
      'toggle-issue-detail': toggleIssueDetail,
    };

    const handler = (e: KeyboardEvent) => {
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
  }, [toggleCommandPalette, toggleTerminal, toggleSidebar, toggleIssueDetail]);
}
