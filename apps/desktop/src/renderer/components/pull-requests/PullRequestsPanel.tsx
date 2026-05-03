import type { PullRequestListFilter, PullRequestListItem } from '@shipcode/shared';
import { Button, cn } from '@shipshitdev/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GitPullRequest, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../../stores/app-store';
import { PullRequestDetailPanel } from './PullRequestDetailPanel';

const FILTERS: Array<{ value: PullRequestListFilter; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

export function PullRequestsPanel() {
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activePrNumber = useAppStore((state) => state.activePrNumber);
  const setActivePrNumber = useAppStore((state) => state.setActivePrNumber);
  const [filter, setFilter] = useState<PullRequestListFilter>('open');
  const queryClient = useQueryClient();

  const { data: pullRequests = [], isLoading } = useQuery<PullRequestListItem[]>({
    queryKey: ['pull-requests', activeProjectId, filter],
    queryFn: () => {
      if (!activeProjectId) return Promise.resolve([]);
      return window.shipcode.invoke('github:list-prs', {
        projectId: activeProjectId,
        filter,
      });
    },
    enabled: !!activeProjectId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  if (!activeProjectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        Select a project to view pull requests
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-w-0 overflow-hidden">
      {/* Left: PR list */}
      <div className="flex w-80 shrink-0 flex-col border-r border-border">
        {/* Filter bar */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
          {FILTERS.map(({ value, label }) => (
            <Button
              key={value}
              variant="ghost"
              className={cn(
                'h-6 px-2 text-[11px] font-medium text-secondary',
                filter === value && 'bg-tertiary text-primary',
              )}
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
          <div className="flex-1" />
          <Button
            variant="ghost"
            className="h-6 w-6 p-0 text-secondary"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ['pull-requests', activeProjectId] })
            }
          >
            <RefreshCw size={12} />
          </Button>
        </div>

        {/* PR list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center p-8 text-xs text-muted">
              Loading...
            </div>
          ) : pullRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
              <GitPullRequest size={24} className="text-muted" />
              <p className="text-xs text-muted">No pull requests found</p>
            </div>
          ) : (
            pullRequests.map((pr) => (
              <Button
                key={pr.number}
                type="button"
                variant="ghost"
                className={cn(
                  'w-full cursor-pointer border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/30',
                  activePrNumber === pr.number && 'bg-tertiary',
                )}
                onClick={() => setActivePrNumber(pr.number)}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-muted">#{pr.number}</span>
                  <span className="flex-1 truncate text-xs text-primary">{pr.title}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  {pr.author && <span className="text-[10px] text-muted">{pr.author}</span>}
                  <span className="text-[10px] text-muted">
                    {pr.headRefName} ← {pr.baseRefName}
                  </span>
                  <div className="flex-1" />
                  {pr.isDraft && (
                    <span className="rounded bg-secondary/50 px-1 py-0.5 text-[9px] font-medium text-muted">
                      DRAFT
                    </span>
                  )}
                  {pr.reviewDecision === 'APPROVED' && (
                    <span className="rounded bg-green-500/20 px-1 py-0.5 text-[9px] font-medium text-green-400">
                      APPROVED
                    </span>
                  )}
                  {pr.reviewDecision === 'CHANGES_REQUESTED' && (
                    <span className="rounded bg-red-500/20 px-1 py-0.5 text-[9px] font-medium text-red-400">
                      CHANGES
                    </span>
                  )}
                </div>
              </Button>
            ))
          )}
        </div>
      </div>

      {/* Right: PR detail */}
      <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
        {activePrNumber ? (
          <PullRequestDetailPanel prNumber={activePrNumber} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">
            Select a pull request to view details
          </div>
        )}
      </div>
    </div>
  );
}
