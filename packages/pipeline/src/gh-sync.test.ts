import type { Project } from '@shipcode/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGhSyncService, type GhSyncService } from './gh-sync';
import type { GhSyncWriteOpts } from './gh-sync-queue';

const { mockGhCli } = vi.hoisted(() => ({
  mockGhCli: {
    getIssue: vi.fn(),
    setIssueLabelPresence: vi.fn(),
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

describe('createGhSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGhCli.getIssue.mockResolvedValue({ labels: [] });
    mockGhCli.setIssueProjectMetadata.mockResolvedValue(undefined);
    mockGhCli.setIssueLabelPresence.mockResolvedValue(undefined);
  });

  it('exposes a deps object satisfying the GhSyncDeps contract', () => {
    const project: Project = { id: 'project-1', path: '/repo' } as never;
    const service = createGhSyncService({ getProject: () => project });

    expect(service.deps.getProject('project-1')).toBe(project);
    expect(typeof service.deps.syncToGithub).toBe('function');
  });

  it('writes GH Projects v2 Status field and toggles pipeline labels', async () => {
    mockGhCli.getIssue.mockResolvedValue({
      labels: ['shipcode:pipeline:planning', 'bug'],
    });
    const service: GhSyncService = createGhSyncService({ getProject: () => null });

    service.enqueue(baseOpts());
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockGhCli.setIssueProjectMetadata).toHaveBeenCalledWith({
      issueNumber: 42,
      projectUrl: 'https://github.com/orgs/acme/projects/1',
      metadata: { status: 'In Progress' },
    });
    expect(mockGhCli.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:pipeline:planning',
      false,
    );
    expect(mockGhCli.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:pipeline:executing',
      true,
    );
  });

  it.each([
    ['todo', 'Todo'],
    ['approval', 'Human Review'],
    ['deferred', 'Deferred'],
    ['completed', 'Done'],
  ] as const)('maps pipeline status %s to GH Status column %s', async (pipelineStatus, name) => {
    const service = createGhSyncService({ getProject: () => null });

    service.enqueue(baseOpts({ pipelineStatus: pipelineStatus as never }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockGhCli.setIssueProjectMetadata).toHaveBeenCalledWith({
      issueNumber: 42,
      projectUrl: 'https://github.com/orgs/acme/projects/1',
      metadata: { status: name },
    });
  });

  it('skips the Status write when no project URL is configured (label-only sync)', async () => {
    mockGhCli.getIssue.mockResolvedValue({ labels: [] });
    const service = createGhSyncService({ getProject: () => null });

    service.enqueue(baseOpts({ projectUrl: null, statusMapping: null }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockGhCli.setIssueProjectMetadata).not.toHaveBeenCalled();
    expect(mockGhCli.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:pipeline:executing',
      true,
    );
  });

  it('swallows GitHub project and label sync failures without throwing', async () => {
    mockGhCli.setIssueProjectMetadata.mockRejectedValue(new Error('project offline'));
    mockGhCli.getIssue.mockRejectedValue(new Error('issue offline'));
    const service = createGhSyncService({ getProject: () => null });

    expect(() => service.enqueue(baseOpts())).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockGhCli.setIssueProjectMetadata).toHaveBeenCalled();
    expect(mockGhCli.getIssue).toHaveBeenCalledWith(42);
  });

  it.each([
    [-1],
    [0],
    [-999],
  ])('skips all GitHub writes for local-only quick-task sentinel issue number %i', async (issueNumber) => {
    const service = createGhSyncService({ getProject: () => null });

    service.enqueue(baseOpts({ issueNumber }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockGhCli.setIssueProjectMetadata).not.toHaveBeenCalled();
    expect(mockGhCli.getIssue).not.toHaveBeenCalled();
    expect(mockGhCli.setIssueLabelPresence).not.toHaveBeenCalled();
  });

  it('routes deps.syncToGithub (the syncThreadAndIssuePhase contract) through the same queue', async () => {
    mockGhCli.getIssue.mockResolvedValue({ labels: ['shipcode:pipeline:queued'] });
    const service = createGhSyncService({ getProject: () => null });

    await service.deps.syncToGithub({
      projectPath: '/repo',
      projectUrl: null,
      issueNumber: 42,
      pipelineStatus: 'executing',
      statusMapping: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockGhCli.setIssueLabelPresence).toHaveBeenCalledWith(
      42,
      'shipcode:pipeline:executing',
      true,
    );
  });
});
