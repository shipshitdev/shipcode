import { useEffect } from 'react';
import { useAppStore } from '../stores/app-store';

export function useGlobalKeyboard() {
  const toggleCommandPalette = useAppStore((s) => s.toggleCommandPalette);
  const toggleTerminal = useAppStore((s) => s.toggleTerminal);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleIssueDetail = useAppStore((s) => s.toggleIssueDetail);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      // cmd+k — command palette
      if (!e.altKey && !e.shiftKey && e.key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }
      // cmd+j — terminal drawer
      if (!e.altKey && !e.shiftKey && e.key === 'j') {
        e.preventDefault();
        toggleTerminal();
        return;
      }
      // cmd+b — project sidebar
      if (!e.altKey && !e.shiftKey && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      // cmd+alt+b — issue detail panel (VS Code "secondary sidebar" convention)
      if (e.altKey && !e.shiftKey && (e.key === 'b' || e.key === '∫')) {
        e.preventDefault();
        toggleIssueDetail();
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleCommandPalette, toggleTerminal, toggleSidebar, toggleIssueDetail]);
}
