import path from 'node:path';
import fs from 'node:fs';
import {
  getDatabase,
  ProjectQueries,
  ThreadQueries,
  PlanQueries,
  ReviewQueries,
  VerificationQueries,
  GitHubIssueQueries,
  SettingsQueries,
} from '@shipcode/db';
import {
  ProcessManager,
  GhCli,
  routeFromLabels,
  createClaudeCliProvider,
  createCodexCliProvider,
  createOpenRouterProvider,
  createProviderRegistry,
} from '@shipcode/agents';
import { createPipeline } from '@shipcode/pipeline';
import { createCliEmitter } from '../adapters/cli-emitter';
import { requireOnboarding } from './guard';

export async function runCommand(issueNumber: string) {
  if (!requireOnboarding()) return;

  const num = parseInt(issueNumber, 10);
  if (isNaN(num)) {
    console.error('Invalid issue number:', issueNumber);
    process.exit(1);
  }

  const cwd = process.cwd();
  const dataDir = path.join(process.env.HOME ?? '', '.shipcode', 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const db = getDatabase(dataDir);
  const projects = new ProjectQueries(db);
  const threads = new ThreadQueries(db);
  const plans = new PlanQueries(db);
  const reviews = new ReviewQueries(db);
  const verifications = new VerificationQueries(db);
  const githubIssues = new GitHubIssueQueries(db);
  const settings = new SettingsQueries(db);

  // Find or create project
  let project = projects.list().find((p) => p.path === cwd);
  if (!project) {
    project = projects.add(cwd);
  }

  // Fetch issue from GitHub
  const ghCli = new GhCli(cwd);
  console.log(`Fetching issue #${num}...`);
  const issue = await ghCli.getIssue(num);

  // Route model from labels
  const route = routeFromLabels(issue.labels);
  const executorModel = 'error' in route ? 'claude' : route.executorModel;
  const executorModelOverride = 'error' in route ? null : (route.modelOverride ?? null);

  console.log(`Issue: ${issue.title}`);
  console.log(
    `Model: ${executorModel}${executorModelOverride ? ` (${executorModelOverride})` : ''}`,
  );
  console.log(`Starting pipeline...\n`);

  const emitter = createCliEmitter();
  const processManager = new ProcessManager();

  const providers = createProviderRegistry({
    claude: createClaudeCliProvider(processManager),
    codex: createCodexCliProvider(processManager),
    openrouter: createOpenRouterProvider({
      getApiKey: () => process.env.OPENROUTER_API_KEY,
      getSettings: () => settings.get(),
    }),
  });

  const pipeline = createPipeline({
    emitter,
    processManager,
    threads,
    plans,
    reviews,
    verifications,
    githubIssues,
    settings,
    providers,
  });

  await pipeline.startFromGitHubIssue(
    project.id,
    project.path,
    { number: issue.number, title: issue.title, body: issue.body, labels: issue.labels },
    executorModel,
    { baseBranch: project.defaultBranch, executorModelOverride },
  );

  // Wait for pipeline to complete
  console.log('\nPipeline started. Watching for completion...');
}
