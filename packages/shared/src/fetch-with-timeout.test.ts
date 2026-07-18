import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from './fetch-with-timeout';

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('forwards the request and clears the timeout after completion', async () => {
    vi.useFakeTimers();
    const response = new Response('ok');
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWithTimeout(
        'https://example.test/resource',
        { headers: { Accept: 'application/json' } },
        1_000,
      ),
    ).resolves.toBe(response);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/resource',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts requests when the timeout elapses', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      ),
    );

    const pending = fetchWithTimeout('https://example.test/slow', {}, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'The operation was aborted due to timeout',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['init', 'outer'] as const)('honors an aborted %s signal', async (source) => {
    const controller = new AbortController();
    const reason = new Error(`${source} cancelled`);
    controller.abort(reason);
    const fetchMock = vi.fn((_url, init) => {
      expect(init?.signal?.aborted).toBe(true);
      return Promise.reject(init?.signal?.reason);
    });
    vi.stubGlobal('fetch', fetchMock);

    const request =
      source === 'init'
        ? fetchWithTimeout('https://example.test/cancelled', { signal: controller.signal }, 1_000)
        : fetchWithTimeout('https://example.test/cancelled', {}, 1_000, controller.signal);

    await expect(request).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('aborts an in-flight request when the outer signal fires', async () => {
    const controller = new AbortController();
    const reason = new Error('caller cancelled');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      ),
    );

    const pending = fetchWithTimeout(
      'https://example.test/cancelled',
      {},
      1_000,
      controller.signal,
    );
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it.each([-1, 1.5, Number.POSITIVE_INFINITY, 2 ** 31])(
    'rejects invalid timeout %s',
    async (timeoutMs) => {
      await expect(fetchWithTimeout('https://example.test', {}, timeoutMs)).rejects.toThrow(
        RangeError,
      );
    },
  );
});
