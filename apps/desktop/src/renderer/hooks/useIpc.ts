import type {
  CanonicalTerminalEvent,
  GitHubIssueCacheRecord,
  NotificationRecord,
  PipelinePhase,
  PlanReview,
  ShipCodePlan,
  TerminalEventRecord,
  Thread,
  VerificationResult,
} from '@shipcode/shared';
import { modelDisplay } from '@shipcode/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useAppStore } from '../stores/app-store';

export function useIpc() {
  const queryClient = useQueryClient();
  const {
    setPlan,
    setReview,
    setPipelinePhase,
    appendAgentOutput,
    touchLastActivity,
    addNotification,
    removeNotification,
    mapProcessToThread,
    setCurrentModel,
  } = useAppStore();

  type PhasePayload = { phase: PipelinePhase; threadId: string };
  type PlanParsedPayload = { threadId: string; plan: unknown };
  type ReviewParsedPayload = { threadId: string; review: unknown };
  type VerificationParsedPayload = { threadId: string; verification: VerificationResult };
  type IssuesUpdatedPayload = { projectId?: string; issues: GitHubIssueCacheRecord[] };
  type TerminalEventPayload = Partial<TerminalEventRecord> & { threadId?: string; event?: unknown };
  type AgentOutputPayload = { processId: string; chunk: string; threadId?: string };
  type AgentStatePayload = {
    processId?: string;
    state: 'running' | 'exited' | string;
    threadId?: string;
    type?: string;
  };
  type ModelResolvedPayload = {
    requestedModel?: string;
    resolvedModel?: string;
    tokensUsed?: { prompt: number; completion: number };
    costUsd?: number;
    threadId?: string;
  };
  type DashboardInvalidatePayload = { kinds?: string[] } | null;
  type FocusThreadPayload = { projectId?: string; threadId: string };

  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    // Listen for pipeline phase changes (scoped by threadId)
    unsubscribers.push(
      window.shipcode.on('pipeline:phase', (...args: unknown[]) => {
        const data = args[0] as PhasePayload;
        const store = useAppStore.getState();
        const selectedProjectId = store.activeProjectId;
        const maybeSelectedProjectThread =
          store.activeIssue?.threadId === data.threadId ||
          store.githubIssues.some((issue) => issue.threadId === data.threadId);
        const focusThreadIfSelectedProject = () => {
          if (selectedProjectId == null) return;
          if (maybeSelectedProjectThread) {
            const latest = useAppStore.getState();
            if (latest.activeProjectId !== selectedProjectId) return;
            if (data.phase === 'planning') latest.openTerminal();
            if (data.phase !== 'idle') latest.setTerminalThread(data.threadId);
            return;
          }
          void window.shipcode
            .invoke<Thread | null>('thread:get', { threadId: data.threadId })
            .then((thread) => {
              const latest = useAppStore.getState();
              if (latest.activeProjectId !== selectedProjectId) return;
              if (thread?.projectId !== selectedProjectId) return;
              if (data.phase === 'planning') latest.openTerminal();
              if (data.phase !== 'idle') latest.setTerminalThread(data.threadId);
            })
            .catch(() => {
              // Best-effort focus only.
            });
        };
        // Auto-open terminal and focus thread when a pipeline starts running,
        // even if the user is viewing a different thread.
        if (data.phase === 'planning') {
          focusThreadIfSelectedProject();
        }
        // Update pipeline phase for the active issue's header display
        if (data.threadId === store.activeThreadId) {
          setPipelinePhase(data.phase);
        }
        if (data.phase !== 'idle' && data.phase !== 'planning') {
          focusThreadIfSelectedProject();
        }

        // Directly patch the issue's pipelineStatus in the React Query cache —
        // avoids the github:refresh-issues API round-trip for instant Kanban update.
        if (store.activeProjectId) {
          const mappedStatus = data.phase === 'idle' ? 'todo' : data.phase;
          queryClient.setQueryData<GitHubIssueCacheRecord[]>(
            ['github-issues', store.activeProjectId],
            (prev) =>
              prev?.map((i) =>
                i.threadId === data.threadId ? { ...i, pipelineStatus: mappedStatus } : i,
              ),
          );
        }

        if (store.activeProjectId) {
          window.shipcode
            .invoke<GitHubIssueCacheRecord[]>('github:list-issues', {
              projectId: store.activeProjectId,
            })
            .then((issues) => {
              useAppStore.getState().setGithubIssues(issues);

              const activeIssue = useAppStore.getState().activeIssue;
              if (!activeIssue) return;

              const refreshed = issues.find((issue) => issue.id === activeIssue.id) ?? null;
              useAppStore.setState((state) => ({
                activeIssue: refreshed,
                activeThreadId: refreshed?.threadId ?? state.activeThreadId,
              }));
            })
            .catch(() => {
              // Best-effort sync only.
            });
        }
      }),
    );

    // Listen for parsed plans (scoped by threadId)
    unsubscribers.push(
      window.shipcode.on('plan:parsed', (...args: unknown[]) => {
        const data = args[0] as PlanParsedPayload;
        if (data.threadId === useAppStore.getState().activeThreadId) {
          setPlan(data.plan as ShipCodePlan | null);
        }
      }),
    );

    // Listen for parsed reviews (scoped by threadId)
    unsubscribers.push(
      window.shipcode.on('review:parsed', (...args: unknown[]) => {
        const data = args[0] as ReviewParsedPayload;
        if (data.threadId === useAppStore.getState().activeThreadId) {
          setReview(data.review as PlanReview | null);
        }
      }),
    );

    // Listen for parsed verifications
    unsubscribers.push(
      window.shipcode.on('verification:parsed', (...args: unknown[]) => {
        const data = args[0] as VerificationParsedPayload;
        const store = useAppStore.getState();
        if (store.activeThreadId === data.threadId) {
          store.setVerification(data.verification);
        }
      }),
    );

    // Listen for GitHub issues updates
    unsubscribers.push(
      window.shipcode.on('github:issues-updated', (...args: unknown[]) => {
        const data = args[0] as IssuesUpdatedPayload;
        const store = useAppStore.getState();
        if (data.projectId === store.activeProjectId) {
          store.setGithubIssues(data.issues);
        }
        // Directly set React Query cache — data comes from DB so no refetch needed.
        if (data.projectId) {
          queryClient.setQueryData(['github-issues', data.projectId], data.issues);
        }

        if (data.projectId === store.activeProjectId && store.activeIssue) {
          const refreshed = data.issues.find((issue) => issue.id === store.activeIssue?.id) ?? null;
          useAppStore.setState((state) => ({
            activeIssue: refreshed,
            activeThreadId: refreshed?.threadId ?? state.activeThreadId,
          }));
        }
      }),
    );

    // Listen for canonical terminal events (normalized from all providers)
    unsubscribers.push(
      window.shipcode.on('terminal:event', (...args: unknown[]) => {
        const data = args[0] as TerminalEventPayload;
        if (data.threadId && data.event) {
          useAppStore
            .getState()
            .appendCanonicalEvent(
              data.threadId,
              data.event as CanonicalTerminalEvent,
              data.id && data.createdAt ? { id: data.id, createdAt: data.createdAt } : undefined,
            );
        }
      }),
    );

    // Listen for agent output
    unsubscribers.push(
      window.shipcode.on('agent:output', (...args: unknown[]) => {
        const data = args[0] as AgentOutputPayload;
        // Eagerly populate processToThread from authoritative threadId — covers
        // spawn-failure output that arrives before any 'running' state event.
        if (data.threadId && data.processId) mapProcessToThread(data.processId, data.threadId);
        appendAgentOutput(data.processId, data.chunk);
        if (data.threadId) touchLastActivity(data.threadId);
      }),
    );

    // Log agent process lifecycle events to the terminal (colored by agent type)
    unsubscribers.push(
      window.shipcode.on('agent:state', (...args: unknown[]) => {
        const data = args[0] as AgentStatePayload;
        if (data.state !== 'running' && data.state !== 'exited') return;
        // Associate this processId with its owning thread using the authoritative
        // threadId from the main process (avoids the race where the user has a
        // different tab focused when the process starts).
        const tid = data.threadId;
        if (data.state === 'running' && data.processId && tid) {
          mapProcessToThread(data.processId, tid);
        }
      }),
    );

    // Log model resolution events and update the header model display
    unsubscribers.push(
      window.shipcode.on('pipeline:model-resolved', (...args: unknown[]) => {
        const data = args[0] as ModelResolvedPayload;
        const store = useAppStore.getState();
        const isOpenRouter = String(data.requestedModel ?? '').startsWith('openrouter');
        const requestedOrResolved = data.requestedModel ?? data.resolvedModel ?? null;
        // For claude/codex CLIs the resolvedModel is just 'claude'/'codex' — use the
        // friendly display name instead. For OpenRouter use the actual resolved model
        // (e.g. 'anthropic/claude-sonnet-4-6') since it carries the real model name.
        const displayName = isOpenRouter
          ? (data.resolvedModel ?? null)
          : requestedOrResolved
            ? modelDisplay(requestedOrResolved)
            : null;
        const tid = data.threadId ?? store.terminalThreadId;
        if (tid && displayName) setCurrentModel(tid, displayName);
      }),
    );

    // === Mission Control: dashboard invalidation ===
    unsubscribers.push(
      window.shipcode.on('dashboard:invalidate', (...args: unknown[]) => {
        const data = (args[0] as DashboardInvalidatePayload) ?? null;
        const kinds: string[] = data?.kinds ?? ['stats', 'activity', 'running', 'recent'];
        for (const kind of kinds) {
          queryClient.invalidateQueries({ queryKey: ['dashboard', kind] });
        }
      }),
    );

    // === Notifications ===
    unsubscribers.push(
      window.shipcode.on('notification:fire', (...args: unknown[]) => {
        const record = args[0] as NotificationRecord;
        addNotification(record);
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      }),
    );

    unsubscribers.push(
      window.shipcode.on('notification:focus-thread', (...args: unknown[]) => {
        const data = args[0] as FocusThreadPayload;
        const store = useAppStore.getState();
        if (data.projectId) {
          store.selectProject(data.projectId);
        }
        store.selectThread(data.threadId);
        store.setViewMode('project');
      }),
    );

    unsubscribers.push(
      window.shipcode.on('notification:dismiss', (...args: unknown[]) => {
        const data = args[0] as { id: string } | undefined;
        if (data?.id) removeNotification(data.id);
      }),
    );

    return () => {
      for (const unsub of unsubscribers) unsub();
    };
  }, [
    setPlan,
    setReview,
    setPipelinePhase,
    appendAgentOutput,
    touchLastActivity,
    addNotification,
    removeNotification,
    mapProcessToThread,
    setCurrentModel,
    queryClient,
  ]);
}

export function useInvoke<T>(channel: string) {
  return useCallback(
    (args?: unknown): Promise<T> => window.shipcode.invoke<T>(channel, args),
    [channel],
  );
}
