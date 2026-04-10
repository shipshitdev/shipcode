import { useEffect, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import type {
  ActivePipelineSummary,
  ActivityEntry,
  DashboardStats,
  PipelinePhase,
  Project,
  RecentTask,
} from '@shipcode/shared'
import { Card, CardContent, CardHeader, CardTitle, Button, Folder, Plus } from '@shipcode/ui'
import { useAppStore } from '../stores/app-store'

const PHASE_COLOR: Partial<Record<PipelinePhase, string>> = {
  planning: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  reviewing: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  revising: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  awaiting_approval: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  executing: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  verifying: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  shipping: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  completed: 'bg-success/15 text-success border-success/30',
  failed: 'bg-danger/15 text-danger border-danger/30',
  idle: 'bg-bg-tertiary text-text-muted border-border',
}

function PhaseChip({ phase }: { phase: PipelinePhase }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        PHASE_COLOR[phase] ?? PHASE_COLOR.idle
      }`}
    >
      {phase.replace(/_/g, ' ')}
    </span>
  )
}

function timeAgo(input: string | number): string {
  const t = typeof input === 'number' ? input : new Date(input).getTime()
  const diff = Math.max(0, Date.now() - t)
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function ElapsedClock({ since }: { since: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const elapsed = Date.now() - since
  const s = Math.floor(elapsed / 1000)
  if (s < 60) return <>{s}s</>
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return <>{m}m {rem}s</>
  const h = Math.floor(m / 60)
  return <>{h}h {m % 60}m</>
}

interface StatCardProps {
  label: string
  value: string | number
  subtitle?: string
  tone?: 'default' | 'danger' | 'success'
}

function StatCard({ label, value, subtitle, tone = 'default' }: StatCardProps) {
  const toneClass =
    tone === 'danger'
      ? 'border-danger/40 bg-danger/5'
      : tone === 'success'
      ? 'border-success/40 bg-success/5'
      : ''
  return (
    <Card className={toneClass}>
      <CardContent className="p-5 pt-5">
        <div className="text-3xl font-semibold text-text-primary">{value}</div>
        <div className="mt-1 text-xs uppercase tracking-wide text-text-secondary">{label}</div>
        {subtitle ? (
          <div className="mt-2 text-[11px] text-text-muted">{subtitle}</div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function DashboardView() {
  const queryClient = useQueryClient()
  const selectProject = useAppStore((s) => s.selectProject)
  const selectThread = useAppStore((s) => s.selectThread)

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => window.shipcode.invoke<DashboardStats>('dashboard:get-stats'),
    refetchInterval: 5000,
  })

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => window.shipcode.invoke<Project[]>('project:list'),
  })

  const addProject = useMutation({
    mutationFn: async () => {
      const projectPath = await window.shipcode.invoke<string | null>('dialog:open-directory')
      if (!projectPath) return null
      return window.shipcode.invoke<Project>('project:add', { path: projectPath })
    },
    onSuccess: (project) => {
      if (project) {
        queryClient.invalidateQueries({ queryKey: ['projects'] })
        selectProject(project.id)
      }
    },
  })

  const recentProjects = [...projects]
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 8)

  const { data: running = [] } = useQuery<ActivePipelineSummary[]>({
    queryKey: ['dashboard', 'running'],
    queryFn: () => window.shipcode.invoke<ActivePipelineSummary[]>('pipeline:list-active'),
    refetchInterval: 2000,
  })

  const { data: activity = [] } = useQuery<ActivityEntry[]>({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => window.shipcode.invoke<ActivityEntry[]>('dashboard:get-activity', { limit: 30 }),
    refetchInterval: 5000,
  })

  const { data: recent = [] } = useQuery<RecentTask[]>({
    queryKey: ['dashboard', 'recent'],
    queryFn: () => window.shipcode.invoke<RecentTask[]>('dashboard:get-recent-tasks', { limit: 12 }),
    refetchInterval: 5000,
  })

  const handleRowClick = (projectId: string, threadId: string) => {
    selectProject(projectId)
    selectThread(threadId)
  }

  const handleStop = async (threadId: string) => {
    await window.shipcode.invoke('pipeline:cancel', { threadId })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Mission Control</h1>
          <p className="text-xs text-text-muted">Live view of every agent across every project.</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto grid max-w-6xl gap-6">
          {/* Stat cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Agents Running"
              value={stats?.agentsRunning ?? 0}
              subtitle={
                stats
                  ? Object.entries(stats.runningByPhase ?? {})
                      .map(([phase, n]) => `${n} ${phase.replace(/_/g, ' ')}`)
                      .join(', ') || 'idle'
                  : '—'
              }
            />
            <StatCard
              label="Tasks In Progress"
              value={stats?.tasksInProgress ?? 0}
              subtitle={stats ? `${stats.tasksOpen} open · ${stats.tasksBlocked} blocked` : '—'}
            />
            <StatCard
              label="Pending Approvals"
              value={stats?.pendingApprovals ?? 0}
              subtitle={
                stats?.staleApprovals
                  ? `${stats.staleApprovals} stale > 24h`
                  : 'no stale items'
              }
              tone={stats && stats.pendingApprovals > 0 ? 'danger' : 'default'}
            />
            <StatCard
              label="Shipped (7d)"
              value={stats?.shippedLast7d ?? 0}
              subtitle={stats ? `${stats.failedLast7d} failed` : '—'}
              tone="success"
            />
          </div>

          {/* Projects — quick switcher + add repo */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Projects</CardTitle>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => addProject.mutate()}
                  disabled={addProject.isPending}
                >
                  <Plus size={12} />
                  Add repository
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {recentProjects.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-text-muted">
                  No projects yet. Click <span className="text-text-secondary">Add repository</span> to get started.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {recentProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => selectProject(project.id)}
                      className="group flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-bg-hover"
                    >
                      <Folder size={14} className="shrink-0 text-text-muted group-hover:text-text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-text-primary">
                          {project.name}
                        </div>
                        <div className="truncate text-[10px] text-text-muted">
                          {project.path}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Running Agents */}
          <Card>
            <CardHeader>
              <CardTitle>Running Agents</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {running.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-text-muted">
                  No agents running. Start a pipeline to see live status here.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {running.map((row) => (
                    <li
                      key={row.threadId}
                      className="flex items-center gap-3 py-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => handleRowClick(row.projectId, row.threadId)}
                        className="flex flex-1 cursor-pointer items-center gap-3 border-none bg-transparent text-left"
                      >
                        <span className="inline-flex shrink-0 items-center rounded-md border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-secondary">
                          {row.projectName}
                        </span>
                        <span className="flex-1 truncate text-[13px] text-text-primary">
                          {row.threadTitle}
                        </span>
                        <PhaseChip phase={row.phase} />
                        <span className="w-16 text-right text-[11px] tabular-nums text-text-muted">
                          <ElapsedClock since={row.startedAt} />
                        </span>
                      </button>
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
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {activity.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-text-muted">
                    No activity yet.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {activity.map((entry) => (
                      <li key={entry.id} className="flex items-start gap-2 text-[12px]">
                        <span className="mt-0.5 inline-flex w-12 shrink-0 items-center justify-center rounded border border-border bg-bg-tertiary px-1 py-0.5 text-[9px] uppercase text-text-muted">
                          {entry.actor}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (entry.projectId && entry.threadId) {
                              handleRowClick(entry.projectId, entry.threadId)
                            }
                          }}
                          className="flex-1 cursor-pointer border-none bg-transparent text-left text-text-secondary hover:text-text-primary"
                        >
                          <div className="truncate">{entry.title}</div>
                          {entry.subtitle ? (
                            <div className="truncate text-[11px] text-text-muted">{entry.subtitle}</div>
                          ) : null}
                        </button>
                        <span className="text-[10px] text-text-muted">{timeAgo(entry.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Tasks</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {recent.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-text-muted">
                    No recent tasks.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {recent.map((task) => (
                      <li key={task.threadId} className="flex items-center gap-2 text-[12px]">
                        <PhaseChip phase={task.phase} />
                        <button
                          type="button"
                          onClick={() => handleRowClick(task.projectId, task.threadId)}
                          className="flex-1 cursor-pointer truncate border-none bg-transparent text-left text-text-secondary hover:text-text-primary"
                        >
                          {task.githubIssueNumber ? `#${task.githubIssueNumber} ` : ''}
                          {task.title}
                        </button>
                        <span className="text-[10px] text-text-muted">{timeAgo(task.updatedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
