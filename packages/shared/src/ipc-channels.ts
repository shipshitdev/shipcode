import type {
  ActivePipelineSummary,
  ActivityEntry,
  AppSettings,
  CostSummary,
  DashboardStats,
  NotificationRecord,
  RecentTask,
  ShipCodePlan,
  DiffRecord,
  FileChange,
  GhAuthStatus,
  GitHubIssueCacheRecord,
  GitState,
  PlanRecord,
  PlanReview,
  PipelinePhase,
  Project,
  ReviewRecord,
  SystemHealth,
  Thread,
  AgentState,
  VerificationResult,
  VerificationRecord,
} from './types';

// === Request-Response Channels (invoke/handle) ===

export interface IpcInvokeChannels {
  'project:list': { args: void; result: Project[] };
  'project:list-visible': { args: void; result: Project[] };
  'project:list-archived': { args: void; result: Project[] };
  'project:get': { args: { projectId: string }; result: Project | null };
  'project:add': { args: { path: string }; result: Project };
  'project:remove': { args: { projectId: string }; result: void };
  'project:pin': { args: { projectId: string; pinned: boolean }; result: void };
  'project:archive': { args: { projectId: string }; result: void };
  'project:unarchive': { args: { projectId: string }; result: void };
  'project:set-default-branch': { args: { projectId: string; branch: string }; result: Project };
  'project:set-github-project-url': {
    args: { projectId: string; url: string | null };
    result: Project;
  };

  'thread:list': { args: { projectId: string }; result: Thread[] };
  'thread:create': { args: { projectId: string; prompt: string }; result: Thread };
  'thread:get': { args: { threadId: string }; result: Thread | null };

  'pipeline:start': { args: { threadId: string }; result: void };
  'pipeline:approve': { args: { threadId: string }; result: void };
  'pipeline:reject': { args: { threadId: string; feedback: string }; result: void };
  'pipeline:cancel': { args: { threadId: string }; result: void };
  'pipeline:skip-review': { args: { threadId: string }; result: void };

  'plan:get': { args: { threadId: string }; result: PlanRecord | null };
  'plan:update': { args: { planId: string; structured: ShipCodePlan }; result: void };

  'review:get': { args: { planId: string }; result: ReviewRecord | null };

  'diff:list': { args: { threadId: string }; result: DiffRecord[] };

  'git:status': { args: { projectId: string }; result: GitState };
  'git:commit': { args: { projectId: string; message: string }; result: string };
  'git:push': { args: { projectId: string }; result: void };
  'git:list-branches': { args: { projectId: string; fetch?: boolean }; result: string[] };

  'settings:get': { args: void; result: AppSettings };
  'settings:set': { args: Partial<AppSettings>; result: void };

  'health:check': { args: void; result: SystemHealth };

  'dialog:open-directory': { args: void; result: string | null };

  'shell:open-external': { args: { url: string }; result: void };

  // GitHub
  'github:list-issues': { args: { projectId: string }; result: GitHubIssueCacheRecord[] };
  'github:refresh-issues': { args: { projectId: string }; result: GitHubIssueCacheRecord[] };
  'github:start-issue': { args: { projectId: string; issueNumber: number }; result: void };
  'github:retry-issue': { args: { projectId: string; issueNumber: number }; result: void };
  'github:get-issue': {
    args: { issueNumber: number; projectId: string };
    result: GitHubIssueCacheRecord | null;
  };
  'github:create-issue': {
    args: { projectId: string; title: string; body: string; labels?: string[] };
    result: GitHubIssueCacheRecord;
  };
  'github:edit-issue-body': {
    args: { projectId: string; issueNumber: number; body: string };
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

  // Plans & Reviews (backfill)
  'plan:list': { args: { threadId: string }; result: PlanRecord[] };
  'review:list-by-plans': { args: { planIds: string[] }; result: Record<string, ReviewRecord> };

  // Verification
  'verification:get': { args: { threadId: string }; result: VerificationRecord | null };

  // Pipeline extensions
  'pipeline:start-autonomous': { args: { threadId: string }; result: void };

  // Onboarding
  'onboarding:check-auth': { args: void; result: SystemHealth & { ghAuth: GhAuthStatus } };
  'onboarding:list-repos': { args: void; result: string[] };

  // AI-assisted PRD enhancement (in-place refinement of a draft PRD body)
  'ai:enhance-prd': {
    args: { projectId: string; draftBody: string };
    result: { body: string };
  };

  // Mission Control dashboard
  'dashboard:get-stats': { args: void; result: DashboardStats };
  'dashboard:get-activity': {
    args: { limit?: number; offset?: number; projectId?: string };
    result: ActivityEntry[];
  };
  'dashboard:count-activity': { args: { projectId?: string }; result: number };
  'dashboard:get-recent-tasks': { args: { limit?: number; offset?: number }; result: RecentTask[] };
  'dashboard:count-recent-tasks': { args: void; result: number };

  // Cost tracking
  'costs:get-summary': { args: void; result: CostSummary };

  // Active pipelines listing (for Running Agents panel)
  'pipeline:list-active': { args: void; result: ActivePipelineSummary[] };

  // Notifications
  'notification:list': { args: void; result: NotificationRecord[] };
  'notification:dismiss': { args: { id: string }; result: void };
  'notification:dismiss-all': { args: void; result: void };

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
  'skills:list-quarantined': { args: void; result: unknown };
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
  'notification:focus-thread': { threadId: string; projectId: string | null };
  'activity:appended': ActivityEntry;
  'dashboard:invalidate': { kinds: Array<'stats' | 'activity' | 'running' | 'recent'> };
}
