import type {
  ActivePipelineSummary,
  ActivityEntry,
  AgentState,
  AppSettings,
  ClarificationAnswer,
  CliProviderUsageMap,
  CostSummary,
  CostTaskSummary,
  DashboardOverview,
  DashboardStats,
  DeveloperInfo,
  DiffRecord,
  GeneratorCli,
  GhAuthStatus,
  GitHubIssueCacheRecord,
  GitHubIssueComment,
  GitState,
  InstantFixScope,
  IntegrationStatus,
  NotificationRecord,
  OnboardingRepo,
  OpenRouterModelValidation,
  PipelineCheckpoint,
  PipelineModelResolvedEvent,
  PipelinePhase,
  PlanRecord,
  PlanReview,
  Project,
  ProjectOpenTarget,
  ProjectSetupDraft,
  ProjectSetupInspection,
  PullRequestDetailResponse,
  PullRequestListFilter,
  PullRequestListItem,
  ReasoningEffort,
  RecentTask,
  RepoMemoryStatus,
  RepoSetupContract,
  ReviewRecord,
  ShipCodePlan,
  SystemHealth,
  TerminalEventRecord,
  Thread,
  ThreadPanelData,
  VerificationRecord,
  VerificationResult,
  WritingPrdsSkillInfo,
} from './types';

// === Shared attachment types ===

export interface StagedPrdAttachment {
  /** Original absolute path on disk (after path normalisation). */
  originalPath: string;
  /** Copy in the session temp dir that will be uploaded/embedded. */
  stagedPath: string;
  /** File name without directory. */
  fileName: string;
  /** MIME type detected from magic bytes (image/png | image/jpeg | image/gif | image/webp). */
  mimeType: string;
  /** Size in bytes of the staged copy. */
  sizeBytes: number;
}

// === Request-Response Channels (invoke/handle) ===

export interface IpcInvokeChannels {
  'project:list': { args: undefined; result: Project[] };
  'project:list-visible': { args: undefined; result: Project[] };
  'project:list-archived': { args: undefined; result: Project[] };
  'project:get': { args: { projectId: string }; result: Project | null };
  'project:add': {
    args: { path: string; repo?: Pick<OnboardingRepo, 'id' | 'name'> | null };
    result: Project;
  };
  'project:detect-setup': {
    args: { projectId?: string; path?: string };
    result: ProjectSetupDraft;
  };
  'project:get-setup': {
    args: { projectId: string };
    result: ProjectSetupDraft;
  };
  'project:save-setup': {
    args: { projectId: string; contract: RepoSetupContract };
    result: ProjectSetupInspection;
  };
  'project:remove': { args: { projectId: string }; result: undefined };
  'project:pin': { args: { projectId: string; pinned: boolean }; result: undefined };
  'project:archive': { args: { projectId: string }; result: undefined };
  'project:unarchive': { args: { projectId: string }; result: undefined };
  'project:relink-path': { args: { projectId: string; path: string }; result: Project };
  'project:set-default-branch': { args: { projectId: string; branch: string }; result: Project };
  'project:set-github-project-url': {
    args: { projectId: string; url: string | null };
    result: Project;
  };
  'project:open-path': {
    args: { projectId: string; target: ProjectOpenTarget | 'default' };
    result: undefined;
  };
  'project:set-model-overrides': {
    args: {
      projectId: string;
      overrides: {
        plannerModelOverride: Project['plannerModelOverride'];
        reviewerModelOverride: Project['reviewerModelOverride'];
        executorModelOverride: Project['executorModelOverride'];
        verifierModelOverride: Project['verifierModelOverride'];
        plannerModelIdOverride: Project['plannerModelIdOverride'];
        reviewerModelIdOverride: Project['reviewerModelIdOverride'];
        executorModelIdOverride: Project['executorModelIdOverride'];
        verifierModelIdOverride: Project['verifierModelIdOverride'];
        plannerReasoningEffortOverride: Project['plannerReasoningEffortOverride'];
        reviewerReasoningEffortOverride: Project['reviewerReasoningEffortOverride'];
        executorReasoningEffortOverride: Project['executorReasoningEffortOverride'];
        verifierReasoningEffortOverride: Project['verifierReasoningEffortOverride'];
        revisionCountOverride: Project['revisionCountOverride'];
        requireApprovalOverride: Project['requireApprovalOverride'];
        prdQualityGate: Project['prdQualityGate'];
      };
    };
    result: Project;
  };
  'project:set-notification-routing': {
    args: {
      projectId: string;
      routing: {
        discordRouting: Project['discordRouting'];
        discordWebhookUrlOverride: Project['discordWebhookUrlOverride'];
        telegramRouting: Project['telegramRouting'];
        telegramChatIdOverride: Project['telegramChatIdOverride'];
      };
    };
    result: Project;
  };
  'project:set-notify-github-user': {
    args: { projectId: string; handle: string | null };
    result: Project;
  };

