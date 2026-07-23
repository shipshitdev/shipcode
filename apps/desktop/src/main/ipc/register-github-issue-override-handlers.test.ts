import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGitHubIssueOverrideHandlers } from './register-github-issue-override-handlers';

const logError = vi.hoisted(() => vi.fn());

vi.mock('../logger.service', () => ({
  default: {
    error: logError,
  },
}));

describe('registerGitHubIssueOverrideHandlers', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
  } as unknown as IpcMain;
  const githubIssues = {
    getByNumber: vi.fn(),
    updatePhaseModelOverride: vi.fn(),
    updatePhaseModelIdOverride: vi.fn(),
    updateRevisionCountOverride: vi.fn(),
    updateRequireApprovalOverride: vi.fn(),
    updatePhaseReasoningEffortOverride: vi.fn(),
    clearAllPhaseOverridesForProject: vi.fn(),
  };
  const queries = {
    githubIssues,
    projects: { getById: vi.fn() },
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerGitHubIssueOverrideHandlers({
      ipcMain,
      mainWindow: {} as never,
      queries: queries as never,
    });
  });

  it('mutates, broadcasts, and returns the refreshed issue through the shared lifecycle', () => {
    const initialIssue = { id: 'issue-1', requireApprovalOverride: null };
    const refreshedIssue = { ...initialIssue, requireApprovalOverride: true };
    const send = vi.fn();
    const getByNumber = vi
      .fn()
      .mockReturnValueOnce(initialIssue)
      .mockReturnValueOnce(refreshedIssue);
    const updateRequireApprovalOverride = vi.fn();
    const list = vi.fn(() => [refreshedIssue]);

    registerGitHubIssueOverrideHandlers({
      ipcMain,
      mainWindow: {
        isDestroyed: vi.fn(() => false),
        webContents: {
          isDestroyed: vi.fn(() => false),
          send,
        },
      } as never,
      queries: {
        githubIssues: {
          getByNumber,
          updateRequireApprovalOverride,
          list,
        },
      } as never,
    });

    const handler = handlers.get('github:set-require-approval-override');
    if (!handler) throw new Error('override handler not registered');

    expect(
      handler(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        requireApproval: true,
      }),
    ).toEqual(refreshedIssue);
    expect(getByNumber).toHaveBeenNthCalledWith(1, 'project-1', 42);
    expect(updateRequireApprovalOverride).toHaveBeenCalledWith('issue-1', true);
    expect(list).toHaveBeenCalledWith('project-1');
    expect(send).toHaveBeenCalledWith('github:issues-updated', {
      projectId: 'project-1',
      issues: [refreshedIssue],
    });
    expect(getByNumber).toHaveBeenNthCalledWith(2, 'project-1', 42);
  });

  it('validates override input before looking up the cached issue', () => {
    const handler = handlers.get('github:set-revision-count-override');
    if (!handler) throw new Error('override handler not registered');

    expect(() =>
      handler(undefined, {
        projectId: 'project-1',
        issueNumber: 42,
        revisionCount: 6,
      }),
    ).toThrow('Invalid revision count override: 6');
    expect(githubIssues.getByNumber).not.toHaveBeenCalled();
    expect(githubIssues.updateRevisionCountOverride).not.toHaveBeenCalled();
  });

  it('logs full override errors and exposes only the clamped first line', () => {
    const fullError = new Error(`${'x'.repeat(400)}\nstack trace`);
    githubIssues.getByNumber.mockImplementationOnce(() => {
      throw fullError;
    });
    const handler = handlers.get('github:clear-phase-model-override');
    if (!handler) throw new Error('override handler not registered');

    expect(() =>
      handler(undefined, { projectId: 'project-1', issueNumber: 318, phase: 'executor' }),
    ).toThrow(`${'x'.repeat(279)}…`);
    expect(logError).toHaveBeenCalledWith('[github:clear-phase-model-override]', fullError);
  });
});
