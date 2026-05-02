import fs from 'node:fs';
import path from 'node:path';
import {
  createClaudeCliProvider,
  createCodexCliProvider,
  createOpenRouterProvider,
  createProviderRegistry,
  GhCli,
  ProcessManager,
} from '@shipcode/agents/source';
import {
  AgentConversationQueries,
  CheckpointQueries,
  DiffQueries,
  GitHubIssueQueries,
  getDatabase,
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
import { TaskGraphQueries } from '@shipcode/db/source';
import type { createPipeline } from '@shipcode/pipeline';
import type { Project } from '@shipcode/shared';
import { createCliEmitter } from './adapters/cli-emitter';

export interface CliContext {
  db: ReturnType<typeof getDatabase>;
  projects: ProjectQueries;
  threads: ThreadQueries;
  plans: PlanQueries;
  reviews: ReviewQueries;
  diffs: DiffQueries;
  verifications: VerificationQueries;
  githubIssues: GitHubIssueQueries;
  settings: SettingsQueries;
  skills: SkillsQueries;
  checkpoints: CheckpointQueries;
  terminalEvents: TerminalEventQueries;
  taskGraphs: TaskGraphQueries;
  ghCli: GhCli;
  processManager: ProcessManager;
  emitter: ReturnType<typeof createCliEmitter>;
  project: Project;
  pipelineDeps: Parameters<typeof createPipeline>[0];
}

/**
 * Bootstrap DB, queries, providers, and resolve project for the current cwd.
 * Every CLI command calls this once — single source of truth for initialization.
 */
export function createCliContext(cwd: string): CliContext {
  const dataDir = path.join(process.env.HOME ?? '', '.shipcode', 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const db = getDatabase(dataDir);
  const projects = new ProjectQueries(db);
  const threads = new ThreadQueries(db);
  const plans = new PlanQueries(db);
  const reviews = new ReviewQueries(db);
  const diffs = new DiffQueries(db);
  const verifications = new VerificationQueries(db);
  const githubIssues = new GitHubIssueQueries(db);
  const settings = new SettingsQueries(db);
  const skills = new SkillsQueries(db);
  const checkpoints = new CheckpointQueries(db);
  const terminalEvents = new TerminalEventQueries(db);
  const pipelineSteps = new PipelineStepQueries(db);
  const agentConversations = new AgentConversationQueries(db);
  const taskGraphs = new TaskGraphQueries(db);

  let project = projects.list().find((p) => p.path === cwd);
  if (!project) {
    project = projects.add(cwd);
  }

  const ghCli = new GhCli(cwd);
  const processManager = new ProcessManager();
  const emitter = createCliEmitter();

  const providers = createProviderRegistry({
    claude: createClaudeCliProvider(processManager),
    codex: createCodexCliProvider(processManager),
    openrouter: createOpenRouterProvider({
      getApiKey: () => process.env.OPENROUTER_API_KEY,
      getSettings: () => settings.get(),
    }),
  });

  const pipelineDeps = {
    emitter,
    processManager,
    threads,
    plans,
    reviews,
    diffs,
    verifications,
    githubIssues,
    checkpoints,
    projects,
    settings,
    providers,
    skills,
    taskGraphs,
    pipelineSteps,
    agentConversations,
  } as Parameters<typeof createPipeline>[0];

  return {
    db,
    projects,
    threads,
    plans,
    reviews,
    diffs,
    verifications,
    githubIssues,
    settings,
    skills,
    checkpoints,
    terminalEvents,
    taskGraphs,
    ghCli,
    processManager,
    emitter,
    project,
    pipelineDeps,
  };
}
