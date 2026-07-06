import type { PipelinePhase } from '@shipcode/shared';
import { PIPELINE_PHASE } from '@shipcode/shared';
import { Button, Textarea } from '@shipshitdev/ui';
import { useQueryClient } from '@tanstack/react-query';
import { SendHorizontal } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from '../../stores/toast-store';
import { ThreadConsoleTranscript } from '../terminal-transcript/ThreadConsoleTranscript';

interface ConsoleTabProps {
  activeThreadId: string | null;
  approvedAwaitingExecution: boolean;
  threadPhase: PipelinePhase | 'idle';
}

const STEERABLE_PHASES = new Set<PipelinePhase>([
  PIPELINE_PHASE.planning,
  PIPELINE_PHASE.clarifying,
  PIPELINE_PHASE.reviewing,
  PIPELINE_PHASE.revising,
  PIPELINE_PHASE.approval,
  PIPELINE_PHASE.executing,
  PIPELINE_PHASE.testing,
  PIPELINE_PHASE.verifying,
  PIPELINE_PHASE.shipping,
  PIPELINE_PHASE.paused,
]);

export function ConsoleTab({
  activeThreadId,
  approvedAwaitingExecution,
  threadPhase,
}: ConsoleTabProps) {
  const queryClient = useQueryClient();
  const [instruction, setInstruction] = useState('');
  const [isSending, setIsSending] = useState(false);
  const canSteer =
    activeThreadId !== null &&
    threadPhase !== 'idle' &&
    STEERABLE_PHASES.has(threadPhase as PipelinePhase);

  const handleSubmit = useCallback(async () => {
    if (!activeThreadId || isSending) return;
    const text = instruction.trim();
    if (!text) return;

    setIsSending(true);
    try {
      const result = await window.shipcode.invoke<{
        status: 'delivered' | 'queued' | 'stale' | 'rejected';
        message: string;
      }>('pipeline:steer-execution', {
        threadId: activeThreadId,
        instruction: text,
      });
      if (result.status === 'delivered') {
        setInstruction('');
        toast.success('Instruction delivered');
        queryClient.invalidateQueries({ queryKey: ['agent-conversations', activeThreadId] });
      } else if (result.status === 'queued') {
        setInstruction('');
        toast.success('Instruction saved', result.message);
        queryClient.invalidateQueries({ queryKey: ['agent-conversations', activeThreadId] });
      } else {
        toast.error(
          result.status === 'stale' ? 'Instruction stale' : 'Instruction rejected',
          result.message,
        );
      }
    } catch (error) {
      toast.error('Instruction failed', error instanceof Error ? error.message : undefined);
    } finally {
      setIsSending(false);
    }
  }, [activeThreadId, instruction, isSending, queryClient]);

  if (!activeThreadId) {
    return (
      <div className="rounded-lg border border-border bg-secondary/40 p-6 text-sm text-muted-foreground">
        Console output will appear after this issue starts.
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[360px] flex-col overflow-hidden rounded-lg border border-border bg-secondary">
      <ThreadConsoleTranscript
        threadId={activeThreadId}
        phase={threadPhase}
        approvedAwaitingExecution={approvedAwaitingExecution}
        className="flex-1"
      />
      {canSteer ? (
        <div className="border-t border-border bg-elevated/95 p-3">
          <div className="flex items-end gap-2">
            <Textarea
              aria-label="Steer workflow"
              value={instruction}
              rows={2}
              className="min-h-[44px] flex-1 resize-none font-mono text-[12px]"
              placeholder="Add a steering instruction..."
              disabled={isSending}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
            />
            <Button
              type="button"
              size="icon"
              aria-label="Send steering instruction"
              disabled={isSending || instruction.trim().length === 0}
              onClick={() => void handleSubmit()}
            >
              <SendHorizontal size={16} />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
