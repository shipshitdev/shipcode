'use client';

import {
  BrainCircuit,
  Columns3,
  ExternalLink,
  LayoutList,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Workflow,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/primitives/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/primitives/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/primitives/select';
import { BOARD_SORT_LABELS } from './constants';
import type { BoardSortOrder, BoardView } from './types';

const PRIORITY_LABELS: Record<'p0' | 'p1' | 'p2' | 'p3', string> = {
  p0: 'P0 — Critical',
  p1: 'P1 — High',
  p2: 'P2 — Medium',
  p3: 'P3 — Low',
};
const EMPTY_AUTO_RUN_PRIORITIES: Array<'p0' | 'p1' | 'p2' | 'p3'> = [];

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
  projectActions?: ReactNode;
  repoUrl?: string | null;
  projectsUrl?: string | null;
  onRepoClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onProjectsClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  // Auto-run
  autoRunCount?: number;
  autoRunPriorities?: Array<'p0' | 'p1' | 'p2' | 'p3'>;
  onAutoRunPrioritiesChange?: (priorities: Array<'p0' | 'p1' | 'p2' | 'p3'>) => void;
  onAutoRun?: () => void;
  autoRunning?: boolean;
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
  projectActions,
  repoUrl,
  projectsUrl,
  onRepoClick,
  onProjectsClick,
  autoRunCount = 0,
  autoRunPriorities = EMPTY_AUTO_RUN_PRIORITIES,
  onAutoRunPrioritiesChange,
  onAutoRun,
  autoRunning = false,
}: BoardToolbarProps) {
  const activeFilterCount =
    (approvalFilter === 'needs-approval' ? 1 : 0) + (stalenessFilter === 'stale' ? 1 : 0);

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
      <h3 className="shrink-0 truncate text-sm font-semibold">{projectName ?? 'GitHub Issues'}</h3>
      {(projectActions || repoUrl || projectsUrl) && (
        <ProjectLinks
          projectActions={projectActions}
          repoUrl={repoUrl}
          projectsUrl={projectsUrl}
          onRepoClick={onRepoClick}
          onProjectsClick={onProjectsClick}
        />
      )}
      <div className="flex-1" />
      <div className="flex shrink-0 items-center gap-2">
        <BranchSelector
          baseBranch={baseBranch}
          branches={branches}
          onBaseBranchChange={onBaseBranchChange}
          onRefreshBranches={onRefreshBranches}
          refreshingBranches={refreshingBranches}
        />
        <SortSelector sortOrder={sortOrder} onSortOrderChange={onSortOrderChange} />
        <IssueFilters
          activeFilterCount={activeFilterCount}
          approvalFilter={approvalFilter}
          onApprovalFilterChange={onApprovalFilterChange}
          stalenessFilter={stalenessFilter}
          onStalenessFilterChange={onStalenessFilterChange}
        />
        <ViewSwitcher view={view} graphEnabled={graphEnabled} onViewChange={onViewChange} />
        <AutoRunControls
          autoRunCount={autoRunCount}
          autoRunPriorities={autoRunPriorities}
          autoRunning={autoRunning}
          onAutoRun={onAutoRun}
          onAutoRunPrioritiesChange={onAutoRunPrioritiesChange}
        />
        <TriageButton
          onTriageIssues={onTriageIssues}
          triagingIssues={triagingIssues}
          triageCandidateCount={triageCandidateCount}
        />
        <Button variant="outline" size="icon-sm" onClick={onRefresh} title="Refresh board">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </Button>
      </div>
    </div>
  );
}

function ProjectLinks({
  repoUrl,
  projectsUrl,
  onRepoClick,
  onProjectsClick,
  projectActions,
}: Pick<
  BoardToolbarProps,
  'projectActions' | 'repoUrl' | 'projectsUrl' | 'onRepoClick' | 'onProjectsClick'
>) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {projectActions}
      {repoUrl && (
        <Button asChild variant="outline" size="sm" title="Open repository on github.com">
          <a href={repoUrl} target="_blank" rel="noreferrer noopener" onClick={onRepoClick}>
            repo
            <ExternalLink size={10} />
          </a>
        </Button>
      )}
      {projectsUrl && (
        <Button asChild variant="outline" size="sm" title="Open Projects board on github.com">
          <a href={projectsUrl} target="_blank" rel="noreferrer noopener" onClick={onProjectsClick}>
            board
            <ExternalLink size={10} />
          </a>
        </Button>
      )}
    </div>
  );
}

function BranchSelector({
  baseBranch,
  branches,
  onBaseBranchChange,
  onRefreshBranches,
  refreshingBranches,
}: Pick<
  BoardToolbarProps,
  'baseBranch' | 'branches' | 'onBaseBranchChange' | 'onRefreshBranches' | 'refreshingBranches'
>) {
  if (!baseBranch || !branches?.length || !onBaseBranchChange) return null;

  const localBranches = branches.filter((branch) => !branch.includes('/'));
  const remoteBranches = branches.filter((branch) => branch.includes('/'));

  return (
    <div className="flex h-7 max-w-[240px] min-w-0 shrink-0 items-center overflow-hidden rounded-md border border-border">
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
  );
}

