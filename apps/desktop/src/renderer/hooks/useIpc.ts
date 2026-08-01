import {
  formatResolvedModelDisplay,
  type GitHubIssueCacheRecord,
  ISSUE_PIPELINE_STATUS,
  type IssuePipelineStatus,
  PIPELINE_PHASE,
  type TerminalEventRecord,
  type Thread,
  type ThreadPanelData,
} from '@shipcode/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAppStore } from '../stores/app-store';
import { githubIssuesQueryKey } from '../stores/issue-cache-projection';
import { toast } from '../stores/toast-store';

const TERMINAL_EVENT_BATCH_MS = 50;
const LAST_ACTIVITY_THROTTLE_MS = 500;

export function useIpc() {
  const queryClient = useQueryClient();
  const applyPlan = useAppStore((state) => state.setPlan);
  const applyReview = useAppStore((state) => state.setReview);
  const applyPipelinePhase = useAppStore((state) => state.setPipelinePhase);
  const touchLastActivity = useAppStore((state) => state.touchLastActivity);
  const addNotification = useAppStore((state) => state.addNotification);
  const removeNotification = useAppStore((state) => state.removeNotification);
  const mapProcessToThread = useAppStore((state) => state.mapProcessToThread);
  const applyCurrentModel = useAppStore((state) => state.setCurrentModel);
  const applyTerminalPaneState = useAppStore((state) => state.setTerminalPaneState);
  const appendCanonicalEvents = useAppStore((state) => state.appendCanonicalEvents);

  useEffect(() => {
    if (!window.shipcode?.on) return;

    const unsubscribers: (() => void)[] = [];
    const pendingTerminalEvents = new Map<string, TerminalEventRecord[]>();
    const lastActivityAt = new Map<string, number>();
    let terminalFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushPendingTerminalEvents = () => {
      if (terminalFlushTimer) {
        clearTimeout(terminalFlushTimer);
        terminalFlushTimer = null;
      }

      for (const [threadId, events] of pendingTerminalEvents) {
        if (events.length > 0) {
          appendCanonicalEvents(threadId, events);
        }
      }
      pendingTerminalEvents.clear();
    };

    const queueTerminalEvent = (record: TerminalEventRecord) => {
      const pending = pendingTerminalEvents.get(record.threadId) ?? [];
      pending.push(record);
      pendingTerminalEvents.set(record.threadId, pending);

      if (terminalFlushTimer) return;
      terminalFlushTimer = setTimeout(flushPendingTerminalEvents, TERMINAL_EVENT_BATCH_MS);
    };

    const invalidatePlanQueriesForThread = (threadId: string) => {
      // Plan history list is otherwise polled only while phase is in
      // PLAN_MUTATING_PHASES (planning|reviewing|revising). When the pipeline
      // jumps planning→executing inside a single tick, polling stops before
      // the new plan version is fetched. Invalidate explicitly so the UI
      // never shows a stale SUPERSEDED v1 while the pipeline executes v2.
      queryClient.invalidateQueries({ queryKey: ['plan-history', threadId] });
      queryClient.invalidateQueries({ queryKey: ['issue-plan-history'] });
    };

    const updateThreadPanelThreadStatus = (
      projectId: string,
      threadId: string,
      phase: Thread['status'],
    ) => {
      queryClient.setQueryData<ThreadPanelData>(['thread-panel-data', projectId], (prev) => {
        if (!prev) return prev;
        let changed = false;
        const updatedAt = new Date().toISOString();
        const threads = prev.threads.map((thread) => {
          if (thread.id !== threadId) return thread;
          changed = true;
          return { ...thread, status: phase, updatedAt };
        });
        return changed ? { ...prev, threads } : prev;
      });
    };

    const upsertThreadPanelThread = (
      projectId: string,
      thread: Thread,
      phase: Thread['status'],
    ) => {
      queryClient.setQueryData<ThreadPanelData>(['thread-panel-data', projectId], (prev) => {
        if (!prev) return prev;
        const updatedThread: Thread = {
          ...thread,
          status: phase,
          updatedAt: new Date().toISOString(),
        };
        const existingIndex = prev.threads.findIndex((candidate) => candidate.id === thread.id);
        if (existingIndex < 0) {
          return { ...prev, threads: [updatedThread, ...prev.threads] };
        }
        const threads = [...prev.threads];
        threads[existingIndex] = { ...threads[existingIndex], ...updatedThread };
        return { ...prev, threads };
      });
    };

    const isThreadRecord = (value: unknown): value is Thread => {
      return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Thread).id === 'string' &&
        typeof (value as Thread).projectId === 'string' &&
        typeof (value as Thread).status === 'string' &&
        typeof (value as Thread).title === 'string' &&
        typeof (value as Thread).prompt === 'string'
      );
    };

    unsubscribers.push(
      window.shipcode.on('pipeline:phase', (data) => {
        const store = useAppStore.getState();
        const selectedProjectId = store.activeProjectId;
        const assistantThreadId = store.assistantThreadId;
        const maybeSelectedProjectThread =
          store.activeIssue?.threadId === data.threadId ||
          store.githubIssues.some((issue) => issue.threadId === data.threadId);
        const focusThreadIfSelectedProject = () => {
          if (assistantThreadId === data.threadId) return;
          if (selectedProjectId == null) return;
          if (maybeSelectedProjectThread) {
            const latest = useAppStore.getState();
            if (latest.assistantThreadId === data.threadId) return;
            if (latest.activeProjectId !== selectedProjectId) return;
            if (data.phase === PIPELINE_PHASE.planning) latest.openTerminal();
            if (data.phase !== PIPELINE_PHASE.idle) latest.setTerminalThread(data.threadId);
            return;
          }
          void window.shipcode
            .invoke('thread:get', { threadId: data.threadId })
            .then((thread) => {
              const latest = useAppStore.getState();
              if (latest.assistantThreadId === data.threadId) return;
              if (latest.activeProjectId !== selectedProjectId) return;
              const threadProjectId =
                typeof thread === 'object' && thread !== null
                  ? (thread as Partial<Thread>).projectId
                  : null;
              if (threadProjectId !== selectedProjectId) return;
              const fullThread = isThreadRecord(thread) ? thread : null;
              if (fullThread) {
                upsertThreadPanelThread(selectedProjectId, fullThread, data.phase);
              }
              if (
                data.phase === PIPELINE_PHASE.planning ||
                (fullThread?.automationId && data.phase !== PIPELINE_PHASE.idle)
              ) {
                latest.openTerminal();
              }
              if (data.phase !== PIPELINE_PHASE.idle) latest.setTerminalThread(data.threadId);
            })
            .catch(() => {
              // Best-effort focus only.
            });
        };
        if (data.phase === PIPELINE_PHASE.planning) {
          focusThreadIfSelectedProject();
        }
        queryClient.invalidateQueries({ queryKey: ['task-graph', data.threadId] });
        if (data.threadId === store.activeThreadId) {
          applyPipelinePhase(data.phase);
          invalidatePlanQueriesForThread(data.threadId);
          queryClient.invalidateQueries({ queryKey: ['checkpoints', data.threadId] });
          queryClient.invalidateQueries({ queryKey: ['diffs', data.threadId] });
          queryClient.invalidateQueries({ queryKey: ['review-findings', data.threadId] });
          queryClient.invalidateQueries({ queryKey: ['thread', data.threadId] });
        }
        if (data.phase !== PIPELINE_PHASE.idle && data.phase !== PIPELINE_PHASE.planning) {
          focusThreadIfSelectedProject();
        }

        if (store.activeProjectId) {
          const mappedStatus: IssuePipelineStatus =
            data.phase === PIPELINE_PHASE.idle ? ISSUE_PIPELINE_STATUS.todo : data.phase;
          updateThreadPanelThreadStatus(store.activeProjectId, data.threadId, data.phase);
          // Query cache only — the app store follows via subscribeIssueCacheProjection.
          queryClient.setQueryData<GitHubIssueCacheRecord[]>(
            githubIssuesQueryKey(store.activeProjectId),
            (prev) =>
              prev?.map((i) =>
                i.threadId === data.threadId ? { ...i, pipelineStatus: mappedStatus } : i,
              ),
          );
        }
      }),
    );

    unsubscribers.push(
      window.shipcode.on('plan:parsed', (data) => {
        if (data.threadId === useAppStore.getState().activeThreadId) {
          applyPlan(data.plan);
        }
        invalidatePlanQueriesForThread(data.threadId);
      }),
    );

    unsubscribers.push(
      window.shipcode.on('review:parsed', (data) => {
        if (data.threadId === useAppStore.getState().activeThreadId) {
          applyReview(data.review);
        }
        queryClient.invalidateQueries({ queryKey: ['review-findings', data.threadId] });
      }),
    );

    unsubscribers.push(
      window.shipcode.on('verification:parsed', (data) => {
        const store = useAppStore.getState();
        if (store.activeThreadId === data.threadId) {
          store.setVerification(data.verification);
        }
        queryClient.invalidateQueries({ queryKey: ['review-findings', data.threadId] });
      }),
    );

    unsubscribers.push(
      window.shipcode.on('github:issues-updated', (data) => {
        if (!data.projectId) return;
        // Query cache only — the app store's githubIssues/activeIssue follow via
        // subscribeIssueCacheProjection.
        queryClient.setQueryData(githubIssuesQueryKey(data.projectId), data.issues);
        queryClient.invalidateQueries({ queryKey: ['thread-panel-data', data.projectId] });
      }),
    );

    unsubscribers.push(
      window.shipcode.on('workflow:reloaded', (data) => {
        if (data.ok) {
          toast.info('WORKFLOW.md reloaded', 'New config applies to the next pipeline.');
        } else {
          toast.error('WORKFLOW.md reload failed', data.warning ?? 'Kept the previous config.');
        }
      }),
    );

    unsubscribers.push(
      window.shipcode.on('terminal:event', (data) => {
        queueTerminalEvent({
          id: data.id,
          threadId: data.threadId,
          runId: data.runId,
          event: data.event,
          createdAt: data.createdAt,
        });
      }),
    );

    unsubscribers.push(
      window.shipcode.on('agent:output', (data) => {
        if (data.threadId && data.processId) {
          const store = useAppStore.getState();
          if (store.processToThread[data.processId] !== data.threadId) {
            mapProcessToThread(data.processId, data.threadId);
          }
        }
        if (data.threadId) {
          const now = Date.now();
          const last = lastActivityAt.get(data.threadId) ?? 0;
          if (now - last >= LAST_ACTIVITY_THROTTLE_MS) {
            lastActivityAt.set(data.threadId, now);
            touchLastActivity(data.threadId);
          }
        }
      }),
    );

    unsubscribers.push(
      window.shipcode.on('agent:state', (data) => {
        if (data.state !== 'running' && data.state !== 'exited') return;
        if (data.state === 'running' && data.processId && data.threadId) {
          mapProcessToThread(data.processId, data.threadId);
        }
        if (data.threadId) {
          applyTerminalPaneState(data.threadId, data.state);
        }
      }),
    );

    unsubscribers.push(
      window.shipcode.on('pipeline:model-resolved', (data) => {
        const store = useAppStore.getState();
        const displayName = formatResolvedModelDisplay(data.requestedModel, data.resolvedModel);
        const tid = data.threadId ?? store.terminalThreadId;
        if (tid && displayName) applyCurrentModel(tid, displayName);
        // Token usage recorded — push-invalidate cost queries so CostsView
        // updates without relying on heavy polling.
        queryClient.invalidateQueries({ queryKey: ['costs-summary'] });
        queryClient.invalidateQueries({ queryKey: ['costs-tasks'] });
        queryClient.invalidateQueries({ queryKey: ['costs-tasks-count'] });
        queryClient.invalidateQueries({ queryKey: ['costs-project-tasks'] });
        queryClient.invalidateQueries({ queryKey: ['costs-project-tasks-count'] });
      }),
    );

    unsubscribers.push(
      window.shipcode.on('dashboard:invalidate', (data) => {
        const kinds = data.kinds ?? ['stats', 'activity', 'running', 'recent'];
        for (const kind of kinds) {
          queryClient.invalidateQueries({ queryKey: ['dashboard', kind] });
        }
      }),
    );

    unsubscribers.push(
      window.shipcode.on('notification:fire', (record) => {
        addNotification(record);
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      }),
    );

    unsubscribers.push(
      window.shipcode.on('notification:focus-thread', (data) => {
        const store = useAppStore.getState();
        if (data.projectId) {
          store.selectProject(data.projectId);
        }
        store.selectThread(data.threadId);
        store.setViewMode('project');
      }),
    );

    unsubscribers.push(
      window.shipcode.on('notification:dismiss', (data) => {
        removeNotification(data.id);
      }),
    );

    return () => {
      flushPendingTerminalEvents();
      for (const unsub of unsubscribers) unsub();
    };
  }, [
    applyPlan,
    applyReview,
    applyPipelinePhase,
    touchLastActivity,
    addNotification,
    removeNotification,
    mapProcessToThread,
    applyCurrentModel,
    applyTerminalPaneState,
    appendCanonicalEvents,
    queryClient,
  ]);
}
