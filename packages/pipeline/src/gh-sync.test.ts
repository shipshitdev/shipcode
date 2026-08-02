import type { Project } from '@shipcode/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGhSyncService, type GhSyncService } from './gh-sync';
import type { GhSyncWriteOpts } from './gh-sync-queue';

const { mockGhCli } = vi.hoisted(() => ({
  mockGhCli: {
    getIssue: vi.fn(),
    editIssueLabels: vi.fn(),
    setIssueProjectMetadata: vi.fn(),
  },
}));

vi.mock('@shipcode/agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipcode/agents')>();
  return {
    ...actual,
    GhCli: vi.fn(function GhCli() {
      return mockGhCli;
    }),
  };
});

/** No-op sleep so retry tests don't pay real backoff. */
const noSleep = async (): Promise<void> => {};

function baseOpts(overrides: Partial<GhSyncWriteOpts> = {}): GhSyncWriteOpts {
  return {
    projectPath: '/repo',
    projectUrl: 'https://github.com/orgs/acme/projects/1',
    issueNumber: 42,
    pipelineStatus: 'executing',
    statusMapping: {
      todo: { name: 'Todo', color: 'GRAY' },
      inProgress: { name: 'In Progress', color: 'BLUE' },
      humanReview: { name: 'Human Review', color: 'YELLOW' },
      deferred: { name: 'Deferred', color: 'PURPLE' },
      done: { name: 'Done', color: 'GREEN' },
    },
    ...overrides,
  };
}

