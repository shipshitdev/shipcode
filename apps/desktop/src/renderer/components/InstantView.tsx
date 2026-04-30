import type { Thread } from '@shipcode/shared';
import { PageHeader } from '@shipcode/ui';
import { Button, Code2, cn, Sparkles, Terminal } from '@shipshitdev/ui';
import { useCallback, useMemo, useState } from 'react';
import { getShortcut } from '../data/shortcuts';
import { type InstantShellCli, useStartInstantShell } from '../hooks/useStartInstantShell';
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
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const { startInstantShell, startingCli } = useStartInstantShell();
  const [restartingThreadId, setRestartingThreadId] = useState<string | null>(null);
  const [restartErrors, setRestartErrors] = useState<Record<string, string>>({});

  const handleStartShell = useCallback(
    (cli: InstantShellCli) => {
      void startInstantShell(cli).catch((error) => {
        window.alert(error instanceof Error ? error.message : `Failed to start ${cli} shell`);
      });
    },
    [startInstantShell],
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

  const handleSplitHorizontal = useCallback(
    (threadId: string) => {
      const cli = instantPaneMetaByThread[threadId]?.cli ?? 'codex';
      handleStartShell(cli);
    },
    [handleStartShell, instantPaneMetaByThread],
  );

  const handleSplitVertical = useCallback(
    (threadId: string) => {
      const cli = instantPaneMetaByThread[threadId]?.cli ?? 'codex';
      handleStartShell(cli);
    },
    [handleStartShell, instantPaneMetaByThread],
  );

  const handleSplitHorizontalClick = useCallback(
    (threadId: string) => {
      useAppStore.getState().setInstantSplitDirection('horizontal');
      handleSplitHorizontal(threadId);
    },
    [handleSplitHorizontal],
  );

  const handleSplitVerticalClick = useCallback(
    (threadId: string) => {
      useAppStore.getState().setInstantSplitDirection('vertical');
      handleSplitVertical(threadId);
    },
    [handleSplitVertical],
  );

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
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="secondary"
            disabled={!activeProjectId || startingCli != null}
            onClick={() => handleStartShell('claude')}
          >
            <Sparkles size={14} />
            Claude CLI
          </Button>
          <Button
            variant="default"
            disabled={!activeProjectId || startingCli != null}
            onClick={() => handleStartShell('codex')}
          >
            <Code2 size={14} />
            Codex CLI
          </Button>
        </div>
        <p className="text-xs text-muted">
          {getShortcut('new-claude-shell').glyph} Claude · {getShortcut('new-codex-shell').glyph}{' '}
          Codex
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Terminal Sessions"
        subtitle="Interactive AI shells for the active project."
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={!activeProjectId || startingCli != null}
              onClick={() => handleStartShell('claude')}
            >
              <Sparkles size={14} />
              Claude
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!activeProjectId || startingCli != null}
              onClick={() => handleStartShell('codex')}
            >
              <Code2 size={14} />
              Codex
            </Button>
          </>
        }
      />

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
            onSplitHorizontal={() => handleSplitHorizontalClick(threadId)}
            onSplitVertical={() => handleSplitVerticalClick(threadId)}
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
