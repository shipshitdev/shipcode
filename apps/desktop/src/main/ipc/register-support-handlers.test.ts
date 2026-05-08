import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IpcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCheckGhAuth,
  mockCheckSystemHealthWithAuth,
  mockEnhancePrdDraft,
  mockFormatAutomationPrompt,
  mockGenerateMemoryFiles,
  mockInspectRepoMemory,
  mockReadMemoryFile,
} = vi.hoisted(() => ({
  mockCheckGhAuth: vi.fn(),
  mockCheckSystemHealthWithAuth: vi.fn(),
  mockEnhancePrdDraft: vi.fn(),
  mockFormatAutomationPrompt: vi.fn(),
  mockGenerateMemoryFiles: vi.fn(),
  mockInspectRepoMemory: vi.fn(),
  mockReadMemoryFile: vi.fn(),
}));

vi.mock('@shipcode/agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipcode/agents')>();
  return {
    ...actual,
    checkGhAuth: mockCheckGhAuth,
    checkSystemHealthWithAuth: mockCheckSystemHealthWithAuth,
    enhancePrdDraft: mockEnhancePrdDraft,
    formatAutomationPrompt: mockFormatAutomationPrompt,
    generateMemoryFiles: mockGenerateMemoryFiles,
    inspectRepoMemory: mockInspectRepoMemory,
    readMemoryFile: mockReadMemoryFile,
  };
});

import { registerSupportHandlers } from './register-support-handlers';

// ---------------------------------------------------------------------------
// Minimal test doubles
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();

function getHandler(channel: string) {
  const h = handlers.get(channel);
  if (!h) throw new Error(`No handler registered for ${channel}`);
  return h;
}

const ipcMain = {
  handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
    handlers.set(channel, listener);
  }),
  on: vi.fn(),
} as unknown as IpcMain;

const mainWindow = {
  isDestroyed: () => false,
  webContents: {
    isDestroyed: () => false,
    send: vi.fn(),
  },
};

const queries = {
  projects: {
    getById: vi.fn(),
  },
  settings: {
    get: vi.fn(() => ({
      prdRewriteCli: 'claude',
      prdRewriteClaudeModel: null,
      prdRewriteCodexModel: null,
      prdRewriteReasoningEffort: 'low',
      executorReasoningEffort: 'medium',
      openrouterDefaultPaidModel: 'openrouter/auto',
    })),
  },
  notifications: {
    listActive: vi.fn(() => []),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  },
  terminalEvents: {
    create: vi.fn((threadId: string, event: unknown) => ({ threadId, ...(event as object) })),
  },
};

const processManager = {
  on: vi.fn(),
  get: vi.fn(),
};

const notificationService = {
  listActive: vi.fn(() => []),
  dismiss: vi.fn(),
  dismissAll: vi.fn(),
} as never;

function processListener(eventName: string) {
  const call = (processManager.on as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
    ([name]) => name === eventName,
  );
  if (!call) throw new Error(`Missing process listener ${eventName}`);
  return call[1] as (...args: unknown[]) => void;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  mockCheckGhAuth.mockResolvedValue({ isAuthenticated: true, user: 'decod3rs' });
  mockCheckSystemHealthWithAuth.mockResolvedValue({
    claude: { ok: true },
    codex: { ok: true },
    git: { ok: true },
    gh: { ok: true },
  });
  mockEnhancePrdDraft.mockResolvedValue({ body: 'enhanced' });
  mockGenerateMemoryFiles.mockResolvedValue({ success: true, error: null });
  mockInspectRepoMemory.mockReturnValue([{ name: 'overview.md' }]);
  mockReadMemoryFile.mockReturnValue('memory body');

  registerSupportHandlers({
    ipcMain,
    mainWindow: mainWindow as never,
    queries: queries as unknown as never,
    processManager: processManager as never,
    pipeline: {} as never,
    emitter: {} as never,
    notificationService,
    chatNotificationService: {} as never,
  });
});

// ---------------------------------------------------------------------------
// Simple support IPC handlers
// ---------------------------------------------------------------------------

