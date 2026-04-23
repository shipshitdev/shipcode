import type {
  GitHubIssueCacheRecord,
  IntegrationStatus,
  TerminalEventRecord,
} from '@shipcode/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useStartInstantShell } from '../hooks/useStartInstantShell';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';
import { EMPTY_STREAM, PHASE_LABELS } from './terminal-drawer/constants';
import { TerminalDrawerEmptyState } from './terminal-drawer/TerminalDrawerEmptyState';
import { TerminalDrawerHeader } from './terminal-drawer/TerminalDrawerHeader';
import { useTerminalDrawer } from './terminal-drawer/useTerminalDrawer';
import { TerminalTranscript } from './terminal-transcript/TerminalTranscript';

interface TerminalDrawerTranscriptProps {
  approvedAwaitingExecution: boolean;
  displayIssue: GitHubIssueCacheRecord;
  terminalThreadId: string;
  onOpenIssue: (issue: GitHubIssueCacheRecord) => void;
}

function TerminalDrawerTranscript({
  approvedAwaitingExecution,
  displayIssue,
  terminalThreadId,
  onOpenIssue,
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
    canonicalStream.length === 0 && displayIssue.pipelineStatus
      ? approvedAwaitingExecution
        ? 'Waiting for execution slot'
        : (PHASE_LABELS[displayIssue.pipelineStatus] ?? 'Working')
      : null;
  const handleAction = useCallback(() => {
    onOpenIssue(displayIssue);
  }, [displayIssue, onOpenIssue]);

  return (
    <TerminalTranscript
      events={canonicalStream}
      pendingLabel={pendingLabel}
      emptyMessage="No console output yet."
      onAction={handleAction}
    />
  );
}

export function TerminalDrawer() {
  const {
    approvedAwaitingExecution,
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

  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const { startInstantShell } = useStartInstantShell();

  const { data: integrations } = useQuery<IntegrationStatus>({
    queryKey: ['integrations'],
    queryFn: () => window.shipcode.invoke('integrations:check'),
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const ghosttyAvailable = integrations?.desktopApps?.ghostty?.available ?? false;
  const terminalAvailable = integrations?.desktopApps?.terminal?.available ?? false;

  const handleNewCliSession = useCallback(
    async (cli: 'claude' | 'codex') => {
      await startInstantShell(cli);
    },
    [startInstantShell],
  );

  const handleNewClaudeSession = useCallback(() => {
    void handleNewCliSession('claude').catch((error) => {
      window.alert(error instanceof Error ? error.message : 'Failed to start Claude shell');
    });
  }, [handleNewCliSession]);

  const handleNewCodexSession = useCallback(() => {
    void handleNewCliSession('codex').catch((error) => {
      window.alert(error instanceof Error ? error.message : 'Failed to start Codex shell');
    });
  }, [handleNewCliSession]);

  const handleOpenInGhostty = useCallback(() => {
    if (!activeProjectId) return;
    void window.shipcode
      .invoke('project:open-path', {
        projectId: activeProjectId,
        target: 'ghostty',
      })
      .catch((error) => {
        window.alert(error instanceof Error ? error.message : 'Failed to open Ghostty');
      });
  }, [activeProjectId]);

  const handleOpenInTerminalApp = useCallback(() => {
    if (!activeProjectId) return;
    void window.shipcode
      .invoke('project:open-path', {
        projectId: activeProjectId,
        target: 'terminal',
      })
      .catch((error) => {
        window.alert(error instanceof Error ? error.message : 'Failed to open Terminal.app');
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
        approvedAwaitingExecution={approvedAwaitingExecution}
        isMaximized={isMaximized}
        pipelinePhase={pipelinePhase}
        runningTabs={runningTabs}
        startedAt={startedAt}
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
        {showEmptyState ? (
          <TerminalDrawerEmptyState />
        ) : displayIssue && terminalThreadId ? (
          <TerminalDrawerTranscript
            approvedAwaitingExecution={approvedAwaitingExecution}
            displayIssue={displayIssue}
            terminalThreadId={terminalThreadId}
            onOpenIssue={handleRunningTabSelect}
          />
        ) : (
          <TerminalDrawerEmptyState />
        )}
      </div>
    </div>
  );
}
