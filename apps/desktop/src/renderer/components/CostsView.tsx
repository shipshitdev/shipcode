import type {
  CostSummary,
  CostTaskSummary,
  GitHubIssueCacheRecord,
  PipelinePhase,
} from '@shipcode/shared';
import { sanitizeResolvedModel } from '@shipcode/shared';
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  cn,
  Loader2,
  modelDisplay,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shipcode/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAppStore } from '../stores/app-store';

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.005) return '< $0.01';
  return `$${usd.toFixed(2)}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTokens(n: number): string {
  if (n === 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function formatProvider(provider: string): string {
  return provider;
}

function formatModelDescription(model: string | null, provider: string): string {
  const value = sanitizeResolvedModel(model) ?? provider;
  switch (value) {
    case 'anthropic/claude-sonnet-4-6':
      return 'Claude Sonnet 4.6';
    case 'anthropic/claude-opus-4-6':
      return 'Claude Opus 4.6';
    case 'openai/gpt-5-codex':
      return 'GPT-5 Codex';
    case 'qwen/qwen3.6-plus':
      return 'Qwen 3.6 Plus';
    case 'qwen/qwen3-coder:free':
      return 'Qwen 3 Coder Free';
    case 'openrouter/auto':
      return 'Auto (paid)';
    default:
      return modelDisplay(value);
  }
}

// See OverviewView for why all 6 agent phases share one color.
const AGENT_PHASE_CLASSES = 'bg-agent/10 text-agent border-agent/25';

const PHASE_COLOR: Partial<Record<PipelinePhase, string>> = {
  planning: AGENT_PHASE_CLASSES,
  reviewing: AGENT_PHASE_CLASSES,
  revising: AGENT_PHASE_CLASSES,
  executing: AGENT_PHASE_CLASSES,
  verifying: AGENT_PHASE_CLASSES,
  shipping: AGENT_PHASE_CLASSES,
  awaiting_approval: 'bg-warning/15 text-warning border-warning/30',
  completed: 'bg-success/15 text-success border-success/30',
  failed: 'bg-danger/15 text-danger border-danger/30',
  idle: 'bg-secondary text-muted border-border',
};

type DisplayMode = '$' | 'tokens';

export function CostsView() {
  const { selectProject, selectThread, selectIssue, setGithubIssues } = useAppStore();
  // Default to tokens because token counts are exact for every provider,
  // whereas USD amounts are only real for OpenRouter (billed) and are
  // best-effort estimates for Claude/Codex CLI runs priced from published rates.
  const [displayMode, setDisplayMode] = useState<DisplayMode>('tokens');
  const [navigatingThreadId, setNavigatingThreadId] = useState<string | null>(null);
  const [tasksPage, setTasksPage] = useState(1);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectPage, setProjectPage] = useState(1);
  const PAGE_SIZE = 8;

  // Click-through from the Top Tasks table: switch project, fetch its issues,
  // and open the IssueDetail sidebar for the matching threadId. The previous
  // implementation called selectIssue(null) which closed the panel instead of
  // opening it.
  const goToTask = async (projectId: string, threadId: string) => {
    setNavigatingThreadId(threadId);
    try {
      selectProject(projectId);
      selectThread(threadId);
      const issues = await window.shipcode.invoke<GitHubIssueCacheRecord[]>('github:list-issues', {
        projectId,
      });
      setGithubIssues(issues);
      const match = issues.find((i) => i.threadId === threadId) ?? null;
      if (match) selectIssue(match);
    } finally {
      setNavigatingThreadId(null);
    }
  };

  const { data, isLoading, isError, refetch } = useQuery<CostSummary>({
    queryKey: ['costs-summary'],
    queryFn: () => window.shipcode.invoke<CostSummary>('costs:get-summary'),
    refetchInterval: 30_000,
  });

  const { data: tasks = [] } = useQuery<CostTaskSummary[]>({
    queryKey: ['costs-tasks', tasksPage],
    queryFn: () =>
      window.shipcode.invoke<CostTaskSummary[]>('costs:list-tasks', {
        limit: PAGE_SIZE,
        offset: (tasksPage - 1) * PAGE_SIZE,
      }),
    refetchInterval: 30_000,
  });

  const { data: tasksTotal = 0 } = useQuery<number>({
    queryKey: ['costs-tasks-count'],
    queryFn: () => window.shipcode.invoke<number>('costs:count-tasks'),
    refetchInterval: 30_000,
  });

  const { data: projectTasks = [] } = useQuery<CostTaskSummary[]>({
    queryKey: ['costs-project-tasks', selectedProjectId, projectPage],
    queryFn: () =>
      window.shipcode.invoke<CostTaskSummary[]>('costs:list-tasks', {
        projectId: selectedProjectId ?? '',
        limit: PAGE_SIZE,
        offset: (projectPage - 1) * PAGE_SIZE,
      }),
    refetchInterval: 30_000,
    enabled: !!selectedProjectId,
  });

  const { data: projectTasksTotal = 0 } = useQuery<number>({
    queryKey: ['costs-project-tasks-count', selectedProjectId],
    queryFn: () =>
      window.shipcode.invoke<number>('costs:count-tasks', { projectId: selectedProjectId ?? '' }),
    refetchInterval: 30_000,
    enabled: !!selectedProjectId,
  });

  const tasksTotalPages = Math.max(1, Math.ceil(tasksTotal / PAGE_SIZE));
  const projectTasksTotalPages = Math.max(1, Math.ceil(projectTasksTotal / PAGE_SIZE));

  function displayValue(costUsd: number, tokens: number): string {
    if (displayMode === 'tokens') return formatTokens(tokens);
    return formatCost(costUsd);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-base font-semibold text-primary">Costs</h1>
          <p className="text-xs text-muted">
            {displayMode === 'tokens'
              ? 'Token spend across all projects and tasks. Exact counts for every provider.'
              : 'USD estimates for Claude / Codex CLI runs from published pricing — only OpenRouter amounts are real billing.'}
          </p>
        </div>
        <div className="flex items-center rounded-md border border-border bg-secondary p-0.5 text-[11px]">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setDisplayMode('$')}
            className={cn(
              displayMode === '$' ? 'bg-tertiary text-primary font-medium' : 'text-muted',
            )}
            aria-label="Show costs in US dollars"
          >
            USD
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setDisplayMode('tokens')}
            className={cn(
              displayMode === 'tokens' ? 'bg-tertiary text-primary font-medium' : 'text-muted',
            )}
            aria-label="Show costs in tokens"
          >
            Tokens
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-5xl space-y-6">
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-muted" />
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-sm text-secondary">Failed to load cost data.</p>
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          )}

          {data && (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-3 gap-4">
                <StatCard
                  label="All-time"
                  value={displayValue(data.totalCostAllTime, data.totalTokensAllTime)}
                  subtitle={
                    displayMode === '$'
                      ? `${formatTokens(data.totalTokensAllTime)} tokens`
                      : undefined
                  }
                />
                <StatCard
                  label="Last 7 days"
                  value={displayValue(data.totalCost7d, data.totalTokens7d)}
                />
                <StatCard
                  label="Avg per task"
                  value={displayValue(data.avgCostPerTask, data.avgTokensPerTask)}
                />
              </div>

              {/* By project */}
              <section>
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  By Project
                </h2>
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
                            <TableHead className="text-right">
                              {displayMode === '$' ? 'Cost' : 'Tokens'}
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.byProject.map((p) => (
                            <TableRow
                              key={p.projectId}
                              className={cn(
                                'cursor-pointer hover:bg-hover',
                                selectedProjectId === p.projectId && 'bg-hover',
                              )}
                              onClick={() => {
                                setSelectedProjectId((current) =>
                                  current === p.projectId ? null : p.projectId,
                                );
                                setProjectPage(1);
                              }}
                            >
                              <TableCell className="font-medium text-primary">
                                {p.projectName}
                              </TableCell>
                              <TableCell className="text-right text-secondary">
                                {p.taskCount}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs text-primary">
                                {displayValue(
                                  p.totalCostUsd,
                                  p.totalTokensPrompt + p.totalTokensCompletion,
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </section>

              {selectedProjectId && (
                <section>
                  <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {data.byProject.find((p) => p.projectId === selectedProjectId)?.projectName ??
                      'Project'}{' '}
                    Cost Details
                  </h2>
                  <Card>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Task</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Phase</TableHead>
                            <TableHead>Provider</TableHead>
                            <TableHead>Model</TableHead>
                            <TableHead className="text-right">Tokens</TableHead>
                            <TableHead className="text-right">Cost</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {projectTasks.map((t) => (
                            <TableRow
                              key={`${selectedProjectId}-${t.threadId}`}
                              className={cn(
                                'cursor-pointer hover:bg-hover',
                                navigatingThreadId === t.threadId && 'opacity-60',
                              )}
                              onClick={() => goToTask(t.projectId, t.threadId)}
                            >
                              <TableCell>
                                <div className="font-medium text-primary truncate max-w-[260px]">
                                  {t.title}
                                </div>
                              </TableCell>
                              <TableCell className="text-[11px] text-muted whitespace-nowrap">
                                {t.updatedAt ? formatDateTime(t.updatedAt) : '—'}
                              </TableCell>
                              <TableCell>
                                <span
                                  className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${PHASE_COLOR[t.phase] ?? PHASE_COLOR.idle}`}
                                >
                                  {t.phase.replace(/_/g, ' ')}
                                </span>
                              </TableCell>
                              <TableCell className="text-[11px] text-muted whitespace-nowrap">
                                {formatProvider(t.provider)}
                              </TableCell>
                              <TableCell className="text-[11px] text-primary whitespace-nowrap">
                                {formatModelDescription(t.model, t.provider)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs text-primary">
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
                    {projectTasksTotalPages > 1 && (
                      <CardFooter className="pt-0 pb-4 px-5">
                        <Pagination
                          page={projectPage}
                          totalPages={projectTasksTotalPages}
                          onPageChange={setProjectPage}
                          className="w-full"
                        />
                      </CardFooter>
                    )}
                  </Card>
                </section>
              )}

              {/* Top tasks by cost */}
              <section>
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Top Tasks by Cost
                </h2>
                {tasks.length === 0 ? (
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
                            <TableHead>Date</TableHead>
                            <TableHead>Phase</TableHead>
                            <TableHead>Provider</TableHead>
                            <TableHead>Model</TableHead>
                            <TableHead className="text-right">Tokens</TableHead>
                            <TableHead className="text-right">Cost</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tasks.map((t) => (
                            <TableRow
                              key={t.threadId}
                              className={cn(
                                'cursor-pointer hover:bg-hover',
                                navigatingThreadId === t.threadId && 'opacity-60',
                              )}
                              onClick={() => goToTask(t.projectId, t.threadId)}
                            >
                              <TableCell>
                                <div className="font-medium text-primary truncate max-w-[260px]">
                                  {t.title}
                                </div>
                                <div className="text-[11px] text-muted">{t.projectName}</div>
                              </TableCell>
                              <TableCell className="text-[11px] text-muted whitespace-nowrap">
                                {t.updatedAt ? formatDateTime(t.updatedAt) : '—'}
                              </TableCell>
                              <TableCell>
                                <span
                                  className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${PHASE_COLOR[t.phase] ?? PHASE_COLOR.idle}`}
                                >
                                  {t.phase.replace(/_/g, ' ')}
                                </span>
                              </TableCell>
                              <TableCell className="text-[11px] text-muted whitespace-nowrap">
                                {formatProvider(t.provider)}
                              </TableCell>
                              <TableCell className="text-[11px] text-primary whitespace-nowrap">
                                {formatModelDescription(t.model, t.provider)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs text-primary">
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
                    {tasksTotalPages > 1 && (
                      <CardFooter className="pt-0 pb-4 px-5">
                        <Pagination
                          page={tasksPage}
                          totalPages={tasksTotalPages}
                          onPageChange={setTasksPage}
                          className="w-full"
                        />
                      </CardFooter>
                    )}
                  </Card>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold text-primary">{value}</div>
      {subtitle && <div className="mt-0.5 text-[11px] text-muted">{subtitle}</div>}
    </div>
  );
}
