import { PageHeader } from '@shipcode/ui';
import { toast } from '../stores/toast-store';
import { Button, cn } from '@shipshitdev/ui';
import { Plus, Terminal } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useOpenProjectTerminal } from '../hooks/useOpenProjectTerminal';
import { type TerminalPaneMode, useAppStore } from '../stores/app-store';
import { TerminalPane } from './terminal-panes/TerminalPane';

const MAX_PANES = 4;

export function TerminalView() {
  const terminalPaneThreadIds = useAppStore((state) => state.terminalPaneThreadIds);
  const terminalSplitDirection = useAppStore((state) => state.terminalSplitDirection);
  const terminalPaneMetaByThread = useAppStore((state) => state.terminalPaneMetaByThread);
  const removeTerminalPane = useAppStore((state) => state.removeTerminalPane);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const { openProjectTerminal, openingTerminal } = useOpenProjectTerminal();

  const handleOpenTerminal = useCallback(() => {
    void openProjectTerminal().catch((error) => {
      toast.error('Failed to open terminal', error instanceof Error ? error.message : undefined);
    });
  }, [openProjectTerminal]);

  const openTerminalButton = (
    <Button
      variant="default"
      size="sm"
      disabled={!activeProjectId || openingTerminal || terminalPaneThreadIds.length >= MAX_PANES}
      onClick={handleOpenTerminal}
    >
      <Plus size={14} />
      Open
    </Button>
  );

  const paneTitle = useCallback(
    (threadId: string) => {
      return terminalPaneMetaByThread[threadId]?.title ?? threadId.slice(0, 8);
    },
    [terminalPaneMetaByThread],
  );

  const handleCancel = useCallback((threadId: string) => {
    void window.shipcode.invoke('instant:cancel', { threadId });
  }, []);

  const handleClose = useCallback(
    (threadId: string, isRunning: boolean) => {
      const meta = terminalPaneMetaByThread[threadId];
      if (meta?.mode === 'live' && isRunning) {
        void window.shipcode.invoke('instant:cancel', { threadId });
      }
      removeTerminalPane(threadId);
    },
    [terminalPaneMetaByThread, removeTerminalPane],
  );

  const gridClass = useMemo(() => {
    const count = terminalPaneThreadIds.length;
    if (count <= 1) return 'flex flex-col';
    if (count === 2) {
      return terminalSplitDirection === 'horizontal' ? 'grid grid-cols-2' : 'grid grid-rows-2';
    }
    return 'grid grid-cols-2 grid-rows-2';
  }, [terminalPaneThreadIds.length, terminalSplitDirection]);

  if (terminalPaneThreadIds.length === 0) {
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
        title="Terminal"
        subtitle="Terminal sessions for the active project."
        actions={openTerminalButton}
      />

      <div className={cn('flex-1 min-h-0 gap-1 p-1', gridClass)}>
        {terminalPaneThreadIds.map((threadId) => (
          <TerminalPane
            key={threadId}
            threadId={threadId}
            title={paneTitle(threadId)}
            mode={(terminalPaneMetaByThread[threadId]?.mode ?? 'replay') as TerminalPaneMode}
            paneState={terminalPaneMetaByThread[threadId]?.state}
            isBareShell={terminalPaneMetaByThread[threadId]?.cli === 'shell'}
            onClose={handleClose}
            onCancel={handleCancel}
          />
        ))}
      </div>
    </div>
  );
}
