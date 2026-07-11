import type { ProcessManager } from '@shipcode/agents';
import type {
  ActivityQueries,
  AgentConversationQueries,
  AutomationQueries,
  CheckpointQueries,
  CostsQueries,
  DashboardQueries,
  DiffQueries,
  FeatureQaResultQueries,
  GitHubIssueQueries,
  HeatmapQueries,
  IssueChatSessionQueries,
  IssueEdgeQueries,
  NotificationsQueries,
  PhaseLogQueries,
  PipelineAnalyticsQueries,
  PipelineRunQueries,
  PipelineStepQueries,
  PipelineWakeRequestQueries,
  PlanQueries,
  ProjectFailureQueries,
  ProjectQueries,
  PromptTelemetryQueries,
  ReviewFindingQueries,
  ReviewQueries,
  SettingsQueries,
  SkillResolutionLogQueries,
  SkillsQueries,
  TaskGraphQueries,
  TerminalEventQueries,
  ThreadQueries,
  TriageRuleQueries,
  VerificationQueries,
} from '@shipcode/db';
import type { GhSyncDeps, Pipeline, PipelineEmitter } from '@shipcode/pipeline';
import type { BrowserWindow, IpcMain } from 'electron';
import type { ChatNotificationService } from '../chat-notification-service';
import type { NotificationService } from '../notification-service';
import type { ResourceMonitor } from '../resource-monitor';

export interface Queries {
  projects: ProjectQueries;
  threads: ThreadQueries;
  plans: PlanQueries;
  reviews: ReviewQueries;
  diffs: DiffQueries;
  settings: SettingsQueries;
  verifications: VerificationQueries;
  githubIssues: GitHubIssueQueries;
  heatmap: HeatmapQueries;
  issueChatSessions: IssueChatSessionQueries;
  issueEdges: IssueEdgeQueries;
  checkpoints: CheckpointQueries;
  activity: ActivityQueries;
  automations: AutomationQueries;
  notifications: NotificationsQueries;
  dashboard: DashboardQueries;
  costs: CostsQueries;
  skills: SkillsQueries;
  terminalEvents: TerminalEventQueries;
  phaseLogs: PhaseLogQueries;
  pipelineAnalytics: PipelineAnalyticsQueries;
  pipelineRuns: PipelineRunQueries;
  pipelineSteps: PipelineStepQueries;
  wakeRequests: PipelineWakeRequestQueries;
  promptTelemetry: PromptTelemetryQueries;
  reviewFindings: ReviewFindingQueries;
  agentConversations: AgentConversationQueries;
  skillResolutionLogs: SkillResolutionLogQueries;
  featureQaResults: FeatureQaResultQueries;
  projectFailures?: ProjectFailureQueries;
  taskGraphs?: TaskGraphQueries;
  triageRules?: TriageRuleQueries;
}

export interface IpcHandlerDeps {
  ipcMain: IpcMain;
  mainWindow: BrowserWindow;
  queries: Queries;
  processManager: ProcessManager;
  pipeline: Pipeline;
  emitter: PipelineEmitter;
  notificationService: NotificationService;
  chatNotificationService: ChatNotificationService;
  resourceMonitor?: ResourceMonitor;
  /**
   * Invoked after a project is added, relinked, removed, or archived so the
   * main process can re-sync per-project resources (e.g. WORKFLOW.md watchers)
   * to the new project set. Optional: defaults to a no-op in tests.
   */
  onProjectsChanged?: () => void;
  /**
   * Shared GH Status/label sync service deps. When provided, all pipeline
   * label + Status write paths (manual transitions, board sync, PR
   * feedback) route through the single shared queue instead of writing
   * to GitHub independently. Optional: falls back to a no-op sync in
   * tests / when GitHub sync isn't wired up.
   */
  ghSync?: GhSyncDeps;
}
