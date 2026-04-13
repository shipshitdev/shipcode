import type {
  ActivePipelineSummary,
  ActivityEntry,
  AgentState,
  AppSettings,
  ContextFileInfo,
  CostSummary,
  DashboardStats,
  DiffRecord,
  FileChange,
  GhAuthStatus,
  GitHubIssueCacheRecord,
  GitState,
  IntegrationStatus,
  NotificationRecord,
  OpenRouterModelValidation,
  PipelineCheckpoint,
  PipelinePhase,
  PlanRecord,
  PlanReview,
  Project,
  RecentTask,
  ReviewRecord,
  ShipCodePlan,
  SystemHealth,
  Thread,
  VerificationRecord,
  VerificationResult,
} from './types';

// === Request-Response Channels (invoke/handle) ===

export interface IpcInvokeChannels {
  'project:list': { args: undefined; result: Project[] };
  'project:list-visible': { args: undefined; result: Project[] };
  'project:list-archived': { args: undefined; result: Project[] };
  'project:get': { args: { projectId: string }; result: Project | null };
  'project:add': { args: { path: string }; result: Project };
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
      };
    };
    result: Project;
  };

  'thread:list': { args: { projectId: string }; result: Thread[] };
  'thread:create': { args: { projectId: string; prompt: string }; result: Thread };
  'thread:get': { args: { threadId: string }; result: Thread | null };
  'checkpoint:list': { args: { threadId: string }; result: PipelineCheckpoint[] };
  'checkpoint:restore': {
    args: { threadId: string; checkpointId: string };
    result: { restored: true; checkpoint: PipelineCheckpoint };
  };

  'pipeline:start': { args: { threadId: string }; result: undefined };
  'pipeline:retry': { args: { threadId: string }; result: undefined };
  'pipeline:approve': { args: { threadId: string }; result: undefined };
  'pipeline:reject': { args: { threadId: string; feedback: string }; result: undefined };
  'pipeline:stabilize-pr': { args: { threadId: string }; result: undefined };
  'pipeline:cancel': { args: { threadId: string }; result: undefined };
  'pipeline:skip-review': { args: { threadId: string }; result: undefined };

  'plan:get': { args: { threadId: string }; result: PlanRecord | null };
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
  'integrations:check': { args: undefined; result: IntegrationStatus };
  'integrations:validate-openrouter-model': {
    args: { modelId: string };
    result: OpenRouterModelValidation;
  };

  'dialog:open-directory': { args: undefined; result: string | null };

  'shell:open-external': { args: { url: string }; result: undefined };

  // GitHub
  'github:list-issues': { args: { projectId: string }; result: GitHubIssueCacheRecord[] };
  'github:refresh-issues': { args: { projectId: string }; result: GitHubIssueCacheRecord[] };
  'github:start-issue': { args: { projectId: string; issueNumber: number }; result: undefined };
  'github:retry-issue': { args: { projectId: string; issueNumber: number }; result: undefined };
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

  // Plans & Reviews (backfill)
  'plan:list': { args: { threadId: string }; result: PlanRecord[] };
  'review:list-by-plans': { args: { planIds: string[] }; result: Record<string, ReviewRecord> };

  // Verification
  'verification:get': { args: { threadId: string }; result: VerificationRecord | null };

  // Pipeline extensions
  'pipeline:start-autonomous': { args: { threadId: string }; result: undefined };

  // Onboarding
  'onboarding:check-auth': { args: undefined; result: SystemHealth & { ghAuth: GhAuthStatus } };
  'onboarding:list-repos': { args: undefined; result: string[] };

  // AI-assisted PRD enhancement (in-place refinement of a draft PRD body)
  'ai:enhance-prd': {
    args: { projectId: string; draftBody: string };
    result: { body: string };
  };

  // Repo context files (Phase 2)
  'context:list': { args: { projectId: string }; result: ContextFileInfo[] };
  'context:generate': {
    args: { projectId: string; cli: 'claude' | 'codex' };
    result: { success: boolean; error?: string };
  };
  'context:read': { args: { projectId: string; name: string }; result: { content: string | null } };

  // Mission Control dashboard
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
}

// === Streaming Channels (send/on) ===

export interface IpcStreamChannels {
  'agent:output': { processId: string; chunk: string; threadId?: string };
  'agent:state': { processId: string; type: string; state: AgentState; threadId?: string };
  'pipeline:phase': { threadId: string; phase: PipelinePhase };
  'pipeline:verification-exhausted': { threadId: string; retries: number };
  'plan:parsed': { threadId: string; plan: ShipCodePlan };
  'review:parsed': { threadId: string; review: PlanReview };
  'files:changed': { projectId: string; changes: FileChange[] };
  'verification:parsed': { threadId: string; verification: VerificationResult };
  'github:issues-updated': { projectId: string; issues: GitHubIssueCacheRecord[] };
  'github:issue-status': { projectId: string; issueNumber: number; status: string };
  'notification:fire': NotificationRecord;
  'notification:dismiss': { id: string };
  'notification:focus-thread': { threadId: string; projectId: string | null };
  'activity:appended': ActivityEntry;
  'dashboard:invalidate': { kinds: Array<'stats' | 'activity' | 'running' | 'recent'> };
}
