import type { ExecutorModel, ReasoningEffort, RevisionCount } from './agents';
import type { DiffRecord } from './git';
import { PIPELINE_PHASE } from './pipeline-core';

// === GitHub Types ===

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  assignee: string | null;
  state: 'open' | 'closed';
  url: string;
  updatedAt?: string | null;
  author?: { login: string };
}

export interface GitHubPrCheckSummary {
  name: string;
  status: 'pending' | 'success' | 'failed';
  conclusion: string | null;
  detailsUrl: string | null;
  workflowName: string | null;
}

export interface GitHubPrReviewCommentSummary {
  author: string | null;
  body: string;
  url: string;
  createdAt: string;
  path: string | null;
  line: number | null;
}

export type PullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';
export type PullRequestReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED';
export type PullRequestListFilter = 'open' | 'closed' | 'merged' | 'all';

export interface PullRequestListItem {
  number: number;
  title: string;
  author: string | null;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  state: PullRequestState;
  reviewDecision: PullRequestReviewDecision | null;
  url: string;
  labels: string[];
  updatedAt: string;
  linkedIssueNumbers: number[];
}

export interface PullRequestDetail {
  number: number;
  url: string;
  title: string;
  body: string | null;
  author: string | null;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  state: PullRequestState;
  reviewDecision: PullRequestReviewDecision | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  linkedIssueNumbers: number[];
  ciBlocked: boolean;
  failingChecks: GitHubPrCheckSummary[];
  unresolvedReviewComments: GitHubPrReviewCommentSummary[];
  unresolvedReviewCommentCount: number;
}

export interface PullRequestDetailResponse extends PullRequestDetail {
  linkedThreadId: string | null;
  diffs: DiffRecord[];
}

export interface GitHubIssueCacheRecord {
  id: string;
  projectId: string;
  issueNumber: number;
  title: string;
  body: string | null;
  labels: string[];
  assignee: string | null;
  author?: string | null;
  state: string;
  pipelineStatus: IssuePipelineStatus;
  threadId: string | null;
  claimedAt: string | null;
  claimedBy: string | null;
  executionRunId?: string | null;
  executionLockedAt?: string | null;
  executionLockOwner?: string | null;
  lastPhaseUpdate: string | null;
  pipelineStartedAt?: string | null;
  lastStatusLabel: string | null;
  // Nullable per-issue phase provider overrides. Null means "inherit from
  // project/global settings".
  plannerModelOverride: ExecutorModel | null;
  reviewerModelOverride: ExecutorModel | null;
  executorModelOverride: ExecutorModel | null;
  verifierModelOverride: ExecutorModel | null;
  plannerModelIdOverride: string | null;
  reviewerModelIdOverride: string | null;
  executorModelIdOverride: string | null;
  verifierModelIdOverride: string | null;
  plannerReasoningEffortOverride: ReasoningEffort | null;
  reviewerReasoningEffortOverride: ReasoningEffort | null;
  executorReasoningEffortOverride: ReasoningEffort | null;
  verifierReasoningEffortOverride: ReasoningEffort | null;
  revisionCountOverride: RevisionCount | null;
  requireApprovalOverride?: boolean | null;
  linkedPrNumber: number | null;
  linkedPrUrl: string | null;
  linkedPrIsDraft: boolean;
  ciBlocked: boolean;
  failingChecks: GitHubPrCheckSummary[];
  unresolvedReviewComments: GitHubPrReviewCommentSummary[];
  unresolvedReviewCommentCount: number;
  prLastSyncAt: string | null;
  updatedAt?: string | null;
  fetchedAt: string;
  // GitHub Projects v2 single-select Priority field, synced via the configured
  // project board. priorityRank is the normalized bucket; priorityRaw is the
  // verbatim option name (so unknown options like "Icebox" round-trip).
  // priorityFetchedAt distinguishes "we know it has no priority" (timestamp +
  // null rank/raw) from "we never asked" (all null).
  priorityRank: 'p0' | 'p1' | 'p2' | 'p3' | null;
  priorityRaw: string | null;
  priorityFetchedAt: string | null;
  issueType?: string | null;
  rulesAppliedAt?: string | null;
  triageFailureReason?: string | null;
  // Quick mode: synthetic local-only task with negative sentinel `issueNumber`
  // and no real GitHub issue. Pipeline runs against raw text; PR/comment paths
  // must skip these rows.
  isQuickMode: boolean;
  // Renderer-only optimistic state for a GitHub issue that has been accepted
  // by the UI but has not been confirmed by GitHub yet.
  syncState?: 'creating';
}