  'thread:list': { args: { projectId: string }; result: Thread[] };
  'thread-panel:get-data': { args: { projectId: string }; result: ThreadPanelData };
  'thread:create': { args: { projectId: string; prompt: string }; result: Thread };
  'thread:get': { args: { threadId: string }; result: Thread | null };
  'checkpoint:list': { args: { threadId: string }; result: PipelineCheckpoint[] };
  'checkpoint:restore': {
    args: { threadId: string; checkpointId: string };
    result: { restored: true; checkpoint: PipelineCheckpoint };
  };

  'pipeline:start': { args: { threadId: string }; result: undefined };
  'pipeline:retry': { args: { threadId: string }; result: undefined };
  'pipeline:answer-clarification': {
    args: { threadId: string; answers: ClarificationAnswer[] };
    result: undefined;
  };
  'pipeline:approve': { args: { threadId: string }; result: undefined };
  'pipeline:reject': { args: { threadId: string; feedback: string }; result: undefined };
  'pipeline:stabilize-pr': { args: { threadId: string }; result: undefined };
  'pipeline:cancel': { args: { threadId: string }; result: undefined };
  'pipeline:skip-review': { args: { threadId: string }; result: undefined };

  'plan:get': { args: { threadId: string }; result: PlanRecord | null };
  'plan:get-by-id': { args: { planId: string }; result: PlanRecord | null };
  'plan:list-for-issue': {
    args: { projectId: string; issueNumber: number };
    result: PlanRecord[];
  };
  'plan:update': { args: { planId: string; structured: ShipCodePlan }; result: undefined };

  'review:get': { args: { planId: string }; result: ReviewRecord | null };

  'diff:list': { args: { threadId: string }; result: DiffRecord[] };

  'git:status': { args: { projectId: string }; result: GitState };
  'git:commit': { args: { projectId: string; message: string }; result: string };
  'git:push': { args: { projectId: string }; result: undefined };
  'git:list-branches': { args: { projectId: string; fetch?: boolean }; result: string[] };

  'settings:get': { args: undefined; result: AppSettings };
  'settings:set': { args: Partial<AppSettings>; result: undefined };

  'health:check': { args: undefined; result: SystemHealth };
  'provider-usage:check': { args: undefined; result: CliProviderUsageMap };
  'integrations:check': { args: undefined; result: IntegrationStatus };
  'integrations:validate-openrouter-model': {
    args: { modelId: string };
    result: OpenRouterModelValidation;
  };
  'integrations:test-chat': {
    args: { provider: 'discord' | 'telegram'; projectId?: string | null };
    result: { ok: boolean; message: string };
  };

  'dialog:open-directory': { args: undefined; result: string | null };

  'shell:open-external': { args: { url: string }; result: undefined };

