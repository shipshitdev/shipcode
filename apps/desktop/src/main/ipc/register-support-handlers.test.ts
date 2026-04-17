import { type IpcMain } from 'electron';
import { enhancePrdDraft } from '@shipcode/agents';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectQueries, SettingsQueries } from '@shipcode/db';
import { DEFAULT_SETTINGS, type AppSettings } from '@shipcode/shared';
import {
  clearPrdAttachmentSession,
  createPrdAttachmentSession,
  stagePrdAttachments,
} from './prd-attachments';
import { registerSupportHandlers } from './register-support-handlers';

vi.mock('@shipcode/agents', async () => {
  const actual = await vi.importActual<typeof import('@shipcode/agents')>('@shipcode/agents');
  return {
    ...actual,
    enhancePrdDraft: vi.fn(),
  };
});

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    plannerModel: 'codex',
    plannerMaxTurns: 4,
    ...overrides,
  };
}

function makeProjectQueries(projectPath: string): ProjectQueries {
  return {
    getById: vi.fn((projectId: string) =>
      projectId === 'project-1' ? { id: projectId, path: projectPath } : null,
    ),
  } as unknown as ProjectQueries;
}

function makeSettingsQueries(settings: AppSettings): SettingsQueries {
  return {
    get: vi.fn(() => settings),
  } as unknown as SettingsQueries;
}

function createIpcMainMock() {
  const handlers = new Map<
    string,
    (event: { sender: { id: number } }, args: unknown) => Promise<unknown> | unknown
  >();
  const ipcMain = {
    handle: vi.fn(
      (
        channel: string,
        handler: (event: { sender: { id: number } }, args: unknown) => Promise<unknown> | unknown,
      ) => {
        handlers.set(channel, handler);
      },
    ),
  } as unknown as IpcMain;
  return { ipcMain, handlers };
}

describe('registerSupportHandlers', () => {
  const enhanceMock = vi.mocked(enhancePrdDraft);
  let projectDir: string;
  let imagePath: string;
  let sessionId: string | null;

  beforeEach(async () => {
    enhanceMock.mockReset();
    enhanceMock.mockResolvedValue({ body: 'refined' });
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipcode-project-'));
    imagePath = path.join(projectDir, 'input.png');
    await fs.writeFile(
      imagePath,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]),
    );
    sessionId = null;
  });

  afterEach(async () => {
    if (sessionId) {
      await clearPrdAttachmentSession({
        senderId: 1,
        projectId: 'project-1',
        attachmentSessionId: sessionId,
      }).catch(() => {});
    }
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('rejects attachment-backed requests before enhancePrdDraft is called', async () => {
    const { ipcMain, handlers } = createIpcMainMock();
    registerSupportHandlers(ipcMain, {
      projects: makeProjectQueries(projectDir),
      settings: makeSettingsQueries(makeSettings()),
    });

    const created = createPrdAttachmentSession({ senderId: 1, projectId: 'project-1' });
    sessionId = created.attachmentSessionId;
    await stagePrdAttachments({
      senderId: 1,
      projectId: 'project-1',
      attachmentSessionId: sessionId,
      paths: [imagePath],
    });

    const handler = handlers.get('ai:enhance-prd');
    expect(handler).toBeDefined();
    await expect(
      handler!({ sender: { id: 1 } }, {
        projectId: 'project-1',
        draftBody: '# Draft',
        attachmentSessionId: sessionId,
      }),
    ).rejects.toThrow('Write PRD does not support attachments yet.');

    expect(enhanceMock).not.toHaveBeenCalled();
  });

  it('rejects ownership mismatches before enhancePrdDraft is called', async () => {
    const { ipcMain, handlers } = createIpcMainMock();
    registerSupportHandlers(ipcMain, {
      projects: makeProjectQueries(projectDir),
      settings: makeSettingsQueries(makeSettings()),
    });

    const created = createPrdAttachmentSession({ senderId: 1, projectId: 'project-1' });
    sessionId = created.attachmentSessionId;

    const handler = handlers.get('ai:enhance-prd');
    expect(handler).toBeDefined();
    await expect(
      handler!({ sender: { id: 2 } }, {
        projectId: 'project-1',
        draftBody: '# Draft',
        attachmentSessionId: sessionId,
      }),
    ).rejects.toThrow('Attachment session mismatch.');

    expect(enhanceMock).not.toHaveBeenCalled();
  });

  it('allows text-only requests without attachment state', async () => {
    const { ipcMain, handlers } = createIpcMainMock();
    registerSupportHandlers(ipcMain, {
      projects: makeProjectQueries(projectDir),
      settings: makeSettingsQueries(makeSettings()),
    });

    const handler = handlers.get('ai:enhance-prd');
    expect(handler).toBeDefined();
    const result = await handler!({ sender: { id: 1 } }, {
      projectId: 'project-1',
      draftBody: '# Draft',
      attachmentSessionId: null,
    });

    expect(result).toEqual({ body: 'refined' });
    expect(enhanceMock).toHaveBeenCalledTimes(1);
  });
});
