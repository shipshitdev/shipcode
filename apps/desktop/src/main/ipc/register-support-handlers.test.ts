import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IpcMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFormatAutomationPrompt = vi.hoisted(() => vi.fn());

vi.mock('@shipcode/agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipcode/agents')>();
  return {
    ...actual,
    formatAutomationPrompt: mockFormatAutomationPrompt,
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
} as never;

const notificationService = {
  listActive: vi.fn(() => []),
  dismiss: vi.fn(),
  dismissAll: vi.fn(),
} as never;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();

  registerSupportHandlers({
    ipcMain,
    mainWindow: mainWindow as never,
    queries: queries as unknown as never,
    processManager,
    pipeline: {} as never,
    emitter: {} as never,
    notificationService,
    chatNotificationService: {} as never,
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
