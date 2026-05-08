import {
  type ActivePipelineSummary,
  type ActivityEntry,
  type DashboardOverview,
  type DashboardStats,
  formatCost,
  formatRelativeTime,
  type GitHubIssueCacheRecord,
  type PipelineAnalyticsOverview,
  type RecentTask,
} from '@shipcode/shared';
import { ActivePipelineCard, PageHeader, PhaseChip } from '@shipcode/ui';
import {
  Button,
  Card,
  CardContent,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shipshitdev/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Bot, Gauge, ListTodo, PackageCheck, Timer } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber';
import { useAppStore } from '../stores/app-store';

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  tone?: 'default' | 'danger' | 'success' | 'agent';
  icon?: ReactNode;
  onClick?: () => void;
}

function StatCard({ label, value, subtitle, tone = 'default', icon, onClick }: StatCardProps) {
  const toneClass =
    tone === 'danger'
      ? 'border-danger/40 bg-danger/5'
      : tone === 'success'
        ? 'border-success/40 bg-success/5'
        : tone === 'agent'
          ? 'border-agent/35 bg-agent/[0.04]'
          : '';
  const iconColor =
    tone === 'agent'
      ? 'var(--color-agent)'
      : tone === 'danger'
        ? 'var(--color-danger)'
        : tone === 'success'
          ? 'var(--color-success)'
          : 'var(--text-muted)';
  const card = (
    <Card
      className={`w-full h-full${toneClass ? ` ${toneClass}` : ''}${onClick ? ' hover:ring-1 hover:ring-border' : ''}`}
    >
      <CardContent className="p-5 pt-5">
        <div className="flex items-start justify-between">
          <div className="text-3xl font-semibold text-primary">{value}</div>
          {icon && <div style={{ color: iconColor }}>{icon}</div>}
        </div>
        <div className="mt-1 text-xs uppercase tracking-wide text-secondary">{label}</div>
        {subtitle ? <div className="mt-2 text-[11px] text-muted">{subtitle}</div> : null}
      </CardContent>
    </Card>
  );
  if (onClick) {
    return (
      <Button
        variant="ghost"
        onClick={onClick}
        className="h-full w-full whitespace-normal p-0 text-left font-normal hover:bg-transparent"
      >
        {card}
      </Button>
    );
  }
  return card;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function OverviewView() {
  const queryClient = useQueryClient();
  const selectProject = useAppStore((s) => s.selectProject);
  const selectThread = useAppStore((s) => s.selectThread);
  const selectIssue = useAppStore((s) => s.selectIssue);
  const setGithubIssues = useAppStore((s) => s.setGithubIssues);
  const setTerminalThread = useAppStore((s) => s.setTerminalThread);
  const openTerminal = useAppStore((s) => s.openTerminal);
  const openActivity = useAppStore((s) => s.openActivity);
  const openInbox = useAppStore((s) => s.openInbox);

  const PAGE_SIZE = 5;
  const [activityPage, setActivityPage] = useState(1);
  const [tasksPage, setTasksPage] = useState(1);

  const { data: overview } = useQuery<DashboardOverview>({
    queryKey: ['dashboard', 'overview', activityPage, tasksPage],
    queryFn: () =>
      window.shipcode.invoke<DashboardOverview>('dashboard:get-overview', {
        activityLimit: PAGE_SIZE,
        activityOffset: (activityPage - 1) * PAGE_SIZE,
        recentLimit: PAGE_SIZE,
        recentOffset: (tasksPage - 1) * PAGE_SIZE,
      }),
  });
  const { data: analytics } = useQuery<PipelineAnalyticsOverview>({
    queryKey: ['pipeline-analytics', 'overview'],
    queryFn: () =>
      window.shipcode.invoke<PipelineAnalyticsOverview>('pipeline-analytics:get-overview'),
  });
  const stats: DashboardStats | undefined = overview?.stats;
  const animatedAgents = useAnimatedNumber(stats?.agentsRunning ?? 0);
  const animatedTasks = useAnimatedNumber(stats?.tasksInProgress ?? 0);
  const animatedApprovals = useAnimatedNumber(stats?.pendingApprovals ?? 0);
  const animatedShipped = useAnimatedNumber(stats?.shippedLast7d ?? 0, 800);
  const running: ActivePipelineSummary[] = overview?.running ?? [];
  const activity: ActivityEntry[] = overview?.activity ?? [];
  const activityTotal = overview?.activityTotal ?? 0;
  const recent: RecentTask[] = overview?.recent ?? [];
  const recentTotal = overview?.recentTotal ?? 0;

  const activityTotalPages = Math.max(1, Math.ceil(activityTotal / PAGE_SIZE));
  const tasksTotalPages = Math.max(1, Math.ceil(recentTotal / PAGE_SIZE));
  const activitySlice = activity;
  const tasksSlice = recent;
  const bottleneck = analytics?.averagePhaseDurations[0] ?? null;
  const analyticsCost =
    analytics?.tokensByPhase.reduce((sum, phase) => sum + phase.costUsd, 0) ?? 0;

  // Click-through from Mission Control rows: switch project, fetch its issues,
  // and open the IssueDetail sidebar for the matching threadId. Falls back to
  // selectThread alone if no cached issue matches (e.g. thread with no linked
  // GitHub issue).
  const handleRowClick = async (projectId: string, threadId: string) => {
    selectProject(projectId);
    selectThread(threadId);
    setTerminalThread(threadId);
    openTerminal();
    try {
      const issues = await window.shipcode.invoke<GitHubIssueCacheRecord[]>('github:list-issues', {
        projectId,
      });
      setGithubIssues(issues);
      const match = issues.find((i) => i.threadId === threadId) ?? null;
      if (match) selectIssue(match);
    } catch {
      // Best-effort — rows still navigate even if the issue fetch fails.
    }
  };

  const handleStop = async (threadId: string) => {
    await window.shipcode.invoke('pipeline:cancel', { threadId });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader title="Overview" subtitle="Live view of every agent across every project." />

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="flex flex-col gap-6 max-w-5xl">
          {/* Stat cards */}
          <div className="flex gap-4">
            {[
              {
                label: 'Agents Running',
                value: animatedAgents,
                subtitle: stats
                  ? Object.entries(stats.runningByPhase ?? {})
                      .map(([phase, n]) => `${n} ${phase.replace(/_/g, ' ')}`)
                      .join(', ') || 'idle'
                  : '—',
                tone: (stats && stats.agentsRunning > 0 ? 'agent' : 'default') as
                  | 'agent'
                  | 'default',
                icon: <Bot size={18} />,
              },
              {
                label: 'Tasks In Progress',
                value: animatedTasks,
                subtitle: stats ? `${stats.tasksOpen} open · ${stats.tasksBlocked} blocked` : '—',
                tone: (stats && stats.tasksInProgress > 0 ? 'agent' : 'default') as
                  | 'agent'
                  | 'default',
                icon: <ListTodo size={18} />,
                onClick: openInbox,
              },
              {
                label: 'Pending Approvals',
                value: animatedApprovals,
                subtitle: stats?.staleApprovals
                  ? `${stats.staleApprovals} stale > 24h`
                  : 'no stale items',
                tone: (stats && stats.pendingApprovals > 0 ? 'danger' : 'default') as
                  | 'danger'
                  | 'default',
                icon: <Bell size={18} />,
                onClick: openInbox,
              },
              {
                label: 'Shipped (7d)',
                value: animatedShipped,
                subtitle: stats ? `${stats.failedLast7d} failed` : '—',
                tone: 'success' as const,
                icon: <PackageCheck size={18} />,
                onClick: openActivity,
              },
            ].map((card) => (
              <div key={card.label} className="flex-1 min-w-0">
                <StatCard {...card} />
              </div>
            ))}
          </div>

          {/* Running Agents — always first after stats */}
          <div>
            <h2 className="text-sm font-semibold text-primary mb-3">Running Agents</h2>
            {running.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
                No agents running. Start a pipeline to see live status here.
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {running.map((row) => (
                  <div key={row.threadId} className="min-w-[280px] max-w-[360px] flex-1">
                    <ActivePipelineCard
                      projectName={row.projectName}
                      title={row.threadTitle}
                      phase={row.phase}
                      approvedAwaitingExecution={row.approvedAwaitingExecution}
                      startedAt={row.startedAt}
                      issueNumber={row.githubIssueNumber}
                      modelProvider={row.modelProvider}
                      model={row.model}
                      reasoningEffort={row.reasoningEffort}
                      onClick={() => handleRowClick(row.projectId, row.threadId)}
                      onCancel={() => handleStop(row.threadId)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-sm font-semibold text-primary mb-3">Iteration Analytics</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <StatCard
                label="Median Time To PR"
                value={formatDuration(analytics?.timeToPr.medianMs)}
                subtitle={`${analytics?.timeToPr.sampleSize ?? 0} shipped sample${analytics?.timeToPr.sampleSize === 1 ? '' : 's'}`}
                icon={<Timer size={18} />}
              />
              <StatCard
                label="P75 Time To PR"
                value={formatDuration(analytics?.timeToPr.p75Ms)}
                subtitle={`p95 ${formatDuration(analytics?.timeToPr.p95Ms)}`}
                icon={<Timer size={18} />}
              />
              <StatCard
                label="Bottleneck Phase"
                value={bottleneck ? bottleneck.phase.replace(/_/g, ' ') : '—'}
                subtitle={bottleneck ? `avg ${formatDuration(bottleneck.averageMs)}` : 'no data'}
                tone={bottleneck ? 'agent' : 'default'}
                icon={<Gauge size={18} />}
              />
              <StatCard
                label="Tokens / Cost"
                value={formatCost(analyticsCost)}
                subtitle={`${analytics?.tokensByPhase.reduce((sum, phase) => sum + phase.promptTokens + phase.completionTokens, 0).toLocaleString() ?? 0} tokens`}
                icon={<Bot size={18} />}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardContent className="p-0">
                  {(analytics?.averagePhaseDurations.length ?? 0) === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
                      No phase timing data yet.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Phase</TableHead>
                          <TableHead className="text-right">Avg</TableHead>
                          <TableHead className="text-right">P75</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(analytics?.averagePhaseDurations ?? []).slice(0, 5).map((phase) => (
                          <TableRow key={phase.phase}>
                            <TableCell>
                              <PhaseChip status={phase.phase} />
                            </TableCell>
                            <TableCell className="text-right text-[11px] text-primary">
                              {formatDuration(phase.averageMs)}
                            </TableCell>
                            <TableCell className="text-right text-[11px] text-muted">
                              {formatDuration(phase.p75Ms)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-0">
                  {(analytics?.slowestRecentRuns.length ?? 0) === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
                      No completed PR runs yet.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Slow Run</TableHead>
                          <TableHead className="text-right">Duration</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(analytics?.slowestRecentRuns ?? []).map((run) => (
                          <TableRow
                            key={run.threadId}
                            className="cursor-pointer hover:bg-hover"
                            onClick={() => selectThread(run.threadId)}
                          >
                            <TableCell className="max-w-0">
                              <div className="truncate text-[12px] text-primary">
                                {run.githubPrNumber ? `#${run.githubPrNumber} ` : ''}
                                {run.title}
                              </div>
                              <div className="truncate text-[11px] text-muted">
                                {run.projectName ?? 'Unknown project'}
                                {run.bottleneckPhase
                                  ? ` · ${run.bottleneckPhase.replace(/_/g, ' ')}`
                                  : ''}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-[11px] text-primary">
                              {formatDuration(run.durationMs)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Activity + Recent tasks */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-primary">Recent Activity</h2>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={openActivity}
                  className="h-auto px-0 text-[11px] font-normal text-muted hover:bg-transparent capitalize"
                >
                  View all →
                </Button>
              </div>
              <Card>
                <CardContent className="p-0">
                  {activity.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
                      No activity yet.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="sr-only">
                        <TableRow>
                          <TableHead>Actor</TableHead>
                          <TableHead>Activity</TableHead>
                          <TableHead>Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activitySlice.map((entry) => {
                          const clickable = entry.projectId !== null && entry.threadId !== null;
                          const projectId = entry.projectId;
                          const threadId = entry.threadId;

                          return (
                            <TableRow
                              key={entry.id}
                              className={clickable ? 'cursor-pointer hover:bg-hover' : undefined}
                              onClick={() => {
                                if (projectId && threadId) {
                                  handleRowClick(projectId, threadId);
                                }
                              }}
                            >
                              <TableCell className="w-px whitespace-nowrap pr-2 align-top pt-2.5">
                                <span className="inline-flex items-center justify-center rounded border border-border bg-tertiary px-1 py-0.5 text-[9px] uppercase text-secondary">
                                  {entry.actor}
                                </span>
                              </TableCell>
                              <TableCell className="max-w-0 w-full">
                                <div className="truncate text-[12px] text-primary">
                                  {entry.title}
                                </div>
                                <div className="truncate text-[11px] text-muted">
                                  {entry.subtitle || '–'}
                                </div>
                              </TableCell>
                              <TableCell className="w-px whitespace-nowrap text-right text-[10px] text-muted">
                                {formatRelativeTime(entry.createdAt)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
              {activityTotalPages > 1 && (
                <div className="mt-3 px-1">
                  <Pagination
                    page={activityPage}
                    totalPages={activityTotalPages}
                    onPageChange={setActivityPage}
                    className="w-full"
                  />
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-primary">Recent Tasks</h2>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={openInbox}
                  className="h-auto px-0 text-[11px] font-normal text-muted hover:bg-transparent capitalize"
                >
                  View all →
                </Button>
              </div>
              <Card>
                <CardContent className="p-0">
                  {recent.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
                      No recent tasks.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="sr-only">
                        <TableRow>
                          <TableHead>Phase</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead>Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tasksSlice.map((task) => (
                          <TableRow
                            key={task.threadId}
                            className="cursor-pointer hover:bg-hover"
                            onClick={() => handleRowClick(task.projectId, task.threadId)}
                          >
                            <TableCell className="w-px whitespace-nowrap pr-2 align-top pt-2.5">
                              <PhaseChip status={task.phase} />
                            </TableCell>
                            <TableCell className="max-w-0 w-full">
                              <div className="truncate text-[12px] text-primary">
                                {task.githubIssueNumber ? `#${task.githubIssueNumber} ` : ''}
                                {task.title}
                              </div>
                              <div className="truncate text-[11px] text-muted">
                                {task.projectName} · {task.phase.replace(/_/g, ' ')}
                              </div>
                            </TableCell>
                            <TableCell className="w-px whitespace-nowrap text-right text-[10px] text-muted align-top pt-2.5">
                              {formatRelativeTime(task.updatedAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
              {tasksTotalPages > 1 && (
                <div className="mt-3 px-1">
                  <Pagination
                    page={tasksPage}
                    totalPages={tasksTotalPages}
                    onPageChange={setTasksPage}
                    className="w-full"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
