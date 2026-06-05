import type { ExecutorModel } from './agents';
import type { PipelinePhase, Thread } from './pipeline-core';
import type { Project } from './project';
import type { PlanStatus } from './records';
import type { AppSettings } from './settings';

// === Onboarding Types ===

export type OnboardingStep =
  | 'ai-auth'
  | 'github-project'
  | 'model-preferences'
  | 'label-mapping'
  | 'complete';

export interface GhAuthStatus {
  installed: boolean;
  authenticated: boolean;
  username: string | null;
  version: string | null;
  error: string | null;
  /**
   * Whether the gh token includes a scope sufficient to read AND write
   * GitHub Projects v2 (`project`). Required by `gh project item-add`,
   * which ShipCode uses to attach issues to a project board.
   *
   * `null` when authentication failed or the scope list could not be
   * parsed (e.g. older gh versions). UI should treat `null` as unknown
   * and not show an error.
   */
  hasProjectScope: boolean | null;
}

// === Mission Control Dashboard ===

export interface DashboardStats {
  agentsRunning: number;
  runningByPhase: Partial<Record<PipelinePhase, number>>;
  agentsRunningByProject: Record<string, number>;
  pendingApprovalsByProject: Record<string, number>;
  tasksInProgress: number;
  tasksOpen: number;
  tasksBlocked: number;
  pendingApprovals: number;
  staleApprovals: number;
  shippedLast7d: number;
  failedLast7d: number;
}

export interface DashboardOverview {
  stats: DashboardStats;
  running: ActivePipelineSummary[];
  activity: ActivityEntry[];
  activityTotal: number;
  recent: RecentTask[];
  recentTotal: number;
}

export interface ThreadPanelData {
  project: Project | null;
  settings: AppSettings;
  threads: Thread[];
  latestPlanStatusByThreadId: Record<string, PlanStatus | null>;
  branches: string[];
}

export interface GitHubIssueComment {
  id: number;
  author: string | null;
  authorAssociation?: string | null;
  body: string;
  createdAt: string;
  url: string;
}

export interface ProjectCostSummary {
  projectId: string;
  projectName: string;
  totalCostUsd: number;
  totalTokensPrompt: number;
  totalTokensCompletion: number;
  taskCount: number;
}

export interface CostSummary {
  totalCostAllTime: number;
  totalCost7d: number;
  totalTokensAllTime: number;
  totalTokens7d: number;
  avgCostPerTask: number;
  avgTokensPerTask: number;
  byProject: ProjectCostSummary[];
}

export interface CostTaskSummary {
  threadId: string;
  projectId: string;
  title: string;
  projectName: string;
  phase: PipelinePhase;
  provider: ExecutorModel;
  model: string | null;
  costUsd: number;
  tokensPrompt: number;
  tokensCompletion: number;
  updatedAt: string;
}

export type ActivityKind =
  | 'phase_change'
  | 'plan_parsed'
  | 'review_parsed'
  | 'verification_parsed'
  | 'pipeline_started'
  | 'pipeline_cancelled'
  | 'pipeline_failed'
  | 'pipeline_completed'
  | 'pipeline_verification_exhausted'
  | 'notification_fired';

export type ActivityActor = 'claude' | 'codex' | 'system' | 'human';

export interface ActivityEntry {
  id: string;
  threadId: string | null;
  projectId: string | null;
  kind: ActivityKind;
  actor: ActivityActor;
  title: string;
  subtitle: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface RecentTask {
  threadId: string;
  projectId: string;
  projectName: string;
  title: string;
  phase: PipelinePhase;
  githubIssueNumber: number | null;
  updatedAt: string;
}

export interface ActivePipelineSummary {
  threadId: string;
  projectId: string;
  projectName: string;
  threadTitle: string;
  phase: PipelinePhase;
  approvedAwaitingExecution?: boolean;
  startedAt: number;
  activeProcessId: string | null;
  githubIssueNumber: number | null;
  modelProvider: ExecutorModel | null;
  model: string | null;
  reasoningEffort: string | null;
}

// === Notifications ===

export type NotificationKind =
  | 'approval'
  | 'failed'
  | 'completed'
  | 'verification_exhausted'
  | 'ci_blocked';

export interface NotificationRecord {
  id: string;
  threadId: string;
  projectId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  dismissedAt: string | null;
}
