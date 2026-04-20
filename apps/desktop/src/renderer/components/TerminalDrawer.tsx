import type { IntegrationStatus } from '@shipcode/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';
import { TerminalDrawerEmptyState } from './terminal-drawer/TerminalDrawerEmptyState';
import { TerminalDrawerHeader } from './terminal-drawer/TerminalDrawerHeader';
import { useTerminalDrawer } from './terminal-drawer/useTerminalDrawer';

export function TerminalDrawer() {
  const {
    canonicalStream,
    containerRef,
    currentModel,
    displayIssue,
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

  const { openTerminalSessions, openInstantFixModal, activeProjectId } = useAppStore();

  const { data: integrations } = useQuery<IntegrationStatus>({
    queryKey: ['integrations'],
    queryFn: () => window.shipcode.invoke('integrations:check'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const ghosttyAvailable = integrations?.desktopApps?.ghostty?.available ?? false;
  const terminalAvailable = integrations?.desktopApps?.terminal?.available ?? false;

  const handleNewClaudeSession = useCallback(() => {
    openTerminalSessions();
    openInstantFixModal('claude');
  }, [openTerminalSessions, openInstantFixModal]);

  const handleNewCodexSession = useCallback(() => {
    openTerminalSessions();
    openInstantFixModal('codex');
  }, [openTerminalSessions, openInstantFixModal]);

  const handleOpenInGhostty = useCallback(() => {
    if (!activeProjectId) return;
    void window.shipcode.invoke('project:open-path', {
      projectId: activeProjectId,
      target: 'ghostty',
    });
  }, [activeProjectId]);

  const handleOpenInTerminalApp = useCallback(() => {
    if (!activeProjectId) return;
    void window.shipcode.invoke('project:open-path', {
      projectId: activeProjectId,
      target: 'terminal',
    });
  }, [activeProjectId]);

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
        activeProjectId={activeProjectId}
        currentModel={currentModel}
        displayIssue={displayIssue}
        ghosttyAvailable={ghosttyAvailable}
        isMaximized={isMaximized}
        pipelinePhase={pipelinePhase}
        runningTabs={runningTabs}
        startedAt={canonicalStream.length > 0 ? startedAt : null}
        terminalAvailable={terminalAvailable}
        terminalThreadId={terminalThreadId}
        onNewClaudeSession={handleNewClaudeSession}
        onNewCodexSession={handleNewCodexSession}
        onOpenInGhostty={handleOpenInGhostty}
        onOpenInTerminalApp={handleOpenInTerminalApp}
        onOpenIssue={handleRunningTabSelect}
        onToggleMaximize={toggleMaximize}
        onToggleTerminal={toggleTerminal}
      />
      <div className="relative flex-1 overflow-hidden min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        {showEmptyState && <TerminalDrawerEmptyState />}
      </div>
    </div>
  );
}
