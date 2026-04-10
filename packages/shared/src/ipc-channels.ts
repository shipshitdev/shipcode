import type {
  ActivePipelineSummary,
  ActivityEntry,
  AppSettings,
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
} from './types'

// === Request-Response Channels (invoke/handle) ===

export interface IpcInvokeChannels {
  'project:list': { args: void; result: Project[] }
  'project:get': { args: { projectId: string }; result: Project | null }
  'project:add': { args: { path: string }; result: Project }
  'project:remove': { args: { projectId: string }; result: void }
  'project:set-default-branch': { args: { projectId: string; branch: string }; result: Project }

  'thread:list': { args: { projectId: string }; result: Thread[] }
  'thread:create': { args: { projectId: string; prompt: string; useWorktree: boolean }; result: Thread }
  'thread:get': { args: { threadId: string }; result: Thread | null }

  'pipeline:start': { args: { threadId: string }; result: void }
  'pipeline:approve': { args: { threadId: string }; result: void }
  'pipeline:reject': { args: { threadId: string; feedback: string }; result: void }
  'pipeline:cancel': { args: { threadId: string }; result: void }
  'pipeline:skip-review': { args: { threadId: string }; result: void }

  'plan:get': { args: { threadId: string }; result: PlanRecord | null }
  'plan:update': { args: { planId: string; structured: ShipCodePlan }; result: void }

  'review:get': { args: { planId: string }; result: ReviewRecord | null }

  'diff:list': { args: { threadId: string }; result: DiffRecord[] }

  'git:status': { args: { projectId: string }; result: GitState }
  'git:commit': { args: { projectId: string; message: string }; result: string }
  'git:push': { args: { projectId: string }; result: void }
  'git:list-branches': { args: { projectId: string }; result: string[] }

  'settings:get': { args: void; result: AppSettings }
  'settings:set': { args: Partial<AppSettings>; result: void }

  'health:check': { args: void; result: SystemHealth }

  'dialog:open-directory': { args: void; result: string | null }

  'shell:open-external': { args: { url: string }; result: void }

  // GitHub
  'github:list-issues': { args: { projectId: string }; result: GitHubIssueCacheRecord[] }
  'github:refresh-issues': { args: { projectId: string }; result: GitHubIssueCacheRecord[] }
  'github:start-issue': { args: { projectId: string; issueNumber: number }; result: void }
  'github:retry-issue': { args: { projectId: string; issueNumber: number }; result: void }
  'github:get-issue': { args: { issueNumber: number; projectId: string }; result: GitHubIssueCacheRecord | null }
  'github:create-issue': {
    args: { projectId: string; title: string; body: string; labels?: string[] }
    result: GitHubIssueCacheRecord
  }
  'github:edit-issue-body': {
    args: { projectId: string; issueNumber: number; body: string }
    result: GitHubIssueCacheRecord | null
  }

  // Plans & Reviews (backfill)
  'plan:list': { args: { threadId: string }; result: PlanRecord[] }
  'review:list-by-plans': { args: { planIds: string[] }; result: Record<string, ReviewRecord> }

  // Verification
  'verification:get': { args: { threadId: string }; result: VerificationRecord | null }

  // Pipeline extensions
  'pipeline:start-autonomous': { args: { threadId: string }; result: void }

  // Onboarding
  'onboarding:check-auth': { args: void; result: SystemHealth & { ghAuth: GhAuthStatus } }
  'onboarding:list-repos': { args: void; result: string[] }

  // AI-assisted PRD enhancement (in-place refinement of a draft PRD body)
  'ai:enhance-prd': {
    args: { projectId: string; draftBody: string }
    result: { body: string }
  }

  // Mission Control dashboard
  'dashboard:get-stats': { args: void; result: DashboardStats }
  'dashboard:get-activity': { args: { limit?: number; offset?: number; projectId?: string }; result: ActivityEntry[] }
  'dashboard:count-activity': { args: { projectId?: string }; result: number }
  'dashboard:get-recent-tasks': { args: { limit?: number; offset?: number }; result: RecentTask[] }
  'dashboard:count-recent-tasks': { args: void; result: number }

  // Active pipelines listing (for Running Agents panel)
  'pipeline:list-active': { args: void; result: ActivePipelineSummary[] }

  // Notifications
  'notification:list': { args: void; result: NotificationRecord[] }
  'notification:dismiss': { args: { id: string }; result: void }
  'notification:dismiss-all': { args: void; result: void }
}

// === Streaming Channels (send/on) ===

export interface IpcStreamChannels {
  'agent:output': { processId: string; chunk: string }
  'agent:state': { processId: string; type: string; state: AgentState }
  'pipeline:phase': { threadId: string; phase: PipelinePhase }
  'pipeline:verification-exhausted': { threadId: string; retries: number }
  'plan:parsed': { threadId: string; plan: ShipCodePlan }
  'review:parsed': { threadId: string; review: PlanReview }
  'files:changed': { projectId: string; changes: FileChange[] }
  'verification:parsed': { threadId: string; verification: VerificationResult }
  'github:issues-updated': { projectId: string; issues: GitHubIssueCacheRecord[] }
  'github:issue-status': { projectId: string; issueNumber: number; status: string }
  'notification:fire': NotificationRecord
  'notification:focus-thread': { threadId: string; projectId: string | null }
  'activity:appended': ActivityEntry
  'dashboard:invalidate': { kinds: Array<'stats' | 'activity' | 'running' | 'recent'> }
}
