import { useCallback, useState } from 'react';
import { useAppStore } from '../stores/app-store';

export function useOpenProjectTerminal() {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const [openingTerminal, setOpeningTerminal] = useState(false);

  const openProjectTerminal = useCallback(async () => {
    if (!activeProjectId) {
      throw new Error('Select a project before opening a terminal');
    }

    setOpeningTerminal(true);
    try {
      await window.shipcode.invoke('project:open-path', {
        projectId: activeProjectId,
        target: 'default-terminal',
      });
    } finally {
      setOpeningTerminal(false);
    }
  }, [activeProjectId]);

  return { openProjectTerminal, openingTerminal };
}
