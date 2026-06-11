import { Button, cn } from '@shipshitdev/ui';
import type { CSSProperties } from 'react';
import { useCallback } from 'react';
import { useOpenProjectTerminal } from '../hooks/useOpenProjectTerminal';
import { useAppStore } from '../stores/app-store';
import { toast } from '../stores/toast-store';
import type { TerminalDrawerTarget } from './terminal-drawer/constants';
import { TerminalDrawerHeader } from './terminal-drawer/TerminalDrawerHeader';
import { useTerminalDrawer } from './terminal-drawer/useTerminalDrawer';
import { ThreadConsoleTranscript } from './terminal-transcript/ThreadConsoleTranscript';

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
  const handleAction = useCallback(() => {
    onOpenTarget(displayTarget);
  }, [displayTarget, onOpenTarget]);

  return (
    <ThreadConsoleTranscript
      threadId={terminalThreadId}
      phase={displayTarget.phase}
      approvedAwaitingExecution={approvedAwaitingExecution}
      emptyMessage="No console output yet."
      onAction={displayTarget.kind === 'issue' ? handleAction : undefined}
    />
  );
}

export function TerminalDrawer({ isExiting = false }: { isExiting?: boolean }) {
  const {
    approvedAwaitingExecution,
    currentModel,
    displayTarget,
    handleResizeMouseDown,
    handleRunningTargetSelect,
    isDragging,
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
      toast.error('Failed to open terminal', error instanceof Error ? error.message : undefined);
    });
  }, [openProjectTerminal]);

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col overflow-hidden border-t border-border bg-secondary',
        isExiting ? 'animate-terminal-exit' : 'terminal-drawer-shell',
      )}
      data-testid="terminal-drawer"
      data-dragging={isDragging ? 'true' : undefined}
      style={{ '--terminal-drawer-height': `${resolvedHeight}px` } as CSSProperties}
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
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm text-center">
              <div className="text-sm font-medium text-primary">
                No issue selected for this project
              </div>
              <div className="mt-1 text-xs leading-5 text-secondary">
                Console output will appear when you select or start an issue in this project.
              </div>
            </div>
          </div>
        ) : displayTarget && terminalThreadId ? (
          <TerminalDrawerTranscript
            approvedAwaitingExecution={approvedAwaitingExecution}
            displayTarget={displayTarget}
            terminalThreadId={terminalThreadId}
            onOpenTarget={handleRunningTargetSelect}
          />
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm text-center">
              <div className="text-sm font-medium text-primary">
                No issue selected for this project
              </div>
              <div className="mt-1 text-xs leading-5 text-secondary">
                Console output will appear when you select or start an issue in this project.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
