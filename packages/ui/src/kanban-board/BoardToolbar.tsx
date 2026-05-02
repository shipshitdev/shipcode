'use client';

import {
  BrainCircuit,
  CircleAlert,
  Columns3,
  ExternalLink,
  LayoutList,
  RefreshCw,
  Workflow,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from '../primitives/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../primitives/select';
import { BOARD_SORT_LABELS } from './constants';
import type { BoardSortOrder, BoardView } from './types';

interface BoardToolbarProps {
  baseBranch?: string;
  branches?: string[];
  onBaseBranchChange?: (branch: string) => void;
  onRefreshBranches?: () => void;
  refreshingBranches: boolean;
  sortOrder: BoardSortOrder;
  onSortOrderChange: (order: BoardSortOrder) => void;
  view: BoardView;
  onViewChange: (view: BoardView) => void;
  graphEnabled?: boolean;
  approvalFilter: 'all' | 'needs-approval';
  onApprovalFilterChange: (filter: 'all' | 'needs-approval') => void;
  stalenessFilter: 'all' | 'stale';
  onStalenessFilterChange: (filter: 'all' | 'stale') => void;
  refreshing: boolean;
  onRefresh: () => void;
  triagingIssues?: boolean;
  triageCandidateCount?: number;
  onTriageIssues?: () => void;
  projectName?: string;
  repoUrl?: string | null;
  projectsUrl?: string | null;
  onRepoClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onProjectsClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

export function BoardToolbar({
  baseBranch,
  branches,
  onBaseBranchChange,
  onRefreshBranches,
  refreshingBranches,
  sortOrder,
  onSortOrderChange,
  view,
  onViewChange,
  graphEnabled = false,
  approvalFilter,
  onApprovalFilterChange,
  stalenessFilter,
  onStalenessFilterChange,
  refreshing,
  onRefresh,
  triagingIssues = false,
  triageCandidateCount = 0,
  onTriageIssues,
  projectName,
  repoUrl,
  projectsUrl,
  onRepoClick,
  onProjectsClick,
}: BoardToolbarProps) {
  const localBranches = branches?.filter((branch) => !branch.includes('/')) ?? [];
  const remoteBranches = branches?.filter((branch) => branch.includes('/')) ?? [];

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
      <h3 className="shrink-0 truncate text-sm font-semibold">{projectName ?? 'GitHub Issues'}</h3>
      {(repoUrl || projectsUrl) && (
        <div className="flex shrink-0 items-center gap-1">
          {repoUrl && (
            <Button asChild variant="outline" size="xs" title="Open repository on github.com">
              <a href={repoUrl} target="_blank" rel="noreferrer noopener" onClick={onRepoClick}>
                repo
                <ExternalLink size={10} />
              </a>
            </Button>
          )}
          {projectsUrl && (
            <Button asChild variant="outline" size="xs" title="Open Projects board on github.com">
              <a
                href={projectsUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick={onProjectsClick}
              >
                board
                <ExternalLink size={10} />
              </a>
            </Button>
          )}
        </div>
      )}
      <div className="flex-1" />
      <div className="flex shrink-0 items-center gap-2">
        {baseBranch && branches && branches.length > 0 && onBaseBranchChange && (
          <div className="flex max-w-[240px] min-w-0 shrink-0 items-center overflow-hidden rounded-md border border-border">
            <Select value={baseBranch} onValueChange={onBaseBranchChange}>
              <SelectTrigger className="h-7 gap-1 rounded-none border-0 bg-transparent px-2 font-mono text-xs text-secondary hover:text-primary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {localBranches.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Local</SelectLabel>
                    {localBranches.map((branch) => (
                      <SelectItem key={branch} value={branch} className="font-mono text-xs">
                        {branch}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {localBranches.length > 0 && remoteBranches.length > 0 && <SelectSeparator />}
                {remoteBranches.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Remote</SelectLabel>
                    {remoteBranches.map((branch) => (
                      <SelectItem key={branch} value={branch} className="font-mono text-xs">
                        {branch}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
            {onRefreshBranches && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-none border-l border-border"
                title="Refresh branches"
                disabled={refreshingBranches}
                onClick={(event) => {
                  event.stopPropagation();
                  onRefreshBranches();
                }}
              >
                <RefreshCw size={14} className={refreshingBranches ? 'animate-spin' : ''} />
              </Button>
            )}
          </div>
        )}
        <div className="flex max-w-[140px] min-w-0 shrink-0 items-center overflow-hidden rounded-md border border-border">
          <Select
            value={sortOrder}
            onValueChange={(value) => onSortOrderChange(value as BoardSortOrder)}
          >
            <SelectTrigger className="h-7 gap-1 rounded-none border-0 bg-transparent px-2 text-xs text-secondary hover:text-primary">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(BOARD_SORT_LABELS) as BoardSortOrder[]).map((key) => (
                <SelectItem key={key} value={key} className="text-xs">
                  {BOARD_SORT_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="xs"
          className={cn(
            'shrink-0',
            approvalFilter === 'needs-approval' &&
              'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15 hover:text-warning',
          )}
          title={
            approvalFilter === 'needs-approval'
              ? 'Show all issues'
              : 'Show only issues that require approval'
          }
          onClick={() =>
            onApprovalFilterChange(approvalFilter === 'needs-approval' ? 'all' : 'needs-approval')
          }
        >
          Needs approval
        </Button>
        <Button
          variant="outline"
          size="xs"
          className={cn(
            'shrink-0 gap-1.5',
            stalenessFilter === 'stale' &&
              'border-danger/40 bg-danger/10 text-danger hover:bg-danger/15 hover:text-danger',
          )}
          title={stalenessFilter === 'stale' ? 'Show all issues' : 'Show only stale issues'}
          onClick={() => onStalenessFilterChange(stalenessFilter === 'stale' ? 'all' : 'stale')}
        >
          <CircleAlert size={12} />
          Stale
        </Button>
        <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-border">
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn('rounded-none text-muted', view === 'list' && 'bg-accent/15 text-accent')}
            onClick={() => onViewChange('list')}
            title="List view"
          >
            <LayoutList size={14} />
          </Button>
          {graphEnabled && (
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                'rounded-none border-l border-border text-muted',
                view === 'graph' && 'bg-accent/15 text-accent',
              )}
              onClick={() => onViewChange('graph')}
              title="Graph view"
            >
              <Workflow size={14} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              'rounded-none border-l border-border text-muted',
              view === 'kanban' && 'bg-accent/15 text-accent',
            )}
            onClick={() => onViewChange('kanban')}
            title="Board view"
          >
            <Columns3 size={14} />
          </Button>
        </div>
        <Button variant="outline" size="icon-sm" onClick={onRefresh} title="Refresh board">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </Button>
        {onTriageIssues && (
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onTriageIssues}
            disabled={triagingIssues || triageCandidateCount === 0}
            title={
              triageCandidateCount === 0
                ? 'No unclaimed Todo issues to review'
                : `Review and align ${triageCandidateCount} Todo issue${triageCandidateCount === 1 ? '' : 's'}`
            }
            aria-label="Review and align board issues"
          >
            <BrainCircuit size={14} className={triagingIssues ? 'animate-pulse' : ''} />
          </Button>
        )}
      </div>
    </div>
  );
}
