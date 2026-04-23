import type { Thread } from '@shipcode/shared';
import { Button, cn, Plus, Terminal } from '@shipshitdev/ui';
import { useCallback, useMemo, useState } from 'react';
import { type InstantPaneMode, useAppStore } from '../stores/app-store';
import { InstantTerminalPane } from './instant-terminal/InstantTerminalPane';

function formatLivePaneTitle(cli: 'claude' | 'codex', prompt: string): string {
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length > 0) {
    return `${cli === 'claude' ? 'Claude' : 'Codex'} • ${trimmedPrompt.slice(0, 40)}`;
  }
  return `${cli === 'claude' ? 'Claude' : 'Codex'} shell`;
}

export function InstantView() {
  const instantPaneThreadIds = useAppStore((state) => state.instantPaneThreadIds);
  const instantSplitDirection = useAppStore((state) => state.instantSplitDirection);
  const instantPaneMetaByThread = useAppStore((state) => state.instantPaneMetaByThread);
  const addInstantPane = useAppStore((state) => state.addInstantPane);
  const removeInstantPane = useAppStore((state) => state.removeInstantPane);
  const openInstantFixModal = useAppStore((state) => state.openInstantFixModal);
  const [restartingThreadId, setRestartingThreadId] = useState<string | null>(null);
  const [restartErrors, setRestartErrors] = useState<Record<string, string>>({});

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

  const handleRestart = useCallback(
    async (threadId: string) => {
      const meta = instantPaneMetaByThread[threadId];
      if (!meta || meta.mode !== 'live') return;

      setRestartingThreadId(threadId);
      setRestartErrors((current) => {
        if (!(threadId in current)) return current;
        const next = { ...current };
        delete next[threadId];
        return next;
      });

      try {
        const originalThread = await window.shipcode.invoke<Thread | null>('thread:get', {
          threadId,
        });
        if (!originalThread) {
          throw new Error('Original session was not found');
        }

        const cli = meta.cli ?? 'claude';
        const result = await window.shipcode.invoke<{ threadId: string }>('instant:shell-start', {
          projectId: originalThread.projectId,
          cli,
          initialPrompt: originalThread.prompt.trim() || undefined,
        });

        removeInstantPane(threadId);
        addInstantPane(result.threadId, {
          mode: 'live',
          cli,
          title: formatLivePaneTitle(cli, originalThread.prompt),
          state: 'running',
        });
      } catch (error) {
        setRestartErrors((current) => ({
          ...current,
          [threadId]: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        setRestartingThreadId((current) => (current === threadId ? null : current));
      }
    },
    [addInstantPane, instantPaneMetaByThread, removeInstantPane],
  );

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
        <Terminal size={32} className="text-muted" />
        <p className="text-sm">No terminal sessions open</p>
        <Button variant="default" onClick={() => openInstantFixModal()}>
          <Plus size={14} className="mr-1.5" />
          New Terminal Session
        </Button>
        <p className="text-xs text-muted">or press ⇧⌘I</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <h2 className="text-sm font-medium text-primary">Terminal Sessions</h2>
        <Button variant="ghost" size="sm" onClick={() => openInstantFixModal()}>
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
            mode={(instantPaneMetaByThread[threadId]?.mode ?? 'replay') as InstantPaneMode}
            paneState={instantPaneMetaByThread[threadId]?.state}
            onClose={handleClose}
            onSplitHorizontal={handleSplitHorizontal}
            onSplitVertical={handleSplitVertical}
            onCancel={handleCancel}
            onRestart={handleRestart}
            restartPending={restartingThreadId === threadId}
            restartError={restartErrors[threadId] ?? null}
          />
        ))}
      </div>
    </div>
  );
}
