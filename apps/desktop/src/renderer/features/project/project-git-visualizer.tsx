import type { DiffRecord, GitVisualizerData } from '@shipcode/shared';
import { GitVisualizer } from '@shipcode/ui';
import { Alert, AlertDescription, Loader2 } from '@shipshitdev/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/app-store';

export function ProjectGitVisualizer() {
  const queryClient = useQueryClient();
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const [selectedWorktreePath, setSelectedWorktreePath] = useState<string | null>(null);

  const {
    data,
    error: dataError,
    isLoading,
    isFetching,
  } = useQuery<GitVisualizerData>({
    queryKey: ['git-visualizer-data', activeProjectId],
    queryFn: () => window.shipcode.invoke('git:visualizer-data', { projectId: activeProjectId }),
    enabled: !!activeProjectId,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!data?.worktrees.length) {
      setSelectedWorktreePath(null);
      return;
    }
    setSelectedWorktreePath((current) =>
      current && data.worktrees.some((worktree) => worktree.path === current)
        ? current
        : data.worktrees[0].path,
    );
  }, [data?.worktrees]);

  const {
    data: diffs = [],
    error: diffError,
    isFetching: isDiffFetching,
  } = useQuery<DiffRecord[]>({
    queryKey: ['git-worktree-diff', activeProjectId, selectedWorktreePath],
    queryFn: () =>
      window.shipcode.invoke('git:worktree-diff', {
        projectId: activeProjectId,
        worktreePath: selectedWorktreePath ?? '',
      }),
    enabled: !!activeProjectId && !!selectedWorktreePath,
    staleTime: 2_000,
  });

  if (!activeProjectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-secondary">
        Select a project to view git worktrees.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-secondary">
        <Loader2 className="animate-spin" size={14} />
        Loading git state...
      </div>
    );
  }

  if (!data || dataError) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertDescription>
            {dataError instanceof Error ? dataError.message : 'Unable to load git state.'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {diffError ? (
        <Alert variant="destructive" className="m-3 mb-0 shrink-0">
          <AlertDescription>
            {diffError instanceof Error ? diffError.message : 'Unable to load worktree diff.'}
          </AlertDescription>
        </Alert>
      ) : null}
      <GitVisualizer
        worktrees={data.worktrees}
        branches={data.branches}
        selectedWorktreePath={selectedWorktreePath}
        diffs={diffs}
        loading={isFetching}
        diffLoading={isDiffFetching}
        onSelectWorktree={setSelectedWorktreePath}
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ['git-visualizer-data', activeProjectId] });
          queryClient.invalidateQueries({ queryKey: ['git-worktree-diff', activeProjectId] });
        }}
      />
    </div>
  );
}
