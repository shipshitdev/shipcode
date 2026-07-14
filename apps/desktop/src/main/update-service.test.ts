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

function makeWindowWithState({
  destroyed = false,
  webContentsDestroyed = false,
  send = vi.fn(),
}: {
  destroyed?: boolean;
  webContentsDestroyed?: boolean;
  send?: ReturnType<typeof vi.fn>;
}) {
  return {
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => webContentsDestroyed,
      send,
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
    vi.useRealTimers();
  });

  it('starts and stops periodic update checks and exposes current status', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ tag_name: 'v0.2.0', draft: false, prerelease: false }), {
          status: 200,
        }),
    ) as typeof fetch;

    const svc = new UpdateService(makeWindow());
    expect(svc.getStatus()).toMatchObject({
      current: '0.1.0',
      state: 'idle',
    });

    svc.start();
    svc.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(2);

    svc.stop();
    svc.stop();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('cancels the delayed initial check when stopped before startup polling begins', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch;

    const svc = new UpdateService(makeWindow());
    svc.start();
    svc.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetch).not.toHaveBeenCalled();
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

  it('treats current or older stable tags as up-to-date', async () => {
    appGetVersionMock.mockReturnValue('1.2.3');
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v1.2.3',
            html_url: 'https://example.test/current',
            published_at: '2026-04-27T00:00:00Z',
            draft: false,
            prerelease: false,
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const svc = new UpdateService(makeWindow());
    const status = await svc.checkNow();

    expect(status.state).toBe('up-to-date');
    expect(status.hasUpdate).toBe(false);
    expect(status.latest).toBe('1.2.3');
    expect(status.releaseUrl).toBe('https://example.test/current');
  });

  it('skips draft and prerelease responses without surfacing an update', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v99.0.0-beta.1',
            html_url: 'https://example.test/prerelease',
            published_at: '2026-04-27T00:00:00Z',
            draft: false,
            prerelease: true,
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const svc = new UpdateService(makeWindow());
    const status = await svc.checkNow();

    expect(status.state).toBe('up-to-date');
    expect(status.hasUpdate).toBe(false);
    expect(status.latest).toBeNull();
    expect(status.error).toBeNull();
  });

  it('falls back to release name when tag_name is missing', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            name: 'v0.3.0',
            html_url: 'https://example.test/name-release',
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
    expect(status.latest).toBe('0.3.0');
    expect(status.releaseTag).toBe('v0.3.0');
  });

  it('reports malformed release metadata as a clamped update error', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: null,
            name: null,
            draft: false,
            prerelease: false,
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const svc = new UpdateService(makeWindow());
    const status = await svc.checkNow();

    expect(status.state).toBe('error');
    expect(status.error).toBe('Release response missing tag_name');
  });

  it('handles invalid and prerelease semver comparisons conservatively', async () => {
    appGetVersionMock.mockReturnValue('1.0.0-rc.2');
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v1.0.0',
            html_url: 42,
            published_at: 42,
            draft: false,
            prerelease: false,
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const stableVsRc = new UpdateService(makeWindow());
    await expect(stableVsRc.checkNow()).resolves.toMatchObject({
      state: 'available',
      latest: '1.0.0',
      releaseUrl: null,
      publishedAt: null,
    });

    appGetVersionMock.mockReturnValue('not-semver');
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'also-not-semver',
            draft: false,
            prerelease: false,
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const invalid = new UpdateService(makeWindow());
    await expect(invalid.checkNow()).resolves.toMatchObject({
      state: 'up-to-date',
      latest: 'also-not-semver',
      hasUpdate: false,
    });
  });

  it('handles prerelease ordering when current stable is newer', async () => {
    appGetVersionMock.mockReturnValue('1.0.0');
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v1.0.0-rc.2',
            draft: false,
            prerelease: false,
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const stableVsRc = new UpdateService(makeWindow());
    await expect(stableVsRc.checkNow()).resolves.toMatchObject({
      state: 'up-to-date',
      latest: '1.0.0-rc.2',
      hasUpdate: false,
    });

    appGetVersionMock.mockReturnValue('1.0.0-rc.2');
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: 'v1.0.0-rc.10',
            draft: false,
            prerelease: false,
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const lexicalNewer = new UpdateService(makeWindow());
    await expect(lexicalNewer.checkNow()).resolves.toMatchObject({
      state: 'up-to-date',
      latest: '1.0.0-rc.10',
      hasUpdate: false,
    });
  });

  it('aborts slow update checks after the timeout', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal instanceof AbortSignal) {
            signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
          }
        }),
    ) as typeof fetch;

    const svc = new UpdateService(makeWindow());
    const pending = svc.checkNow();

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toMatchObject({
      state: 'error',
      error: 'aborted by timeout',
    });
  });

  it('skips renderer sends when the window or webContents is destroyed', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ tag_name: 'v0.2.0', draft: false, prerelease: false }), {
          status: 200,
        }),
    ) as typeof fetch;
    const destroyedSend = vi.fn();
    const destroyed = new UpdateService(
      makeWindowWithState({ destroyed: true, send: destroyedSend }),
    );

    await destroyed.checkNow();

    expect(destroyedSend).not.toHaveBeenCalled();

    const webContentsDestroyedSend = vi.fn();
    const webContentsDestroyed = new UpdateService(
      makeWindowWithState({ webContentsDestroyed: true, send: webContentsDestroyedSend }),
    );

    await webContentsDestroyed.checkNow();

    expect(webContentsDestroyedSend).not.toHaveBeenCalled();
  });

  it('ignores renderer send failures during status updates', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ tag_name: 'v0.2.0', draft: false, prerelease: false }), {
          status: 200,
        }),
    ) as typeof fetch;
    const send = vi.fn(() => {
      throw new Error('window closed during send');
    });
    const svc = new UpdateService(makeWindowWithState({ send }));

    await expect(svc.checkNow()).resolves.toMatchObject({ state: 'available' });
    expect(send).toHaveBeenCalled();
  });

  it('coalesces concurrent update checks into one fetch', async () => {
    let resolveFetch: (response: Response) => void = () => {};
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as typeof fetch;

    const svc = new UpdateService(makeWindow());
    const first = svc.checkNow();
    const second = svc.checkNow();
    resolveFetch(
      new Response(JSON.stringify({ tag_name: 'v0.2.0', draft: false, prerelease: false }), {
        status: 200,
      }),
    );

    await expect(first).resolves.toMatchObject({ state: 'available' });
    await expect(second).resolves.toMatchObject({ state: 'available' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
