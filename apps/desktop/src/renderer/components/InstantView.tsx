import { PageHeader } from '@shipcode/ui';
import { Button, cn } from '@shipshitdev/ui';
import { Plus, Terminal } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useOpenProjectTerminal } from '../hooks/useOpenProjectTerminal';
import { type InstantPaneMode, useAppStore } from '../stores/app-store';
import { InstantTerminalPane } from './instant-terminal/InstantTerminalPane';

export function InstantView() {
  const instantPaneThreadIds = useAppStore((state) => state.instantPaneThreadIds);
  const instantSplitDirection = useAppStore((state) => state.instantSplitDirection);
  const instantPaneMetaByThread = useAppStore((state) => state.instantPaneMetaByThread);
  const removeInstantPane = useAppStore((state) => state.removeInstantPane);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const { openProjectTerminal, openingTerminal } = useOpenProjectTerminal();

  const handleOpenTerminal = useCallback(() => {
    void openProjectTerminal().catch((error) => {
      window.alert(error instanceof Error ? error.message : 'Failed to open terminal');
    });
  }, [openProjectTerminal]);

  const openTerminalButton = (
    <Button
      variant="ghost"
      size="icon"
      disabled={!activeProjectId || openingTerminal || instantPaneThreadIds.length >= 4}
      onClick={handleOpenTerminal}
      title="Open Terminal"
    >
      <div className="relative">
        <Terminal size={16} />
        <Plus size={10} className="absolute -right-1.5 -top-1.5 stroke-[3]" />
      </div>
    </Button>
  );

  const paneTitle = useCallback(
    (threadId: string) => {
      return instantPaneMetaByThread[threadId]?.title ?? threadId.slice(0, 8);
    },
    [instantPaneMetaByThread],
  );

  const handleCancel = useCallback((threadId: string) => {
    void window.shipcode.invoke('instant:cancel', { threadId });
  }, []);

  const handleClose = useCallback(
    (threadId: string, isRunning: boolean) => {
      const meta = instantPaneMetaByThread[threadId];
      if (meta?.mode === 'live' && isRunning) {
        void window.shipcode.invoke('instant:cancel', { threadId });
      }
      removeInstantPane(threadId);
    },
    [instantPaneMetaByThread, removeInstantPane],
  );

  const gridClass = useMemo(() => {
    const count = instantPaneThreadIds.length;
    if (count <= 1) return 'flex flex-col';
    if (count === 2) {
      return instantSplitDirection === 'horizontal' ? 'grid grid-cols-2' : 'grid grid-rows-2';
    }
    return 'grid grid-cols-2 grid-rows-2';
  }, [instantPaneThreadIds.length, instantSplitDirection]);

  if (instantPaneThreadIds.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted">
        <Terminal size={32} className="text-muted" />
        <p className="text-sm">No terminal sessions open</p>
        {openTerminalButton}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Terminal Sessions"
        subtitle="Terminal sessions for the active project."
        actions={openTerminalButton}
      />

      <div className={cn('flex-1 min-h-0 gap-1 p-1', gridClass)}>
        {instantPaneThreadIds.map((threadId) => (
          <InstantTerminalPane
            key={threadId}
            threadId={threadId}
            title={paneTitle(threadId)}
            mode={(instantPaneMetaByThread[threadId]?.mode ?? 'replay') as InstantPaneMode}
            paneState={instantPaneMetaByThread[threadId]?.state}
            isBareShell={instantPaneMetaByThread[threadId]?.cli === 'shell'}
            onClose={handleClose}
            onCancel={handleCancel}
          />
        ))}
      </div>
    </div>
  );
}
