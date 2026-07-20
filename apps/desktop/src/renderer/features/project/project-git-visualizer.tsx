import type { AutoCommitResult, DiffRecord, GitVisualizerData } from '@shipcode/shared';
import { GitVisualizer } from '@shipcode/ui';
import { Alert, AlertDescription, Button } from '@shipshitdev/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CleanupModal } from '../../components/CleanupModal';
import { useAppSettings } from '../../hooks/useAppSettings';
import { useAppStore } from '../../stores/app-store';

export function ProjectGitVisualizer() {
  const queryClient = useQueryClient();
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const pendingGitWorktreePath = useAppStore((state) => state.pendingGitWorktreePath);
  const clearPendingGitWorktreePath = useAppStore((state) => state.clearPendingGitWorktreePath);
  const [userSelectedWorktreePath, setUserSelectedWorktreePath] = useState<string | null>(null);
  const [autoCommitMessage, setAutoCommitMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);

  const { data: settings } = useAppSettings();

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

  const selectedWorktreePath = useMemo(() => {
    const worktrees = data?.worktrees ?? [];
    if (worktrees.length === 0) return null;
    if (pendingGitWorktreePath && worktrees.some((w) => w.path === pendingGitWorktreePath)) {
      return pendingGitWorktreePath;
    }
    if (userSelectedWorktreePath && worktrees.some((w) => w.path === userSelectedWorktreePath)) {
      return userSelectedWorktreePath;
    }
    return worktrees[0].path;
  }, [data?.worktrees, pendingGitWorktreePath, userSelectedWorktreePath]);

  useEffect(() => {
    if (
      pendingGitWorktreePath &&
      data?.worktrees &&
      (selectedWorktreePath === pendingGitWorktreePath ||
        !data.worktrees.some((w) => w.path === pendingGitWorktreePath))
    ) {
      clearPendingGitWorktreePath();
    }
  }, [data?.worktrees, pendingGitWorktreePath, selectedWorktreePath, clearPendingGitWorktreePath]);

  const {
    data: diffs = [],
    error: diffError,
    isFetching: isDiffFetching,
  } = useQuery<DiffRecord[]>({
    queryKey: ['git-worktree-diff', activeProjectId, selectedWorktreePath],
    queryFn: () =>
      window.shipcode.invoke('git:worktree-diff', {
        projectId: activeProjectId,
        worktreePath: selectedWorktreePath,
      }),
    enabled: !!activeProjectId && !!selectedWorktreePath,
    staleTime: 2_000,
  });

  const selectedWorktree = useMemo(
    () => data?.worktrees.find((w) => w.path === selectedWorktreePath) ?? null,
    [data?.worktrees, selectedWorktreePath],
  );

  const autoCommit = useMutation({
    mutationFn: () =>
      window.shipcode.invoke<AutoCommitResult>('git:auto-commit', {
        projectId: activeProjectId,
        worktreePath: selectedWorktreePath,
      }),
    onSuccess: (result) => {
      const created = result.commits.length;
      if (result.partialFailure) {
        const hookPrefix = result.partialFailure.hookFailure
          ? `Pre-commit hook blocked auto-commit${result.partialFailure.hookPath ? ` (${result.partialFailure.hookPath})` : ''}: `
          : '';
        setAutoCommitMessage({
          tone: 'error',
          text: `${hookPrefix}Committed ${created} of ${result.partialFailure.groupIndex + 1} groups, then failed: ${result.partialFailure.error}`,
        });
      } else {
        setAutoCommitMessage({
          tone: 'success',
          text: `Created ${created} commit${created === 1 ? '' : 's'}${result.fallbackUsed ? ' (single-commit fallback)' : ''}${result.preCommitHookPath ? ' after running the pre-commit hook' : ''}.`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['git-visualizer-data', activeProjectId] });
      queryClient.invalidateQueries({ queryKey: ['git-worktree-diff', activeProjectId] });
    },
    onError: (err) => {
      setAutoCommitMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Auto-commit failed.',
      });
    },
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
        Loading git state…
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

  const autoCommitDisabled =
    !settings?.autoCommitEnabled ||
    autoCommit.isPending ||
    !selectedWorktree ||
    !selectedWorktree.isDirty;

  const headerActions = (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => autoCommit.mutate()}
        disabled={autoCommitDisabled}
        title={
          !settings?.autoCommitEnabled
            ? 'Enable auto-commit in Settings'
            : !selectedWorktree?.isDirty
              ? 'Worktree clean'
              : 'AI-generated split commits'
        }
      >
        {autoCommit.isPending ? (
          <Loader2 className="animate-spin" size={13} />
        ) : (
          <Sparkles size={13} />
        )}
        Auto-commit
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setCleanupOpen(true)}
        disabled={autoCommit.isPending}
        title="Cleanup merged worktrees & branches"
      >
        <Trash2 size={13} />
        Cleanup
      </Button>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {diffError ? (
        <Alert variant="destructive" className="m-3 mb-0 shrink-0">
          <AlertDescription>
            {diffError instanceof Error ? diffError.message : 'Unable to load worktree diff.'}
          </AlertDescription>
        </Alert>
      ) : null}
      {autoCommitMessage ? (
        <Alert
          variant={autoCommitMessage.tone === 'error' ? 'destructive' : 'default'}
          className="m-3 mb-0 shrink-0"
        >
          <AlertDescription>
            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">
              {autoCommitMessage.text}
            </pre>
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
        onSelectWorktree={setUserSelectedWorktreePath}
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ['git-visualizer-data', activeProjectId] });
          queryClient.invalidateQueries({ queryKey: ['git-worktree-diff', activeProjectId] });
        }}
        headerActions={headerActions}
      />
      {settings ? (
        <CleanupModal
          open={cleanupOpen}
          onClose={() => setCleanupOpen(false)}
          projectId={activeProjectId}
          criteria={settings.cleanupCriteria}
        />
      ) : null}
    </div>
  );
}