function SortSelector({
  sortOrder,
  onSortOrderChange,
}: Pick<BoardToolbarProps, 'sortOrder' | 'onSortOrderChange'>) {
  return (
    <div className="flex h-7 max-w-[140px] min-w-0 shrink-0 items-center overflow-hidden rounded-md border border-border">
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
  );
}

function IssueFilters({
  activeFilterCount,
  approvalFilter,
  onApprovalFilterChange,
  stalenessFilter,
  onStalenessFilterChange,
}: Pick<
  BoardToolbarProps,
  'approvalFilter' | 'onApprovalFilterChange' | 'stalenessFilter' | 'onStalenessFilterChange'
> & {
  activeFilterCount: number;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'shrink-0 gap-1.5',
            activeFilterCount > 0 &&
              'border-accent/40 bg-accent/10 text-accent hover:bg-accent/15 hover:text-accent',
          )}
          title="Filter issues"
        >
          <SlidersHorizontal size={12} />
          Filters
          {activeFilterCount > 0 && (
            <span className="flex size-4 items-center justify-center rounded-full bg-accent/20 text-[10px] font-semibold leading-none text-accent">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuCheckboxItem
          checked={approvalFilter === 'needs-approval'}
          onCheckedChange={(checked) => onApprovalFilterChange(checked ? 'needs-approval' : 'all')}
        >
          Needs approval
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={stalenessFilter === 'stale'}
          onCheckedChange={(checked) => onStalenessFilterChange(checked ? 'stale' : 'all')}
        >
          Stale
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ViewSwitcher({
  view,
  graphEnabled,
  onViewChange,
}: Pick<BoardToolbarProps, 'view' | 'graphEnabled' | 'onViewChange'>) {
  return (
    <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-border">
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(
          'rounded-none text-muted-foreground',
          view === 'kanban' && 'bg-accent/15 text-accent',
        )}
        onClick={() => onViewChange('kanban')}
        title="Board view"
      >
        <Columns3 size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(
          'rounded-none border-l border-border text-muted-foreground',
          view === 'list' && 'bg-accent/15 text-accent',
        )}
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
            'rounded-none border-l border-border text-muted-foreground',
            view === 'graph' && 'bg-accent/15 text-accent',
          )}
          onClick={() => onViewChange('graph')}
          title="Graph view"
        >
          <Workflow size={14} />
        </Button>
      )}
    </div>
  );
}

function AutoRunControls({
  autoRunCount = 0,
  autoRunPriorities = EMPTY_AUTO_RUN_PRIORITIES,
  autoRunning,
  onAutoRun,
  onAutoRunPrioritiesChange,
}: Pick<
  BoardToolbarProps,
  'autoRunCount' | 'autoRunPriorities' | 'autoRunning' | 'onAutoRun' | 'onAutoRunPrioritiesChange'
>) {
  if (!onAutoRun) return null;

  return (
    <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-border">
      <Button
        variant="ghost"
        size="sm"
        className={cn('gap-1.5 rounded-none', autoRunning && 'text-accent')}
        onClick={onAutoRun}
        disabled={autoRunning || autoRunCount === 0}
        title={
          autoRunCount === 0
            ? 'No eligible todo issues'
            : `Start ${autoRunCount} issue${autoRunCount === 1 ? '' : 's'} through the pipeline`
        }
      >
        <Play size={12} className={autoRunning ? 'animate-pulse' : ''} />
        Run ({autoRunCount})
      </Button>
      {onAutoRunPrioritiesChange && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                'rounded-none border-l border-border text-muted-foreground',
                autoRunPriorities.length > 0 && 'text-accent',
              )}
              title="Filter auto-run by priority"
            >
              <SlidersHorizontal size={10} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              onClick={() =>
                onAutoRunPrioritiesChange(
                  autoRunPriorities.length === 4 ? [] : (['p0', 'p1', 'p2', 'p3'] as const).slice(),
                )
              }
            >
              {autoRunPriorities.length === 4 ? 'Clear filter' : 'Select all'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {(Object.keys(PRIORITY_LABELS) as Array<'p0' | 'p1' | 'p2' | 'p3'>).map((rank) => (
              <DropdownMenuCheckboxItem
                key={rank}
                checked={autoRunPriorities.includes(rank)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) => {
                  const next = checked
                    ? [...autoRunPriorities, rank]
                    : autoRunPriorities.filter((p) => p !== rank);
                  onAutoRunPrioritiesChange(next);
                }}
              >
                {PRIORITY_LABELS[rank]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function TriageButton({
  onTriageIssues,
  triagingIssues,
  triageCandidateCount = 0,
}: Pick<BoardToolbarProps, 'onTriageIssues' | 'triagingIssues' | 'triageCandidateCount'>) {
  if (!onTriageIssues) return null;

  return (
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
  );
}
