import type { PipelinePhase } from '@shipcode/shared';
import { ThreadConsoleTranscript } from '../terminal-transcript/ThreadConsoleTranscript';

interface ConsoleTabProps {
  activeThreadId: string | null;
  approvedAwaitingExecution: boolean;
  threadPhase: PipelinePhase | 'idle';
}

export function ConsoleTab({
  activeThreadId,
  approvedAwaitingExecution,
  threadPhase,
}: ConsoleTabProps) {
  if (!activeThreadId) {
    return (
      <div className="rounded-lg border border-border bg-secondary/40 p-6 text-sm text-muted-foreground">
        Console output will appear after this issue starts.
      </div>
    );
  }

  return (
    <div className="flex min-h-[520px] overflow-hidden rounded-lg border border-border bg-secondary">
      <ThreadConsoleTranscript
        threadId={activeThreadId}
        phase={threadPhase}
        approvedAwaitingExecution={approvedAwaitingExecution}
        className="flex-1"
      />
    </div>
  );
}
