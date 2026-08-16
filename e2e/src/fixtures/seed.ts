import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  ActivityQueries,
  AgentConversationQueries,
  closeDatabase,
  DiffQueries,
  GitHubIssueQueries,
  getDatabase,
  NotificationsQueries,
  PipelineRunQueries,
  PlanQueries,
  ProjectQueries,
  ReviewFindingQueries,
  SettingsQueries,
  TerminalEventQueries,
  ThreadQueries,
} from '@shipcode/db';
import {
  CURRENT_ONBOARDING_VERSION,
  type GitHubIssueCacheRecord,
  ISSUE_PIPELINE_STATUS,
  PIPELINE_PHASE,
  type ShipCodePlan,
} from '@shipcode/shared';

export interface SeedIssue {
  issueNumber: number;
  title: string;
  body?: string;
  labels?: string[];
  assignee?: string | null;
  author?: string | null;
  state?: 'open' | 'closed';
  updatedAt?: string | null;
  /** Link this cached issue to a deterministic completed pipeline thread fixture. */
  linkedThread?: boolean;
  /**
   * Link this cached issue to a bare idle thread — a real `threads` row and a
   * real `github_issues.thread_id` link, but no plan/run/diff/terminal-event
   * artifacts.
   *
   * Specs that drive the terminal drawer need `thread:get` to resolve and the
   * cached issue record to carry a `threadId`, without any pre-existing console
   * output that would defeat an empty-transcript assertion. Mutually exclusive
   * with `linkedThread`, which seeds a fully completed pipeline.
   */
  linkedIdleThread?: boolean;
}

export interface SeedOptions {
  /** When false, leaves onboardingVersion at 0 so the OnboardingWizard renders. Default true. */
  onboarded?: boolean;
  /** Initialize the temp project as a tiny git repository for git/code surface specs. */
  gitRepo?: boolean;
  /** Add a second project already archived for Settings -> Archived restore specs. */
  archivedProject?: boolean;
  /** Issues to pre-cache for the seeded project (drives the board without network). */
  issues?: SeedIssue[];
  /** Issues to pre-cache as already archived for Settings -> Archived restore specs. */
  archivedIssues?: SeedIssue[];
  /** Optional notifications to pre-seed for the inbox flow. */
  notifications?: Array<{ kind: string; title: string; threadId?: string | null }>;
}

export interface SeedResult {
  projectId: string;
  projectPath: string;
  issues: SeedIssue[];
  issueThreads: Record<number, string>;
  archivedProject: { id: string; name: string; path: string } | null;
  archivedIssueIds: Record<number, string>;
  cleanupPaths: string[];
}

/**
 * Seed a fresh ShipCode SQLite database at `dataDir` for an E2E run.
 *
 * Opens the real app database (running every migration), inserts a project
 * pointed at a real temp directory (so workflow-file watchers don't choke),
 * sets the onboarding gate, and optionally pre-caches issues + notifications.
 * Closes the handle before returning so the Electron main process can open the
 * same file cleanly on launch.
 */
