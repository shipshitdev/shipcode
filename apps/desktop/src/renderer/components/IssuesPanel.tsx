import {
  type AppSettings,
  type GitHubIssueCacheRecord,
  type GitHubIssueTriageResult,
  githubRepoUrl,
  type IntegrationStatus,
  ISSUE_PIPELINE_STATUS,
  type IssuePipelineStatus,
  type ThreadPanelData as IssuesPanelData,
  isRealGithubIssueNumber,
  PIPELINE_PHASE,
  type Project,
  type ProjectOpenTarget,
  resolveRequireApproval,
  type TaskGraphWithNodes,
  THREAD_KIND,
  type Thread,
} from '@shipcode/shared';
import { isAutomationIssue, KanbanBoard } from '@shipcode/ui';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch,
} from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import log from 'electron-log/renderer';
import { Check, ChevronDown, RefreshCw, X } from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { toast } from '../stores/toast-store';
import { automationIssueNumber, automationThreadToIssue } from './issues-panel-automation';

// ReactFlow + CSS is heavy — lazy-load since graph tab is rarely the default view.
const ProjectGraphTab = lazy(() =>
  import('../features/project/project-graph-tab').then((m) => ({ default: m.ProjectGraphTab })),
);

import { useAppStore } from '../stores/app-store';
import { currentIsoTimestamp } from './format-timestamp';
import { ProjectOpenTargetIcon } from './ProjectOpenTargetIcon';
import { ThreadPanelArchiveDialog } from './ThreadPanelArchiveDialog';
import { ThreadPanelBoardReviewDialog } from './ThreadPanelBoardReviewDialog';

const EMPTY_ISSUES: GitHubIssueCacheRecord[] = [];
const EMPTY_THREADS: Thread[] = [];
const EMPTY_BRANCHES: string[] = [];
const EMPTY_LATEST_PLAN_STATUS_BY_THREAD_ID: IssuesPanelData['latestPlanStatusByThreadId'] = {};
const ARCHIVABLE_PIPELINE_STATUSES: IssuePipelineStatus[] = [ISSUE_PIPELINE_STATUS.closed];
const KANBAN_FLASH_MS = 1600;
const PROJECT_OPEN_TARGETS: ProjectOpenTarget[] = [
  'cursor',
  'vscode',
  'finder',
  'terminal',
  'ghostty',
  't3code',
];

const PROJECT_OPEN_TARGET_LABELS: Record<ProjectOpenTarget, string> = {
  cursor: 'Cursor',
  finder: 'Finder',
  terminal: 'Terminal',
  ghostty: 'Ghostty',
  vscode: 'Visual Studio Code',
  t3code: 'T3 Code',
};

type FlashTimeoutsByIssueId = Map<string, ReturnType<typeof setTimeout>>;

function clearFlashTimeouts(flashTimeouts: FlashTimeoutsByIssueId) {
  for (const timeout of flashTimeouts.values()) {
    clearTimeout(timeout);
  }
  flashTimeouts.clear();
}

function deleteFlashTimeout(flashTimeouts: FlashTimeoutsByIssueId, issueId: string) {
  flashTimeouts.delete(issueId);
}

function restartFlashTimeout(
  flashTimeouts: FlashTimeoutsByIssueId,
  issueId: string,
  dispatch: (action: FlashingIssueIdsAction) => void,
) {
  const existing = flashTimeouts.get(issueId);
  if (existing) clearTimeout(existing);

  const timeout = setTimeout(() => {
    deleteFlashTimeout(flashTimeouts, issueId);
    dispatch({ type: 'remove', id: issueId });
  }, KANBAN_FLASH_MS);
  flashTimeouts.set(issueId, timeout);
}

function clearFlashTimeout(flashTimeouts: FlashTimeoutsByIssueId, issueId: string) {
  const timeout = flashTimeouts.get(issueId);
  if (!timeout) return;
  clearTimeout(timeout);
  flashTimeouts.delete(issueId);
}

type FlashingIssueIdsAction = { type: 'add'; ids: string[] } | { type: 'remove'; id: string };

function flashingIssueIdsReducer(
  current: ReadonlySet<string>,
  action: FlashingIssueIdsAction,
): ReadonlySet<string> {
  if (action.type === 'add') {
    return new Set([...current, ...action.ids]);
  }
  if (!current.has(action.id)) return current;
  const next = new Set(current);
  next.delete(action.id);
  return next;
}

