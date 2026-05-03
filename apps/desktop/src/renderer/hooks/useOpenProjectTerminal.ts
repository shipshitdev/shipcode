import { useCallback, useState } from 'react';
import { useAppStore } from '../stores/app-store';

export function useOpenProjectTerminal() {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const addInstantPane = useAppStore((state) => state.addInstantPane);
  const openTerminalSessions = useAppStore((state) => state.openTerminalSessions);
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
      addInstantPane(threadId, { mode: 'live', title: 'Terminal', cli: 'shell' });
      openTerminalSessions();
    } finally {
      setOpeningTerminal(false);
    }
  }, [activeProjectId, addInstantPane, openTerminalSessions]);

  return { openProjectTerminal, openingTerminal };
}
