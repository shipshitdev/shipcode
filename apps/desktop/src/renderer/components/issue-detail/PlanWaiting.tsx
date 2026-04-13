import type { ActivePipelineSummary } from '@shipcode/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/app-store';

export function PlanWaiting({ threadId }: { threadId: string }) {
  const lastActivity = useAppStore((state) => state.lastActivityByThread[threadId]);
  const [, tick] = useState(0);

  const { data: running = [] } = useQuery<ActivePipelineSummary[]>({
    queryKey: ['dashboard', 'running'],
    queryFn: () => window.shipcode.invoke<ActivePipelineSummary[]>('pipeline:list-active'),
    refetchInterval: 2000,
  });

  useEffect(() => {
    const id = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const startedAt = running.find((pipeline) => pipeline.threadId === threadId)?.startedAt;
  const sinceStart = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null;
  const sinceOutput = lastActivity ? Math.floor((Date.now() - lastActivity) / 1000) : sinceStart;
  const stale = (sinceOutput ?? 0) >= 90;

  function formatDuration(seconds: number) {
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  return (
    <div className="mb-5 py-4 text-center text-[13px]">
      <p className="text-muted">
        Waiting for plan generation
        {sinceStart !== null && (
          <>
            {' '}
            <span className="tabular-nums">- {formatDuration(sinceStart)}</span>
          </>
        )}
      </p>
      {lastActivity && !stale && sinceOutput !== null && (
        <p className="mt-1 text-[11px] text-muted opacity-60">
          Last output: {formatDuration(sinceOutput)} ago
        </p>
      )}
      {stale && sinceOutput !== null && (
        <p className="mt-2 text-[11px] text-warning">
          No output in {formatDuration(sinceOutput)} - the model may be slow or stalled. Open the
          terminal to diagnose, or cancel and retry.
        </p>
      )}
    </div>
  );
}
