import type { AgentType, PipelineSpeedProfile, ReasoningEffort, RevisionCount } from './agents';
import type { GhStatusMapping } from './github';
import type { ProjectNotificationRoutingMode, ProjectSetupStatus } from './settings';

// === Project Types ===

export interface Project {
  id: string;
  name: string;
  path: string;
  pathExists?: boolean;
  setupStatus?: ProjectSetupStatus;
  setupPath?: string;
  setupError?: string | null;
  gitRemote: string | null;
  githubRepoId: string | null;
  githubRepoFullName: string | null;
  starterIssueNumber: number | null;
  starterIssueCreatedAt: string | null;
  /**
   * GitHub Projects v2 board used for the Kanban `board` quick-link and status
   * sync. Auto-detected from the repository's associated `projectsV2` when a
   * folder is added or refreshed; users can override or clear it in settings.
   * When null, the Kanban header hides the `board` quick-link.
   */
  githubProjectUrl: string | null;
  /**
   * Per-project mapping from ShipCode macro columns to GH Projects v2 Status
   * option names. Auto-detected when `githubProjectUrl` is set. When null,
   * GH Status sync is disabled for this project.
   */
  githubStatusMapping: GhStatusMapping | null;
  plannerModelOverride: AgentType | null;
  reviewerModelOverride: AgentType | null;
  executorModelOverride: AgentType | null;
  verifierModelOverride: AgentType | null;
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
  pipelineSpeedProfileOverride?: PipelineSpeedProfile | null;
  prdQualityGate?: boolean | null;
  discordRouting: ProjectNotificationRoutingMode;
  discordWebhookUrlOverride: string | null;
  telegramRouting: ProjectNotificationRoutingMode;
  telegramChatIdOverride: string | null;
  defaultBranch: string;
  pinned: boolean;
  archived: boolean;
  hidden: boolean;
  notifyGithubUser: string | null;
  createdAt: string;
  updatedAt: string;
}

// === Automation Types ===

export type AutomationLastStatus = 'running' | 'completed' | 'failed';

export interface Automation {
  id: string;
  /** Primary target project. Retained for back-compat; equals `targets[0]`. */
  projectId: string;
  /** All target projects this automation fans out to (includes the primary). */
  targets: string[];
  name: string;
  prompt: string;
  cronExpr: string;
  enabled: boolean;
  executorProvider: AgentType | null;
  executorModelId: string | null;
  executorReasoningEffort: ReasoningEffort | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: AutomationLastStatus | null;
  nextRunAt: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutomationInput {
  /** Primary target project. Used as `targets[0]` when `targets` is omitted. */
  projectId: string;
  /** Optional full target set. Defaults to `[projectId]` when omitted. */
  targets?: string[];
  name: string;
  prompt: string;
  cronExpr: string;
  enabled?: boolean;
  executorProvider?: AgentType | null;
  executorModelId?: string | null;
  executorReasoningEffort?: ReasoningEffort | null;
}

export interface UpdateAutomationInput {
  name?: string;
  prompt?: string;
  cronExpr?: string;
  enabled?: boolean;
  executorProvider?: AgentType | null;
  executorModelId?: string | null;
  executorReasoningEffort?: ReasoningEffort | null;
  /**
   * Optional full target set. When present, replaces the automation's targets
   * (deduped, non-empty) and realigns the primary `projectId` to `targets[0]`,
   * applied atomically with the column update. Omit to leave targets unchanged.
   */
  targets?: string[];
}
