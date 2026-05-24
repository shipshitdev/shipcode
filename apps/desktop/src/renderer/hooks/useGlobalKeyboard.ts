import { useEffect } from 'react';
import { getShortcut, matchesShortcut, SHORTCUTS, type ShortcutId } from '../data/shortcuts';
import { useAppStore } from '../stores/app-store';
import { toast } from '../stores/toast-store';
import { useOpenProjectTerminal } from './useOpenProjectTerminal';

export function useGlobalKeyboard() {
  const toggleCommandPalette = useAppStore((s) => s.toggleCommandPalette);
  const toggleTerminal = useAppStore((s) => s.toggleTerminal);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const hasDetailView = useAppStore(
    (s) => s.activeIssue !== null || s.activeAutomationThreadId !== null,
  );
  const selectIssue = useAppStore((s) => s.selectIssue);
  const openCreateIssueModal = useAppStore((s) => s.openCreateIssueModal);
  const { openProjectTerminal } = useOpenProjectTerminal();

  useEffect(() => {
    const openTerminal = () => {
      void openProjectTerminal().catch((error) => {
        toast.error('Failed to open terminal', error instanceof Error ? error.message : undefined);
      });
    };
    const actions: Partial<Record<ShortcutId, () => void>> = {
      'command-palette': toggleCommandPalette,
      'toggle-terminal': toggleTerminal,
      'toggle-sidebar': hasDetailView ? () => {} : toggleSidebar,
      'toggle-issue-detail': () => selectIssue(null),
      'open-project-terminal': openTerminal,
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
        if (shortcut.scope === 'board') continue;
        if (matchesShortcut(e, shortcut.combo)) {
          e.preventDefault();
          actions[shortcut.id]?.();
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
    hasDetailView,
    selectIssue,
    openCreateIssueModal,
    openProjectTerminal,
  ]);
}
