import { ISSUE_PIPELINE_STATUS, PIPELINE_PHASE } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type GhSyncDeps,
  mapPhaseToIssuePipelineStatus,
  syncThreadAndIssuePhase,
} from './phase-sync';

// ---------------------------------------------------------------------------
// Minimal fakes for ThreadQueries / GitHubIssueQueries
// ---------------------------------------------------------------------------

function makeThreads(overrides: Record<string, unknown> = {}) {
  const store: Record<
    string,
    { id: string; projectId: string; githubIssueNumber: number; status: string }
  > = {
    't-1': {
      id: 't-1',
      projectId: 'proj-1',
      githubIssueNumber: 42,
      status: 'planning',
      ...overrides,
    },
  };
  return {
    getById: vi.fn((id: string) => store[id] ?? null),
    updateStatus: vi.fn(),
    recordFailure: vi.fn(),
  };
}

function makeGithubIssues() {
  return {
    getByNumber: vi.fn((_projectId: string, _num: number) => ({
      id: 'gi-1',
      pipelineStatus: ISSUE_PIPELINE_STATUS.todo,
    })),
    updatePipelineStatus: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// syncThreadAndIssuePhase — GH sync callback
// ---------------------------------------------------------------------------

describe('syncThreadAndIssuePhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls ghSync.syncToGithub with correct args when project has status mapping', () => {
    const threads = makeThreads();
    const githubIssues = makeGithubIssues();
    const syncToGithub = vi.fn().mockResolvedValue(undefined);
    const project = {
      id: 'proj-1',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubStatusMapping: {
        todo: { name: 'Todo', color: 'GREEN' },
        inProgress: { name: 'In Progress', color: 'YELLOW' },
        humanReview: { name: 'Human Review', color: 'ORANGE' },
        done: { name: 'Done', color: 'PURPLE' },
      },
      path: '/tmp/repo',
    };
    const ghSync: GhSyncDeps = {
      getProject: vi.fn(() => project as never),
      syncToGithub,
    };

    syncThreadAndIssuePhase(
      threads as never,
      githubIssues as never,
      't-1',
      PIPELINE_PHASE.planning,
      undefined,
      ghSync,
    );

    expect(syncToGithub).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/tmp/repo',
        issueNumber: 42,
        pipelineStatus: ISSUE_PIPELINE_STATUS.planning,
      }),
    );
  });

  it('does not call ghSync.syncToGithub when project has no status mapping', () => {
    const threads = makeThreads();
    const githubIssues = makeGithubIssues();
    const syncToGithub = vi.fn().mockResolvedValue(undefined);
    const project = {
      id: 'proj-1',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubStatusMapping: null,
      path: '/tmp/repo',
    };
    const ghSync: GhSyncDeps = {
      getProject: vi.fn(() => project as never),
      syncToGithub,
    };

    syncThreadAndIssuePhase(
      threads as never,
      githubIssues as never,
      't-1',
      PIPELINE_PHASE.planning,
      undefined,
      ghSync,
    );

    expect(syncToGithub).not.toHaveBeenCalled();
  });

  it('swallows errors from ghSync.syncToGithub without blocking', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const threads = makeThreads();
    const githubIssues = makeGithubIssues();
    const syncToGithub = vi.fn().mockRejectedValue(new Error('network down'));
    const project = {
      id: 'proj-1',
      githubProjectUrl: 'https://github.com/orgs/acme/projects/1',
      githubStatusMapping: {
        todo: { name: 'Todo', color: 'GREEN' },
        inProgress: { name: 'In Progress', color: 'YELLOW' },
        humanReview: null,
        done: { name: 'Done', color: 'PURPLE' },
      },
      path: '/tmp/repo',
    };
    const ghSync: GhSyncDeps = {
      getProject: vi.fn(() => project as never),
      syncToGithub,
    };

    // Should not throw
    syncThreadAndIssuePhase(
      threads as never,
      githubIssues as never,
      't-1',
      PIPELINE_PHASE.executing,
      undefined,
      ghSync,
    );

    // Let microtask flush
    await new Promise((r) => setTimeout(r, 10));

    expect(warnSpy).toHaveBeenCalledWith(
      '[phase-sync] gh status sync failed silently',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it('does not call ghSync.syncToGithub when ghSync is undefined', () => {
    const threads = makeThreads();
    const githubIssues = makeGithubIssues();

    // Should not throw
    syncThreadAndIssuePhase(
      threads as never,
      githubIssues as never,
      't-1',
      PIPELINE_PHASE.planning,
    );

    expect(githubIssues.updatePipelineStatus).toHaveBeenCalled();
  });

  it('maps idle to todo for issue pipeline status', () => {
    expect(mapPhaseToIssuePipelineStatus(PIPELINE_PHASE.idle)).toBe(ISSUE_PIPELINE_STATUS.todo);
  });

  it('records failed status through updateStatus when recordFailure is unavailable', () => {
    const threads = makeThreads() as ReturnType<typeof makeThreads> & {
      recordFailure?: unknown;
    };
    delete threads.recordFailure;
    const githubIssues = makeGithubIssues();

    syncThreadAndIssuePhase(
      threads as never,
      githubIssues as never,
      't-1',
      PIPELINE_PHASE.failed,
      'boom',
    );

    expect(threads.updateStatus).toHaveBeenCalledWith('t-1', PIPELINE_PHASE.failed, 'boom');
  });

  it('updates thread status with an error message and skips issue sync when no issue exists', () => {
    const threads = makeThreads({ githubIssueNumber: null });
    const githubIssues = makeGithubIssues();

    syncThreadAndIssuePhase(
      threads as never,
      githubIssues as never,
      't-1',
      PIPELINE_PHASE.executing,
      'still running',
    );

    expect(threads.updateStatus).toHaveBeenCalledWith(
      't-1',
      PIPELINE_PHASE.executing,
      'still running',
    );
    expect(githubIssues.getByNumber).not.toHaveBeenCalled();
  });

  it('skips issue status writes when the linked issue row is missing', () => {
    const threads = makeThreads();
    const githubIssues = makeGithubIssues();
    githubIssues.getByNumber.mockReturnValueOnce(null);

    syncThreadAndIssuePhase(
      threads as never,
      githubIssues as never,
      't-1',
      PIPELINE_PHASE.executing,
    );

    expect(githubIssues.updatePipelineStatus).not.toHaveBeenCalled();
  });
});
