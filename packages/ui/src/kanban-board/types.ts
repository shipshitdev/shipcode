import type {
  AppSettings,
  GitHubIssueCacheRecord,
  IssuePipelineStatus,
  Project,
  ResolvedPhaseModel,
  Thread,
} from '@shipcode/shared';

export interface KanbanBoardProps {
  issues: GitHubIssueCacheRecord[];
  project?: Project | null;
  settings?: AppSettings | null;
  threads?: Thread[];
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
  model: string;
  effort: string | null;
};
