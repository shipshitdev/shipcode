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

  it('logs full override errors and exposes only the clamped first line', async () => {
    const fullError = new Error(`${'x'.repeat(400)}\nstack trace`);
    githubIssues.getByNumber.mockImplementationOnce(() => {
      throw fullError;
    });
    const handler = handlers.get('github:clear-phase-model-override');
    if (!handler) throw new Error('override handler not registered');

    await expect(
      handler(undefined, { projectId: 'project-1', issueNumber: 318, phase: 'executor' }),
    ).rejects.toThrow(`${'x'.repeat(279)}…`);
    expect(logError).toHaveBeenCalledWith('[github:clear-phase-model-override]', fullError);
  });
});
