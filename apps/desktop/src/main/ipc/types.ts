import type { ProcessManager } from '@shipcode/agents';
import type {
  ActivityQueries,
  CheckpointQueries,
  CostsQueries,
  DashboardQueries,
  DiffQueries,
  GitHubIssueQueries,
  IssueEdgeQueries,
  NotificationsQueries,
  PlanQueries,
  ProjectQueries,
  ReviewQueries,
  SettingsQueries,
  SkillsQueries,
  TerminalEventQueries,
  ThreadQueries,
  VerificationQueries,
} from '@shipcode/db';
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
  issueEdges: IssueEdgeQueries;
  checkpoints: CheckpointQueries;
  activity: ActivityQueries;
  notifications: NotificationsQueries;
  dashboard: DashboardQueries;
  costs: CostsQueries;
  skills: SkillsQueries;
  terminalEvents: TerminalEventQueries;
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
