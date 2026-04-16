import { describe, expect, it, vi } from 'vitest';
import type { GitHubIssueQueries, PlanQueries, ProjectQueries, SettingsQueries, ThreadQueries } from '@shipcode/db';
import type { Pipeline } from '@shipcode/pipeline';
import type { GitHubIssueCacheRecord, Project } from '@shipcode/shared';
import { PipelineScheduler, isSchedulerSlotConsumingPhase } from './pipeline-scheduler';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Project One',
    path: '/proj',
    gitRemote: 'https://github.com/shipcode/shipcode',
    githubProjectUrl: 'https://github.com/orgs/shipcode/projects/1',
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeIssue(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: 'issue-1',
    projectId: 'project-1',
    issueNumber: 42,
    title: 'Queue me',
    body: 'Please do the thing',
    labels: ['agent:claude'],
    assignee: null,
    state: 'open',
    pipelineStatus: 'todo',
    threadId: null,
    claimedAt: null,
    claimedBy: null,
    lastPhaseUpdate: null,
    lastStatusLabel: null,
    executorModel: 'claude',
    fetchedAt: new Date('2026-04-16T12:00:00.000Z').toISOString(),
    ...overrides,
  };
}

function makeScheduler(overrides: {
  activePhases?: Array<'awaiting_approval' | 'planning' | 'reviewing' | 'failed' | 'completed'>;
  maxConcurrentPipelines?: number;
  issue?: Partial<GitHubIssueCacheRecord>;
  secondIssue?: Partial<GitHubIssueCacheRecord>;
  startFromGitHubIssue?: ReturnType<typeof vi.fn>;
  tryClaim?: ReturnType<typeof vi.fn>;
} = {}) {
  const project = makeProject();
  const issue = makeIssue(overrides.issue);
  const secondIssue = makeIssue({
    id: 'issue-2',
    issueNumber: 43,
    fetchedAt: new Date('2026-04-16T12:05:00.000Z').toISOString(),
    ...overrides.secondIssue,
  });
  const byId = new Map<string, GitHubIssueCacheRecord>([
    [issue.id, issue],
    [secondIssue.id, secondIssue],
  ]);

  const startFromGitHubIssue =
    overrides.startFromGitHubIssue ??
    vi.fn(async () => {
      return undefined;
    });

  const tryClaim = overrides.tryClaim ?? vi.fn(() => true);

  const pipeline = {
    listActive: vi.fn(() =>
      (overrides.activePhases ?? []).map((phase, index) => ({
        threadId: `t-${index}`,
        projectPath: '/proj',
        phase,
        startedAt: 123,
        activeProcessId: null,
      })),
    ),
    startFromGitHubIssue,
    startExecution: vi.fn(async () => undefined),
  } as unknown as Pipeline;

  const projects = {
    list: vi.fn(() => [project]),
    getById: vi.fn(() => project),
  } as unknown as ProjectQueries;

  const threads = {
    getById: vi.fn(() => null),
    create: vi.fn(() => ({ id: 'thread-1' })),
    setGithubIssue: vi.fn(),
    updateStatus: vi.fn(),
  } as unknown as ThreadQueries;

  const plans = {
    supersedeAll: vi.fn(),
  } as unknown as PlanQueries;

  const githubIssues = {
    getByNumber: vi.fn((_projectId: string, issueNumber: number) =>
      issueNumber === 43 ? secondIssue : issue,
    ),
    updatePipelineStatus: vi.fn((id: string, status: GitHubIssueCacheRecord['pipelineStatus']) => {
      const row = byId.get(id);
      if (row) row.pipelineStatus = status;
    }),
    linkThread: vi.fn((id: string, threadId: string) => {
      const row = byId.get(id);
      if (row) row.threadId = threadId;
    }),
    tryClaim: vi.fn((id: string, owner: string) => {
      const row = byId.get(id);
      if (!row || row.claimedAt) return false;
      row.claimedAt = new Date().toISOString();
      row.claimedBy = owner;
      return true;
    }),
    releaseClaim: vi.fn((id: string) => {
      const row = byId.get(id);
      if (!row) return;
      row.claimedAt = null;
      row.claimedBy = null;
      row.pipelineStatus = 'queued';
    }),
    getRequeued: vi.fn(() =>
      [issue, secondIssue].filter(
        (item) => item.pipelineStatus === 'queued' && item.claimedAt == null,
      ),
    ),
  } as unknown as GitHubIssueQueries;

  const settings = {
    get: vi.fn(() => ({ maxConcurrentPipelines: overrides.maxConcurrentPipelines ?? 3 })),
  } as unknown as SettingsQueries;

  const scheduler = new PipelineScheduler({
    pipeline,
    projects,
    threads,
    plans,
    githubIssues,
    settings,
    emitGithubIssuesUpdated: vi.fn(),
    attachIssueToProject: vi.fn(async () => undefined),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  });

  return { scheduler, pipeline, projects, threads, plans, githubIssues, settings, project, issue, secondIssue };
}

