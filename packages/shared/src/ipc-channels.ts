import type {
  AppSettings,
  ShipCodePlan,
  DiffRecord,
  FileChange,
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
  'project:add': { args: { path: string }; result: Project }
  'project:remove': { args: { projectId: string }; result: void }

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

  'settings:get': { args: void; result: AppSettings }
  'settings:set': { args: Partial<AppSettings>; result: void }

  'health:check': { args: void; result: SystemHealth }

  'dialog:open-directory': { args: void; result: string | null }

  // GitHub
  'github:list-issues': { args: { projectId: string }; result: GitHubIssueCacheRecord[] }
  'github:refresh-issues': { args: { projectId: string }; result: GitHubIssueCacheRecord[] }
  'github:start-issue': { args: { projectId: string; issueNumber: number }; result: void }
  'github:get-issue': { args: { issueNumber: number; projectId: string }; result: GitHubIssueCacheRecord | null }

  // Verification
  'verification:get': { args: { threadId: string }; result: VerificationRecord | null }

  // Pipeline extensions
  'pipeline:start-autonomous': { args: { threadId: string }; result: void }
}

// === Streaming Channels (send/on) ===

export interface IpcStreamChannels {
  'agent:output': { processId: string; chunk: string }
  'agent:state': { processId: string; type: string; state: AgentState }
  'pipeline:phase': { threadId: string; phase: PipelinePhase }
  'plan:parsed': { threadId: string; plan: ShipCodePlan }
  'review:parsed': { threadId: string; review: PlanReview }
  'files:changed': { projectId: string; changes: FileChange[] }
  'verification:parsed': { threadId: string; verification: VerificationResult }
  'github:issues-updated': { projectId: string; issues: GitHubIssueCacheRecord[] }
  'github:issue-status': { projectId: string; issueNumber: number; status: string }
}
