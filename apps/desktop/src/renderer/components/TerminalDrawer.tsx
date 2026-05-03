import type { TerminalEventRecord } from '@shipcode/shared';
import { Button } from '@shipshitdev/ui';
import { useCallback, useEffect } from 'react';
import { useOpenProjectTerminal } from '../hooks/useOpenProjectTerminal';
import { useAppStore } from '../stores/app-store';
import { EMPTY_STREAM, PHASE_LABELS, type TerminalDrawerTarget } from './terminal-drawer/constants';
import { TerminalDrawerEmptyState } from './terminal-drawer/TerminalDrawerEmptyState';
import { TerminalDrawerHeader } from './terminal-drawer/TerminalDrawerHeader';
import { useTerminalDrawer } from './terminal-drawer/useTerminalDrawer';
import { TerminalTranscript } from './terminal-transcript/TerminalTranscript';

interface TerminalDrawerTranscriptProps {
  approvedAwaitingExecution: boolean;
  displayTarget: TerminalDrawerTarget;
  terminalThreadId: string;
  onOpenTarget: (target: TerminalDrawerTarget) => void;
}

function TerminalDrawerTranscript({
  approvedAwaitingExecution,
  displayTarget,
  terminalThreadId,
  onOpenTarget,
}: TerminalDrawerTranscriptProps) {
  const canonicalStream = useAppStore(
    (state) => state.canonicalTerminalStream[terminalThreadId] ?? EMPTY_STREAM,
  );
  const hydrateCanonicalEvents = useAppStore((state) => state.hydrateCanonicalEvents);

  useEffect(() => {
    if (canonicalStream.length > 0) return;

    let cancelled = false;
    void window.shipcode
      .invoke<TerminalEventRecord[]>('terminal:list', {
        threadId: terminalThreadId,
        limit: 2000,
      })
      .then((events) => {
        if (cancelled || !Array.isArray(events) || events.length === 0) return;
        hydrateCanonicalEvents(terminalThreadId, events);
      })
      .catch(() => {
        // Best-effort hydration only.
      });

    return () => {
      cancelled = true;
    };
  }, [canonicalStream.length, hydrateCanonicalEvents, terminalThreadId]);

  const pendingLabel =
    canonicalStream.length === 0 && displayTarget.phase
      ? approvedAwaitingExecution
        ? 'Waiting for execution slot'
        : (PHASE_LABELS[displayTarget.phase] ?? 'Working')
      : null;
  const handleAction = useCallback(() => {
    onOpenTarget(displayTarget);
  }, [displayTarget, onOpenTarget]);

  return (
    <TerminalTranscript
      events={canonicalStream}
      pendingLabel={pendingLabel}
      emptyMessage="No console output yet."
      onAction={displayTarget.kind === 'issue' ? handleAction : undefined}
    />
  );
}

export function TerminalDrawer() {
  const {
    approvedAwaitingExecution,
    currentModel,
    displayTarget,
    handleResizeMouseDown,
    handleRunningTargetSelect,
    isMaximized,
    isMinimized,
    pipelinePhase,
    resolvedHeight,
    runningTargets,
    showEmptyState,
    startedAt,
    terminalThreadId,
    resetHeight,
    toggleMinimized,
    toggleMaximize,
    toggleTerminal,
  } = useTerminalDrawer();

  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const { openProjectTerminal } = useOpenProjectTerminal();

  const handleOpenProjectTerminal = useCallback(() => {
    void openProjectTerminal().catch((error) => {
      window.alert(error instanceof Error ? error.message : 'Failed to open terminal');
    });
  }, [openProjectTerminal]);

  return (
    <div
      className="flex flex-col border-t border-border bg-secondary shrink-0"
      style={{ height: resolvedHeight }}
    >
      <Button
        type="button"
        variant="ghost"
        aria-label="Resize terminal drawer"
        className="h-1 w-full cursor-ns-resize rounded-none p-0 hover:bg-accent/30 transition-colors shrink-0"
        onMouseDown={handleResizeMouseDown}
      />
      <TerminalDrawerHeader
        activeProjectId={activeProjectId}
        currentModel={currentModel}
        displayTarget={displayTarget}
        approvedAwaitingExecution={approvedAwaitingExecution}
        isMaximized={isMaximized}
        isMinimized={isMinimized}
        pipelinePhase={pipelinePhase}
        runningTargets={runningTargets}
        startedAt={startedAt}
        terminalThreadId={terminalThreadId}
        onOpenProjectTerminal={handleOpenProjectTerminal}
        onOpenTarget={handleRunningTargetSelect}
        onResetHeight={resetHeight}
        onToggleMinimized={toggleMinimized}
        onToggleMaximize={toggleMaximize}
        onToggleTerminal={toggleTerminal}
      />
      <div className="relative flex-1 overflow-hidden min-h-0">
        {showEmptyState ? (
          <TerminalDrawerEmptyState />
        ) : displayTarget && terminalThreadId ? (
          <TerminalDrawerTranscript
            approvedAwaitingExecution={approvedAwaitingExecution}
            displayTarget={displayTarget}
            terminalThreadId={terminalThreadId}
            onOpenTarget={handleRunningTargetSelect}
          />
        ) : (
          <TerminalDrawerEmptyState />
        )}
      </div>
    </div>
  );
}
