import type { ProcessManager } from '@shipcode/agents/source';
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
  IssueEdgeQueries,
  NotificationsQueries,
  PhaseLogQueries,
  PipelineAnalyticsQueries,
  PipelineStepQueries,
  PlanQueries,
  ProjectFailureQueries,
  ProjectQueries,
  PromptTelemetryQueries,
  ReviewQueries,
  SettingsQueries,
  SkillResolutionLogQueries,
  SkillsQueries,
  TerminalEventQueries,
  ThreadQueries,
  TriageRuleQueries,
  VerificationQueries,
} from '@shipcode/db';
import type { TaskGraphQueries } from '@shipcode/db/source';
import type { Pipeline, PipelineEmitter } from '@shipcode/pipeline';
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
  pipelineSteps: PipelineStepQueries;
  promptTelemetry: PromptTelemetryQueries;
  agentConversations: AgentConversationQueries;
  skillResolutionLogs: SkillResolutionLogQueries;
  featureQaResults: FeatureQaResultQueries;
  projectFailures?: ProjectFailureQueries;
  taskGraphs?: TaskGraphQueries;
  triageRules: TriageRuleQueries;
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
}
