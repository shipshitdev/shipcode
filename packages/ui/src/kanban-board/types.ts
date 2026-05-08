import type { ReactNode } from 'react';
import type {
  AppSettings,
  GitHubIssueCacheRecord,
  IssuePipelineStatus,
  Project,
  ResolvedPhaseModel,
  Thread,
} from '@/lib/shipcode';

export type BoardView = 'kanban' | 'list' | 'graph';

export interface KanbanBoardProps {
  issues: GitHubIssueCacheRecord[];
  project?: Project | null;
  settings?: AppSettings | null;
  threads?: Thread[];
  approvedAwaitingExecutionIssueIds?: ReadonlySet<string>;
  flashingIssueIds?: ReadonlySet<string>;
  readOnly?: boolean;
  presentationMode?: 'app' | 'compact';
  issueHoverCards?: boolean;
  keyboardShortcutsEnabled?: boolean;
  onIssueClick: (issue: GitHubIssueCacheRecord) => void;
  onCommentIssue?: (issue: GitHubIssueCacheRecord) => void;
  onRefresh: () => void;
  onTriageIssues?: () => void;
  triagingIssues?: boolean;
  triageCandidateCount?: number;
  onStartPipeline?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onRetry?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onRerun?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onMarkDone?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onCancel?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
  onCreatePr?: (issue: GitHubIssueCacheRecord) => void | Promise<void>;
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
  // Auto-run: batch-start all eligible todo issues
  autoRunCount?: number;
  autoRunPriorities?: Array<'p0' | 'p1' | 'p2' | 'p3'>;
  onAutoRunPrioritiesChange?: (priorities: Array<'p0' | 'p1' | 'p2' | 'p3'>) => void;
  onAutoRun?: () => void;
  autoRunning?: boolean;
  onFetchPlanSteps?: (threadId: string) => Promise<PlanStepSummary[] | null>;
}

export type ColumnKey = 'todo' | 'agent' | 'human' | 'done' | 'deferred';
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

export type IssuePriorityBadge = {
  label: string;
  title: string;
  variant: 'default' | 'warning' | 'info' | 'accent';
  rank: 'p0' | 'p1' | 'p2' | 'p3' | null;
};

export interface PlanStepSummary {
  id: string;
  order: number;
  title: string;
  status: 'ready' | 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
  agentRole: string;
}
