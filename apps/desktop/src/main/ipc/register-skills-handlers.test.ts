import type { Project } from '@shipcode/shared';
import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSkillsHandlers } from './register-skills-handlers';

const mockInspectProjectSetup = vi.hoisted(() => vi.fn());
const mockLoadRepoContext = vi.hoisted(() => vi.fn());
const mockRewriteSkillDraft = vi.hoisted(() => vi.fn());
const mockAssertPrdRewriteModelSupported = vi.hoisted(() => vi.fn());

vi.mock('@shipcode/agents', () => ({
  DEFAULT_SKILLS: {
    'plan-generation': {
      content: '---\nname: plan-generation\n---\nUse {{USER_PROMPT}}.',
      requiredSlots: ['USER_PROMPT'],
      version: '1',
      schemaVersion: 1,
    },
  },
  PHASE_SKILL_KEYS: ['plan-generation'],
  inspectProjectSetup: mockInspectProjectSetup,
  loadRepoContext: mockLoadRepoContext,
  rewriteSkillDraft: mockRewriteSkillDraft,
  validateSkill: vi.fn(() => null),
}));

vi.mock('./helpers', () => ({
  assertPrdRewriteModelSupported: mockAssertPrdRewriteModelSupported,
  buildSkillRow: vi.fn(),
}));

vi.mock('../logger.service', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function makeProject(overrides: Partial<Project> = {}): Project {
  const now = new Date().toISOString();
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/repo',
    gitRemote: 'git@github.com:shipshitdev/shipcode.git',
    githubRepoId: 'repo-id',
    githubRepoFullName: 'shipshitdev/shipcode',
    starterIssueNumber: null,
    starterIssueCreatedAt: null,
    githubProjectUrl: 'https://github.com/users/decod3rs/projects/1',
    githubStatusMapping: {
      todo: { name: 'Ready', color: 'GRAY' },
      inProgress: { name: 'In progress', color: 'BLUE' },
      humanReview: { name: 'Review', color: 'YELLOW' },
      done: { name: 'Done', color: 'GREEN' },
    },
    plannerModelOverride: null,
    reviewerModelOverride: null,
    executorModelOverride: null,
    verifierModelOverride: null,
    plannerModelIdOverride: null,
    reviewerModelIdOverride: null,
    executorModelIdOverride: null,
    verifierModelIdOverride: null,
    plannerReasoningEffortOverride: null,
    reviewerReasoningEffortOverride: null,
    executorReasoningEffortOverride: null,
    verifierReasoningEffortOverride: null,
    revisionCountOverride: null,
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('registerSkillsHandlers', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    }),
  } as unknown as IpcMain;

  const queries = {
    projects: {
      getById: vi.fn(),
    },
    settings: {
      get: vi.fn(),
    },
    skills: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      listQuarantined: vi.fn(() => []),
    },
  };

  function getHandler(channel: string) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`${channel} handler not registered`);
    return handler;
  }

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    queries.projects.getById.mockReturnValue(makeProject());
    queries.settings.get.mockReturnValue({
      prdRewriteCli: 'claude',
      prdRewriteClaudeModel: 'claude-sonnet-4-6',
      prdRewriteCodexModel: null,
      prdRewriteReasoningEffort: 'low',
    });
    mockInspectProjectSetup.mockReturnValue({
      status: 'configured',
      error: null,
      contract: {
        setupCommands: ['bun install'],
        verifyCommands: ['bun test'],
        testingContext: 'Use focused Vitest tests.',
      },
    });
    mockLoadRepoContext.mockReturnValue('Repo memory');
    mockRewriteSkillDraft.mockResolvedValue({
      content: '---\nname: plan-generation\n---\nUse {{USER_PROMPT}} with Review.',
    });
    mockAssertPrdRewriteModelSupported.mockResolvedValue(undefined);

    registerSkillsHandlers({ ipcMain, queries } as never);
  });

  it('rewrites a skill with project setup, repo memory, and configured model settings', async () => {
    const handler = getHandler('skills:rewrite');

    const result = await handler(null, {
      projectId: null,
      contextProjectId: 'project-1',
      phase: 'plan-generation',
      content: 'draft',
      instruction: 'adapt to Review',
    });

    expect(result).toEqual({
      content: '---\nname: plan-generation\n---\nUse {{USER_PROMPT}} with Review.',
    });
    expect(mockAssertPrdRewriteModelSupported).toHaveBeenCalledWith(
      'claude',
      'claude-sonnet-4-6',
      'low',
    );
    expect(mockRewriteSkillDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'plan-generation',
        currentContent: 'draft',
        bundledContent: '---\nname: plan-generation\n---\nUse {{USER_PROMPT}}.',
        requiredSlots: ['USER_PROMPT'],
        userInstruction: 'adapt to Review',
        cwd: '/repo',
        cli: 'claude',
        modelId: 'claude-sonnet-4-6',
        reasoningEffort: 'low',
        projectContext: expect.stringContaining('human_review=Review'),
      }),
    );
    expect(mockRewriteSkillDraft.mock.calls[0][0].projectContext).toContain('bun test');
    expect(mockRewriteSkillDraft.mock.calls[0][0].projectContext).toContain('Repo memory');
  });

  it('rejects blank rewrite instructions before calling the model', async () => {
    const handler = getHandler('skills:rewrite');

    await expect(
      handler(null, {
        projectId: null,
        contextProjectId: 'project-1',
        phase: 'plan-generation',
        content: 'draft',
        instruction: '   ',
      }),
    ).rejects.toThrow('Rewrite instructions are required');
    expect(mockRewriteSkillDraft).not.toHaveBeenCalled();
  });
});
