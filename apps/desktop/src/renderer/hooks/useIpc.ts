import {
  formatResolvedModelDisplay,
  type GitHubIssueCacheRecord,
  type IssuePipelineStatus,
  type TerminalEventRecord,
} from '@shipcode/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAppStore } from '../stores/app-store';

const TERMINAL_EVENT_BATCH_MS = 50;
const LAST_ACTIVITY_THROTTLE_MS = 500;

export function useIpc() {
  const queryClient = useQueryClient();
  const setPlan = useAppStore((state) => state.setPlan);
  const setReview = useAppStore((state) => state.setReview);
  const setPipelinePhase = useAppStore((state) => state.setPipelinePhase);
  const touchLastActivity = useAppStore((state) => state.touchLastActivity);
  const addNotification = useAppStore((state) => state.addNotification);
  const removeNotification = useAppStore((state) => state.removeNotification);
  const mapProcessToThread = useAppStore((state) => state.mapProcessToThread);
  const setCurrentModel = useAppStore((state) => state.setCurrentModel);
  const setInstantPaneState = useAppStore((state) => state.setInstantPaneState);
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

    unsubscribers.push(
      window.shipcode.on('pipeline:phase', (data) => {
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
            .invoke('thread:get', { threadId: data.threadId })
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
        if (data.phase === 'planning') {
          focusThreadIfSelectedProject();
        }
        if (data.threadId === store.activeThreadId) {
          setPipelinePhase(data.phase);
        }
        if (data.phase !== 'idle' && data.phase !== 'planning') {
          focusThreadIfSelectedProject();
        }

        if (store.activeProjectId) {
          const mappedStatus: IssuePipelineStatus = data.phase === 'idle' ? 'todo' : data.phase;
          queryClient.setQueryData<GitHubIssueCacheRecord[]>(
            ['github-issues', store.activeProjectId],
            (prev) =>
              prev?.map((i) =>
                i.threadId === data.threadId ? { ...i, pipelineStatus: mappedStatus } : i,
              ),
          );
          const nextIssues = store.githubIssues.map((issue) =>
            issue.threadId === data.threadId ? { ...issue, pipelineStatus: mappedStatus } : issue,
          );
          useAppStore.setState((state) => ({
            githubIssues: nextIssues,
            activeIssue:
              state.activeIssue?.threadId === data.threadId
                ? { ...state.activeIssue, pipelineStatus: mappedStatus }
                : state.activeIssue,
          }));
        }
      }),
    );

    unsubscribers.push(
      window.shipcode.on('plan:parsed', (data) => {
        if (data.threadId === useAppStore.getState().activeThreadId) {
          setPlan(data.plan);
        }
      }),
    );

    unsubscribers.push(
      window.shipcode.on('review:parsed', (data) => {
        if (data.threadId === useAppStore.getState().activeThreadId) {
          setReview(data.review);
        }
      }),
    );

    unsubscribers.push(
      window.shipcode.on('verification:parsed', (data) => {
        const store = useAppStore.getState();
        if (store.activeThreadId === data.threadId) {
          store.setVerification(data.verification);
        }
      }),
    );

    unsubscribers.push(
      window.shipcode.on('github:issues-updated', (data) => {
        const store = useAppStore.getState();
        if (data.projectId === store.activeProjectId) {
          store.setGithubIssues(data.issues);
        }
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

    unsubscribers.push(
      window.shipcode.on('terminal:event', (data) => {
        queueTerminalEvent({
          id: data.id,
          threadId: data.threadId,
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
          setInstantPaneState(data.threadId, data.state);
        }
      }),
    );

    unsubscribers.push(
      window.shipcode.on('pipeline:model-resolved', (data) => {
        const store = useAppStore.getState();
        const displayName = formatResolvedModelDisplay(data.requestedModel, data.resolvedModel);
        const tid = data.threadId ?? store.terminalThreadId;
        if (tid && displayName) setCurrentModel(tid, displayName);
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
    setPlan,
    setReview,
    setPipelinePhase,
    touchLastActivity,
    addNotification,
    removeNotification,
    mapProcessToThread,
    setCurrentModel,
    setInstantPaneState,
    appendCanonicalEvents,
    queryClient,
  ]);
}
