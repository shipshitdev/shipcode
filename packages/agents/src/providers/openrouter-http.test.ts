import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _internals, OpenRouterClient, OpenRouterError } from './openrouter-http';

/**
 * Build a Response whose `body` is a real ReadableStream<Uint8Array>
 * that emits the given chunks. This is what `fetch()` returns in Node
 * 22's native implementation, so tests exercise the exact code path
 * the SSE consumer uses in production.
 */
function sseResponse(
  chunks: string[],
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/event-stream', ...headers },
  });
}

function errorResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function buildClient() {
  return new OpenRouterClient({ apiKey: 'test-key', baseUrl: 'https://example.test/v1' });
}

describe('OpenRouterClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('throws when constructed without an API key', () => {
    expect(() => new OpenRouterClient({ apiKey: '' })).toThrow(/apiKey is required/);
  });

  describe('SSE streaming', () => {
    it('concatenates delta content across multiple frames', async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[{"index":0,"finish_reason":null,"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"index":0,"finish_reason":null,"delta":{"content":"lo "}}]}\n\n',
          'data: {"model":"anthropic/claude-sonnet-4-6","choices":[{"index":0,"finish_reason":"stop","delta":{"content":"world"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      );

      const client = buildClient();
      const result = await client.chat(
        { model: 'openrouter/auto', messages: [{ role: 'user', content: 'hi' }], stream: true },
        new AbortController().signal,
      );

      expect(result.content).toBe('Hello world');
      expect(result.finishReason).toBe('stop');
      expect(result.model).toBe('anthropic/claude-sonnet-4-6');
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://example.test/v1/chat/completions');
      expect(init.headers.Authorization).toBe('Bearer test-key');
      expect(init.headers['X-Title']).toBe('ShipCode');
    });

    it('survives arbitrary byte-boundary splits within a frame', async () => {
      // Split a single frame across five chunks to prove the buffer
      // assembles lines correctly regardless of where chunks land.
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          'data: {"cho',
          'ices":[{"i',
          'ndex":0,"finish_reason":"stop","delta":{"content":"',
          'SPLIT"}}]}\n',
          '\ndata: [DONE]\n\n',
        ]),
      );

      const client = buildClient();
      const result = await client.chat(
        { model: 'openrouter/auto', messages: [{ role: 'user', content: 'x' }] },
        new AbortController().signal,
      );
      expect(result.content).toBe('SPLIT');
      expect(result.finishReason).toBe('stop');
    });

    it('ignores malformed JSON frames rather than tearing down the stream', async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          'data: not-json\n\n',
          'data: {"choices":[{"index":0,"finish_reason":"stop","delta":{"content":"ok"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      );

      const client = buildClient();
      const result = await client.chat(
        { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      );
      expect(result.content).toBe('ok');
    });

    it('accumulates usage from the final frame', async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[{"index":0,"finish_reason":"stop","delta":{"content":"x"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
          'data: [DONE]\n\n',
        ]),
      );

      const client = buildClient();
      const result = await client.chat(
        { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      );
      expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    });

    it('handles stream ending without [DONE] sentinel', async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[{"index":0,"finish_reason":"stop","delta":{"content":"done"}}]}\n\n',
        ]),
      );

      const client = buildClient();
      const result = await client.chat(
        { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      );
      expect(result.content).toBe('done');
    });
  });

  describe('error handling', () => {
    it('401 becomes non-retryable auth error', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(401, '{"error":"unauthorized"}'));

      const client = buildClient();
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        name: 'OpenRouterError',
        kind: 'auth',
        retryable: false,
      });
    });

    it('404 becomes non-retryable not_found error', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(404, '{"error":"model not found"}'));

      const client = buildClient();
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'not_found', retryable: false });
    });

    it('500 is retryable; succeeds on second attempt', async () => {
      fetchMock
        .mockResolvedValueOnce(errorResponse(500, 'server error'))
        .mockResolvedValueOnce(
          sseResponse([
            'data: {"choices":[{"index":0,"finish_reason":"stop","delta":{"content":"ok"}}]}\n\n',
            'data: [DONE]\n\n',
          ]),
        );

      // Use real timers but speed up by stubbing sleep
      vi.spyOn(_internals, 'sleep').mockResolvedValue(undefined);

      const client = buildClient();
      const result = await client.chat(
        { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        new AbortController().signal,
      );
      expect(result.content).toBe('ok');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('network failure surfaces as retryable OpenRouterError', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));
      vi.spyOn(_internals, 'sleep').mockResolvedValue(undefined);

      const client = buildClient();
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'network', retryable: true });
    });
  });

  describe('abort handling', () => {
    it('pre-aborted signal throws immediately without calling fetch', async () => {
      const abort = new AbortController();
      abort.abort();

      const client = buildClient();
      await expect(
        client.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }, abort.signal),
      ).rejects.toMatchObject({ kind: 'aborted', retryable: false });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('mid-stream abort cancels the reader', async () => {
      // Build a stream that lingers via a pending promise so we can abort
      // while it is still being consumed.
      const abort = new AbortController();
      const encoder = new TextEncoder();
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"index":0,"finish_reason":null,"delta":{"content":"part"}}]}\n\n',
            ),
          );
          // Do not close — leaves reader pending forever unless cancelled
        },
        cancel() {
          cancelled = true;
        },
      });
      fetchMock.mockResolvedValueOnce(
        new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      );

      const client = buildClient();
      const promise = client.chat(
        { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        abort.signal,
      );

      // Give the consumer a tick to start reading
      await new Promise((r) => setImmediate(r));
      abort.abort();

      await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
      expect(cancelled).toBe(true);
    });
  });
});

describe('parseRetryAfter', () => {
  const { parseRetryAfter } = _internals;

  it('parses integer seconds', () => {
    expect(parseRetryAfter('3')).toBe(3000);
  });

  it('parses HTTP-date', () => {
    const future = new Date(Date.now() + 5_000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).toBeGreaterThan(3_000);
    expect(ms).toBeLessThan(7_000);
  });

  it('returns 0 for unparseable values', () => {
    expect(parseRetryAfter('garbage')).toBe(0);
  });
});

describe('computeBackoffMs', () => {
  const { computeBackoffMs } = _internals;

  it('grows exponentially with attempt count', () => {
    const err = new OpenRouterError('network', 'x', true);
    const a0 = computeBackoffMs(0, err);
    const a1 = computeBackoffMs(1, err);
    const a2 = computeBackoffMs(2, err);
    expect(a1).toBeGreaterThan(a0);
    expect(a2).toBeGreaterThan(a1);
  });

  it('honors Retry-After when present on the error', () => {
    const err = new OpenRouterError('rate_limit', 'x', true);
    (err as unknown as { retryAfterMs: number }).retryAfterMs = 7_500;
    expect(computeBackoffMs(0, err)).toBe(7_500);
  });
});