  // GitHub
  'github:list-issues': { args: { projectId: string }; result: GitHubIssueCacheRecord[] };
  'github:refresh-issues': { args: { projectId: string }; result: GitHubIssueCacheRecord[] };
  'github:start-issue': { args: { projectId: string; issueNumber: number }; result: undefined };
  'github:retry-issue': { args: { projectId: string; issueNumber: number }; result: undefined };
  'github:mark-done': { args: { projectId: string; issueNumber: number }; result: undefined };
  'github:get-issue': {
    args: { issueNumber: number; projectId: string };
    result: GitHubIssueCacheRecord | null;
  };
  'github:create-issue': {
    args: { projectId: string; title: string; body: string; labels?: string[] };
    result: GitHubIssueCacheRecord;
  };
  'github:edit-issue-body': {
    args: {
      projectId: string;
      issueNumber: number;
      title: string;
      body: string;
      labels?: string[];
    };
    result: GitHubIssueCacheRecord | null;
  };
  'github:sync-to-project-board': {
    args: { projectId: string };
    result: {
      attached: number;
      alreadyPresent: number;
      failed: number;
      errors: string[];
    };
  };
  'github:list-repo-labels': {
    args: { projectId: string };
    result: Array<{ name: string; color: string; description: string }>;
  };
  'github:ensure-shipcode-labels': {
    args: { projectId: string };
    result: {
      created: string[];
      alreadyPresent: string[];
      failed: Array<{ name: string; error: string }>;
    };
  };
  'github:archive-issue': {
    args: { projectId: string; issueNumber: number };
    result: { archivedCount: number };
  };
  'github:archive-all-done': {
    args: { projectId: string };
    result: { archivedCount: number; failedCount: number };
  };
  'github:list-archived': { args: undefined; result: GitHubIssueCacheRecord[] };
  'github:unarchive-issue': { args: { issueId: string }; result: undefined };
  'github:set-phase-model-override': {
    args: {
      projectId: string;
      issueNumber: number;
      phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
      model:
        | GitHubIssueCacheRecord['plannerModelOverride']
        | GitHubIssueCacheRecord['reviewerModelOverride']
        | GitHubIssueCacheRecord['executorModelOverride']
        | GitHubIssueCacheRecord['verifierModelOverride'];
    };
    result: GitHubIssueCacheRecord | null;
  };
  'github:clear-phase-model-override': {
    args: {
      projectId: string;
      issueNumber: number;
      phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
    };
    result: GitHubIssueCacheRecord | null;
  };
  'github:set-phase-model-id-override': {
    args: {
      projectId: string;
      issueNumber: number;
      phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
      modelId: string;
    };
    result: GitHubIssueCacheRecord | null;
  };
  'github:clear-phase-model-id-override': {
    args: {
      projectId: string;
      issueNumber: number;
      phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
    };
    result: GitHubIssueCacheRecord | null;
  };
  'github:clear-all-phase-overrides-for-project': {
    args: { projectId: string };
    result: { clearedCount: number };
  };
  'github:set-revision-count-override': {
    args: {
      projectId: string;
      issueNumber: number;
      revisionCount: GitHubIssueCacheRecord['revisionCountOverride'];
    };
    result: GitHubIssueCacheRecord | null;
  };
  'github:set-require-approval-override': {
    args: {
      projectId: string;
      issueNumber: number;
      requireApproval: GitHubIssueCacheRecord['requireApprovalOverride'];
    };
    result: GitHubIssueCacheRecord | null;
  };
  'github:set-phase-reasoning-effort-override': {
    args: {
      projectId: string;
      issueNumber: number;
      phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
      effort: ReasoningEffort;
    };
    result: GitHubIssueCacheRecord | null;
  };
  'github:clear-phase-reasoning-effort-override': {
    args: {
      projectId: string;
      issueNumber: number;
      phase: 'planner' | 'reviewer' | 'executor' | 'verifier';
    };
    result: GitHubIssueCacheRecord | null;
  };
  'github:add-comment': {
    args: { projectId: string; issueNumber: number; body: string };
    result: undefined;
  };
  'github:list-comments': {
    args: { projectId: string; issueNumber: number };
    result: GitHubIssueComment[];
  };
  'github:rewrite-issue': {
    args: { projectId: string; issueNumber: number };
    result: GitHubIssueCacheRecord;
  };
  'github:close-issue': {
    args: { projectId: string; issueNumber: number };
    result: undefined;
  };
  'github:reopen-issue': {
    args: { projectId: string; issueNumber: number };
    result: undefined;
  };

