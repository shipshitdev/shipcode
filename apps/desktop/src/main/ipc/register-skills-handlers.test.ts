import fs from 'node:fs';
import path from 'node:path';
import type { Project } from '@shipcode/shared';
import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSkillsHandlers } from './register-skills-handlers';

const mockInspectProjectSetup = vi.hoisted(() => vi.fn());
const mockLoadRepoContext = vi.hoisted(() => vi.fn());
const mockRewriteSkillDraft = vi.hoisted(() => vi.fn());
const mockAssertPrdRewriteModelSupported = vi.hoisted(() => vi.fn());
const mockValidateSkill = vi.hoisted(() => vi.fn());
const mockBuildSkillRow = vi.hoisted(() => vi.fn());
const mockOpenPath = vi.hoisted(() => vi.fn());

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
  validateSkill: mockValidateSkill,
}));

vi.mock('./helpers', () => ({
  assertPrdRewriteModelSupported: mockAssertPrdRewriteModelSupported,
  buildSkillRow: mockBuildSkillRow,
}));

vi.mock('electron', () => ({
  shell: {
    openPath: mockOpenPath,
  },
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
    mockValidateSkill.mockReturnValue(null);
    mockBuildSkillRow.mockImplementation(
      (_queries: unknown, phase: string, projectId: string | null) => ({
        id: `${projectId ?? 'global'}:${phase}`,
        projectId,
        phase,
        source: projectId ? 'project' : 'default',
        status: 'ok',
        content: 'skill content',
      }),
    );
    mockOpenPath.mockResolvedValue('');

    registerSkillsHandlers({ ipcMain, queries } as never);
  });

  it('lists, reads, writes, resets, and reports quarantined skills', async () => {
    const listForView = getHandler('skills:list-for-view');
    const read = getHandler('skills:read');
    const write = getHandler('skills:write');
    const reset = getHandler('skills:reset');
    const listQuarantined = getHandler('skills:list-quarantined');
    queries.skills.listQuarantined.mockReturnValue([
      {
        phase: 'plan-generation',
        projectId: 'project-1',
        statusReason: 'Missing USER_PROMPT',
        updatedAt: '2026-05-08T00:00:00.000Z',
      },
    ] as never);

    expect(listForView(null, { projectId: 'project-1' })).toEqual([
      expect.objectContaining({
        phase: 'plan-generation',
        requiredSlots: ['USER_PROMPT'],
        projectRow: expect.objectContaining({ projectId: 'project-1' }),
        globalRow: expect.objectContaining({ projectId: null }),
        active: expect.objectContaining({ projectId: 'project-1' }),
      }),
    ]);
    expect(read(null, { projectId: null, phase: 'plan-generation' })).toEqual(
      expect.objectContaining({ id: 'global:plan-generation' }),
    );
    expect(
      write(null, { projectId: 'project-1', phase: 'plan-generation', content: 'next' }),
    ).toEqual({
      ok: true,
      row: expect.objectContaining({ id: 'project-1:plan-generation' }),
    });
    expect(queries.skills.set).toHaveBeenCalledWith('project-1', 'plan-generation', 'next', '1', 1);
    expect(reset(null, { projectId: 'project-1', phase: 'plan-generation' })).toEqual(
      expect.objectContaining({ id: 'project-1:plan-generation' }),
    );
    expect(queries.skills.delete).toHaveBeenCalledWith('project-1', 'plan-generation');
    expect(listQuarantined()).toEqual([
      {
        phase: 'plan-generation',
        projectId: 'project-1',
        statusReason: 'Missing USER_PROMPT',
        updatedAt: '2026-05-08T00:00:00.000Z',
      },
    ]);
  });

  it('falls back to the global skill row when the project row is inactive', () => {
    mockBuildSkillRow.mockImplementation(
      (_queries: unknown, phase: string, projectId: string | null) => ({
        id: `${projectId ?? 'global'}:${phase}`,
        projectId,
        phase,
        source: projectId ? 'default' : 'global',
        status: projectId ? 'missing' : 'ok',
        content: 'skill content',
      }),
    );
    const listForView = getHandler('skills:list-for-view');

    expect(listForView(null, { projectId: 'project-1' })).toEqual([
      expect.objectContaining({
        active: expect.objectContaining({ id: 'global:plan-generation' }),
      }),
    ]);
  });

  it('lists global-only skills when no project is selected', () => {
    const listForView = getHandler('skills:list-for-view');

    expect(listForView(null, { projectId: null })).toEqual([
      expect.objectContaining({
        projectRow: null,
        active: expect.objectContaining({ id: 'global:plan-generation' }),
      }),
    ]);
  });

  it('returns validation errors without persisting invalid skills', () => {
    mockValidateSkill.mockReturnValueOnce('Missing required slot USER_PROMPT');
    const write = getHandler('skills:write');

    expect(write(null, { projectId: null, phase: 'plan-generation', content: 'bad' })).toEqual({
      ok: false,
      error: 'Missing required slot USER_PROMPT',
    });
    expect(queries.skills.set).not.toHaveBeenCalled();
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

  it('builds rewrite context for partially configured projects and unavailable repo metadata', async () => {
    const handler = getHandler('skills:rewrite');
    queries.projects.getById.mockReturnValueOnce(
      makeProject({
        gitRemote: null,
        githubRepoFullName: null,
        githubProjectUrl: null,
        githubStatusMapping: null,
      }),
    );
    mockInspectProjectSetup.mockReturnValueOnce({
      status: 'invalid',
      error: 'missing setup command',
      contract: {
        setupCommands: [],
        verifyCommands: [],
        testingContext: null,
      },
    });
    mockLoadRepoContext.mockImplementationOnce(() => {
      throw new Error('memory missing');
    });
    queries.settings.get.mockReturnValueOnce({
      prdRewriteCli: 'codex',
      prdRewriteClaudeModel: 'claude-sonnet-4-6',
      prdRewriteCodexModel: 'gpt-5.4',
      prdRewriteReasoningEffort: 'medium',
    });

    await handler(null, {
      projectId: 'project-1',
      phase: 'plan-generation',
      content: 'draft',
      instruction: 'use codex',
    });

    const rewriteInput = mockRewriteSkillDraft.mock.calls[0][0];
    expect(mockAssertPrdRewriteModelSupported).toHaveBeenCalledWith('codex', 'gpt-5.4', 'medium');
    expect(rewriteInput.modelId).toBe('gpt-5.4');
    expect(rewriteInput.projectContext).toContain('Git remote: not configured');
    expect(rewriteInput.projectContext).toContain('GitHub Projects status mapping: not configured');
    expect(rewriteInput.projectContext).toContain('Setup error: missing setup command');
    expect(rewriteInput.projectContext).toContain('Setup commands: none');
    expect(rewriteInput.projectContext).toContain('Verification commands: none');
    expect(rewriteInput.projectContext).toContain('Repo memory unavailable: memory missing');
  });

  it('includes setup inspection failures in rewrite context', async () => {
    const handler = getHandler('skills:rewrite');
    mockInspectProjectSetup.mockImplementationOnce(() => {
      throw new Error('setup exploded');
    });

    await handler(null, {
      projectId: 'project-1',
      phase: 'plan-generation',
      content: 'draft',
      instruction: 'include setup failure',
    });

    expect(mockRewriteSkillDraft.mock.calls[0][0].projectContext).toContain(
      'Setup inspection failed: setup exploded',
    );
  });

  it('formats unmapped status options and setup without a contract', async () => {
    const handler = getHandler('skills:rewrite');
    queries.projects.getById.mockReturnValueOnce(
      makeProject({
        githubStatusMapping: {
          todo: null,
          inProgress: { name: 'Doing', color: 'BLUE' },
          humanReview: null,
          done: { name: 'Done', color: 'GREEN' },
        },
      } as never),
    );
    mockInspectProjectSetup.mockReturnValueOnce({
      status: 'missing',
      error: null,
      contract: null,
    });

    await handler(null, {
      projectId: 'project-1',
      phase: 'plan-generation',
      content: 'draft',
      instruction: 'format unmapped statuses',
    });

    const projectContext = mockRewriteSkillDraft.mock.calls[0][0].projectContext;
    expect(projectContext).toContain('todo=unmapped');
    expect(projectContext).toContain('human_review=unmapped');
    expect(projectContext).toContain('Setup status: missing');
    expect(projectContext).not.toContain('Setup commands:');
  });

  it('rejects unknown rewrite phases', async () => {
    const handler = getHandler('skills:rewrite');

    await expect(
      handler(null, {
        projectId: null,
        contextProjectId: null,
        phase: 'unknown-phase',
        content: 'draft',
        instruction: 'adapt',
      }),
    ).rejects.toThrow('Unknown skill phase: unknown-phase');
  });

  it('rewrites with no project context and clamps model rewrite failures', async () => {
    const handler = getHandler('skills:rewrite');
    mockRewriteSkillDraft.mockRejectedValueOnce(new Error(`first line\n${'x'.repeat(1_000)}`));

    await expect(
      handler(null, {
        projectId: null,
        contextProjectId: null,
        phase: 'plan-generation',
        content: 'draft',
        instruction: 'tighten it',
      }),
    ).rejects.toThrow('first line');
    expect(mockRewriteSkillDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: process.cwd(),
        projectContext:
          'No active project selected. Rewrite for the selected scope without repo-specific assumptions.',
      }),
    );
  });

  it('rejects rewrite requests with missing context projects', async () => {
    const handler = getHandler('skills:rewrite');
    queries.projects.getById.mockReturnValueOnce(null);

    await expect(
      handler(null, {
        projectId: null,
        contextProjectId: 'missing-project',
        phase: 'plan-generation',
        content: 'draft',
        instruction: 'adapt',
      }),
    ).rejects.toThrow('Project missing-project not found');
    expect(mockRewriteSkillDraft).not.toHaveBeenCalled();
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

  it('reports and opens writing PRD skill paths with fallback targets', async () => {
    const existsSpy = vi
      .spyOn(fs, 'existsSync')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const getInfo = getHandler('skills:get-writing-prds-info');
    const openWritingPrds = getHandler('skills:open-writing-prds');

    expect(getInfo(null, { projectId: 'project-1' })).toEqual({
      projectId: 'project-1',
      projectPath: '/repo',
      absolutePath: path.join('/repo', 'skills', 'writing-prds', 'SKILL.md'),
      exists: true,
      usingFallback: false,
      openTargetPath: path.join('/repo', 'skills', 'writing-prds', 'SKILL.md'),
    });

    await expect(openWritingPrds(null, { projectId: 'project-1' })).resolves.toBeUndefined();
    expect(mockOpenPath).toHaveBeenCalledWith(path.join('/repo', 'skills', 'writing-prds'));

    mockOpenPath.mockResolvedValueOnce('cannot open');
    await expect(openWritingPrds(null, { projectId: 'project-1' })).rejects.toThrow('cannot open');
    existsSpy.mockRestore();
  });

  it('reports writing PRD fallback to the project path and rejects missing projects', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const getInfo = getHandler('skills:get-writing-prds-info');
    const openWritingPrds = getHandler('skills:open-writing-prds');

    expect(getInfo(null, { projectId: 'project-1' })).toEqual({
      projectId: 'project-1',
      projectPath: '/repo',
      absolutePath: path.join('/repo', 'skills', 'writing-prds', 'SKILL.md'),
      exists: false,
      usingFallback: true,
      openTargetPath: '/repo',
    });

    queries.projects.getById.mockReturnValueOnce(null);
    expect(() => getInfo(null, { projectId: 'missing-project' })).toThrow(
      'Project missing-project not found',
    );

    queries.projects.getById.mockReturnValueOnce(null);
    await expect(openWritingPrds(null, { projectId: 'missing-project' })).rejects.toThrow(
      'Project missing-project not found',
    );
    existsSpy.mockRestore();
  });
});