describe('support IPC utilities', () => {
  it('routes notification handlers through the notification service', () => {
    (notificationService as { listActive: ReturnType<typeof vi.fn> }).listActive.mockReturnValue([
      { id: 'notification-1' },
    ]);

    expect(getHandler('notification:list')()).toEqual([{ id: 'notification-1' }]);
    getHandler('notification:dismiss')(undefined, { id: 'notification-1' });
    getHandler('notification:dismiss-all')();

    expect(
      (notificationService as { dismiss: ReturnType<typeof vi.fn> }).dismiss,
    ).toHaveBeenCalledWith('notification-1');
    expect(
      (notificationService as { dismissAll: ReturnType<typeof vi.fn> }).dismissAll,
    ).toHaveBeenCalled();
  });

  it('combines system health and GitHub auth for onboarding', async () => {
    await expect(getHandler('onboarding:check-auth')()).resolves.toMatchObject({
      claude: { ok: true },
      ghAuth: { isAuthenticated: true, user: 'decod3rs' },
    });
  });
});

// ---------------------------------------------------------------------------
// ai:enhance-prd
// ---------------------------------------------------------------------------

describe('ai:enhance-prd', () => {
  it('throws when project is not found', async () => {
    (queries.projects.getById as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const handler = getHandler('ai:enhance-prd');
    await expect(
      handler(undefined, { projectId: 'missing', draftBody: 'body', attachmentSessionId: null }),
    ).rejects.toThrow('not found');
  });

  it('blocks when attachmentSessionId is provided', async () => {
    (queries.projects.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'p1',
      path: '/tmp/proj',
    });
    const handler = getHandler('ai:enhance-prd');
    await expect(
      handler(undefined, {
        projectId: 'p1',
        draftBody: 'body',
        attachmentSessionId: 'some-session-id',
      }),
    ).rejects.toThrow(/not yet supported/i);
  });

  it('enhances a PRD using the repo skill when present and clamps thrown errors', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-prd-skill-'));
    fs.mkdirSync(path.join(tempDir, 'skills', 'writing-prds'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'skills', 'writing-prds', 'SKILL.md'), 'Skill body');
    (queries.projects.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'p1',
      path: tempDir,
    });
    (queries.settings.get as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      prdRewriteCli: 'codex',
      prdRewriteClaudeModel: null,
      prdRewriteCodexModel: null,
      prdRewriteReasoningEffort: 'medium',
      executorReasoningEffort: 'medium',
      openrouterDefaultPaidModel: 'openrouter/auto',
    });

    const handler = getHandler('ai:enhance-prd');
    await expect(
      handler(undefined, { projectId: 'p1', draftBody: 'draft', attachmentSessionId: null }),
    ).resolves.toEqual({ body: 'enhanced' });
    expect(mockEnhancePrdDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draftBody: 'draft',
        skillContent: 'Skill body',
        cwd: tempDir,
      }),
    );

    (queries.settings.get as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      prdRewriteCli: 'codex',
      prdRewriteClaudeModel: null,
      prdRewriteCodexModel: null,
      prdRewriteReasoningEffort: 'medium',
      executorReasoningEffort: 'medium',
      openrouterDefaultPaidModel: 'openrouter/auto',
    });
    mockEnhancePrdDraft.mockRejectedValueOnce(new Error('boom\nwith stack'));
    await expect(
      handler(undefined, { projectId: 'p1', draftBody: null, attachmentSessionId: null }),
    ).rejects.toThrow('boom');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// ai:format-automation
// ---------------------------------------------------------------------------

