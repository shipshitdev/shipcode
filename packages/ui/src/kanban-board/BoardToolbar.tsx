'use client';

import { Columns3, ExternalLink, LayoutList, RefreshCw } from 'lucide-react';
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
import type { BoardSortOrder } from './types';

interface BoardToolbarProps {
  baseBranch?: string;
  branches?: string[];
  onBaseBranchChange?: (branch: string) => void;
  onRefreshBranches?: () => void;
  refreshingBranches: boolean;
  sortOrder: BoardSortOrder;
  onSortOrderChange: (order: BoardSortOrder) => void;
  view: 'kanban' | 'list';
  onViewChange: (view: 'kanban' | 'list') => void;
  refreshing: boolean;
  onRefresh: () => void;
  onNewIssue?: () => void;
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
  refreshing,
  onRefresh,
  onNewIssue,
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
        {onNewIssue && (
          <Button size="sm" onClick={onNewIssue}>
            + New PRD
          </Button>
        )}
      </div>
    </div>
  );
}
