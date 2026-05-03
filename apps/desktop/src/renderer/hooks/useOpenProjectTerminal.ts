import { useCallback, useState } from 'react';
import { useAppStore } from '../stores/app-store';

export function useOpenProjectTerminal() {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const addTerminalPane = useAppStore((state) => state.addTerminalPane);
  const openTerminalTab = useAppStore((state) => state.openTerminalTab);
  const [openingTerminal, setOpeningTerminal] = useState(false);

  const openProjectTerminal = useCallback(async () => {
    if (!activeProjectId) {
      throw new Error('Select a project before opening a terminal');
    }

    setOpeningTerminal(true);
    try {
      const { threadId } = await window.shipcode.invoke('instant:bare-shell', {
        projectId: activeProjectId,
      });
      addTerminalPane(threadId, { mode: 'live', title: 'Terminal', cli: 'shell' });
      openTerminalTab();
    } finally {
      setOpeningTerminal(false);
    }
  }, [activeProjectId, addTerminalPane, openTerminalTab]);

  return { openProjectTerminal, openingTerminal };
}
