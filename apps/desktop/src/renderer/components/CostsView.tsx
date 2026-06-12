import type {
  CostSummary,
  CostTaskSummary,
  GitHubIssueCacheRecord,
  PipelineAnalyticsOverview,
  PipelinePhase,
} from '@shipcode/shared';
import {
  formatCost,
  formatDurationMilliseconds,
  formatTokenCount,
  modelDisplay,
  sanitizeResolvedModel,
} from '@shipcode/shared';
import { PageHeader } from '@shipcode/ui';
import {
  Button,
  Card,
  CardContent,
  cn,
  Pagination,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shipshitdev/ui';
import { useQuery } from '@tanstack/react-query';
import { Coins } from 'lucide-react';
import { useReducer } from 'react';
import { useAppStore } from '../stores/app-store';
import { CostByProjectChart } from './costs/CostByProjectChart';
import { PhaseDurationsChart } from './costs/PhaseDurationsChart';
import { TokensByPhaseChart } from './costs/TokensByPhaseChart';
import { ActivityHeatmap } from './heatmap/ActivityHeatmap';

const COST_STAT_LOADING_KEYS = ['cost-stat-1', 'cost-stat-2', 'cost-stat-3'];
const COST_PROJECT_LOADING_KEYS = ['cost-project-1', 'cost-project-2', 'cost-project-3'];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatModelDescription(model: string | null, provider: string): string {
  return modelDisplay(sanitizeResolvedModel(model) ?? provider);
}

// See OverviewView for why all 6 agent phases share one color.
const AGENT_PHASE_CLASSES = 'bg-agent/10 text-agent border-agent/25';

const PHASE_COLOR: Partial<Record<PipelinePhase, string>> = {
  planning: AGENT_PHASE_CLASSES,
  clarifying: 'bg-warning/12 text-warning border-warning/25',
  reviewing: AGENT_PHASE_CLASSES,
  revising: AGENT_PHASE_CLASSES,
  executing: AGENT_PHASE_CLASSES,
  verifying: AGENT_PHASE_CLASSES,
  shipping: AGENT_PHASE_CLASSES,
  approval: 'bg-warning/15 text-warning border-warning/30',
  completed: 'bg-success/15 text-success border-success/30',
  failed: 'bg-danger/15 text-danger border-danger/30',
  idle: 'bg-secondary text-muted-foreground border-border',
};

type DisplayMode = '$' | 'tokens';

interface CostsViewState {
  displayMode: DisplayMode;
  navigatingThreadId: string | null;
  tasksPage: number;
  selectedProjectId: string | null;
  projectPage: number;
}

type CostsViewAction =
  | { type: 'display-mode'; value: DisplayMode }
  | { type: 'navigating-thread'; threadId: string | null }
  | { type: 'tasks-page'; page: number }
  | { type: 'project-page'; page: number }
  | { type: 'toggle-project'; projectId: string };

const INITIAL_COSTS_VIEW_STATE: CostsViewState = {
  displayMode: 'tokens',
  navigatingThreadId: null,
  tasksPage: 1,
  selectedProjectId: null,
  projectPage: 1,
};

function costsViewReducer(state: CostsViewState, action: CostsViewAction): CostsViewState {
  switch (action.type) {
    case 'display-mode':
      return { ...state, displayMode: action.value };
    case 'navigating-thread':
      return { ...state, navigatingThreadId: action.threadId };
    case 'tasks-page':
      return { ...state, tasksPage: action.page };
    case 'project-page':
      return { ...state, projectPage: action.page };
    case 'toggle-project':
      return {
        ...state,
        selectedProjectId: state.selectedProjectId === action.projectId ? null : action.projectId,
        projectPage: 1,
      };
  }
}

export function CostsView() {
  const selectProject = useAppStore((state) => state.selectProject);
  const selectThread = useAppStore((state) => state.selectThread);
  const selectIssue = useAppStore((state) => state.selectIssue);
  const setGithubIssues = useAppStore((state) => state.setGithubIssues);
  // Default to tokens because token counts are exact for every provider,
  // whereas USD amounts are only real for OpenRouter (billed) and are
  // best-effort estimates for Claude/Codex CLI runs priced from published rates.
  const [{ displayMode, navigatingThreadId, tasksPage, selectedProjectId, projectPage }, dispatch] =
    useReducer(costsViewReducer, INITIAL_COSTS_VIEW_STATE);
  const PAGE_SIZE = 8;

  // Click-through from the Top Tasks table: switch project, fetch its issues,
  // and open the IssueDetail sidebar for the matching threadId. The previous
  // implementation called selectIssue(null) which closed the panel instead of
  // opening it.
  const goToTask = async (projectId: string, threadId: string) => {
    dispatch({ type: 'navigating-thread', threadId });
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
      dispatch({ type: 'navigating-thread', threadId: null });
    }
  };

  const { data, isLoading, isError, refetch } = useQuery<CostSummary>({
    queryKey: ['costs-summary'],
    queryFn: () => window.shipcode.invoke<CostSummary>('costs:get-summary'),
    // Event-driven: invalidated by pipeline:model-resolved in useIpc.
  });

  const { data: tasks = [] } = useQuery<CostTaskSummary[]>({
    queryKey: ['costs-tasks', tasksPage],
    queryFn: () =>
      window.shipcode.invoke<CostTaskSummary[]>('costs:list-tasks', {
        limit: PAGE_SIZE,
        offset: (tasksPage - 1) * PAGE_SIZE,
      }),
    // Event-driven: invalidated by pipeline:model-resolved in useIpc.
  });

  const { data: tasksTotal = 0 } = useQuery<number>({
    queryKey: ['costs-tasks-count'],
    queryFn: () => window.shipcode.invoke<number>('costs:count-tasks'),
    // Event-driven: invalidated by pipeline:model-resolved in useIpc.
  });

  const { data: projectTasks = [] } = useQuery<CostTaskSummary[]>({
    queryKey: ['costs-project-tasks', selectedProjectId, projectPage],
    queryFn: () => {
      if (!selectedProjectId) return [];
      return window.shipcode.invoke<CostTaskSummary[]>('costs:list-tasks', {
        projectId: selectedProjectId,
        limit: PAGE_SIZE,
        offset: (projectPage - 1) * PAGE_SIZE,
      });
    },
    // Event-driven: invalidated by pipeline:model-resolved in useIpc.
    enabled: !!selectedProjectId,
  });

  const { data: projectTasksTotal = 0 } = useQuery<number>({
    queryKey: ['costs-project-tasks-count', selectedProjectId],
    queryFn: () => {
      if (!selectedProjectId) return 0;
      return window.shipcode.invoke<number>('costs:count-tasks', { projectId: selectedProjectId });
    },
    // Event-driven: invalidated by pipeline:model-resolved in useIpc.
    enabled: !!selectedProjectId,
  });

  const { data: analytics } = useQuery<PipelineAnalyticsOverview>({
    queryKey: ['pipeline-analytics', 'overview'],
    queryFn: () =>
      window.shipcode.invoke<PipelineAnalyticsOverview>('pipeline-analytics:get-overview'),
  });

  const tasksTotalPages = Math.max(1, Math.ceil(tasksTotal / PAGE_SIZE));
  const projectTasksTotalPages = Math.max(1, Math.ceil(projectTasksTotal / PAGE_SIZE));
  const selectedProjectName =
    data?.byProject.find((project) => project.projectId === selectedProjectId)?.projectName ??
    'Project';

  function displayValue(costUsd: number, tokens: number): string {
    if (displayMode === 'tokens') return formatTokenCount(tokens);
    return formatCost(costUsd);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Costs"
        subtitle="Token usage and spend across all pipelines."
        actions={
          <div className="flex items-center rounded-md border border-border bg-secondary p-0.5 text-[11px]">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => dispatch({ type: 'display-mode', value: '$' })}
              className={cn(
                displayMode === '$'
                  ? 'bg-tertiary text-primary font-medium'
                  : 'text-muted-foreground',
              )}
              aria-label="Show costs in US dollars"
            >
              USD
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => dispatch({ type: 'display-mode', value: 'tokens' })}
              className={cn(
                displayMode === 'tokens'
                  ? 'bg-tertiary text-primary font-medium'
                  : 'text-muted-foreground',
              )}
              aria-label="Show costs in tokens"
            >
              Tokens
            </Button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl space-y-6">
          {isError && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-sm text-secondary">Failed to load cost data.</p>
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          )}

          {/* Stat cards — skeleton while loading, real values when data arrives */}
          {isLoading && !data ? (
            <div className="grid grid-cols-3 gap-4">
              {COST_STAT_LOADING_KEYS.map((key) => (
                <Skeleton key={key} className="h-[76px] rounded-lg" />
              ))}
            </div>
          ) : data ? (
            <div className="grid grid-cols-3 gap-4">
              <StatCard
                label="All-time"
                value={displayValue(data.totalCostAllTime, data.totalTokensAllTime)}
                subtitle={
                  displayMode === '$'
                    ? `${formatTokenCount(data.totalTokensAllTime)} tokens`
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
          ) : null}

          {/* Activity heatmap — renders immediately, manages own data fetching */}
          <section className="rounded-xl border border-border bg-secondary p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-primary">Activity</h3>
              <p className="text-[11px] text-muted-foreground">All projects</p>
            </div>
            <ActivityHeatmap scope="global" surface="global" />
          </section>

          {/* Usage analytics charts */}
          <section>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
              Usage Analytics
            </h2>
            {!analytics ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Skeleton className="h-64 rounded-lg" />
                <Skeleton className="h-64 rounded-lg" />
              </div>
            ) : (
              <>
                <div
                  className={cn(
                    'grid gap-4',
                    data && data.byProject.length > 1
                      ? 'grid-cols-1 lg:grid-cols-2'
                      : 'grid-cols-1',
                  )}
                >
                  <TokensByPhaseChart
                    tokensByPhase={analytics.tokensByPhase}
                    displayMode={displayMode}
                  />
                  {data && data.byProject.length > 1 && (
                    <CostByProjectChart byProject={data.byProject} displayMode={displayMode} />
                  )}
                </div>
                {analytics.averagePhaseDurations.length > 0 && (
                  <PhaseDurationsChart
                    phaseDurations={analytics.averagePhaseDurations}
                    className="mt-4"
                  />
                )}
                {analytics.timeToPr.sampleSize > 0 && (
                  <div className="mt-4 grid grid-cols-3 gap-4">
                    <TimeToPrCard
                      label="Median Time to PR"
                      ms={analytics.timeToPr.medianMs}
                      samples={analytics.timeToPr.sampleSize}
                    />
                    <TimeToPrCard label="P75" ms={analytics.timeToPr.p75Ms} />
                    <TimeToPrCard label="P95" ms={analytics.timeToPr.p95Ms} />
                  </div>
                )}
              </>
            )}
          </section>

          {/* By project — skeleton while loading */}
          <ProjectCostsSection
            data={data}
            displayMode={displayMode}
            isLoading={isLoading}
            selectedProjectId={selectedProjectId}
            displayValue={displayValue}
            onToggleProject={(projectId) => dispatch({ type: 'toggle-project', projectId })}
          />

          {selectedProjectId && data && (
            <section>
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {selectedProjectName} Cost Details
              </h2>
              <CostTaskTable
                tasks={projectTasks}
                page={projectPage}
                totalPages={projectTasksTotalPages}
                onPageChange={(page) => dispatch({ type: 'project-page', page })}
                onTaskClick={goToTask}
                navigatingThreadId={navigatingThreadId}
                keyPrefix={`${selectedProjectId}-`}
              />
            </section>
          )}

          <section>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Top Tasks by Cost
            </h2>
            <CostTaskTable
              tasks={tasks}
              page={tasksPage}
              totalPages={tasksTotalPages}
              onPageChange={(page) => dispatch({ type: 'tasks-page', page })}
              onTaskClick={goToTask}
              navigatingThreadId={navigatingThreadId}
              showProjectName
              emptyMessage="No tasks yet."
            />
          </section>
        </div>
      </div>
    </div>
  );
}

