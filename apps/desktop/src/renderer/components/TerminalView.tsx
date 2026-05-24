import { PageHeader } from '@shipcode/ui';
import { Button, cn } from '@shipshitdev/ui';
import { Plus, Terminal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useOpenProjectTerminal } from '../hooks/useOpenProjectTerminal';
import { type TerminalPaneMode, useAppStore } from '../stores/app-store';
import { toast } from '../stores/toast-store';
import { TerminalPane } from './terminal-panes/TerminalPane';

const MAX_PANES = 4;

function cancelRunningLivePanes(ref: { current: Array<{ threadId: string; isRunning: boolean }> }) {
  const livePanes = ref.current;
  for (const pane of livePanes) {
    if (pane.isRunning) {
      void window.shipcode.invoke('instant:cancel', { threadId: pane.threadId });
    }
  }
}

export function TerminalView() {
  const terminalPaneThreadIds = useAppStore((state) => state.terminalPaneThreadIds);
  const terminalSplitDirection = useAppStore((state) => state.terminalSplitDirection);
  const terminalPaneMetaByThread = useAppStore((state) => state.terminalPaneMetaByThread);
  const assistantThreadId = useAppStore((state) => state.assistantThreadId);
  const removeTerminalPane = useAppStore((state) => state.removeTerminalPane);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const { openProjectTerminal, openingTerminal } = useOpenProjectTerminal();
  const livePaneRef = useRef<Array<{ threadId: string; isRunning: boolean }>>([]);
  const visibleTerminalPaneThreadIds = useMemo(
    () => terminalPaneThreadIds.filter((threadId) => threadId !== assistantThreadId),
    [assistantThreadId, terminalPaneThreadIds],
  );

  useEffect(() => {
    livePaneRef.current = visibleTerminalPaneThreadIds.map((threadId) => {
      const meta = terminalPaneMetaByThread[threadId];
      return {
        threadId,
        isRunning: meta?.mode === 'live' && meta.state !== 'exited',
      };
    });
  }, [terminalPaneMetaByThread, visibleTerminalPaneThreadIds]);

  useEffect(() => {
    return () => {
      cancelRunningLivePanes(livePaneRef);
    };
  }, []);

  const handleOpenTerminal = useCallback(() => {
    void openProjectTerminal().catch((error) => {
      toast.error('Failed to open terminal', error instanceof Error ? error.message : undefined);
    });
  }, [openProjectTerminal]);

  const openTerminalButton = (
    <Button
      variant="default"
      size="sm"
      disabled={
        !activeProjectId || openingTerminal || visibleTerminalPaneThreadIds.length >= MAX_PANES
      }
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
    const count = visibleTerminalPaneThreadIds.length;
    if (count <= 1) return 'flex flex-col';
    if (count === 2) {
      return terminalSplitDirection === 'horizontal' ? 'grid grid-cols-2' : 'grid grid-rows-2';
    }
    return 'grid grid-cols-2 grid-rows-2';
  }, [terminalSplitDirection, visibleTerminalPaneThreadIds.length]);

  if (visibleTerminalPaneThreadIds.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
        <Terminal size={32} className="text-muted-foreground" />
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
        {visibleTerminalPaneThreadIds.map((threadId) => (
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