describe('ai:format-automation', () => {
  it('formats automation prompts through the selected OpenRouter override', async () => {
    mockFormatAutomationPrompt.mockResolvedValueOnce({
      prompt: '# Automation: Smoke\n\n## Goal\nRun smoke tests.',
    });
    (queries.projects.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'p1',
      path: '/tmp/proj',
    });
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

    try {
      const handler = getHandler('ai:format-automation');
      const result = await handler(undefined, {
        projectId: 'p1',
        prompt: 'run smoke tests every morning',
        provider: 'openrouter',
        modelId: '',
        reasoningEffort: null,
      });

      expect(result).toEqual({
        prompt: '# Automation: Smoke\n\n## Goal\nRun smoke tests.',
      });
      expect(mockFormatAutomationPrompt).toHaveBeenCalledWith({
        rawPrompt: 'run smoke tests every morning',
        cwd: '/tmp/proj',
        provider: 'openrouter',
        modelId: 'openrouter/auto',
        reasoningEffort: 'medium',
        openRouterApiKey: 'test-openrouter-key',
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = previousKey;
      }
    }
  });

  it('throws when the project is missing', async () => {
    (queries.projects.getById as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const handler = getHandler('ai:format-automation');

    await expect(
      handler(undefined, {
        projectId: 'missing',
        prompt: 'format me',
        provider: null,
        modelId: null,
        reasoningEffort: null,
      }),
    ).rejects.toThrow('not found');
    expect(mockFormatAutomationPrompt).not.toHaveBeenCalled();
  });

  it('falls back to rewrite settings and returns a clamped formatting failure', async () => {
    (queries.projects.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'p1',
      path: '/tmp/proj',
    });
    (queries.settings.get as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      prdRewriteCli: 'openrouter',
      prdRewriteClaudeModel: null,
      prdRewriteCodexModel: null,
      prdRewriteReasoningEffort: 'low',
      executorReasoningEffort: 'high',
      openrouterDefaultPaidModel: 'openrouter/model',
    });
    mockFormatAutomationPrompt.mockRejectedValueOnce('format failed\nlong detail');

    await expect(
      getHandler('ai:format-automation')(undefined, {
        projectId: 'p1',
        prompt: null,
        provider: 'unknown',
        modelId: '  ',
        reasoningEffort: null,
      }),
    ).rejects.toThrow('format failed');
    expect(mockFormatAutomationPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        rawPrompt: '',
        provider: 'openrouter',
        modelId: 'openrouter/model',
        reasoningEffort: 'high',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Memory IPC handlers
// ---------------------------------------------------------------------------

describe('memory IPC handlers', () => {
  it('lists, generates, and reads repo memory for an existing project', async () => {
    (queries.projects.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'p1',
      path: '/tmp/proj',
    });

    expect(getHandler('memory:list')(undefined, { projectId: 'p1' })).toEqual([
      { name: 'overview.md' },
    ]);
    await expect(
      getHandler('memory:generate')(undefined, { projectId: 'p1', cli: 'claude' }),
    ).resolves.toEqual({
      success: true,
      error: null,
    });
    expect(getHandler('memory:read')(undefined, { projectId: 'p1', name: 'overview.md' })).toEqual({
      content: 'memory body',
    });
  });

  it('reports memory generation failures and rejects missing projects', async () => {
    (queries.projects.getById as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    expect(() => getHandler('memory:list')(undefined, { projectId: 'missing' })).toThrow(
      'not found',
    );

    (queries.projects.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'p1',
      path: '/tmp/proj',
    });
    mockGenerateMemoryFiles.mockRejectedValueOnce(new Error('generation exploded'));

    await expect(
      getHandler('memory:generate')(undefined, { projectId: 'p1', cli: 'codex' }),
    ).resolves.toEqual({
      success: false,
      error: 'generation exploded',
    });
  });
});

// ---------------------------------------------------------------------------
// Process manager forwarding
// ---------------------------------------------------------------------------

describe('process manager forwarding', () => {
  it('normalizes raw output and forwards lifecycle state to the renderer and terminal stream', () => {
    (processManager as unknown as { get: ReturnType<typeof vi.fn> }).get.mockReturnValue({
      threadId: 'thread-1',
      outputMode: 'raw',
      type: 'codex',
      state: 'running',
      exitCode: null,
    });

    processListener('output')('proc-1', 'raw output');

    expect(queries.terminalEvents.create).toHaveBeenCalledWith('thread-1', {
      kind: 'raw',
      content: 'raw output',
    });
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('agent:output', {
      processId: 'proc-1',
      chunk: 'raw output',
      threadId: 'thread-1',
    });

    processListener('stateChange')('proc-1', 'codex', 'running');

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('agent:state', {
      processId: 'proc-1',
      type: 'codex',
      state: 'running',
      threadId: 'thread-1',
    });
    expect(queries.terminalEvents.create).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({ kind: 'lifecycle' }),
    );
  });

  it('drops normalizers on exit and skips renderer sends when the window is destroyed', () => {
    const destroyedWindow = {
      isDestroyed: () => true,
      webContents: {
        isDestroyed: () => true,
        send: vi.fn(),
      },
    };
    handlers.clear();
    registerSupportHandlers({
      ipcMain,
      mainWindow: destroyedWindow as never,
      queries: queries as unknown as never,
      processManager: processManager as never,
      pipeline: {} as never,
      emitter: {} as never,
      notificationService,
      chatNotificationService: {} as never,
    });
    (processManager as unknown as { get: ReturnType<typeof vi.fn> }).get.mockReturnValue({
      threadId: 'thread-1',
      outputMode: 'normalized',
      type: 'claude',
      state: 'exited',
      exitCode: 1,
    });

    processListener('output')('proc-2', 'normalized output');
    processListener('stateChange')('proc-2', 'openrouter', 'exited');

    expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// prd-attachments IPC handlers
// ---------------------------------------------------------------------------

describe('prd-attachments IPC handlers', () => {
  const sessionIds: string[] = [];

  afterEach(async () => {
    const clearHandler = getHandler('prd-attachments:clear');
    for (const id of sessionIds) {
      try {
        await clearHandler(undefined, { sessionId: id });
      } catch {
        /* already cleared */
      }
    }
    sessionIds.length = 0;
  });

  async function createSession(): Promise<string> {
    const handler = getHandler('prd-attachments:create-session');
    const result = (await handler(undefined, { senderId: 'sender-1', projectId: 'project-1' })) as {
      sessionId: string;
    };
    sessionIds.push(result.sessionId);
    return result.sessionId;
  }

  it('prd-attachments:create-session returns a sessionId', async () => {
    const result = (await getHandler('prd-attachments:create-session')(undefined, {
      senderId: 's',
      projectId: 'p',
    })) as { sessionId: string };
    sessionIds.push(result.sessionId);
    expect(typeof result.sessionId).toBe('string');
    expect(result.sessionId.length).toBeGreaterThan(0);
  });

  it('prd-attachments:stage stages valid PNG files', async () => {
    const sessionId = await createSession();

    // Create a real PNG-magic temp file
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const tmpPath = path.join(os.tmpdir(), `sc-test-${crypto.randomUUID().slice(0, 8)}.png`);
    fs.writeFileSync(tmpPath, pngMagic);

    try {
      const stageHandler = getHandler('prd-attachments:stage');
      const result = (await stageHandler(undefined, {
        sessionId,
        filePaths: [tmpPath],
      })) as { staged: unknown[]; errors: string[] };

      expect(result.errors).toHaveLength(0);
      expect(result.staged).toHaveLength(1);
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ok */
      }
    }
  });

  it('prd-attachments:remove removes a staged attachment', async () => {
    const sessionId = await createSession();

    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const tmpPath = path.join(os.tmpdir(), `sc-test-${crypto.randomUUID().slice(0, 8)}.png`);
    fs.writeFileSync(tmpPath, pngMagic);

    try {
      const stageHandler = getHandler('prd-attachments:stage');
      const staged = (await stageHandler(undefined, {
        sessionId,
        filePaths: [tmpPath],
      })) as { staged: Array<{ originalPath: string; stagedPath: string }>; errors: string[] };

      expect(staged.staged).toHaveLength(1);
      const stagedPath = staged.staged[0]?.stagedPath;

      const removeHandler = getHandler('prd-attachments:remove');
      await removeHandler(undefined, {
        sessionId,
        filePath: staged.staged[0]?.originalPath,
      });

      expect(fs.existsSync(stagedPath)).toBe(false);
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ok */
      }
    }
  });

  it('prd-attachments:clear cleans up the session', async () => {
    const sessionId = await createSession();
    const clearHandler = getHandler('prd-attachments:clear');
    await clearHandler(undefined, { sessionId });

    // Remove from cleanup list since already cleared
    const idx = sessionIds.indexOf(sessionId);
    if (idx !== -1) sessionIds.splice(idx, 1);

    // Staging into a cleared session should throw
    const stageHandler = getHandler('prd-attachments:stage');
    await expect(stageHandler(undefined, { sessionId, filePaths: [] })).rejects.toThrow(
      /No attachment session/i,
    );
  });
});