function ProjectCostsSection({
  data,
  displayMode,
  isLoading,
  selectedProjectId,
  displayValue,
  onToggleProject,
}: {
  data?: CostSummary;
  displayMode: DisplayMode;
  isLoading: boolean;
  selectedProjectId: string | null;
  displayValue: (costUsd: number, tokens: number) => string;
  onToggleProject: (projectId: string) => void;
}) {
  if (isLoading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-3 w-20" />
        {COST_PROJECT_LOADING_KEYS.map((key) => (
          <Skeleton key={key} className="h-10 w-full rounded-md" />
        ))}
      </div>
    );
  }
  if (!data) return null;

  return (
    <section>
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        By Project
      </h2>
      {data.byProject.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-12 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted/10">
            <Coins size={20} className="text-muted-foreground/50" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">No cost data yet</p>
            <p className="text-xs text-muted-foreground/50">
              Run a pipeline to see cost breakdowns here.
            </p>
          </div>
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
              <TableBody className="[&_tr:last-child]:border-0">
                {data.byProject.map((project) => (
                  <TableRow
                    key={project.projectId}
                    className={cn(
                      'cursor-pointer hover:bg-hover',
                      selectedProjectId === project.projectId && 'bg-hover',
                    )}
                    onClick={() => onToggleProject(project.projectId)}
                  >
                    <TableCell className="font-medium text-primary">
                      {project.projectName}
                    </TableCell>
                    <TableCell className="text-right text-secondary">{project.taskCount}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-primary">
                      {displayValue(
                        project.totalCostUsd,
                        project.totalTokensPrompt + project.totalTokensCompletion,
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
  );
}

function CostTaskTable({
  tasks,
  page,
  totalPages,
  onPageChange,
  onTaskClick,
  navigatingThreadId,
  showProjectName = false,
  emptyMessage,
  keyPrefix = '',
}: {
  tasks: CostTaskSummary[];
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onTaskClick: (projectId: string, threadId: string) => void;
  navigatingThreadId: string | null;
  showProjectName?: boolean;
  emptyMessage?: string;
  keyPrefix?: string;
}) {
  if (tasks.length === 0 && emptyMessage) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-12 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted/10">
          <Coins size={20} className="text-muted-foreground/50" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phase</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-0">
              {tasks.map((task) => (
                <TableRow
                  key={`${keyPrefix}${task.threadId}`}
                  className={cn(
                    'cursor-pointer hover:bg-hover',
                    navigatingThreadId === task.threadId && 'opacity-60',
                  )}
                  onClick={() => onTaskClick(task.projectId, task.threadId)}
                >
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${PHASE_COLOR[task.phase] ?? PHASE_COLOR.idle}`}
                    >
                      {task.phase.replace(/_/g, ' ')}
                    </span>
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {task.updatedAt ? formatDateTime(task.updatedAt) : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-primary truncate max-w-[260px]">
                      {task.title}
                    </div>
                    {showProjectName && (
                      <div className="text-[11px] text-muted-foreground">{task.projectName}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {task.provider}
                  </TableCell>
                  <TableCell className="text-[11px] text-primary whitespace-nowrap">
                    {formatModelDescription(task.model, task.provider)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-primary">
                    {formatTokenCount(task.tokensPrompt + task.tokensCompletion)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-primary">
                    {formatCost(task.costUsd)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {totalPages > 1 && (
        <div className="mt-3 px-1">
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
            className="w-full"
          />
        </div>
      )}
    </>
  );
}

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-primary">{value}</div>
      {subtitle && <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div>}
    </div>
  );
}

function TimeToPrCard({
  label,
  ms,
  samples,
}: {
  label: string;
  ms: number | null;
  samples?: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-primary">
        {formatDurationMilliseconds(ms)}
      </div>
      {samples != null && (
        <div className="mt-0.5 text-[11px] text-muted">
          {samples} shipped sample{samples === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}
