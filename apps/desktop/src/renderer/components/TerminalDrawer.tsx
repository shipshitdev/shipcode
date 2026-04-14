import { TerminalDrawerActionBanner } from './terminal-drawer/TerminalDrawerActionBanner';
import { TerminalDrawerEmptyState } from './terminal-drawer/TerminalDrawerEmptyState';
import { TerminalDrawerHeader } from './terminal-drawer/TerminalDrawerHeader';
import { useTerminalDrawer } from './terminal-drawer/useTerminalDrawer';

export function TerminalDrawer() {
  const {
    actionBanner,
    canonicalStream,
    containerRef,
    currentModel,
    displayIssue,
    dismissActionBanner,
    handleActionBannerClick,
    handleResizeMouseDown,
    handleRunningTabSelect,
    isMaximized,
    pipelinePhase,
    resolvedHeight,
    runningTabs,
    showEmptyState,
    startedAt,
    terminalThreadId,
    toggleMaximize,
    toggleTerminal,
  } = useTerminalDrawer();

  return (
    <div
      className="flex flex-col border-t border-border bg-secondary shrink-0"
      style={isMaximized ? { flex: '1 1 0', minHeight: 0 } : { height: resolvedHeight }}
    >
      {!isMaximized && (
        <button
          type="button"
          aria-label="Resize terminal drawer"
          className="h-1 cursor-ns-resize hover:bg-accent/30 transition-colors shrink-0"
          onMouseDown={handleResizeMouseDown}
        />
      )}
      <TerminalDrawerHeader
        currentModel={currentModel}
        displayIssue={displayIssue}
        isMaximized={isMaximized}
        pipelinePhase={pipelinePhase}
        runningTabs={runningTabs}
        startedAt={canonicalStream.length > 0 ? startedAt : null}
        terminalThreadId={terminalThreadId}
        onOpenIssue={handleRunningTabSelect}
        onToggleMaximize={toggleMaximize}
        onToggleTerminal={toggleTerminal}
      />
      <div className="relative flex-1 overflow-hidden min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        {showEmptyState && <TerminalDrawerEmptyState />}
        {actionBanner && (
          <TerminalDrawerActionBanner
            actionBanner={actionBanner}
            pinnedIssue={displayIssue}
            onDismiss={dismissActionBanner}
            onOpen={handleActionBannerClick}
          />
        )}
      </div>
    </div>
  );
}