export interface GitHubIssueTriageSummary {
  issueNumber: number;
  confidence: number;
  applied: boolean;
  suggestedLabels: string[];
  suggestedAgent: ExecutorModel | null;
  shouldStart: boolean;
  needsHuman: boolean;
  rationale: string;
}

export interface GitHubIssueTriageResult {
  provider: ExecutorModel;
  modelId: string | null;
  resolvedModel: string | null;
  consideredCount: number;
  appliedCount: number;
  skippedCount: number;
  threshold: number;
  issues: GitHubIssueTriageSummary[];
}

export const ISSUE_PIPELINE_STATUS = {
  todo: 'todo',
  queued: 'queued',
  planning: PIPELINE_PHASE.planning,
  clarifying: PIPELINE_PHASE.clarifying,
  reviewing: PIPELINE_PHASE.reviewing,
  revising: PIPELINE_PHASE.revising,
  approval: PIPELINE_PHASE.approval,
  executing: PIPELINE_PHASE.executing,
  testing: PIPELINE_PHASE.testing,
  verifying: PIPELINE_PHASE.verifying,
  shipping: PIPELINE_PHASE.shipping,
  needsReview: 'needs_review',
  readyToMerge: 'ready_to_merge',
  paused: PIPELINE_PHASE.paused,
  completed: PIPELINE_PHASE.completed,
  closed: 'closed',
  deferred: 'deferred',
  failed: PIPELINE_PHASE.failed,
} as const;

export type IssuePipelineStatus =
  (typeof ISSUE_PIPELINE_STATUS)[keyof typeof ISSUE_PIPELINE_STATUS];

// === GitHub Projects v2 Status Sync Types ===

/** ShipCode macro columns that map to GH Projects v2 Status field options. */
export type GhMacroColumn = 'todo' | 'in_progress' | 'human_review' | 'deferred' | 'done';

/** A single GitHub Projects v2 Status field option with its display color. */
export interface GhStatusOption {
  name: string;
  /** GitHub color enum: GRAY | BLUE | GREEN | YELLOW | ORANGE | RED | PINK | PURPLE */
  color: string | null;
}

/**
 * Per-project mapping from ShipCode macro columns to GitHub Projects v2
 * Status field option names (with optional color). Stored as JSON in
 * `projects.github_status_mapping`.
 */
export interface GhStatusMapping {
  todo: GhStatusOption | null;
  inProgress: GhStatusOption | null;
  humanReview: GhStatusOption | null;
  deferred?: GhStatusOption | null;
  done: GhStatusOption | null;
}

// === GitHub Project Readiness Types ===

export type ProjectReadinessItemStatus = 'ready' | 'missing' | 'warning' | 'error';

export type ProjectReadinessItemKind = 'labels' | 'github-project' | 'project-field' | 'issue-type';

export interface ProjectReadinessItem {
  key: string;
  kind: ProjectReadinessItemKind;
  label: string;
  required: boolean;
  status: ProjectReadinessItemStatus;
  message: string;
  present?: string[];
  missing?: string[];
}

export interface ProjectReadinessLabelSync {
  created: string[];
  alreadyPresent: string[];
  failed: Array<{ name: string; error: string }>;
}

export interface ProjectReadinessReport {
  ok: boolean;
  checkedAt: string;
  projectUrl: string | null;
  labelSync: ProjectReadinessLabelSync;
  labelNames: string[];
  statusMapping: GhStatusMapping | null;
  items: ProjectReadinessItem[];
}
