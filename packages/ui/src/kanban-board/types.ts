import type { ReactNode } from 'react';
import type {
  AppSettings,
  GitHubIssueCacheRecord,
  IssuePipelineStatus,
  Project,
  ResolvedPhaseModel,
  Thread,
} from '../lib/shipcode';

export type BoardView = 'kanban' | 'list' | 'graph';

export interface KanbanBoardProps {
  issues: GitHubIssueCacheRecord[];
  project?: Project | null;
  settings?: AppSettings | null;
  threads?: Thread[];
  approvedAwaitingExecutionIssueIds?: ReadonlySet<string>;
  readOnly?: boolean;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onRefresh: () => void;
  onStartPipeline?: (issue: GitHubIssueCacheRecord) => void;
  onRetry?: (issue: GitHubIssueCacheRecord) => void;
  onRerun?: (issue: GitHubIssueCacheRecord) => void;
  onMarkDone?: (issue: GitHubIssueCacheRecord) => void;
  onCancel?: (issue: GitHubIssueCacheRecord) => void;
  baseBranch?: string;
  branches?: string[];
  onBaseBranchChange?: (branch: string) => void;
  onRefreshBranches?: () => void;
  refreshingBranches?: boolean;
  selectedIssueNumber?: number;
  projectName?: string;
  repoUrl?: string | null;
  projectsUrl?: string | null;
  onOpenExternal?: (url: string) => void;
  onOpenPullRequest?: (url: string) => void;
  onArchiveIssue?: (issue: GitHubIssueCacheRecord) => void;
  onArchiveAllDone?: () => void;
  graphContent?: ReactNode;
}

export type ColumnKey = 'todo' | 'agent' | 'human' | 'done';
export type BoardSortOrder = 'priority' | 'id-desc' | 'id-asc' | 'title';
export type RowTone = 'default' | 'success' | 'done' | 'agent' | 'danger' | 'warning';

export type PhaseSection = {
  key: string;
  label: string;
  statuses: IssuePipelineStatus[];
  droppable: boolean;
};

export type BoardColumn = {
  key: ColumnKey;
  label: string;
  statuses: IssuePipelineStatus[];
  droppable?: boolean;
  sections?: PhaseSection[];
};

export type IssuePhaseChip = {
  phase: ResolvedPhaseModel;
  provider: 'claude' | 'codex' | 'openrouter';
  model: string;
  effort: string | null;
};

export type IssueApprovalBadge = {
  label: string;
  title: string;
  source: 'app' | 'project' | 'issue';
};

export type IssueRevisionBadge = {
  label: string;
  title: string;
  variant: 'default' | 'done' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
};
