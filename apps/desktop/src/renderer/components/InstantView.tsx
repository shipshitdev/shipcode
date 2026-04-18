import { Button, cn, Plus, Zap } from '@shipcode/ui';
import { useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/app-store';
import { InstantTerminalPane } from './instant-terminal/InstantTerminalPane';

export function InstantView() {
  const { instantPaneThreadIds, instantSplitDirection, removeInstantPane, openInstantFixModal } =
    useAppStore();

  const canonicalStream = useAppStore((s) => s.canonicalTerminalStream);

  const isRunning = useCallback(
    (threadId: string) => {
      const stream = canonicalStream[threadId];
      if (!stream || stream.length === 0) return true;
      const lastEvent = stream[stream.length - 1];
      return lastEvent.event.kind !== 'done';
    },
    [canonicalStream],
  );

  const paneTitle = useCallback((threadId: string) => {
    // Use first line of the stream or a generic title
    return threadId.slice(0, 8);
  }, []);

  const handleCancel = useCallback((threadId: string) => {
    void window.shipcode.invoke('instant:cancel', { threadId });
  }, []);

  const handleSplitHorizontal = useCallback(() => {
    useAppStore.getState().setInstantSplitDirection('horizontal');
    openInstantFixModal();
  }, [openInstantFixModal]);

  const handleSplitVertical = useCallback(() => {
    useAppStore.getState().setInstantSplitDirection('vertical');
    openInstantFixModal();
  }, [openInstantFixModal]);

  const gridClass = useMemo(() => {
    const count = instantPaneThreadIds.length;
    if (count <= 1) return '';
    if (count === 2) {
      return instantSplitDirection === 'horizontal' ? 'grid grid-cols-2' : 'grid grid-rows-2';
    }
    return 'grid grid-cols-2 grid-rows-2';
  }, [instantPaneThreadIds.length, instantSplitDirection]);

  if (instantPaneThreadIds.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted">
        <Zap size={32} className="text-muted" />
        <p className="text-sm">No instant fix panes open</p>
        <Button variant="default" onClick={openInstantFixModal}>
          <Plus size={14} className="mr-1.5" />
          New Instant Fix
        </Button>
        <p className="text-xs text-muted">or press ⇧⌘I</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <h2 className="text-sm font-medium text-primary">Instant</h2>
        <Button variant="ghost" size="sm" onClick={openInstantFixModal}>
          <Plus size={14} className="mr-1" />
          New
        </Button>
      </div>

      {/* Pane grid */}
      <div className={cn('flex-1 min-h-0 gap-1 p-1', gridClass)}>
        {instantPaneThreadIds.map((threadId) => (
          <InstantTerminalPane
            key={threadId}
            threadId={threadId}
            title={paneTitle(threadId)}
            onClose={removeInstantPane}
            onSplitHorizontal={handleSplitHorizontal}
            onSplitVertical={handleSplitVertical}
            onCancel={handleCancel}
            isRunning={isRunning(threadId)}
          />
        ))}
      </div>
    </div>
  );
}
