import type { GitHubIssueCacheRecord } from '@shipcode/shared';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAppStore } from './app-store';

/**
 * Ownership: the React Query cache entry `['github-issues', projectId]` is the
 * single source of truth for GitHub issue records, including `pipelineStatus`.
 *
 * `useAppStore.githubIssues` / `activeIssue` are a READ-ONLY PROJECTION of that
 * cache, kept for the many synchronous `useAppStore.getState()` consumers that
 * cannot call a hook. This module is the ONLY writer of those two fields outside
 * of explicit UI navigation actions (`selectIssue`, `selectProject`,
 * `navigateToIssue`, ...) which choose *which* issue is active rather than what
 * its server state is.
 *
 * Anything that learns about new issue state — IPC events, optimistic mutations,
 * refetches — must write to the query cache and let the projection follow. Never
 * write `githubIssues` or `activeIssue` fields in parallel with a `setQueryData`
 * call; that is the drift this module exists to prevent.
 */

export const GITHUB_ISSUES_QUERY_KEY = 'github-issues';

export function githubIssuesQueryKey(projectId: string) {
  return [GITHUB_ISSUES_QUERY_KEY, projectId] as const;
}

/**
 * The one place that turns cached issue records into store state. Reconciles the
 * active issue against the incoming list so a record that changed status, or
 * disappeared entirely, can never linger in the detail view while the board
 * shows something else.
 */
function projectIssues(projectId: string, issues: GitHubIssueCacheRecord[]) {
  useAppStore.setState((state) => {
    if (state.activeProjectId !== projectId) return {};

    const activeIssue = state.activeIssue
      ? (issues.find((issue) => issue.id === state.activeIssue?.id) ?? null)
      : null;

    if (state.githubIssues === issues && state.activeIssue === activeIssue) return {};

    return {
      githubIssues: issues,
      activeIssue,
      activeThreadId: activeIssue?.threadId ?? state.activeThreadId,
    };
  });
}

function readIssues(queryClient: QueryClient, projectId: string) {
  return queryClient.getQueryData<GitHubIssueCacheRecord[]>(githubIssuesQueryKey(projectId));
}

/**
 * Mirrors the `['github-issues', activeProjectId]` cache entry into the app store.
 *
 * Subscribing to the query *cache* rather than to a `useQuery` result means the
 * projection sees every write — fetches, `setQueryData` from any component,
 * optimistic patches — regardless of which components happen to be mounted.
 *
 * Returns an unsubscribe function.
 */
export function subscribeIssueCacheProjection(queryClient: QueryClient) {
  const projectFromCache = (projectId: string | null) => {
    if (!projectId) return;
    const issues = readIssues(queryClient, projectId);
    // No cache entry yet: nothing to derive from, so leave the store untouched
    // rather than blanking a selection the navigation actions just made.
    if (!issues) return;
    projectIssues(projectId, issues);
  };

  projectFromCache(useAppStore.getState().activeProjectId);

  const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
    const [scope, projectId] = event.query.queryKey as [unknown, unknown];
    if (scope !== GITHUB_ISSUES_QUERY_KEY || typeof projectId !== 'string') return;
    if (projectId !== useAppStore.getState().activeProjectId) return;
    projectFromCache(projectId);
  });

  // Switching projects swaps which cache entry is authoritative. Only the list is
  // re-derived here: the navigation action itself owns which issue is selected.
  const unsubscribeStore = useAppStore.subscribe((state, previous) => {
    if (state.activeProjectId === previous.activeProjectId) return;
    const projectId = state.activeProjectId;
    if (!projectId) return;
    const issues = readIssues(queryClient, projectId);
    if (!issues || issues === state.githubIssues) return;
    useAppStore.setState((current) =>
      current.activeProjectId === projectId ? { githubIssues: issues } : {},
    );
  });

  return () => {
    unsubscribeCache();
    unsubscribeStore();
  };
}

/** Mounts the projection for the lifetime of the app shell. */
export function useIssueCacheProjection() {
  const queryClient = useQueryClient();
  useEffect(() => subscribeIssueCacheProjection(queryClient), [queryClient]);
}