describe('pipeline scheduler', () => {
  it('treats awaiting_approval as non-slot-consuming', () => {
    expect(isSchedulerSlotConsumingPhase('awaiting_approval')).toBe(false);
    expect(isSchedulerSlotConsumingPhase('planning')).toBe(true);
  });

  it('counts only scheduler-consuming active pipelines', () => {
    const { scheduler } = makeScheduler({
      activePhases: ['awaiting_approval', 'planning', 'failed'],
    });

    expect(scheduler.countSchedulerActivePipelines()).toBe(2);
  });

  it('queues GitHub issues at capacity', async () => {
    const { scheduler, githubIssues, threads, plans, pipeline } = makeScheduler({
      activePhases: ['planning'],
      maxConcurrentPipelines: 1,
    });

    await expect(scheduler.startGitHubIssue('project-1', 42)).resolves.toEqual({ queued: true });
    expect(githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-1', 'queued');
    expect(threads.create).not.toHaveBeenCalled();
    expect(plans.supersedeAll).not.toHaveBeenCalled();
    expect(pipeline.startFromGitHubIssue).not.toHaveBeenCalled();
  });

  it('starts GitHub issues immediately below capacity', async () => {
    const { scheduler, githubIssues, threads, plans, pipeline } = makeScheduler({
      activePhases: [],
      maxConcurrentPipelines: 1,
    });

    await expect(scheduler.startGitHubIssue('project-1', 42)).resolves.toEqual({ queued: false });
    expect(githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-1', 'planning');
    expect(threads.create).toHaveBeenCalledWith('project-1', 'Please do the thing', 'Queue me');
    expect(threads.setGithubIssue).toHaveBeenCalledWith('thread-1', 42, 'https://github.com/shipcode/shipcode');
    expect(githubIssues.linkThread).toHaveBeenCalledWith('issue-1', 'thread-1');
    expect(plans.supersedeAll).toHaveBeenCalledWith('thread-1');
    expect(pipeline.startFromGitHubIssue).toHaveBeenCalledTimes(1);
  });

  it('promotes queued GitHub issues when a slot opens', async () => {
    const { scheduler, githubIssues, pipeline } = makeScheduler({
      activePhases: [],
      maxConcurrentPipelines: 1,
      issue: { pipelineStatus: 'queued' },
    });

    await scheduler.drainQueuedGitHubIssues();
    expect(githubIssues.tryClaim).toHaveBeenCalledWith('issue-1', expect.stringContaining('shipcode-scheduler'));
    expect(pipeline.startFromGitHubIssue).toHaveBeenCalledTimes(1);
  });

  it('keeps overlapping start attempts within the slot cap', async () => {
    const gate = deferred<void>();
    const { scheduler, githubIssues, threads, pipeline } = makeScheduler({
      activePhases: [],
      maxConcurrentPipelines: 1,
      startFromGitHubIssue: vi.fn(() => gate.promise),
    });

    const first = scheduler.startGitHubIssue('project-1', 42);
    await new Promise((resolve) => setImmediate(resolve));

    const second = scheduler.startGitHubIssue('project-1', 43);
    await expect(second).resolves.toEqual({ queued: true });
    expect(threads.create).toHaveBeenCalledTimes(1);
    expect(githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-2', 'queued');
    expect(pipeline.startFromGitHubIssue).toHaveBeenCalledTimes(1);

    gate.resolve();
    await expect(first).resolves.toEqual({ queued: false });
  });

  it('releases reserved capacity when startup fails', async () => {
    const { scheduler, githubIssues, pipeline } = makeScheduler({
      activePhases: [],
      maxConcurrentPipelines: 1,
      startFromGitHubIssue: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    await expect(scheduler.startGitHubIssue('project-1', 42)).rejects.toThrow('boom');
    expect(githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-1', 'todo');
    expect(githubIssues.releaseClaim).not.toHaveBeenCalled();

    await expect(scheduler.startGitHubIssue('project-1', 42)).rejects.toThrow('boom');
    expect(pipeline.startFromGitHubIssue).toHaveBeenCalledTimes(2);
  });
});