  // Plans & Reviews (backfill)
  'plan:list': { args: { threadId: string }; result: PlanRecord[] };
  'review:list-by-plans': { args: { planIds: string[] }; result: Record<string, ReviewRecord> };

  // Verification
  'verification:get': { args: { threadId: string }; result: VerificationRecord | null };
  'terminal:list': { args: { threadId: string; limit?: number }; result: TerminalEventRecord[] };

  // Pipeline extensions
  'pipeline:start-autonomous': { args: { threadId: string }; result: undefined };

  // Onboarding
  'onboarding:check-auth': { args: undefined; result: SystemHealth & { ghAuth: GhAuthStatus } };
  'onboarding:list-repos': { args: undefined; result: OnboardingRepo[] };

  // AI-assisted PRD enhancement (in-place refinement of a draft PRD body)
  'ai:enhance-prd': {
    args: { projectId: string; draftBody: string; attachmentSessionId: string | null };
    result: { body: string };
  };

  // PRD attachment lifecycle (image staging before issue creation)
  'prd-attachments:create-session': {
    args: { senderId: string; projectId: string };
    result: { sessionId: string };
  };
  'prd-attachments:stage': {
    args: { sessionId: string; filePaths: string[] };
    result: { staged: StagedPrdAttachment[]; errors: string[] };
  };
  'prd-attachments:remove': {
    args: { sessionId: string; filePath: string };
    result: undefined;
  };
  'prd-attachments:clear': {
    args: { sessionId: string };
    result: undefined;
  };

  // Repo memory files
  'memory:list': { args: { projectId: string }; result: RepoMemoryStatus };
  'memory:generate': {
    args: { projectId: string; cli: GeneratorCli };
    result: { success: boolean; error?: string };
  };
  'memory:read': { args: { projectId: string; name: string }; result: { content: string | null } };

  // Mission Control dashboard
  'dashboard:get-overview': {
    args: {
      activityLimit?: number;
      activityOffset?: number;
      recentLimit?: number;
      recentOffset?: number;
    };
    result: DashboardOverview;
  };
  'dashboard:get-stats': { args: undefined; result: DashboardStats };
  'dashboard:get-activity': {
    args: { limit?: number; offset?: number; projectId?: string };
    result: ActivityEntry[];
  };
  'activity:list-for-issue': {
    args: { projectId: string; issueNumber: number; limit?: number };
    result: ActivityEntry[];
  };
  'dashboard:count-activity': { args: { projectId?: string }; result: number };
  'dashboard:get-recent-tasks': { args: { limit?: number; offset?: number }; result: RecentTask[] };
  'dashboard:count-recent-tasks': { args: undefined; result: number };

  // Cost tracking
  'costs:get-summary': { args: undefined; result: CostSummary };
  'costs:list-for-issue': {
    args: { projectId: string; issueNumber: number };
    result: CostTaskSummary[];
  };

  // Active pipelines listing (for Running Agents panel)
  'pipeline:list-active': { args: undefined; result: ActivePipelineSummary[] };

  // Notifications
  'notification:list': { args: undefined; result: NotificationRecord[] };
  'notification:dismiss': { args: { id: string }; result: undefined };
  'notification:dismiss-all': { args: undefined; result: undefined };

  // Phase prompt skills (the /skills page). Args/results are typed loosely
  // here as `unknown` because the concrete types live in @shipcode/agents
  // (PhaseSkillKey, BundledDefault, ResolvedSkill) and we don't want shared
  // to depend on agents — would create a cycle. The renderer casts via the
  // re-exported types in src/renderer/types/skills.ts.
  'skills:list-for-view': { args: { projectId: string | null }; result: unknown };
  'skills:read': { args: { projectId: string | null; phase: string }; result: unknown };
  'skills:write': {
    args: { projectId: string | null; phase: string; content: string };
    result: unknown;
  };
  'skills:reset': { args: { projectId: string | null; phase: string }; result: unknown };
  'skills:list-quarantined': { args: undefined; result: unknown };
  'skills:get-writing-prds-info': {
    args: { projectId: string };
    result: WritingPrdsSkillInfo;
  };
  'skills:open-writing-prds': { args: { projectId: string }; result: undefined };

