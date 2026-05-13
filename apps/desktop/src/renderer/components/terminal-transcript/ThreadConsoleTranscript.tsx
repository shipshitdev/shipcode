import type { PipelinePhase, TerminalEventRecord } from '@shipcode/shared';
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../stores/app-store';
import { toast } from '../../stores/toast-store';
import { EMPTY_STREAM, PHASE_LABELS } from '../terminal-drawer/constants';
import {
  type TerminalAutoFixRequest,
  type TerminalFailureActionRequest,
  TerminalTranscript,
} from './TerminalTranscript';

interface ThreadConsoleTranscriptProps {
  threadId: string;
  phase?: PipelinePhase | 'idle' | null;
  approvedAwaitingExecution?: boolean;
  emptyMessage?: string;
  className?: string;
  onAction?: () => void;
}

export function ThreadConsoleTranscript({
  threadId,
  phase = null,
  approvedAwaitingExecution = false,
  emptyMessage = 'No console output yet.',
  className,
  onAction,
}: ThreadConsoleTranscriptProps) {
  const canonicalStream = useAppStore(
    (state) => state.canonicalTerminalStream[threadId] ?? EMPTY_STREAM,
  );
  const hydrateCanonicalEvents = useAppStore((state) => state.hydrateCanonicalEvents);
  const addTerminalPane = useAppStore((state) => state.addTerminalPane);
  const setProjectTab = useAppStore((state) => state.setProjectTab);
  const [autoFixingEventId, setAutoFixingEventId] = useState<string | null>(null);
  const [sendingToTerminalEventId, setSendingToTerminalEventId] = useState<string | null>(null);

  useEffect(() => {
    if (canonicalStream.length > 0) return;

    let cancelled = false;
    void window.shipcode
      .invoke<TerminalEventRecord[]>('terminal:list', {
        threadId,
        limit: 2000,
      })
      .then((events) => {
        if (cancelled || !Array.isArray(events) || events.length === 0) return;
        hydrateCanonicalEvents(threadId, events);
      })
      .catch(() => {
        // Best-effort hydration only.
      });

    return () => {
      cancelled = true;
    };
  }, [canonicalStream.length, hydrateCanonicalEvents, threadId]);

  const pendingLabel =
    canonicalStream.length === 0 && phase && phase !== 'idle'
      ? approvedAwaitingExecution
        ? 'Waiting for execution slot'
        : (PHASE_LABELS[phase] ?? 'Working')
      : null;

  const handleAutoFix = useCallback(
    async ({ record, output }: TerminalAutoFixRequest) => {
      if (autoFixingEventId) return;

      setAutoFixingEventId(record.id);
      try {
        await window.shipcode.invoke('pipeline:auto-fix', {
          threadId,
          failureOutput: output,
        });
      } catch (error) {
        toast.error('Auto Fix failed', error instanceof Error ? error.message : undefined);
      } finally {
        setAutoFixingEventId(null);
      }
    },
    [autoFixingEventId, threadId],
  );

  const handleSendToTerminal = useCallback(
    async ({ record, output }: TerminalFailureActionRequest) => {
      if (sendingToTerminalEventId) return;

      setSendingToTerminalEventId(record.id);
      try {
        const result = await window.shipcode.invoke<{
          threadId: string;
          cli: 'claude' | 'codex';
          title: string;
        }>('instant:fix-thread-failure', {
          threadId,
          failureOutput: output,
        });
        addTerminalPane(result.threadId, {
          mode: 'replay',
          cli: result.cli,
          title: result.title,
          state: 'running',
        });
        setProjectTab('terminal');
      } catch (error) {
        toast.error(
          'Failed to send to terminal',
          error instanceof Error ? error.message : undefined,
        );
      } finally {
        setSendingToTerminalEventId(null);
      }
    },
    [addTerminalPane, sendingToTerminalEventId, setProjectTab, threadId],
  );

  return (
    <TerminalTranscript
      events={canonicalStream}
      pendingLabel={pendingLabel}
      emptyMessage={emptyMessage}
      className={className}
      onAction={onAction ? () => onAction() : undefined}
      onAutoFix={handleAutoFix}
      onSendToTerminal={handleSendToTerminal}
      autoFixingEventId={autoFixingEventId}
      sendingToTerminalEventId={sendingToTerminalEventId}
    />
  );
}
