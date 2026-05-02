import { type AgentState, formatDurationSeconds, type TerminalEventRecord } from '@shipcode/shared';
import { Badge, Button } from '@shipshitdev/ui';
import { Square, X } from 'lucide-react';
import { useMemo } from 'react';
import { useSharedSecondNow } from '../../hooks/useSharedSecondNow';
import type { InstantPaneMode } from '../../stores/app-store';
import { useAppStore } from '../../stores/app-store';
import { TerminalTranscript } from '../terminal-transcript/TerminalTranscript';
import { useInstantTerminalPane } from './useInstantTerminalPane';

const EMPTY_STREAM: TerminalEventRecord[] = [];
const QUIET_HINT_SECONDS = 15;
const STALE_WARNING_SECONDS = 90;

interface InstantTerminalPaneProps {
  threadId: string;
  title: string;
  mode: InstantPaneMode;
  paneState?: AgentState;
  onClose: (threadId: string, isRunning: boolean) => void;
  onCancel: (threadId: string) => void;
}

export function InstantTerminalPane({
  threadId,
  title,
  mode,
  paneState,
  onClose,
  onCancel,
}: InstantTerminalPaneProps) {
  const shouldReadStream = mode !== 'live' || paneState == null;
  const canonicalStream = useAppStore((s) =>
    shouldReadStream ? (s.canonicalTerminalStream[threadId] ?? EMPTY_STREAM) : EMPTY_STREAM,
  );
  const lastActivityAt = useAppStore((s) => s.lastActivityByThread[threadId] ?? null);
  const lastEvent = canonicalStream[canonicalStream.length - 1]?.event;
  const isRunning =
    paneState != null
      ? paneState === 'running' || paneState === 'starting'
      : lastEvent?.kind === 'lifecycle' && lastEvent.message.includes('process exited')
        ? false
        : lastEvent?.kind !== 'done';
  const { containerRef } = useInstantTerminalPane(threadId, mode, isRunning);
  const now = useSharedSecondNow();

  const quietSince = useMemo(() => {
    const lastRecordAt =
      canonicalStream.length > 0
        ? Date.parse(canonicalStream[canonicalStream.length - 1].createdAt)
        : NaN;
    return typeof lastActivityAt === 'number'
      ? lastActivityAt
      : Number.isFinite(lastRecordAt)
        ? lastRecordAt
        : null;
  }, [canonicalStream, lastActivityAt]);
  const quietSeconds =
    isRunning && quietSince != null ? Math.max(0, Math.floor((now - quietSince) / 1_000)) : null;
  const showQuietHint = quietSeconds != null && quietSeconds >= QUIET_HINT_SECONDS;
  const stale = quietSeconds != null && quietSeconds >= STALE_WARNING_SECONDS;

  return (
    <div className="flex flex-col border border-border rounded-lg overflow-hidden bg-secondary">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-elevated border-b border-border">
        <span className="flex-1 truncate text-xs text-secondary font-medium">{title}</span>
        <Badge
          variant={isRunning ? (stale ? 'warning' : 'default') : 'done'}
          className="text-[10px] px-1.5 py-0"
        >
          {isRunning ? 'Running' : 'Done'}
        </Badge>
        {isRunning && showQuietHint ? (
          <span
            className={`font-mono text-[10px] tabular-nums ${stale ? 'text-warning' : 'text-muted'}`}
          >
            {stale
              ? `No output ${formatDurationSeconds(quietSeconds)}`
              : `Quiet ${formatDurationSeconds(quietSeconds)}`}
          </span>
        ) : null}
        <div className="flex items-center gap-0.5">
          {isRunning && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-danger"
              title="Stop"
              onClick={() => onCancel(threadId)}
            >
              <Square size={12} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted"
            title="Close pane"
            onClick={() => onClose(threadId, isRunning)}
          >
            <X size={12} />
          </Button>
        </div>
      </div>
      {isRunning && stale && quietSeconds != null ? (
        <div className="border-b border-warning/20 bg-warning/5 px-3 py-1.5 text-[11px] text-warning">
          No output for {formatDurationSeconds(quietSeconds)}. The CLI may be thinking or waiting on
          a slow tool call. Press Esc to interrupt if it stays stuck.
        </div>
      ) : null}
      {mode === 'live' ? (
        <div ref={containerRef} className="flex-1 min-h-0" />
      ) : (
        <TerminalTranscript
          events={canonicalStream}
          pendingLabel={isRunning && canonicalStream.length === 0 ? 'Waiting for output' : null}
          emptyMessage="No replay output yet."
          compact
          className="flex-1 min-h-0"
        />
      )}
    </div>
  );
}
