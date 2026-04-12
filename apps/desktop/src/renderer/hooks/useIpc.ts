import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GitHubIssueCacheRecord, NotificationRecord } from '@shipcode/shared';
import { modelDisplay } from '@shipcode/ui';
import { useAppStore } from '../stores/app-store';

export function useIpc() {
  const queryClient = useQueryClient();
  const {
    setPlan,
    setReview,
    setPipelinePhase,
    setVerification,
    setGithubIssues,
    appendAgentOutput,
    touchLastActivity,
    addNotification,
    removeNotification,
    logTerminalEventForThread,
    setTerminalThread,
    mapProcessToThread,
    setCurrentModel,
  } = useAppStore();

  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    // Listen for pipeline phase changes (scoped by threadId)
    unsubscribers.push(
      window.shipcode.on('pipeline:phase', (data: any) => {
        const store = useAppStore.getState();
        if (data.threadId === store.activeThreadId) {
          setPipelinePhase(data.phase);
          // Auto-open terminal when planning starts so the user sees output immediately.
          // Scoped to 'planning' only so it fires once per run; manual close is respected.
          if (data.phase === 'planning') {
            store.openTerminal();
          }
          // Log phase transition to terminal event log (colored)
          const ts = new Date().toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
          const phaseLine = `\x1b[2m[${ts}]\x1b[0m phase: \x1b[36m${data.phase}\x1b[0m`;
          store.logTerminalEvent(phaseLine);
          logTerminalEventForThread(data.threadId, phaseLine);
          // Also set terminal focus to this thread when it starts
          if (data.phase !== 'idle') setTerminalThread(data.threadId);
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
      window.shipcode.on('plan:parsed', (data: any) => {
        if (data.threadId === useAppStore.getState().activeThreadId) {
          setPlan(data.plan);
        }
      }),
    );

    // Listen for parsed reviews (scoped by threadId)
    unsubscribers.push(
      window.shipcode.on('review:parsed', (data: any) => {
        if (data.threadId === useAppStore.getState().activeThreadId) {
          setReview(data.review);
        }
      }),
    );

    // Listen for parsed verifications
    unsubscribers.push(
      window.shipcode.on('verification:parsed', (data: any) => {
        const store = useAppStore.getState();
        if (store.activeThreadId === data.threadId) {
          store.setVerification(data.verification);
        }
      }),
    );

    // Listen for GitHub issues updates
    unsubscribers.push(
      window.shipcode.on('github:issues-updated', (data: any) => {
        const store = useAppStore.getState();
        store.setGithubIssues(data.issues);
        // Directly set React Query cache — data comes from DB so no refetch needed.
        if (data.projectId) {
          queryClient.setQueryData(['github-issues', data.projectId], data.issues);
        }

        if (store.activeIssue) {
          const refreshed =
            data.issues.find((issue: any) => issue.id === store.activeIssue?.id) ?? null;
          useAppStore.setState((state) => ({
            activeIssue: refreshed,
            activeThreadId: refreshed?.threadId ?? state.activeThreadId,
          }));
        }
      }),
    );

    // Listen for agent output
    unsubscribers.push(
      window.shipcode.on('agent:output', (data: any) => {
        // Eagerly populate processToThread from authoritative threadId — covers
        // spawn-failure output that arrives before any 'running' state event.
        if (data.threadId && data.processId) mapProcessToThread(data.processId, data.threadId);
        appendAgentOutput(data.processId, data.chunk);
        if (data.threadId) touchLastActivity(data.threadId);
      }),
    );

    // Log agent process lifecycle events to the terminal (colored by agent type)
    unsubscribers.push(
      window.shipcode.on('agent:state', (data: any) => {
        if (data.state !== 'running' && data.state !== 'exited') return;
        const store = useAppStore.getState();
        const ts = new Date().toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        const label = data.state === 'running' ? 'started' : 'exited';
        // Associate this processId with its owning thread using the authoritative
        // threadId from the main process (avoids the race where the user has a
        // different tab focused when the process starts).
        const tid = data.threadId;
        if (data.state === 'running' && data.processId && tid) {
          mapProcessToThread(data.processId, tid);
        }
        // Color the agent name: claude=cyan, codex=yellow, openrouter=magenta
        const agentColor =
          data.type === 'claude' ? '\x1b[36m'
          : data.type === 'codex' ? '\x1b[33m'
          : data.type === 'openrouter' ? '\x1b[35m'
          : '';
        const agentReset = agentColor ? '\x1b[0m' : '';
        const exitColor = data.state === 'exited' ? '\x1b[2m' : '';
        const line = `\x1b[2m[${ts}]\x1b[0m ${exitColor}${agentColor}${data.type}${agentReset}${exitColor} process ${label}\x1b[0m`;
        store.logTerminalEvent(line);
        if (tid) logTerminalEventForThread(tid, line);
      }),
    );

    // Log model resolution events and update the header model display
    unsubscribers.push(
      window.shipcode.on('pipeline:model-resolved', (data: any) => {
        const store = useAppStore.getState();
        const isOpenRouter = String(data.requestedModel ?? '').startsWith('openrouter');
        const isCodex = data.requestedModel === 'codex';
        // For claude/codex CLIs the resolvedModel is just 'claude'/'codex' — use the
        // friendly display name instead. For OpenRouter use the actual resolved model
        // (e.g. 'anthropic/claude-sonnet-4-6') since it carries the real model name.
        const displayName = isOpenRouter
          ? data.resolvedModel
          : modelDisplay(data.requestedModel ?? data.resolvedModel);
        const tid = data.threadId ?? store.terminalThreadId;
        if (tid) setCurrentModel(tid, displayName);
        const ts = new Date().toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        // Tokens: show for OpenRouter and codex — both report accurate per-call counts.
        // Claude CLI only reports delta (non-cached) input tokens, which is misleading.
        const tokenStr =
          (isOpenRouter || isCodex) && data.tokensUsed
            ? ` \x1b[2m(${data.tokensUsed.prompt}+${data.tokensUsed.completion} tok)\x1b[0m`
            : '';
        // Cost:
        // - OpenRouter: exact per-call charge from API response
        // - claude CLI: session-level API-rate estimate (~$) — real cost if API user,
        //   theoretical if on a subscription plan, still useful for comparison
        // - codex CLI: estimated from token counts using gpt-5.4 pricing
        //   ($62.50/MTok input, $375/MTok output) — prefixed ~ to signal it's an estimate
        let costStr = '';
        if (isOpenRouter && data.costUsd && data.costUsd > 0) {
          costStr = ` \x1b[2m$${data.costUsd.toFixed(4)}\x1b[0m`;
        } else if (!isOpenRouter && data.costUsd && data.costUsd > 0) {
          costStr = ` \x1b[2m~$${data.costUsd.toFixed(4)}\x1b[0m`;
        } else if (isCodex && data.tokensUsed) {
          const estimated =
            (data.tokensUsed.prompt * 62.5 + data.tokensUsed.completion * 375) / 1_000_000;
          costStr = ` \x1b[2m~$${estimated.toFixed(4)}\x1b[0m`;
        }
        const line = `\x1b[2m[${ts}]\x1b[0m \x1b[35mmodel:\x1b[0m ${displayName}${tokenStr}${costStr}`;
        store.logTerminalEvent(line);
        if (tid) logTerminalEventForThread(tid, line);
      }),
    );

    // === Mission Control: dashboard invalidation ===
    unsubscribers.push(
      window.shipcode.on('dashboard:invalidate', (data: any) => {
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
        const store = useAppStore.getState();
        // If the user is already viewing this thread in project view,
        // silently dismiss the notification rather than showing a toast.
        if (store.viewMode === 'project' && record.threadId === store.activeThreadId) {
          window.shipcode.invoke('notification:dismiss', { id: record.id }).catch(() => {});
          return;
        }
        addNotification(record);
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      }),
    );

    unsubscribers.push(
      window.shipcode.on('notification:focus-thread', (data: any) => {
        const store = useAppStore.getState();
        if (data.projectId) {
          store.selectProject(data.projectId);
        }
        store.selectThread(data.threadId);
        store.setViewMode('project');
      }),
    );

    // Drop dismissed notifications from the in-memory toaster stack so the
    // "auto-dismiss after view" path stays in sync with the DB.
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
    setVerification,
    setGithubIssues,
    appendAgentOutput,
    addNotification,
    removeNotification,
    logTerminalEventForThread,
    setTerminalThread,
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