/** Service with instant retries, for tests that exercise the failure path. */
function createTestService(
  overrides: Partial<Parameters<typeof createGhSyncService>[0]> = {},
): GhSyncService {
  return createGhSyncService({
    getProject: () => null,
    queueOptions: { sleep: noSleep },
    ...overrides,
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('createGhSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGhCli.getIssue.mockResolvedValue({ labels: [] });
    mockGhCli.setIssueProjectMetadata.mockResolvedValue(undefined);
    mockGhCli.editIssueLabels.mockResolvedValue(undefined);
  });

  it('exposes a deps object satisfying the GhSyncDeps contract', () => {
    const project: Project = { id: 'project-1', path: '/repo' } as never;
    const service = createGhSyncService({ getProject: () => project });

    expect(service.deps.getProject('project-1')).toBe(project);
    expect(typeof service.deps.syncToGithub).toBe('function');
  });

  it('writes GH Projects v2 Status field and swaps pipeline labels in one edit', async () => {
    mockGhCli.getIssue.mockResolvedValue({
      labels: ['shipcode:pipeline:planning', 'bug'],
    });
    const service = createTestService();

    service.enqueue(baseOpts());
    await settle();

    expect(mockGhCli.setIssueProjectMetadata).toHaveBeenCalledWith({
      issueNumber: 42,
      projectUrl: 'https://github.com/orgs/acme/projects/1',
      metadata: { status: 'In Progress' },
    });
    // One call carries both halves: the issue is never left unlabeled, and the
    // add is never sequenced after the remove.
    expect(mockGhCli.editIssueLabels).toHaveBeenCalledTimes(1);
    expect(mockGhCli.editIssueLabels).toHaveBeenCalledWith(42, {
      add: ['shipcode:pipeline:executing'],
      remove: ['shipcode:pipeline:planning'],
    });
  });

  it('leaves non-pipeline labels alone', async () => {
    mockGhCli.getIssue.mockResolvedValue({ labels: ['bug', 'p1'] });
    const service = createTestService();

    service.enqueue(baseOpts());
    await settle();

    expect(mockGhCli.editIssueLabels).toHaveBeenCalledWith(42, {
      add: ['shipcode:pipeline:executing'],
      remove: [],
    });
  });

  it('skips the label edit when the issue already carries only the target label', async () => {
    mockGhCli.getIssue.mockResolvedValue({ labels: ['shipcode:pipeline:executing', 'bug'] });
    const service = createTestService();

    service.enqueue(baseOpts());
    await settle();

    expect(mockGhCli.editIssueLabels).not.toHaveBeenCalled();
  });

  it.each([
    ['todo', 'Todo'],
    ['approval', 'Human Review'],
    ['deferred', 'Deferred'],
    ['completed', 'Done'],
  ] as const)('maps pipeline status %s to GH Status column %s', async (pipelineStatus, name) => {
    const service = createTestService();

    service.enqueue(baseOpts({ pipelineStatus: pipelineStatus as never }));
    await settle();

    expect(mockGhCli.setIssueProjectMetadata).toHaveBeenCalledWith({
      issueNumber: 42,
      projectUrl: 'https://github.com/orgs/acme/projects/1',
      metadata: { status: name },
    });
  });

  it('skips the Status write when no project URL is configured (label-only sync)', async () => {
    mockGhCli.getIssue.mockResolvedValue({ labels: [] });
    const service = createTestService();

    service.enqueue(baseOpts({ projectUrl: null, statusMapping: null }));
    await settle();

    expect(mockGhCli.setIssueProjectMetadata).not.toHaveBeenCalled();
    expect(mockGhCli.editIssueLabels).toHaveBeenCalledWith(42, {
      add: ['shipcode:pipeline:executing'],
      remove: [],
    });
  });

  it('still swaps labels when the Status write fails', async () => {
    mockGhCli.setIssueProjectMetadata.mockRejectedValue(new Error('project offline'));
    mockGhCli.getIssue.mockResolvedValue({ labels: ['shipcode:pipeline:planning'] });
    const service = createTestService({ queueOptions: { sleep: noSleep, maxAttempts: 1 } });

    service.enqueue(baseOpts());
    await settle();

    expect(mockGhCli.editIssueLabels).toHaveBeenCalledWith(42, {
      add: ['shipcode:pipeline:executing'],
      remove: ['shipcode:pipeline:planning'],
    });
  });

  it('retries a transient failure and succeeds without reporting', async () => {
    const onSyncFailure = vi.fn();
    mockGhCli.getIssue
      .mockRejectedValueOnce(new Error('issue offline'))
      .mockResolvedValue({ labels: ['shipcode:pipeline:planning'] });
    const service = createTestService({ onSyncFailure });

    service.enqueue(baseOpts());
    await settle();

    expect(mockGhCli.getIssue).toHaveBeenCalledTimes(2);
    expect(mockGhCli.editIssueLabels).toHaveBeenCalledWith(42, {
      add: ['shipcode:pipeline:executing'],
      remove: ['shipcode:pipeline:planning'],
    });
    expect(onSyncFailure).not.toHaveBeenCalled();
  });

  it('reports a persistent failure instead of dropping it silently', async () => {
    const error = new Error('issue offline');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSyncFailure = vi.fn();
    mockGhCli.setIssueProjectMetadata.mockRejectedValue(new Error('project offline'));
    mockGhCli.getIssue.mockRejectedValue(error);
    const service = createTestService({ onSyncFailure });

    // The pipeline must never see a sync failure — enqueue stays fire-and-forget.
    expect(() => service.enqueue(baseOpts({ repoFullName: 'acme/app' }))).not.toThrow();
    await settle();

    expect(mockGhCli.getIssue).toHaveBeenCalledTimes(3);
    expect(onSyncFailure).toHaveBeenCalledTimes(1);
    expect(onSyncFailure).toHaveBeenCalledWith(
      expect.objectContaining({ attempts: 3, error: expect.any(AggregateError) }),
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('acme/app issue #42'),
      expect.any(AggregateError),
    );
    consoleError.mockRestore();
  });

  it.each([
    [-1],
    [0],
    [-999],
  ])('skips all GitHub writes for local-only quick-task sentinel issue number %i', async (issueNumber) => {
    const service = createTestService();

    service.enqueue(baseOpts({ issueNumber }));
    await settle();

    expect(mockGhCli.setIssueProjectMetadata).not.toHaveBeenCalled();
    expect(mockGhCli.getIssue).not.toHaveBeenCalled();
    expect(mockGhCli.editIssueLabels).not.toHaveBeenCalled();
  });

  it('routes deps.syncToGithub (the syncThreadAndIssuePhase contract) through the same queue', async () => {
    mockGhCli.getIssue.mockResolvedValue({ labels: ['shipcode:pipeline:queued'] });
    const service = createTestService();

    await service.deps.syncToGithub({
      projectPath: '/repo',
      projectUrl: null,
      issueNumber: 42,
      pipelineStatus: 'executing',
      statusMapping: null,
    });

    expect(mockGhCli.editIssueLabels).toHaveBeenCalledWith(42, {
      add: ['shipcode:pipeline:executing'],
      remove: ['shipcode:pipeline:queued'],
    });
  });

  it('rejects deps.syncToGithub once the write has exhausted its retries', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGhCli.getIssue.mockRejectedValue(new Error('issue offline'));
    const service = createTestService();

    await expect(
      service.deps.syncToGithub({
        projectPath: '/repo',
        projectUrl: null,
        issueNumber: 42,
        pipelineStatus: 'executing',
        statusMapping: null,
      }),
    ).rejects.toThrow('issue offline');

    consoleError.mockRestore();
  });
});
