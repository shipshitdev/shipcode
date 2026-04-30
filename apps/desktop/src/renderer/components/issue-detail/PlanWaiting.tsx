import { type ActivePipelineSummary, formatDurationSeconds } from '@shipcode/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useSharedSecondNow } from '../../hooks/useSharedSecondNow';
import { useAppStore } from '../../stores/app-store';

export function PlanWaiting({ threadId }: { threadId: string }) {
  const lastActivity = useAppStore((state) => state.lastActivityByThread[threadId]);
  const now = useSharedSecondNow();

  const { data: running = [] } = useQuery<ActivePipelineSummary[]>({
    queryKey: ['dashboard', 'running'],
    queryFn: () => window.shipcode.invoke<ActivePipelineSummary[]>('pipeline:list-active'),
  });

  const startedAt = useMemo(
    () => running.find((pipeline) => pipeline.threadId === threadId)?.startedAt,
    [running, threadId],
  );
  const sinceStart = startedAt ? Math.floor((now - startedAt) / 1000) : null;
  const sinceOutput = lastActivity ? Math.floor((now - lastActivity) / 1000) : sinceStart;
  const stale = (sinceOutput ?? 0) >= 90;

  return (
    <div className="mb-5 py-4 text-center text-[13px]">
      <p className="text-muted">
        Waiting for plan generation
        {sinceStart !== null && (
          <>
            {' '}
            <span className="tabular-nums">- {formatDurationSeconds(sinceStart)}</span>
          </>
        )}
      </p>
      {lastActivity && !stale && sinceOutput !== null && (
        <p className="mt-1 text-[11px] text-muted opacity-60">
          Last output: {formatDurationSeconds(sinceOutput)} ago
        </p>
      )}
      {stale && sinceOutput !== null && (
        <p className="mt-2 text-[11px] text-warning">
          No output in {formatDurationSeconds(sinceOutput)} - the model may be slow or stalled. Open
          the terminal to diagnose, or cancel and retry.
        </p>
      )}
    </div>
  );
}