  // Instant Fix — direct CLI runs without pipeline
  'instant:run': {
    args: {
      projectId?: string;
      prompt: string;
      scope: InstantFixScope;
      cli: 'claude' | 'codex';
      modelId?: string | null;
      reasoningEffort?: ReasoningEffort;
      attachmentSessionId?: string;
      customSystemPrompt?: string;
    };
    result: { threadId: string };
  };
  'instant:shell-start': {
    args: {
      projectId: string;
      cli: 'claude' | 'codex';
      modelId?: string | null;
      reasoningEffort?: ReasoningEffort;
      initialPrompt?: string;
      attachmentSessionId?: string;
    };
    result: { threadId: string };
  };
  'instant:shell-input': {
    args: { threadId: string; data: string };
    result: undefined;
  };
  'instant:shell-resize': {
    args: { threadId: string; cols: number; rows: number };
    result: undefined;
  };
  'instant:cancel': { args: { threadId: string }; result: undefined };
  'instant:list': { args: undefined; result: Thread[] };
  'instant:cleanup': { args: undefined; result: { deleted: number } };

  // Pull request browsing
  'github:list-prs': {
    args: { projectId: string; filter?: PullRequestListFilter; limit?: number };
    result: PullRequestListItem[];
  };
  'github:get-pr-detail': {
    args: { projectId: string; prNumber: number };
    result: PullRequestDetailResponse;
  };
  'skills:load-content': {
    args: { name: string };
    result: string | null;
  };

  // Developer diagnostics
  'developer:get-info': { args: undefined; result: DeveloperInfo };
  'developer:open-devtools': { args: undefined; result: undefined };
  'developer:open-log-directory': { args: undefined; result: undefined };
  'developer:set-log-level': { args: { level: AppSettings['devLogLevel'] }; result: undefined };
}

// === Streaming Channels (send/on) ===

export interface IpcStreamChannels {
  'agent:output': { processId: string; chunk: string; threadId?: string };
  'agent:state': { processId: string; type: string; state: AgentState; threadId?: string };
  'pipeline:phase': { threadId: string; phase: PipelinePhase };
  'pipeline:model-resolved': PipelineModelResolvedEvent;
  'pipeline:verification-exhausted': { threadId: string; retries: number };
  'plan:parsed': { threadId: string; plan: ShipCodePlan };
  'review:parsed': { threadId: string; review: PlanReview };
  'verification:parsed': { threadId: string; verification: VerificationResult };
  'terminal:event': TerminalEventRecord;
  'github:issues-updated': { projectId: string; issues: GitHubIssueCacheRecord[] };
  'github:issue-status': { projectId: string; issueNumber: number; status: string };
  'notification:fire': NotificationRecord;
  'notification:dismiss': { id: string };
  'notification:focus-thread': { threadId: string; projectId: string | null };
  'activity:appended': ActivityEntry;
  'dashboard:invalidate': { kinds: Array<'stats' | 'activity' | 'running' | 'recent'> };
}

export type IpcInvokeChannel = keyof IpcInvokeChannels;
export type IpcStreamChannel = keyof IpcStreamChannels;
export type InvokeArgs<C extends IpcInvokeChannel> = [IpcInvokeChannels[C]['args']] extends [
  undefined,
]
  ? []
  : [IpcInvokeChannels[C]['args']];

export interface ShipCodeAPI {
  invoke<C extends IpcInvokeChannel>(
    channel: C,
    ...args: InvokeArgs<C>
  ): Promise<IpcInvokeChannels[C]['result']>;
  invoke<T = unknown>(channel: string, args?: unknown): Promise<T>;
  on<C extends IpcStreamChannel>(
    channel: C,
    callback: (payload: IpcStreamChannels[C]) => void,
  ): () => void;
  on(channel: string, callback: (...args: unknown[]) => void): () => void;
}
