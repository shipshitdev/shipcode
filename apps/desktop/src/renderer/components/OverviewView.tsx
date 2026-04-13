import type {
  ActivePipelineSummary,
  ActivityEntry,
  DashboardStats,
  GitHubIssueCacheRecord,
  RecentTask,
} from '@shipcode/shared';
import {
  Bell,
  Bot,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  ListTodo,
  PackageCheck,
  Pagination,
  PhaseChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shipcode/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { useAppStore } from '../stores/app-store';

function timeAgo(input: string | number): string {
  const t = typeof input === 'number' ? input : new Date(input).getTime();
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function ElapsedClock({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Date.now() - since;
  const s = Math.floor(elapsed / 1000);
  if (s < 60) return <>{s}s</>;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60)
    return (
      <>
        {m}m {rem}s
      </>
    );
  const h = Math.floor(m / 60);
  return (
    <>
      {h}h {m % 60}m
    </>
  );
}

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

export function OverviewView() {
  const queryClient = useQueryClient();
  const selectProject = useAppStore((s) => s.selectProject);
  const selectThread = useAppStore((s) => s.selectThread);
  const selectIssue = useAppStore((s) => s.selectIssue);
  const setGithubIssues = useAppStore((s) => s.setGithubIssues);
  const openActivity = useAppStore((s) => s.openActivity);
  const openInbox = useAppStore((s) => s.openInbox);

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => window.shipcode.invoke<DashboardStats>('dashboard:get-stats'),
  });

  const { data: running = [] } = useQuery<ActivePipelineSummary[]>({
    queryKey: ['dashboard', 'running'],
    queryFn: () => window.shipcode.invoke<ActivePipelineSummary[]>('pipeline:list-active'),
  });

  const PAGE_SIZE = 5;
  const [activityPage, setActivityPage] = useState(1);
  const [tasksPage, setTasksPage] = useState(1);

  const { data: activity = [] } = useQuery<ActivityEntry[]>({
    queryKey: ['dashboard', 'activity', activityPage],
    queryFn: () =>
      window.shipcode.invoke<ActivityEntry[]>('dashboard:get-activity', {
        limit: PAGE_SIZE,
        offset: (activityPage - 1) * PAGE_SIZE,
      }),
  });

  const { data: activityTotal = 0 } = useQuery<number>({
    queryKey: ['dashboard', 'activity-count'],
    queryFn: () => window.shipcode.invoke<number>('dashboard:count-activity'),
  });

  const { data: recent = [] } = useQuery<RecentTask[]>({
    queryKey: ['dashboard', 'recent', tasksPage],
    queryFn: () =>
      window.shipcode.invoke<RecentTask[]>('dashboard:get-recent-tasks', {
        limit: PAGE_SIZE,
        offset: (tasksPage - 1) * PAGE_SIZE,
      }),
  });

  const { data: recentTotal = 0 } = useQuery<number>({
    queryKey: ['dashboard', 'recent-count'],
    queryFn: () => window.shipcode.invoke<number>('dashboard:count-recent-tasks'),
  });

  const activityTotalPages = Math.max(1, Math.ceil(activityTotal / PAGE_SIZE));
  const tasksTotalPages = Math.max(1, Math.ceil(recentTotal / PAGE_SIZE));
  const activitySlice = activity;
  const tasksSlice = recent;

  // Click-through from Mission Control rows: switch project, fetch its issues,
  // and open the IssueDetail sidebar for the matching threadId. Falls back to
  // selectThread alone if no cached issue matches (e.g. thread with no linked
  // GitHub issue).
  const handleRowClick = async (projectId: string, threadId: string) => {
    selectProject(projectId);
    selectThread(threadId);
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
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-base font-semibold text-primary">Overview</h1>
          <p className="text-xs text-muted">Live view of every agent across every project.</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="flex flex-col gap-6 max-w-5xl">
          {/* Stat cards */}
          <div className="flex gap-4">
            {[
              {
                label: 'Agents Running',
                value: stats?.agentsRunning ?? 0,
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
                value: stats?.tasksInProgress ?? 0,
                subtitle: stats ? `${stats.tasksOpen} open · ${stats.tasksBlocked} blocked` : '—',
                tone: (stats && stats.tasksInProgress > 0 ? 'agent' : 'default') as
                  | 'agent'
                  | 'default',
                icon: <ListTodo size={18} />,
                onClick: openInbox,
              },
              {
                label: 'Pending Approvals',
                value: stats?.pendingApprovals ?? 0,
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
                value: stats?.shippedLast7d ?? 0,
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
          <Card>
            <CardHeader>
              <CardTitle>Running Agents</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {running.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
                  No agents running. Start a pipeline to see live status here.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {running.map((row) => (
                    <li key={row.threadId} className="flex items-center gap-3 py-2.5">
                      <Button
                        variant="ghost"
                        onClick={() => handleRowClick(row.projectId, row.threadId)}
                        className="h-auto flex-1 justify-start gap-3 px-0 py-0 text-left font-normal hover:bg-transparent"
                      >
                        <span className="inline-flex shrink-0 items-center rounded-md border border-border bg-tertiary px-1.5 py-0.5 text-[10px] text-secondary">
                          {row.projectName}
                        </span>
                        <span className="flex-1 truncate text-[13px] text-primary">
                          {row.threadTitle}
                        </span>
                        <PhaseChip status={row.phase} />
                        <span className="w-16 text-right text-[11px] tabular-nums text-muted">
                          <ElapsedClock since={row.startedAt} />
                        </span>
                      </Button>
                      <Button
                        size="xs"
                        variant="destructive"
                        onClick={() => handleStop(row.threadId)}
                      >
                        Stop
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Activity + Recent tasks */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Recent Activity</CardTitle>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={openActivity}
                    className="h-auto px-0 text-[11px] font-normal text-muted hover:bg-transparent capitalize"
                  >
                    View all →
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
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
                      {activitySlice.map((entry) => (
                        <TableRow
                          key={entry.id}
                          className="cursor-pointer hover:bg-hover"
                          onClick={() => {
                            if (entry.projectId && entry.threadId) {
                              handleRowClick(entry.projectId, entry.threadId);
                            }
                          }}
                        >
                          <TableCell className="w-px whitespace-nowrap pr-2 align-top pt-2.5">
                            <span className="inline-flex items-center justify-center rounded border border-border bg-tertiary px-1 py-0.5 text-[9px] uppercase text-secondary">
                              {entry.actor}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-0 w-full">
                            <div className="truncate text-[12px] text-primary">{entry.title}</div>
                            {entry.subtitle ? (
                              <div className="truncate text-[11px] text-muted">
                                {entry.subtitle}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="w-px whitespace-nowrap text-right text-[10px] text-muted">
                            {timeAgo(entry.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
              {activityTotalPages > 1 && (
                <CardFooter className="pt-0 pb-4 px-5">
                  <Pagination
                    page={activityPage}
                    totalPages={activityTotalPages}
                    onPageChange={setActivityPage}
                    className="w-full"
                  />
                </CardFooter>
              )}
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Recent Tasks</CardTitle>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={openInbox}
                    className="h-auto px-0 text-[11px] font-normal text-muted hover:bg-transparent capitalize"
                  >
                    View all →
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
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
                            {timeAgo(task.updatedAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
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
          </div>
        </div>
      </div>
    </div>
  );
}