function ProjectOpenControl({
  project,
  settings,
  integrationStatus,
}: {
  project: Project;
  settings: AppSettings | undefined;
  integrationStatus: IntegrationStatus | undefined;
}) {
  const queryClient = useQueryClient();
  const defaultTarget = settings?.projectOpenTarget ?? 'cursor';
  const defaultApp = integrationStatus?.desktopApps?.[defaultTarget];
  const defaultLabel = defaultApp?.label ?? PROJECT_OPEN_TARGET_LABELS[defaultTarget];
  const canOpenProject = project.pathExists !== false;
  const hasAvailableTarget = integrationStatus
    ? PROJECT_OPEN_TARGETS.some((target) => integrationStatus.desktopApps[target]?.available)
    : true;

  const openProjectPath = useMutation({
    mutationFn: (target: ProjectOpenTarget) =>
      window.shipcode.invoke('project:open-path', { projectId: project.id, target }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects-visible'] });
      queryClient.invalidateQueries({ queryKey: ['projects-archived'] });
    },
    onError: (error: Error) => {
      toast.error('Failed to open project folder', error.message);
    },
  });

  const openTarget = (target: ProjectOpenTarget) => {
    openProjectPath.mutate(target);
  };

  const mainDisabled =
    !canOpenProject || openProjectPath.isPending || (defaultApp ? !defaultApp.available : false);
  const menuDisabled = !canOpenProject || openProjectPath.isPending || !hasAvailableTarget;

  return (
    <div className="flex h-8 shrink-0 overflow-hidden rounded-md border border-border bg-primary">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 rounded-none border-0 px-3 text-sm font-medium text-primary hover:bg-elevated disabled:opacity-50"
        onClick={() => openTarget(defaultTarget)}
        disabled={mainDisabled}
        title={
          canOpenProject
            ? `Open ${project.name} in ${defaultLabel}`
            : `Project folder missing: ${project.path}`
        }
        aria-label={`Open ${project.name} in ${defaultLabel}`}
      >
        <ProjectOpenTargetIcon target={defaultTarget} />
        <span>open</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-none border-l border-border text-secondary hover:bg-elevated disabled:opacity-50"
            disabled={menuDisabled}
            aria-label={`Choose app to open ${project.name}`}
            title="Choose opener"
          >
            <ChevronDown size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" collisionPadding={8} className="min-w-[220px]">
          {PROJECT_OPEN_TARGETS.map((target) => {
            const app = integrationStatus?.desktopApps?.[target];
            const label = app?.label ?? PROJECT_OPEN_TARGET_LABELS[target];
            const available = app?.available ?? true;
            return (
              <DropdownMenuItem
                key={target}
                disabled={!available}
                onSelect={() => openTarget(target)}
                title={app?.error ?? undefined}
              >
                <span className="flex size-3.5 items-center justify-center">
                  {target === defaultTarget ? <Check size={12} /> : null}
                </span>
                <ProjectOpenTargetIcon target={target} className="size-3.5" />
                <span className="truncate">
                  {label}
                  {!available ? ' (Unavailable)' : ''}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ProjectApprovalControl({
  project,
  settings,
}: {
  project: Project;
  settings: AppSettings;
}) {
  const queryClient = useQueryClient();
  const effectiveRequireApproval = resolveRequireApproval(settings, project);
  const updateApproval = useMutation({
    mutationFn: (requireApproval: boolean) =>
      window.shipcode.invoke<Project>('project:set-require-approval', {
        projectId: project.id,
        requireApproval,
      }),
    onSuccess: (updatedProject) => {
      queryClient.setQueryData<Project | null>(['project', project.id], updatedProject);
      queryClient.setQueryData<IssuesPanelData | undefined>(
        ['thread-panel-data', project.id],
        (current) => (current ? { ...current, project: updatedProject } : current),
      );
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects-visible'] });
    },
    onError: (error: Error) => {
      toast.error('Failed to update plan approval', error.message);
    },
  });
  const checked = updateApproval.isPending
    ? (updateApproval.variables ?? effectiveRequireApproval)
    : effectiveRequireApproval;

  return (
    <label
      className="flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-border bg-primary px-2.5 text-xs font-medium text-secondary"
      title="Pause after planning for human approval before execution"
    >
      <span>plan approval</span>
      {project.requireApprovalOverride == null ? (
        <span className="rounded bg-secondary px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
          app
        </span>
      ) : null}
      <Switch
        checked={checked}
        disabled={updateApproval.isPending}
        onCheckedChange={(next) => updateApproval.mutate(next)}
        aria-label={`Require plan approval for ${project.name}`}
      />
    </label>
  );
}

function useIssuesPanelView() {
  const queryClient = useQueryClient();
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const selectedIssueNumber = useAppStore((state) => state.activeIssue?.issueNumber);
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);
  const createIssueModalOpen = useAppStore((state) => state.createIssueModalOpen);
  const projectSettingsModalOpen = useAppStore((state) => state.projectSettingsModalOpen);
  const settingsVisible = useAppStore((state) => state.settingsVisible);
  const activeAutomationThreadId = useAppStore((state) => state.activeAutomationThreadId);
  const selectIssue = useAppStore((state) => state.selectIssue);
  const selectAutomationThread = useAppStore((state) => state.selectAutomationThread);
  const setTerminalThread = useAppStore((state) => state.setTerminalThread);
  const openTerminal = useAppStore((state) => state.openTerminal);
  const requestCommentComposer = useAppStore((state) => state.requestCommentComposer);
  const setGithubIssues = useAppStore((state) => state.setGithubIssues);
  const pendingCreatedIssues = useAppStore((state) => state.pendingCreatedIssues);
  const previousTaskStatusByIdRef = useRef<Map<string, IssuePipelineStatus> | null>(null);
  if (previousTaskStatusByIdRef.current === null) {
    previousTaskStatusByIdRef.current = new Map();
  }
  const previousTaskStatusById = previousTaskStatusByIdRef.current;

  const flashTimeoutsByIssueIdRef = useRef<FlashTimeoutsByIssueId | null>(null);
  if (flashTimeoutsByIssueIdRef.current === null) {
    flashTimeoutsByIssueIdRef.current = new Map();
  }
  const flashTimeoutsByIssueId = flashTimeoutsByIssueIdRef.current;
  const [flashingIssueIds, dispatchFlashingIssueIds] = useReducer(
    flashingIssueIdsReducer,
    new Set<string>(),
  );
  const [isRefreshingBranches, setIsRefreshingBranches] = useState(false);
  const [archiveFeedback, setArchiveFeedback] = useState<{
    tone: 'pending' | 'success' | 'error';
    message: string;
  } | null>(null);
  const [doneUndo, setDoneUndo] = useState<{
    issueId: string;
    issueNumber: number;
    previousStatus: IssuePipelineStatus;
    previousState: GitHubIssueCacheRecord['state'];
    undoing: boolean;
  } | null>(null);

  const { data: issuesData } = useQuery<GitHubIssueCacheRecord[]>({
    queryKey: ['github-issues', activeProjectId],
    queryFn: () => window.shipcode.invoke('github:list-issues', { projectId: activeProjectId }),
    enabled: !!activeProjectId,
    staleTime: 5_000,
  });
  const issues = useMemo(() => {
    const cachedIssues = issuesData ?? EMPTY_ISSUES;
    const scopedPendingIssues = pendingCreatedIssues.filter(
      (issue) =>
        issue.projectId === activeProjectId &&
        !cachedIssues.some((cachedIssue) => cachedIssue.id === issue.id),
    );
    return scopedPendingIssues.length > 0
      ? [...scopedPendingIssues, ...cachedIssues]
      : cachedIssues;
  }, [activeProjectId, issuesData, pendingCreatedIssues]);

  useEffect(() => {
    if (issuesData === undefined) return;
    setGithubIssues(issuesData);
  }, [issuesData, setGithubIssues]);

  const refreshIssues = useMutation({
    mutationFn: (projectId: string) =>
      window.shipcode.invoke<GitHubIssueCacheRecord[]>('github:refresh-issues', {
        projectId,
        force: true,
      }),
    onSuccess: (freshIssues, projectId) => {
      queryClient.setQueryData(['github-issues', projectId], freshIssues);
    },
    onError: (err) => {
      log.error('[threadpanel] refresh-issues failed', { err });
    },
  });

  const triageIssues = useMutation({
    mutationFn: (projectId: string) =>
      window.shipcode.invoke<GitHubIssueTriageResult>('github:triage-issues', { projectId }),
    onSuccess: (result, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['github-issues', projectId] });
      setArchiveFeedback({
        tone: 'success',
        message:
          result.consideredCount === 0
            ? 'No Backlog issues need triage.'
            : `Triaged ${result.consideredCount} issue${result.consideredCount === 1 ? '' : 's'}; applied ${result.appliedCount}.`,
      });
    },
    onError: (err) => {
      setArchiveFeedback({
        tone: 'error',
        message: `Issue triage failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      log.error('[threadpanel] triage-issues failed', { err });
    },
  });

  useEffect(() => {
    if (!archiveFeedback || archiveFeedback.tone === 'pending') return;
    const id = setTimeout(() => setArchiveFeedback(null), 5000);
    return () => clearTimeout(id);
  }, [archiveFeedback]);

  useEffect(() => {
    if (!doneUndo || doneUndo.undoing) return;
    const id = setTimeout(() => {
      setDoneUndo((current) => (current?.issueId === doneUndo.issueId ? null : current));
    }, 8000);
    return () => clearTimeout(id);
  }, [doneUndo]);

  const { data: panelData } = useQuery<IssuesPanelData>({
    queryKey: ['thread-panel-data', activeProjectId],
    queryFn: () =>
      window.shipcode.invoke<IssuesPanelData>('thread-panel:get-data', {
        projectId: activeProjectId ?? '',
      }),
    enabled: !!activeProjectId,
    staleTime: 30_000, // IPC push events handle freshness; avoid frequent git branch calls
  });

  const { data: integrationStatus } = useQuery<IntegrationStatus>({
    queryKey: ['integrations'],
    queryFn: () => window.shipcode.invoke<IntegrationStatus>('integrations:check'),
    enabled: !!activeProjectId,
    staleTime: 30_000,
  });

  // Branches fetched separately — git I/O is slow, don't block board render.
  const { data: branchData } = useQuery<string[]>({
    queryKey: ['git-branches', activeProjectId],
    queryFn: () =>
      window.shipcode.invoke<string[]>('git:list-branches', {
        projectId: activeProjectId ?? '',
      }),
    enabled: !!activeProjectId,
    staleTime: 30_000, // branches change rarely
  });

  const project: Project | null = panelData?.project ?? null;
  const settings: AppSettings | undefined = panelData?.settings;
  const threads: Thread[] = panelData?.threads ?? EMPTY_THREADS;
  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread])),
    [threads],
  );

  // Auto-run state
  const [autoRunPriorities, setAutoRunPriorities] = useState<Array<'p0' | 'p1' | 'p2' | 'p3'>>(
    settings?.autoRunPriorities ?? [],
  );
  const [isAutoRunning, setIsAutoRunning] = useState(false);

  // Sync local priority state when settings load/change
  useEffect(() => {
    if (settings?.autoRunPriorities) setAutoRunPriorities(settings.autoRunPriorities);
  }, [settings?.autoRunPriorities]);

  const autoRunMaxTasks = settings?.autoRunMaxTasks ?? 0;

  const { data: autoRunCountData } = useQuery<{ count: number }>({
    queryKey: ['auto-run-count', activeProjectId, autoRunPriorities, autoRunMaxTasks],
    queryFn: () =>
      window.shipcode.invoke('github:auto-run-count', {
        projectId: activeProjectId ?? '',
        priorities: autoRunPriorities,
        maxTasks: autoRunMaxTasks,
      }),
    enabled: !!activeProjectId,
    staleTime: 10_000,
  });
  const latestPlanStatusByThreadId =
    panelData?.latestPlanStatusByThreadId ?? EMPTY_LATEST_PLAN_STATUS_BY_THREAD_ID;
  const branches: string[] = branchData ?? panelData?.branches ?? EMPTY_BRANCHES;
  const boardIssues = useMemo(() => {
    if (!activeProjectId) return issues;
    const issueThreadIds = new Set(
      issues.flatMap((issue) => (issue.threadId ? [issue.threadId] : [])),
    );
    const automationIssues = threads.flatMap((thread) =>
      thread.kind === THREAD_KIND.pipeline &&
      thread.automationId !== null &&
      !thread.archivedAt &&
      !issueThreadIds.has(thread.id)
        ? [automationThreadToIssue(thread, activeProjectId)]
        : [],
    );

    return automationIssues.length > 0 ? [...automationIssues, ...issues] : issues;
  }, [activeProjectId, issues, threads]);
  const selectedBoardIssueNumber = activeAutomationThreadId
    ? automationIssueNumber(activeAutomationThreadId)
    : selectedIssueNumber;
  const approvedAwaitingExecutionIssueIds = useMemo(() => {
    const issueIds = new Set<string>();
    for (const issue of issues) {
      if (
        issue.pipelineStatus === ISSUE_PIPELINE_STATUS.approval &&
        issue.threadId &&
        latestPlanStatusByThreadId[issue.threadId] === 'approved'
      ) {
        issueIds.add(issue.id);
      }
    }
    return issueIds;
  }, [issues, latestPlanStatusByThreadId]);

  useEffect(() => {
    const tracked = new Map<string, IssuePipelineStatus>();
    for (const issue of boardIssues) {
      tracked.set(issue.id, issue.pipelineStatus);
    }

    const changedIds: string[] = [];
    const previous = previousTaskStatusById;
    for (const [issueId, status] of tracked) {
      const previousStatus = previous.get(issueId);
      if (previousStatus !== undefined && previousStatus !== status) {
        changedIds.push(issueId);
      }
    }
    previousTaskStatusById.clear();
    for (const [issueId, status] of tracked) {
      previousTaskStatusById.set(issueId, status);
    }
    if (changedIds.length === 0) return;

    dispatchFlashingIssueIds({ type: 'add', ids: changedIds });

    for (const issueId of changedIds) {
      restartFlashTimeout(flashTimeoutsByIssueId, issueId, dispatchFlashingIssueIds);
    }

    return () => {
      for (const issueId of changedIds) {
        clearFlashTimeout(flashTimeoutsByIssueId, issueId);
      }
    };
  }, [boardIssues, flashTimeoutsByIssueId, previousTaskStatusById]);

  useEffect(() => {
    return () => {
      clearFlashTimeouts(flashTimeoutsByIssueId);
    };
  }, [flashTimeoutsByIssueId]);

  // Optimistically flip a single issue's pipelineStatus in the local cache so
  // the card jumps to its new column instantly on drop, instead of waiting
  // for the round-trip to the main process. On error we force a refetch to
  // reconcile with the real state.
  const queryKey = ['github-issues', activeProjectId] as const;

  const [archiveConfirm, setArchiveConfirm] = useState<
    { type: 'one'; issue: GitHubIssueCacheRecord } | { type: 'all'; count: number } | null
  >(null);
  const [boardReviewConfirmOpen, setBoardReviewConfirmOpen] = useState(false);
  const triageCandidateCount = useMemo(
    () =>
      issues.filter(
        (issue) =>
          issue.state === 'open' &&
          issue.pipelineStatus === ISSUE_PIPELINE_STATUS.todo &&
          !issue.threadId &&
          !issue.isQuickMode &&
          isRealGithubIssueNumber(issue.issueNumber),
      ).length,
    [issues],
  );

  const archiveIssuesOptimistic = (ids: string[]) => {
    queryClient.setQueryData<GitHubIssueCacheRecord[]>(queryKey, (prev) =>
      prev ? prev.filter((issue) => !ids.includes(issue.id)) : prev,
    );
  };

  const handleArchiveConfirm = () => {
    if (!archiveConfirm || !activeProjectId) return;
    const confirm = archiveConfirm;
    setArchiveConfirm(null);

    if (confirm.type === 'one') {
      archiveIssuesOptimistic([confirm.issue.id]);
      setArchiveFeedback({
        tone: 'pending',
        message: `Archiving issue #${confirm.issue.issueNumber} on GitHub…`,
      });
      window.shipcode
        .invoke('github:archive-issue', {
          projectId: activeProjectId,
          issueId: confirm.issue.id,
          issueNumber: confirm.issue.issueNumber,
        })
        .then(() => {
          setArchiveFeedback({
            tone: 'success',
            message: `Issue #${confirm.issue.issueNumber} archived. GitHub Projects can take 1-2 minutes to reflect it.`,
          });
          refreshIssues.mutate(activeProjectId);
        })
        .catch((err) => {
          setArchiveFeedback({
            tone: 'error',
            message: `Failed to archive issue #${confirm.issue.issueNumber}.`,
          });
          refreshIssues.mutate(activeProjectId);
          log.error('[threadpanel] archive-issue failed', { err });
          toast.error('Failed to archive issue', err?.message ?? String(err));
        });
    } else {
      const closedIssues = boardIssues.filter((issue) =>
        ARCHIVABLE_PIPELINE_STATUSES.includes(issue.pipelineStatus),
      );
      archiveIssuesOptimistic(
        closedIssues.flatMap((issue) => (!isAutomationIssue(issue) ? [issue.id] : [])),
      );
      const archivedAt = currentIsoTimestamp();
      for (const issue of closedIssues) {
        if (isAutomationIssue(issue) && issue.threadId) {
          patchThreadOptimistic(issue.threadId, { archivedAt, updatedAt: archivedAt });
        }
      }
      setArchiveFeedback({
        tone: 'pending',
        message: `Archiving ${closedIssues.length} closed issue${closedIssues.length === 1 ? '' : 's'}...`,
      });
      window.shipcode
        .invoke('github:archive-all-done', { projectId: activeProjectId })
        .then((result) => {
          const { archivedCount, failedCount } = result as {
            archivedCount: number;
            failedCount: number;
          };
          setArchiveFeedback({
            tone: failedCount > 0 ? 'error' : 'success',
            message:
              failedCount > 0
                ? `Archived ${archivedCount} issues. ${failedCount} still need GitHub cleanup or retry.`
                : `Archived ${archivedCount} issues.`,
          });
          refreshIssues.mutate(activeProjectId);
          if (failedCount > 0) {
            toast.error(
              `Archived ${archivedCount}, ${failedCount} failed`,
              `${failedCount} could not be fully archived on GitHub and may still be visible in Done.`,
            );
          }
        })
        .catch((err) => {
          setArchiveFeedback({
            tone: 'error',
            message: 'Failed to archive closed issues.',
          });
          refreshIssues.mutate(activeProjectId);
          log.error('[threadpanel] archive-all-done failed', { err });
          toast.error('Failed to archive closed issues', err?.message ?? String(err));
        });
    }
  };

  const patchIssueOptimistic = (
    id: string,
    patch: Partial<Pick<GitHubIssueCacheRecord, 'pipelineStatus' | 'state'>>,
  ) => {
    queryClient.setQueryData<GitHubIssueCacheRecord[]>(queryKey, (prev) =>
      prev ? prev.map((issue) => (issue.id === id ? { ...issue, ...patch } : issue)) : prev,
    );
    useAppStore.setState((state) => ({
      githubIssues: state.githubIssues.map((issue) =>
        issue.id === id ? { ...issue, ...patch } : issue,
      ),
      activeIssue:
        state.activeIssue?.id === id ? { ...state.activeIssue, ...patch } : state.activeIssue,
    }));
  };

  const patchThreadOptimistic = (
    threadId: string,
    patch: Partial<
      Pick<Thread, 'status' | 'doneAt' | 'updatedAt' | 'archivedAt' | 'pausedPhase' | 'pausedAt'>
    >,
  ) => {
    queryClient.setQueryData<IssuesPanelData | undefined>(
      ['thread-panel-data', activeProjectId],
      (prev) =>
        prev
          ? {
              ...prev,
              threads: prev.threads.map((thread) =>
                thread.id === threadId ? { ...thread, ...patch } : thread,
              ),
            }
          : prev,
    );
  };

  const repoUrl = githubRepoUrl(project?.gitRemote);
  const projectsUrl = project?.githubProjectUrl?.trim() ? project.githubProjectUrl.trim() : null;
  const handleIssueClick = (issue: GitHubIssueCacheRecord) => {
    if (isAutomationIssue(issue) && issue.threadId) {
      selectAutomationThread(issue.threadId);
      setTerminalThread(issue.threadId);
      openTerminal();
      return;
    }

    selectIssue(issue);
  };
  const handleIssueComment = (issue: GitHubIssueCacheRecord) => {
    handleIssueClick(issue);
    if (isAutomationIssue(issue)) return;
    requestCommentComposer(issue.id);
  };

  const handleFetchPlanSteps = useCallback(
    async (threadId: string) => {
      try {
        const graph = await queryClient.ensureQueryData<TaskGraphWithNodes | null>({
          queryKey: ['task-graph', threadId],
          queryFn: async () => {
            const result = await window.shipcode.invoke('task-graph:get-latest', { threadId });
            return result && Array.isArray(result.nodes) ? result : null;
          },
          staleTime: 30_000,
        });
        if (!graph?.nodes?.length) return null;
        return graph.nodes.map((n) => ({
          id: n.id,
          order: n.order,
          title: n.title,
          status: n.status,
          agentRole: n.agentRole,
        }));
      } catch {
        return null;
      }
    },
    [queryClient],
  );

  return (
    <div className="relative flex flex-1 min-h-0 min-w-0 flex-col bg-primary">
      <KanbanBoard
        issues={boardIssues}
        onIssueClick={handleIssueClick}
        onCommentIssue={handleIssueComment}
        keyboardShortcutsEnabled={
          !commandPaletteOpen &&
          !createIssueModalOpen &&
          !projectSettingsModalOpen &&
          !settingsVisible
        }
        selectedIssueNumber={selectedBoardIssueNumber}
        onRefresh={() => activeProjectId && refreshIssues.mutate(activeProjectId)}
        onTriageIssues={() => {
          if (!activeProjectId || triageCandidateCount === 0) return;
          setBoardReviewConfirmOpen(true);
        }}
        triagingIssues={triageIssues.isPending}
        triageCandidateCount={triageCandidateCount}
        baseBranch={project?.defaultBranch}
        branches={branches}
        refreshingBranches={isRefreshingBranches}
        onRefreshBranches={() => {
          setIsRefreshingBranches(true);
          window.shipcode
            .invoke<string[]>('git:list-branches', {
              projectId: activeProjectId ?? '',
              fetch: true,
            })
            .then((fresh) => {
              queryClient.setQueryData(['git-branches', activeProjectId], fresh);
              queryClient.setQueryData<IssuesPanelData | undefined>(
                ['thread-panel-data', activeProjectId],
                (prev) => (prev ? { ...prev, branches: fresh } : prev),
              );
            })
            .catch((err) => log.error('[threadpanel] refresh branches failed', err))
            .finally(() => setIsRefreshingBranches(false));
        }}
        projectName={project?.name}
        projectActions={
          project ? (
            <>
              {settings ? <ProjectApprovalControl project={project} settings={settings} /> : null}
              <ProjectOpenControl
                project={project}
                settings={settings}
                integrationStatus={integrationStatus}
              />
            </>
          ) : null
        }
        project={project}
        settings={settings}
        threads={threads}
        approvedAwaitingExecutionIssueIds={approvedAwaitingExecutionIssueIds}
        flashingIssueIds={flashingIssueIds}
        repoUrl={repoUrl}
        projectsUrl={projectsUrl}
        onOpenExternal={(url) =>
          window.shipcode.invoke('shell:open-external', { url }).catch((err) => {
            log.error('[threadpanel] open-external failed', { url, err });
          })
        }
        onOpenPullRequest={(url) =>
          window.shipcode.invoke('shell:open-external', { url }).catch((err) => {
            log.error('[threadpanel] open-pull-request failed', { url, err });
          })
        }
        onBaseBranchChange={(branch) => {
          // Optimistic cache update so the toolbar reflects the new branch
          // on the same frame as the click, without waiting for IPC.
          queryClient.setQueryData<Project | null>(['project', activeProjectId], (prev) =>
            prev ? { ...prev, defaultBranch: branch } : prev,
          );
          queryClient.setQueryData<IssuesPanelData | undefined>(
            ['thread-panel-data', activeProjectId],
            (prev) =>
              prev?.project
                ? { ...prev, project: { ...prev.project, defaultBranch: branch } }
                : prev,
          );
          window.shipcode
            .invoke('project:set-default-branch', {
              projectId: activeProjectId ?? '',
              branch,
            })
            .catch((err) => {
              queryClient.invalidateQueries({ queryKey: ['project', activeProjectId] });
              queryClient.invalidateQueries({ queryKey: ['thread-panel-data', activeProjectId] });
              log.error('[threadpanel] set-default-branch failed', err);
              toast.error('Failed to set base branch', err?.message ?? String(err));
            });
        }}
        onStartPipeline={(issue) => {
          patchIssueOptimistic(issue.id, { pipelineStatus: ISSUE_PIPELINE_STATUS.planning });
          return window.shipcode
            .invoke('github:start-issue', {
              projectId: activeProjectId,
              issueNumber: issue.issueNumber,
            })
            .then(() => {
              if (activeProjectId) refreshIssues.mutate(activeProjectId);
            })
            .catch((err) => {
              if (activeProjectId) refreshIssues.mutate(activeProjectId);
              log.error('[threadpanel] start-issue failed', {
                issueNumber: issue.issueNumber,
                err,
              });
              toast.error(
                `Failed to start issue #${issue.issueNumber}`,
                err?.message ?? String(err),
              );
            });
        }}
        onRetry={(issue) => {
          patchIssueOptimistic(issue.id, {
            pipelineStatus: ISSUE_PIPELINE_STATUS.todo,
            state: 'open',
          });
          const request = issue.threadId
            ? window.shipcode.invoke('pipeline:retry', { threadId: issue.threadId })
            : window.shipcode.invoke('github:retry-issue', {
                projectId: activeProjectId,
                issueNumber: issue.issueNumber,
              });
          return request
            .then(() => {
              if (activeProjectId) refreshIssues.mutate(activeProjectId);
            })
            .catch((err) => {
              if (activeProjectId) refreshIssues.mutate(activeProjectId);
              log.error('[threadpanel] retry-issue failed', {
                issueNumber: issue.issueNumber,
                err,
              });
              toast.error(
                `Failed to retry issue #${issue.issueNumber}`,
                err?.message ?? String(err),
              );
            });
        }}
        onArchiveIssue={(issue) => setArchiveConfirm({ type: 'one', issue })}
        onArchiveAllDone={() => {
          const closedCount = boardIssues.filter((i) =>
            ARCHIVABLE_PIPELINE_STATUSES.includes(i.pipelineStatus),
          ).length;
          setArchiveConfirm({ type: 'all', count: closedCount });
        }}
        graphContent={
          <Suspense fallback={null}>
            <ProjectGraphTab embedded />
          </Suspense>
        }
        onMarkDone={(issue) => {
          if (!activeProjectId) return;
          const isAutomation = isAutomationIssue(issue);
          const markedDoneAt = currentIsoTimestamp();
          const nextStatus: IssuePipelineStatus = ISSUE_PIPELINE_STATUS.closed;
          const nextState: GitHubIssueCacheRecord['state'] = 'closed';
          if (isAutomation && issue.threadId) {
            patchThreadOptimistic(issue.threadId, {
              doneAt: markedDoneAt,
              updatedAt: markedDoneAt,
            });
          } else {
            patchIssueOptimistic(issue.id, { pipelineStatus: nextStatus, state: nextState });
          }
          const canUndoWithGithub =
            !isAutomation && !issue.isQuickMode && isRealGithubIssueNumber(issue.issueNumber);
          setDoneUndo(
            canUndoWithGithub
              ? {
                  issueId: issue.id,
                  issueNumber: issue.issueNumber,
                  previousStatus: issue.pipelineStatus,
                  previousState: issue.state,
                  undoing: false,
                }
              : null,
          );
          return window.shipcode
            .invoke('issue:mark-done', {
              projectId: activeProjectId,
              issueId: issue.id,
              issueNumber: issue.issueNumber,
            })
            .then(() => {
              if (activeProjectId) {
                if (isAutomation) {
                  queryClient.invalidateQueries({
                    queryKey: ['thread-panel-data', activeProjectId],
                  });
                }
                refreshIssues.mutate(activeProjectId);
              }
            })
            .catch((err) => {
              setDoneUndo((current) => (current?.issueId === issue.id ? null : current));
              if (isAutomation && issue.threadId) {
                patchThreadOptimistic(issue.threadId, {
                  doneAt: null,
                  updatedAt: currentIsoTimestamp(),
                });
              }
              if (activeProjectId) {
                if (isAutomation) {
                  queryClient.invalidateQueries({
                    queryKey: ['thread-panel-data', activeProjectId],
                  });
                }
                refreshIssues.mutate(activeProjectId);
              }
              log.error('[threadpanel] close-issue failed', {
                issueNumber: issue.issueNumber,
                err,
              });
              toast.error(
                `Failed to close issue #${issue.issueNumber}`,
                err?.message ?? String(err),
              );
            });
        }}
        onRerun={(issue) => {
          if (isAutomationIssue(issue) && issue.threadId) {
            patchThreadOptimistic(issue.threadId, {
              status: PIPELINE_PHASE.planning,
              doneAt: null,
              pausedPhase: null,
              pausedAt: null,
              updatedAt: currentIsoTimestamp(),
            });
            return window.shipcode
              .invoke('pipeline:retry', { threadId: issue.threadId })
              .then(() => {
                queryClient.invalidateQueries({ queryKey: ['thread-panel-data', activeProjectId] });
              })
              .catch((err) => {
                queryClient.invalidateQueries({ queryKey: ['thread-panel-data', activeProjectId] });
                log.error('[threadpanel] automation rerun failed', {
                  threadId: issue.threadId,
                  err,
                });
                toast.error('Failed to retry automation run', err?.message ?? String(err));
              });
          }
          patchIssueOptimistic(issue.id, {
            pipelineStatus: ISSUE_PIPELINE_STATUS.planning,
            state: 'open',
          });
          return window.shipcode
            .invoke('github:start-issue', {
              projectId: activeProjectId,
              issueNumber: issue.issueNumber,
            })
            .then(() => {
              if (activeProjectId) refreshIssues.mutate(activeProjectId);
            })
            .catch((err) => {
              if (activeProjectId) refreshIssues.mutate(activeProjectId);
              log.error('[threadpanel] rerun failed', { issueNumber: issue.issueNumber, err });
              toast.error(
                `Failed to re-run issue #${issue.issueNumber}`,
                err?.message ?? String(err),
              );
            });
        }}
        onPause={(issue) => {
          if (!issue.threadId) return;
          const pausedAt = currentIsoTimestamp();
          patchIssueOptimistic(issue.id, { pipelineStatus: ISSUE_PIPELINE_STATUS.paused });
          patchThreadOptimistic(issue.threadId, {
            status: PIPELINE_PHASE.paused,
            pausedPhase: issue.pipelineStatus as Thread['pausedPhase'],
            pausedAt,
            updatedAt: pausedAt,
          });
          return window.shipcode
            .invoke('pipeline:pause', { threadId: issue.threadId })
            .then(() => {
              if (activeProjectId) {
                refreshIssues.mutate(activeProjectId);
                queryClient.invalidateQueries({
                  queryKey: ['thread-panel-data', activeProjectId],
                });
              }
            })
            .catch((err) => {
              if (activeProjectId) {
                refreshIssues.mutate(activeProjectId);
                queryClient.invalidateQueries({
                  queryKey: ['thread-panel-data', activeProjectId],
                });
              }
              log.error('[threadpanel] pause failed', { issueNumber: issue.issueNumber, err });
              toast.error('Failed to pause task', err?.message ?? String(err));
            });
        }}
        onResume={(issue) => {
          if (!issue.threadId) return;
          const resumedAt = currentIsoTimestamp();
          const thread = threadById.get(issue.threadId);
          const nextStatus = (thread?.pausedPhase ??
            PIPELINE_PHASE.executing) as IssuePipelineStatus;
          patchIssueOptimistic(issue.id, { pipelineStatus: nextStatus });
          patchThreadOptimistic(issue.threadId, {
            status: nextStatus as Thread['status'],
            pausedPhase: null,
            pausedAt: null,
            updatedAt: resumedAt,
          });
          return window.shipcode
            .invoke('pipeline:resume', { threadId: issue.threadId })
            .then(() => {
              if (activeProjectId) {
                refreshIssues.mutate(activeProjectId);
                queryClient.invalidateQueries({
                  queryKey: ['thread-panel-data', activeProjectId],
                });
              }
            })
            .catch((err) => {
              if (activeProjectId) {
                refreshIssues.mutate(activeProjectId);
                queryClient.invalidateQueries({
                  queryKey: ['thread-panel-data', activeProjectId],
                });
              }
              log.error('[threadpanel] resume failed', { issueNumber: issue.issueNumber, err });
              toast.error('Failed to resume task', err?.message ?? String(err));
            });
        }}
        onCancel={(issue) => {
          if (!issue.threadId) return;
          patchIssueOptimistic(issue.id, { pipelineStatus: ISSUE_PIPELINE_STATUS.todo });
          return window.shipcode
            .invoke('pipeline:cancel', { threadId: issue.threadId })
            .then(() => {
              if (activeProjectId) refreshIssues.mutate(activeProjectId);
            })
            .catch((err) => {
              if (activeProjectId) refreshIssues.mutate(activeProjectId);
              log.error('[threadpanel] cancel failed', { issueNumber: issue.issueNumber, err });
            });
        }}
        onCreatePr={
          project?.gitRemote
            ? (issue) => {
                if (!issue.threadId) return;
                return window.shipcode
                  .invoke<{ prNumber: number; prUrl: string }>('pipeline:create-pr', {
                    threadId: issue.threadId,
                  })
                  .then((result) => {
                    if (result.prUrl) {
                      window.shipcode
                        .invoke('shell:open-external', { url: result.prUrl })
                        .catch(() => {});
                    }
                    if (activeProjectId) refreshIssues.mutate(activeProjectId);
                  })
                  .catch((err) => {
                    if (activeProjectId) refreshIssues.mutate(activeProjectId);
                    log.error('[threadpanel] create-pr failed', {
                      issueNumber: issue.issueNumber,
                      err,
                    });
                    toast.error(
                      `Failed to create PR for #${issue.issueNumber}`,
                      err?.message ?? String(err),
                    );
                  });
              }
            : undefined
        }
        autoRunCount={autoRunCountData?.count ?? 0}
        autoRunPriorities={autoRunPriorities}
        onAutoRunPrioritiesChange={(priorities) => {
          setAutoRunPriorities(priorities);
          window.shipcode
            .invoke('settings:set', { autoRunPriorities: priorities })
            .catch((err) => log.error('[threadpanel] save auto-run priorities failed', err));
        }}
        autoRunning={isAutoRunning}
        onAutoRun={() => {
          if (!activeProjectId || isAutoRunning) return;
          setIsAutoRunning(true);
          window.shipcode
            .invoke('github:auto-run', {
              projectId: activeProjectId,
              priorities: autoRunPriorities,
              maxTasks: autoRunMaxTasks,
            })
            .then(() => {
              if (activeProjectId) refreshIssues.mutate(activeProjectId);
              queryClient.invalidateQueries({
                queryKey: ['auto-run-count', activeProjectId],
              });
            })
            .catch((err) => {
              if (activeProjectId) refreshIssues.mutate(activeProjectId);
              log.error('[threadpanel] auto-run failed', err);
              toast.error('Auto-run failed', err?.message ?? String(err));
            })
            .finally(() => setIsAutoRunning(false));
        }}
        onFetchPlanSteps={handleFetchPlanSteps}
      />
      <ThreadPanelArchiveDialog
        open={archiveConfirm !== null}
        issueNumber={archiveConfirm?.type === 'one' ? archiveConfirm.issue.issueNumber : undefined}
        count={archiveConfirm?.type === 'all' ? archiveConfirm.count : undefined}
        onClose={() => setArchiveConfirm(null)}
        onConfirm={handleArchiveConfirm}
      />
      <ThreadPanelBoardReviewDialog
        open={boardReviewConfirmOpen}
        count={triageCandidateCount}
        onClose={() => setBoardReviewConfirmOpen(false)}
        onConfirm={() => {
          if (!activeProjectId || triageCandidateCount === 0) return;
          setBoardReviewConfirmOpen(false);
          setArchiveFeedback({
            tone: 'pending',
            message: `Reviewing ${triageCandidateCount} Backlog issue${triageCandidateCount === 1 ? '' : 's'} with the triage model…`,
          });
          triageIssues.mutate(activeProjectId);
        }}
      />
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {doneUndo && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-warning/30 bg-elevated px-3 py-2 shadow-lg">
            <div className="min-w-0 text-xs text-secondary">
              <div className="font-medium text-primary">Closed #{doneUndo.issueNumber}</div>
              <div className="truncate">
                Reopen the issue and restore it to {doneUndo.previousStatus.replaceAll('_', ' ')}.
              </div>
            </div>
            <Button
              variant="ghost"
              size="xs"
              disabled={doneUndo.undoing}
              onClick={() => {
                if (!activeProjectId) return;
                const target = doneUndo;
                setDoneUndo((current) =>
                  current?.issueId === target.issueId ? { ...current, undoing: true } : current,
                );
                patchIssueOptimistic(target.issueId, {
                  pipelineStatus: target.previousStatus,
                  state: target.previousState,
                });
                window.shipcode
                  .invoke('github:reopen-issue', {
                    projectId: activeProjectId,
                    issueNumber: target.issueNumber,
                  })
                  .then(() => {
                    setDoneUndo((current) =>
                      current?.issueId === target.issueId ? null : current,
                    );
                    activeProjectId && refreshIssues.mutate(activeProjectId);
                  })
                  .catch((err) => {
                    setDoneUndo((current) =>
                      current?.issueId === target.issueId ? null : current,
                    );
                    activeProjectId && refreshIssues.mutate(activeProjectId);
                    log.error('[threadpanel] undo mark-done failed', {
                      issueNumber: target.issueNumber,
                      err,
                    });
                    toast.error(
                      `Failed to restore issue #${target.issueNumber}`,
                      err?.message ?? String(err),
                    );
                  });
              }}
            >
              {doneUndo.undoing ? 'Undoing…' : 'Undo'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:bg-transparent hover:text-primary"
              title="Dismiss undo"
              aria-label="Dismiss undo"
              onClick={() => setDoneUndo(null)}
            >
              <X size={12} />
            </Button>
          </div>
        )}
        {archiveFeedback && (
          <div
            className={
              archiveFeedback.tone === 'error'
                ? 'pointer-events-auto flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 shadow-lg text-xs text-danger'
                : archiveFeedback.tone === 'pending'
                  ? 'pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 shadow-lg text-xs text-secondary'
                  : 'pointer-events-auto flex items-center gap-2 rounded-lg border border-agent/30 bg-agent/10 px-3 py-2 shadow-lg text-xs text-agent'
            }
          >
            <RefreshCw
              size={12}
              className={
                archiveFeedback.tone === 'pending' ? 'animate-spin text-muted-foreground' : ''
              }
            />
            {archiveFeedback.message}
          </div>
        )}
      </div>
    </div>
  );
}

export function IssuesPanel() {
  return useIssuesPanelView();
}
