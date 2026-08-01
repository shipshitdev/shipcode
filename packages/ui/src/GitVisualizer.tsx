'use client';

import {
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { DiffRecord, GitWorktreeSummary } from '@/lib/shipcode';
import { shortHash } from '@/lib/shipcode';
import { cn } from '@/lib/utils';
import { Badge } from '@/primitives/badge';
import { Button } from '@/primitives/button';
import { SideBySideDiffViewer } from '@/SideBySideDiffViewer';

export interface GitVisualizerProps {
  worktrees: GitWorktreeSummary[];
  branches: string[];
  selectedWorktreePath: string | null;
  diffs: DiffRecord[];
  loading?: boolean;
  diffLoading?: boolean;
  onSelectWorktree: (path: string) => void;
  onRefresh?: () => void;
  headerActions?: ReactNode;
  className?: string;
}

function formatShortSha(value: string) {
  return shortHash(value, 7) || 'unknown';
}

function formatDirtySummary(worktree: GitWorktreeSummary) {
  const count = worktree.modifiedCount + worktree.stagedCount + worktree.untrackedCount;
  if (count === 0) return 'clean';
  const parts = [
    worktree.modifiedCount > 0 ? `${worktree.modifiedCount} modified` : null,
    worktree.stagedCount > 0 ? `${worktree.stagedCount} staged` : null,
    worktree.untrackedCount > 0 ? `${worktree.untrackedCount} untracked` : null,
  ].filter(Boolean);
  return parts.join(', ');
}

function formatDivergence(worktree: GitWorktreeSummary) {
  const parts = [
    worktree.aheadCount > 0 ? `+${worktree.aheadCount} ahead` : null,
    worktree.behindCount > 0 ? `-${worktree.behindCount} behind` : null,
  ].filter(Boolean);
  if (parts.length === 0) return worktree.compareRef ? `even with ${worktree.compareRef}` : null;
  return `${parts.join(' / ')}${worktree.compareRef ? ` vs ${worktree.compareRef}` : ''}`;
}

function worktreeTitle(worktree: GitWorktreeSummary) {
  if (worktree.kind === 'main') return 'Main working tree';
  if (worktree.issueNumber != null && worktree.title) {
    return `#${worktree.issueNumber} ${worktree.title}`;
  }
  return worktree.title ?? worktree.branch;
}

export function GitVisualizer({
  worktrees,
  branches,
  selectedWorktreePath,
  diffs,
  loading = false,
  diffLoading = false,
  onSelectWorktree,
  onRefresh,
  headerActions,
  className,
}: GitVisualizerProps) {
  const selectedWorktree =
    worktrees.find((worktree) => worktree.path === selectedWorktreePath) ?? worktrees[0] ?? null;

  return (
    <div className={cn('flex h-full min-h-0 overflow-hidden bg-primary', className)}>
      <aside className="flex w-[330px] shrink-0 flex-col border-r border-border bg-secondary/20">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          <GitCompareArrows size={15} className="text-secondary" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-primary">Git Visualizer</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {worktrees.length} worktree{worktrees.length === 1 ? '' : 's'} · {branches.length}{' '}
              branch{branches.length === 1 ? '' : 'es'}
            </div>
          </div>
          {onRefresh ? (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Refresh git visualizer"
              aria-label="Refresh git visualizer"
              onClick={onRefresh}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
            </Button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-3 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Worktrees
          </div>
          <div className="space-y-1 px-2">
            {worktrees.map((worktree) => {
              const selected = selectedWorktree?.path === worktree.path;
              const divergence = formatDivergence(worktree);
              const hasLocalCommits = worktree.aheadCount > 0;
              return (
                <Button
                  key={worktree.id}
                  type="button"
                  variant="ghost"
                  className={cn(
                    'h-auto w-full flex-col items-stretch gap-0 whitespace-normal rounded-md border px-2.5 py-2 text-left transition-colors',
                    selected
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-transparent hover:border-border hover:bg-hover',
                  )}
                  onClick={() => onSelectWorktree(worktree.path)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <GitBranch size={13} className="shrink-0 text-secondary" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-primary">
                      {worktree.branch}
                    </span>
                    <Badge
                      variant={worktree.isDirty || hasLocalCommits ? 'warning' : 'success'}
                      className="shrink-0"
                    >
                      {worktree.isDirty ? 'dirty' : hasLocalCommits ? 'ahead' : 'clean'}
                    </Badge>
                  </div>
                  <div className="mt-1 truncate text-xs text-secondary">
                    {worktreeTitle(worktree)}
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                    <GitCommitHorizontal size={12} className="shrink-0" />
                    <span className="font-mono">{formatShortSha(worktree.commitHash)}</span>
                    <span className="truncate">{formatDirtySummary(worktree)}</span>
                  </div>
                  {divergence ? (
                    <div
                      className={cn(
                        'mt-1 truncate text-[11px]',
                        hasLocalCommits ? 'text-amber-500' : 'text-muted-foreground',
                      )}
                    >
                      {divergence}
                    </div>
                  ) : null}
                </Button>
              );
            })}
          </div>

          <div className="px-3 pb-2 pt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Branches
          </div>
          <div className="space-y-1 px-2 pb-4">
            {branches.map((branch) => (
              <div
                key={branch}
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs',
                  branch === selectedWorktree?.branch
                    ? 'bg-tertiary text-primary'
                    : 'text-secondary',
                )}
              >
                <GitBranch size={12} className="shrink-0" />
                <span className="truncate font-mono">{branch}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
          {selectedWorktree ? (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-primary">
                  {worktreeTitle(selectedWorktree)}
                </div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {selectedWorktree.path}
                </div>
              </div>
              <Badge variant={diffs.length > 0 ? 'warning' : 'success'}>
                {diffs.length} file{diffs.length === 1 ? '' : 's'}
              </Badge>
              {selectedWorktree.preCommitHookPath ? (
                <Badge variant="warning" title={selectedWorktree.preCommitHookPath}>
                  <ShieldAlert size={11} />
                  pre-hook
                </Badge>
              ) : null}
              {headerActions ? (
                <div className="flex shrink-0 items-center gap-1">{headerActions}</div>
              ) : null}
            </>
          ) : (
            <div className="text-sm text-secondary">No worktrees found.</div>
          )}
        </div>

        <div className="min-h-0 flex-1">
          {diffLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-secondary">
              Loading diff…
            </div>
          ) : (
            <SideBySideDiffViewer diffs={diffs} className="h-full" />
          )}
        </div>
      </section>
    </div>
  );
}
