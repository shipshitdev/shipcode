import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createClaudeCliProvider,
  createCodexCliProvider,
  createGrokCliProvider,
  createOpenRouterProvider,
  createProviderRegistry,
  GhCli,
  ProcessManager,
} from '@shipcode/agents';
import {
  AgentConversationQueries,
  CheckpointQueries,
  DiffQueries,
  FeatureQaResultQueries,
  GitHubIssueQueries,
  getDatabase,
  PhaseLogQueries,
  PipelineRunQueries,
  PipelineStepQueries,
  PlanQueries,
  ProjectFailureQueries,
  ProjectQueries,
  ReviewQueries,
  SettingsQueries,
  SkillsQueries,
  TaskGraphQueries,
  TerminalEventQueries,
  ThreadQueries,
  VerificationQueries,
} from '@shipcode/db';
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
  projectFailures: ProjectFailureQueries;
  githubIssues: GitHubIssueQueries;
  settings: SettingsQueries;
  skills: SkillsQueries;
  checkpoints: CheckpointQueries;
  terminalEvents: TerminalEventQueries;
  phaseLogs: PhaseLogQueries;
  agentConversations: AgentConversationQueries;
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
  const dataDir = path.join(os.homedir(), '.shipcode', 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const db = getDatabase(dataDir);
  const projects = new ProjectQueries(db);
  const threads = new ThreadQueries(db);
  const plans = new PlanQueries(db);
  const reviews = new ReviewQueries(db);
  const diffs = new DiffQueries(db);
  const verifications = new VerificationQueries(db);
  const projectFailures = new ProjectFailureQueries(db);
  const githubIssues = new GitHubIssueQueries(db);
  const settings = new SettingsQueries(db);
  const skills = new SkillsQueries(db);
  const checkpoints = new CheckpointQueries(db);
  const terminalEvents = new TerminalEventQueries(db);
  const phaseLogs = new PhaseLogQueries(db);
  const pipelineRuns = new PipelineRunQueries(db);
  const pipelineSteps = new PipelineStepQueries(db);
  const agentConversations = new AgentConversationQueries(db);
  const featureQaResults = new FeatureQaResultQueries(db);
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
    grok: createGrokCliProvider(processManager),
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
    projectFailures,
    githubIssues,
    checkpoints,
    projects,
    settings,
    providers,
    skills,
    taskGraphs,
    phaseLogs,
    pipelineRuns,
    pipelineSteps,
    agentConversations,
    featureQaResults,
  } as Parameters<typeof createPipeline>[0];

  return {
    db,
    projects,
    threads,
    plans,
    reviews,
    diffs,
    verifications,
    projectFailures,
    githubIssues,
    settings,
    skills,
    checkpoints,
    terminalEvents,
    phaseLogs,
    agentConversations,
    taskGraphs,
    ghCli,
    processManager,
    emitter,
    project,
    pipelineDeps,
  };
}