export function seedDatabase(dataDir: string, options: SeedOptions = {}): SeedResult {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = getDatabase(dataDir);
  try {
    new SettingsQueries(db).set({
      onboardingVersion: options.onboarded === false ? 0 : CURRENT_ONBOARDING_VERSION,
    });

    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-e2e-proj-'));
    if (options.gitRepo) initializeGitRepo(projectPath);

    const projectQueries = new ProjectQueries(db);
    const project = projectQueries.add(projectPath, {
      githubRepoFullName: 'shipshitdev/shipcode-e2e',
    });
    const cleanupPaths: string[] = [];
    let archivedProject: SeedResult['archivedProject'] = null;

    if (options.archivedProject) {
      const archivedProjectPath = fs.mkdtempSync(
        path.join(os.tmpdir(), 'shipcode-e2e-archived-proj-'),
      );
      cleanupPaths.push(archivedProjectPath);
      const createdArchivedProject = projectQueries.add(archivedProjectPath, {
        githubRepoFullName: 'shipshitdev/shipcode-e2e-archived',
      });
      projectQueries.archiveIfIdle(createdArchivedProject.id, { ignoreAttentionOnly: true });
      const archived = projectQueries.getById(createdArchivedProject.id);
      archivedProject = archived
        ? { id: archived.id, name: archived.name, path: archived.path }
        : {
            id: createdArchivedProject.id,
            name: createdArchivedProject.name,
            path: createdArchivedProject.path,
          };
    }

    const issues = options.issues ?? [];
    const issueThreads: Record<number, string> = {};
    const archivedIssueIds: Record<number, string> = {};
    if (issues.length > 0) {
      const issueQueries = new GitHubIssueQueries(db);
      for (const issue of issues) {
        const cachedIssue = issueQueries.upsert({
          projectId: project.id,
          issueNumber: issue.issueNumber,
          title: issue.title,
          body: issue.body ?? '',
          labels: issue.labels ?? [],
          assignee: issue.assignee ?? null,
          author: issue.author ?? 'e2e-bot',
          state: issue.state ?? 'open',
          updatedAt: issue.updatedAt ?? null,
          // The cache record carries many pipeline/PR fields that upsert ignores;
          // cast keeps the fixture minimal without enumerating every column.
        } as Parameters<GitHubIssueQueries['upsert']>[0]);

        if (issue.linkedThread) {
          issueThreads[issue.issueNumber] = seedLinkedIssueThread(db, {
            issue: cachedIssue,
            issueQueries,
            projectId: project.id,
            projectPath,
          });
        } else if (issue.linkedIdleThread) {
          issueThreads[issue.issueNumber] = seedIdleIssueThread(db, {
            issue: cachedIssue,
            issueQueries,
            projectId: project.id,
          });
        }
      }
    }

    if (options.archivedIssues?.length) {
      const issueQueries = new GitHubIssueQueries(db);
      for (const issue of options.archivedIssues) {
        const cachedIssue = issueQueries.upsert({
          projectId: project.id,
          issueNumber: issue.issueNumber,
          title: issue.title,
          body: issue.body ?? '',
          labels: issue.labels ?? [],
          assignee: issue.assignee ?? null,
          author: issue.author ?? 'e2e-bot',
          state: issue.state ?? 'closed',
          updatedAt: issue.updatedAt ?? null,
        } as Parameters<GitHubIssueQueries['upsert']>[0]);
        issueQueries.archiveIssues([cachedIssue.id]);
        archivedIssueIds[issue.issueNumber] = cachedIssue.id;
      }
    }

    if (options.notifications?.length) {
      const notifications = new NotificationsQueries(db);
      const createFn = (notifications as { create?: (input: unknown) => unknown }).create;
      for (const note of options.notifications) {
        if (typeof createFn !== 'function') break;
        try {
          createFn.call(notifications, {
            projectId: project.id,
            kind: note.kind,
            title: note.title,
            threadId: note.threadId ?? null,
          });
        } catch {
          // Notification schema drift is non-fatal for seeding; inbox spec also
          // covers the live notification:fire push path.
        }
      }
    }

    return {
      projectId: project.id,
      projectPath,
      issues,
      issueThreads,
      archivedProject,
      archivedIssueIds,
      cleanupPaths,
    };
  } finally {
    closeDatabase();
  }
}

/**
 * Create a bare idle thread and link it to `issue`, returning the thread id.
 *
 * Both directions of the link are durable database state: the `threads` row is
 * what `thread:get` returns, and `github_issues.thread_id` is what
 * `github:list-issues` returns. `useTerminalDrawer` resolves its display target
 * from whichever lands first and re-resolves to the same target on every
 * refetch, so a spec that opens the drawer on this thread never depends on
 * injected renderer state that a later query can overwrite.
 *
 * Deliberately creates no plan, run, diff, or terminal event: the thread must
 * start with an empty console so empty-transcript assertions stay meaningful.
 */
