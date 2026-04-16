import type { GitHubIssueCacheRecord } from '@shipcode/shared';
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

  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

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
            .invoke('github:list-issues', {
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
        useAppStore.getState().appendCanonicalEvent(data.threadId, data.event, {
          id: data.id,
          createdAt: data.createdAt,
        });
      }),
    );

    unsubscribers.push(
      window.shipcode.on('agent:output', (data) => {
        if (data.threadId && data.processId) mapProcessToThread(data.processId, data.threadId);
        appendAgentOutput(data.processId, data.chunk);
        if (data.threadId) touchLastActivity(data.threadId);
      }),
    );

    unsubscribers.push(
      window.shipcode.on('agent:state', (data) => {
        if (data.state !== 'running' && data.state !== 'exited') return;
        if (data.state === 'running' && data.processId && data.threadId) {
          mapProcessToThread(data.processId, data.threadId);
        }
      }),
    );

    unsubscribers.push(
      window.shipcode.on('pipeline:model-resolved', (data) => {
        const store = useAppStore.getState();
        const isOpenRouter = String(data.requestedModel ?? '').startsWith('openrouter');
        const requestedOrResolved = data.requestedModel ?? data.resolvedModel ?? null;
        const displayName = isOpenRouter
          ? (data.resolvedModel ?? null)
          : requestedOrResolved
            ? modelDisplay(requestedOrResolved)
            : null;
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
