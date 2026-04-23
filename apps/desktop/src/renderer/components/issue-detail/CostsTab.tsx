import type { CostTaskSummary, Thread } from '@shipcode/shared';
import { Badge, MODEL_DISPLAY } from '@shipshitdev/ui';
import { useQuery } from '@tanstack/react-query';
import { timeAgo } from './helpers';

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.005) return '< $0.01';
  return `$${usd.toFixed(2)}`;
}

function formatTokens(prompt: number, completion: number): string {
  const total = prompt + completion;
  if (total >= 1000) return `${Math.round(total / 1000)}k tokens`;
  return `${total} tokens`;
}

export function CostsTab({
  projectId,
  issueNumber,
  thread,
}: {
  projectId: string;
  issueNumber: number;
  thread: Thread | null | undefined;
}) {
  const { data: tasks = [], isLoading } = useQuery<CostTaskSummary[]>({
    queryKey: ['issue-costs', projectId, issueNumber],
    queryFn: () => window.shipcode.invoke('costs:list-for-issue', { projectId, issueNumber }),
    enabled: !!projectId,
  });

  const totalCost = tasks.reduce((sum, t) => sum + t.costUsd, 0);
  const totalTokens = tasks.reduce((sum, t) => sum + t.tokensPrompt + t.tokensCompletion, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">Costs</h4>
      </div>

      {isLoading ? (
        <p className="py-4 text-center text-[13px] text-muted">Loading cost data…</p>
      ) : tasks.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-secondary/10 px-4 py-8 text-center text-[12px] text-muted">
          No cost data yet.
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                Total Cost
              </span>
              <span className="text-[14px] font-semibold text-primary">
                {formatCost(totalCost)}
              </span>
            </div>
            <div className="flex flex-col gap-1 rounded-md border border-border bg-secondary p-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                Total Tokens
              </span>
              <span className="text-[14px] font-semibold text-primary">
                {totalTokens >= 1000 ? `${Math.round(totalTokens / 1000)}k` : String(totalTokens)}
              </span>
            </div>
          </div>

          {/* Per-run breakdown */}
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">
            Pipeline Runs
          </h4>
          <div className="overflow-hidden rounded-md border border-border bg-secondary/20">
            <div className="divide-y divide-border">
              {tasks.map((task, index) => (
                <div key={task.threadId} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-tertiary text-[10px] font-medium text-muted">
                    {tasks.length - index}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          task.phase === 'completed'
                            ? 'success'
                            : task.phase === 'failed'
                              ? 'danger'
                              : 'default'
                        }
                        className="text-[10px]"
                      >
                        {task.phase}
                      </Badge>
                      <span className="text-[12px] font-medium text-primary">
                        {formatCost(task.costUsd)}
                      </span>
                      <span className="text-[10px] text-muted">
                        {formatTokens(task.tokensPrompt, task.tokensCompletion)}
                      </span>
                    </div>
                    {task.model && (
                      <p className="mt-0.5 text-[10px] text-muted">
                        {MODEL_DISPLAY[task.model] ?? task.model}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted">{timeAgo(task.updatedAt)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Current thread details */}
          {thread && (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">
                Current Run Models
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { label: 'Planner', model: thread.plannerResolvedModel },
                    { label: 'Reviewer', model: thread.reviewerResolvedModel },
                    { label: 'Executor', model: thread.executorResolvedModel },
                    { label: 'Verifier', model: thread.verifierResolvedModel },
                  ] as const
                )
                  .filter((entry) => entry.model)
                  .map((entry) => (
                    <div
                      key={entry.label}
                      className="flex flex-col gap-0.5 rounded-md border border-border bg-secondary p-2"
                    >
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                        {entry.label}
                      </span>
                      <span className="truncate text-[11px] text-primary">
                        {entry.model ? (MODEL_DISPLAY[entry.model] ?? entry.model) : null}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
