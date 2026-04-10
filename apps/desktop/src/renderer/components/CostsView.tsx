import { useQuery } from '@tanstack/react-query'
import type { CostSummary, PipelinePhase } from '@shipcode/shared'
import {
  Card, CardContent,
  Loader2,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@shipcode/ui'
import { useAppStore } from '../stores/app-store'

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.005) return '< $0.01'
  return `$${usd.toFixed(2)}`
}

function formatTokens(n: number): string {
  if (n === 0) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

const PHASE_COLOR: Partial<Record<PipelinePhase, string>> = {
  planning: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  reviewing: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  revising: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  awaiting_approval: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  executing: 'bg-accent/15 text-accent border-accent/30',
  verifying: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  shipping: 'bg-green-500/15 text-green-400 border-green-500/30',
  completed: 'bg-green-500/15 text-green-400 border-green-500/30',
  failed: 'bg-red-500/15 text-red-400 border-red-500/30',
  idle: 'bg-secondary text-muted border-border',
}

export function CostsView() {
  const { selectIssue } = useAppStore()

  const { data, isLoading, isError, refetch } = useQuery<CostSummary>({
    queryKey: ['costs-summary'],
    queryFn: () => window.shipcode.invoke<CostSummary>('costs:get-summary'),
    refetchInterval: 30_000,
  })

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-base font-semibold text-primary">Costs</h1>
        <p className="text-xs text-muted">Token spend across all projects and tasks.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-muted" />
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-sm text-secondary">Failed to load cost data.</p>
              <button
                type="button"
                className="rounded-md border border-border bg-secondary px-3 py-1.5 text-xs text-primary hover:bg-hover"
                onClick={() => refetch()}
              >
                Retry
              </button>
            </div>
          )}

          {data && (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-3 gap-4">
                <StatCard label="All-time" value={formatCost(data.totalCostAllTime)} subtitle={formatTokens(data.totalTokensAllTime) + ' tokens'} />
                <StatCard label="Last 7 days" value={formatCost(data.totalCost7d)} />
                <StatCard label="Avg per task" value={formatCost(data.avgCostPerTask)} />
              </div>

              {/* By project */}
              <section>
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">By Project</h2>
                {data.byProject.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted">
                    No tasks yet.
                  </div>
                ) : (
                  <Card>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Project</TableHead>
                            <TableHead className="text-right">Tasks</TableHead>
                            <TableHead className="text-right">Tokens</TableHead>
                            <TableHead className="text-right">Cost</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.byProject.map((p) => (
                            <TableRow key={p.projectId}>
                              <TableCell className="font-medium text-primary">{p.projectName}</TableCell>
                              <TableCell className="text-right text-secondary">{p.taskCount}</TableCell>
                              <TableCell className="text-right font-mono text-xs text-secondary">
                                {formatTokens(p.totalTokensPrompt + p.totalTokensCompletion)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs text-primary">
                                {formatCost(p.totalCostUsd)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </section>

              {/* Top tasks by cost */}
              <section>
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Top Tasks by Cost</h2>
                {data.recentByTask.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted">
                    No tasks yet.
                  </div>
                ) : (
                  <Card>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Task</TableHead>
                            <TableHead>Phase</TableHead>
                            <TableHead className="text-right">Tokens</TableHead>
                            <TableHead className="text-right">Cost</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.recentByTask.map((t) => (
                            <TableRow
                              key={t.threadId}
                              className="cursor-pointer hover:bg-hover"
                              onClick={() => selectIssue(null)}
                            >
                              <TableCell>
                                <div className="font-medium text-primary truncate max-w-[260px]">{t.title}</div>
                                <div className="text-[11px] text-muted">{t.projectName}</div>
                              </TableCell>
                              <TableCell>
                                <span
                                  className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${PHASE_COLOR[t.phase] ?? PHASE_COLOR.idle}`}
                                >
                                  {t.phase.replace(/_/g, ' ')}
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs text-secondary">
                                {formatTokens(t.tokensPrompt + t.tokensCompletion)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs text-primary">
                                {formatCost(t.costUsd)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </section>

              {/* Footer note */}
              <p className="text-center text-[11px] text-muted">
                Costs are tracked for OpenRouter only. Claude and Codex CLI do not report token usage.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold text-primary">{value}</div>
      {subtitle && <div className="mt-0.5 text-[11px] text-muted">{subtitle}</div>}
    </div>
  )
}
