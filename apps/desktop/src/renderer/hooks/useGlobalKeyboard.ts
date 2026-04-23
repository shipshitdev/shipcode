import { useEffect } from 'react';
import { getShortcut, matchesShortcut, SHORTCUTS, type ShortcutId } from '../data/shortcuts';
import { useAppStore } from '../stores/app-store';
import { type InstantShellCli, useStartInstantShell } from './useStartInstantShell';

export function useGlobalKeyboard() {
  const toggleCommandPalette = useAppStore((s) => s.toggleCommandPalette);
  const toggleTerminal = useAppStore((s) => s.toggleTerminal);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleIssueDetail = useAppStore((s) => s.toggleIssueDetail);
  const openCreateIssueModal = useAppStore((s) => s.openCreateIssueModal);
  const { startInstantShell } = useStartInstantShell();

  useEffect(() => {
    const startShell = (cli: InstantShellCli) => {
      void startInstantShell(cli).catch((error) => {
        window.alert(error instanceof Error ? error.message : `Failed to start ${cli} shell`);
      });
    };
    const actions: Record<ShortcutId, () => void> = {
      'command-palette': toggleCommandPalette,
      'toggle-terminal': toggleTerminal,
      'toggle-sidebar': toggleSidebar,
      'toggle-issue-detail': toggleIssueDetail,
      'new-claude-shell': () => startShell('claude'),
      'new-codex-shell': () => startShell('codex'),
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
    openCreateIssueModal,
    startInstantShell,
  ]);
}
