import type { ProcessManager } from '@shipcode/agents/source';
import type {
  ActivityQueries,
  AutomationQueries,
  CheckpointQueries,
  CostsQueries,
  DashboardQueries,
  DiffQueries,
  GitHubIssueQueries,
  HeatmapQueries,
  IssueEdgeQueries,
  NotificationsQueries,
  PipelineStepQueries,
  PlanQueries,
  ProjectQueries,
  ReviewQueries,
  SettingsQueries,
  SkillsQueries,
  TerminalEventQueries,
  ThreadQueries,
  VerificationQueries,
} from '@shipcode/db';
import type { TaskGraphQueries } from '@shipcode/db/source';
import type { Pipeline, PipelineEmitter } from '@shipcode/pipeline';
import type { BrowserWindow, IpcMain } from 'electron';
import type { ChatNotificationService } from '../chat-notification-service';
import type { NotificationService } from '../notification-service';

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
  pipelineSteps: PipelineStepQueries;
  taskGraphs?: TaskGraphQueries;
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
}