function seedIdleIssueThread(
  db: DatabaseSync,
  {
    issue,
    issueQueries,
    projectId,
  }: {
    issue: GitHubIssueCacheRecord;
    issueQueries: GitHubIssueQueries;
    projectId: string;
  },
): string {
  const threads = new ThreadQueries(db);
  const thread = threads.create(projectId, issue.body || issue.title, issue.title);
  threads.setGithubIssue(thread.id, issue.issueNumber, 'shipshitdev/shipcode-e2e');
  issueQueries.linkThread(issue.id, thread.id);
  return thread.id;
}

function seedLinkedIssueThread(
  db: DatabaseSync,
  {
    issue,
    issueQueries,
    projectId,
    projectPath,
  }: {
    issue: GitHubIssueCacheRecord;
    issueQueries: GitHubIssueQueries;
    projectId: string;
    projectPath: string;
  },
): string {
  const threads = new ThreadQueries(db);
  const plans = new PlanQueries(db);
  const diffs = new DiffQueries(db);
  const findings = new ReviewFindingQueries(db);
  const runs = new PipelineRunQueries(db);
  const conversations = new AgentConversationQueries(db);
  const activity = new ActivityQueries(db);
  const terminalEvents = new TerminalEventQueries(db);

  const thread = threads.create(projectId, issue.body || issue.title, issue.title);
  const branch = `ship/${issue.issueNumber}-issue-detail-behavior`;
  threads.setGithubIssue(thread.id, issue.issueNumber, 'shipshitdev/shipcode-e2e');
  threads.setWorktree(thread.id, branch, projectPath);
  threads.setPhaseModels(thread.id, {
    plannerModel: 'claude',
    reviewerModel: 'claude',
    verifierModel: 'claude',
    executorModel: 'codex',
  });
  threads.updateStatus(thread.id, PIPELINE_PHASE.completed);
  threads.markDone(thread.id);
  issueQueries.linkThread(issue.id, thread.id);
  issueQueries.updatePipelineStatus(issue.id, ISSUE_PIPELINE_STATUS.completed);

  const plan = plans.create(
    thread.id,
    [
      '## E2E issue-detail behavior plan',
      '',
      '1. Seed a linked issue thread.',
      '2. Render issue-detail tabs from durable data.',
      '3. Assert tab behavior contracts.',
    ].join('\n'),
    makeIssueDetailPlan(thread.id, issue.issueNumber),
    1,
  );
  plans.updateStatus(plan.id, 'approved');

  const run = runs.create({
    threadId: thread.id,
    projectId,
    source: 'github:start-issue',
    triggerDetail: `issue:${issue.issueNumber}`,
    currentPhase: PIPELINE_PHASE.executing,
    context: { fixture: 'issue-detail-behavior' },
  });
  runs.start(run.id, PIPELINE_PHASE.executing);
  runs.finish(run.id, {
    status: 'succeeded',
    currentPhase: PIPELINE_PHASE.verifying,
    context: { fixture: 'issue-detail-behavior', completed: true },
  });

  diffs.create(
    thread.id,
    'src/issue-detail-behavior.ts',
    'modify',
    [
      'diff --git a/src/issue-detail-behavior.ts b/src/issue-detail-behavior.ts',
      '@@ -1,2 +1,2 @@',
      ' export const issueDetailCoverage = true;',
      '-export const tabBehavior = "navigation-only";',
      '+export const tabBehavior = "stateful-behavior";',
    ].join('\n'),
    { beforeHash: '1111111', afterHash: '2222222' },
  );

  findings.createOrUpdateOpen({
    projectId,
    threadId: thread.id,
    planId: plan.id,
    runId: run.id,
    phase: 'verify',
    source: 'verification',
    severity: 'major',
    title: 'Missing issue-detail behavior assertion',
    description: 'The E2E suite must assert issue-detail tab behavior, not only tab reachability.',
    suggestion: 'Add deterministic checks for each issue-detail tab contract.',
    filePath: 'e2e/src/specs/desktop/issue-detail-behaviors.e2e.ts',
    fingerprint: `e2e-issue-detail-${issue.issueNumber}`,
    sourceModel: 'codex',
    worktreePath: projectPath,
    branch,
  });

  conversations.insert({
    threadId: thread.id,
    runId: run.id,
    phase: 'issue_chat',
    round: 1,
    speaker: 'user',
    role: 'prompt',
    provider: 'claude',
    model: 'claude-sonnet-4.6',
    content: 'Summarize the issue-detail behavior coverage risk.',
    tokensIn: 64,
    tokensOut: 0,
    costUsd: 0.0001,
  });
  conversations.insert({
    threadId: thread.id,
    runId: run.id,
    phase: 'issue_chat',
    round: 1,
    speaker: 'claude',
    role: 'response',
    provider: 'claude',
    model: 'claude-sonnet-4.6',
    content: 'Issue chat seeded answer for behavior coverage.',
    tokensIn: 120,
    tokensOut: 80,
    costUsd: 0.0012,
  });
  terminalEvents.create(
    thread.id,
    {
      kind: 'done',
      totalTokens: { prompt: 120, completion: 80 },
      totalCostUsd: 0.0012,
    },
    run.id,
  );

  activity.create({
    threadId: thread.id,
    projectId,
    kind: 'pipeline_completed',
    actor: 'codex',
    title: 'Pipeline completed for issue-detail behavior fixture',
    subtitle: `Issue #${issue.issueNumber} behavior data seeded`,
    metadata: { issueNumber: issue.issueNumber, runId: run.id },
  });

  return thread.id;
}

