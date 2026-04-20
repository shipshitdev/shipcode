import { Badge, Button, Columns2, Rows2, Square, X } from '@shipcode/ui';
import type { InstantPaneMode } from '../../stores/app-store';
import { useInstantTerminalPane } from './useInstantTerminalPane';

interface InstantTerminalPaneProps {
  threadId: string;
  title: string;
  mode: InstantPaneMode;
  onClose: (threadId: string) => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onCancel: (threadId: string) => void;
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
  isRunning,
}: InstantTerminalPaneProps) {
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
      {/* Terminal */}
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
