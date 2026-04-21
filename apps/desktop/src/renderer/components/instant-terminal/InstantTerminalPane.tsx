import { Badge, Button, Columns2, RefreshCw, Rows2, Square, X } from '@shipcode/ui';
import type { InstantPaneMode } from '../../stores/app-store';
import { useAppStore } from '../../stores/app-store';
import { TerminalTranscript } from '../terminal-transcript/TerminalTranscript';
import { useInstantTerminalPane } from './useInstantTerminalPane';

interface InstantTerminalPaneProps {
  threadId: string;
  title: string;
  mode: InstantPaneMode;
  onClose: (threadId: string) => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onCancel: (threadId: string) => void;
  onRestart: (threadId: string) => void;
  canRestart: boolean;
  restartPending: boolean;
  restartError: string | null;
  isRunning: boolean;
}

export function InstantTerminalPane({
  threadId,
  title,
  mode,
  onClose,
  onSplitHorizontal,
  onSplitVertical,
  onCancel,
  onRestart,
  canRestart,
  restartPending,
  restartError,
  isRunning,
}: InstantTerminalPaneProps) {
  const canonicalStream = useAppStore((s) => s.canonicalTerminalStream[threadId] ?? []);
  const { containerRef } = useInstantTerminalPane(threadId, mode, isRunning);

  return (
    <div className="flex flex-col border border-border rounded-lg overflow-hidden bg-secondary">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-elevated border-b border-border">
        <span className="flex-1 truncate text-xs text-secondary font-medium">{title}</span>
        <Badge variant={isRunning ? 'default' : 'done'} className="text-[10px] px-1.5 py-0">
          {isRunning ? 'Running' : 'Done'}
        </Badge>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted"
            title="Split right"
            onClick={onSplitHorizontal}
          >
            <Columns2 size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted"
            title="Split down"
            onClick={onSplitVertical}
          >
            <Rows2 size={12} />
          </Button>
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
          {canRestart && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted"
              title="Restart shell"
              aria-label="Restart shell"
              disabled={restartPending}
              onClick={() => void onRestart(threadId)}
            >
              <RefreshCw size={12} className={restartPending ? 'animate-spin' : undefined} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted"
            title="Close pane"
            onClick={() => onClose(threadId)}
          >
            <X size={12} />
          </Button>
        </div>
      </div>
      {restartError && (
        <div className="border-b border-danger/20 bg-danger/5 px-3 py-1.5 text-[11px] text-danger">
          {restartError}
        </div>
      )}
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