function makeIssueDetailPlan(threadId: string, issueNumber: number): ShipCodePlan {
  return {
    id: `e2e-issue-detail-plan-${issueNumber}`,
    threadId,
    version: 1,
    objective: 'Cover issue-detail tabs with deterministic behavior checks.',
    files: [
      {
        path: 'e2e/src/specs/desktop/issue-detail-behaviors.e2e.ts',
        action: 'create',
        description: 'Add stateful issue-detail tab behavior coverage.',
      },
      {
        path: 'e2e/src/fixtures/seed.ts',
        action: 'modify',
        description: 'Seed linked thread data for issue-detail tabs.',
      },
    ],
    steps: [
      {
        order: 1,
        description: 'Create linked issue thread fixture data.',
        files: ['e2e/src/fixtures/seed.ts'],
        rationale: 'Issue tabs load durable DB state through IPC queries.',
      },
      {
        order: 2,
        description: 'Exercise issue-detail tab interactions.',
        files: ['e2e/src/specs/desktop/issue-detail-behaviors.e2e.ts'],
        rationale: 'Each tab needs a stable user-visible behavior contract.',
      },
      {
        order: 3,
        description: 'Keep the behavior manifest aligned with the test file.',
        files: ['e2e/behavior-coverage.manifest.json'],
        rationale: 'The coverage gate should fail when a page loses behavioral E2E coverage.',
      },
    ],
    acceptanceCriteria: [
      'Comments composer validates empty and non-empty states.',
      'Findings status updates through the real IPC mutation.',
      'Diff, runs, activity, conversations, and chat tabs render seeded durable state.',
    ],
    outOfScope: ['Cloud runner coverage'],
    estimatedComplexity: 'medium',
    dependencies: [],
  };
}

function initializeGitRepo(projectPath: string): void {
  fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectPath, 'README.md'), '# ShipCode E2E Fixture\n');
  fs.writeFileSync(
    path.join(projectPath, 'src', 'index.ts'),
    "export const fixture = 'shipcode-e2e';\n",
  );

  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });

  git(['init']);
  git(['checkout', '-B', 'main']);
  git(['config', 'user.email', 'e2e@shipcode.local']);
  git(['config', 'user.name', 'ShipCode E2E']);
  git(['add', '.']);
  git(['commit', '-m', 'Initial fixture']);
  git(['remote', 'add', 'origin', 'https://github.com/shipshitdev/shipcode-e2e.git']);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
}
