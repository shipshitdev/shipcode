import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { appGetVersionMock } = vi.hoisted(() => ({
  appGetVersionMock: vi.fn(() => '0.1.0'),
}));

vi.mock('electron', () => ({
  app: { getVersion: appGetVersionMock },
  BrowserWindow: class BrowserWindowMock {},
}));

vi.mock('./logger.service', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { UpdateService } from './update-service';

function makeWindow() {
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: vi.fn(),
    },
  } as unknown as BrowserWindow;
}

describe('UpdateService.checkNow', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    appGetVersionMock.mockReturnValue('0.1.0');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('treats GitHub 404 (no published releases) as up-to-date, not error', async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }),
    ) as typeof fetch;

    const svc = new UpdateService(makeWindow());
    const status = await svc.checkNow();

    expect(status.state).toBe('up-to-date');
    expect(status.error).toBeNull();
    expect(status.latest).toBeNull();
    expect(status.hasUpdate).toBe(false);
    expect(status.checkedAt).not.toBeNull();
  });

  it('surfaces non-404 GitHub errors', async () => {
    global.fetch = vi.fn(async () => new Response('rate limited', { status: 403 })) as typeof fetch;

    const svc = new UpdateService(makeWindow());
    const status = await svc.checkNow();

    expect(status.state).toBe('error');
    expect(status.error).toContain('403');
  });

  it('marks update available when latest tag is newer than current', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v0.2.0',
            html_url: 'https://example.test/r',
            published_at: '2026-04-27T00:00:00Z',
            draft: false,
            prerelease: false,
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const svc = new UpdateService(makeWindow());
    const status = await svc.checkNow();

    expect(status.state).toBe('available');
    expect(status.hasUpdate).toBe(true);
    expect(status.latest).toBe('0.2.0');
  });
});
