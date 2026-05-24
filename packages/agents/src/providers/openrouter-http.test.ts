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
    vi.restoreAllMocks();
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
          'data: {"model":"anthropic/claude-sonnet-4.6","choices":[{"index":0,"finish_reason":"stop","delta":{"content":"world"}}]}\n\n',
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
      expect(result.model).toBe('anthropic/claude-sonnet-4.6');
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

    it('emits done without token usage when the stream has no usage frame', async () => {
      const onDelta = vi.fn();
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[{"index":0,"finish_reason":"stop","delta":{"content":"ok"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      );

      const client = buildClient();
      await client.chat(
        { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
        onDelta,
      );

      expect(onDelta).toHaveBeenCalledWith({ kind: 'done', totalTokens: undefined });
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

    it('emits reasoning, done usage, and assembles tool-call fragments', async () => {
      const onDelta = vi.fn();
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          ': keep alive\n',
          'event: completion\n',
          'data: {"model":"m","choices":[]}\n\n',
          'data: {"choices":[{"index":0,"finish_reason":null,"delta":{"reasoning":"thinking","content":"Hi","tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{\\"p\\""}}]}}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n',
          'data: {"choices":[{"index":0,"finish_reason":"tool_calls","delta":{"tool_calls":[{"index":0,"function":{"name":"File","arguments":":\\"x\\"}"}}]}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      );

      const client = buildClient();
      const result = await client.chat(
        { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
        onDelta,
      );

      expect(result).toMatchObject({
        content: 'Hi',
        finishReason: 'tool_calls',
        model: 'm',
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });
      expect(result.toolCalls).toEqual([
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'readFile', arguments: '{"p":"x"}' },
        },
      ]);
      expect(onDelta).toHaveBeenCalledWith({ kind: 'thinking', content: 'thinking' });
      expect(onDelta).toHaveBeenCalledWith({
        kind: 'done',
        totalTokens: { prompt: 2, completion: 3 },
      });
    });

    it('orders multiple tool calls by index before returning them', async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[{"index":0,"finish_reason":"tool_calls","delta":{"tool_calls":[{"index":1,"id":"call_b","function":{"name":"second","arguments":"{}"}},{"index":0,"id":"call_a","function":{"name":"first","arguments":"{}"}}]}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      );

      const client = buildClient();
      const result = await client.chat(
        { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      );

      expect(result.toolCalls.map((call) => call.id)).toEqual(['call_a', 'call_b']);
    });

    it('assembles tool-call fragments that provide only a function name', async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[{"index":0,"finish_reason":"tool_calls","delta":{"tool_calls":[{"index":0,"id":"call_name","function":{"name":"read"}}]}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      );

      const client = buildClient();
      const result = await client.chat(
        { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      );

      expect(result.toolCalls).toEqual([
        { id: 'call_name', type: 'function', function: { name: 'read', arguments: '' } },
      ]);
    });

    it('handles empty deltas, anonymous tool-call fragments, and stream read failures', async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          'data: {"choices":[]}\n\n',
          'data: {"choices":[{"index":0,"finish_reason":null}]}\n\n',
          'data: {"choices":[{"index":0,"finish_reason":null,"delta":{"content":null}}]}\n\n',
          'data: {"choices":[{"index":0,"finish_reason":null,"delta":{"content":"","tool_calls":[{"index":1,"function":{"arguments":"{}"}}]}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      );

      const client = buildClient();
      const result = await client.chat(
        { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      );

      expect(result.toolCalls).toEqual([
        { id: '', type: 'function', function: { name: '', arguments: '{}' } },
      ]);

      vi.spyOn(_internals, 'sleep').mockResolvedValue(undefined);
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.error('broken stream');
              },
            }),
            { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
          ),
        ),
      );
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'network', message: 'stream read failed' });

      fetchMock.mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new Error('reader exploded'));
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      );
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'network', message: 'stream read failed' });
    });

    it('rejects stream responses without a body', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const client = buildClient();
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'network', retryable: false });
    });

    it('propagates OpenRouterError instances from stream reads', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new OpenRouterError('unknown', 'provider reset', false));
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      );

      const client = buildClient();
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'unknown', message: 'provider reset' });
    });

    it('treats an abort before stream completion as an aborted stream', async () => {
      const abort = new AbortController();
      fetchMock.mockImplementationOnce(() => {
        abort.abort();
        return Promise.resolve(sseResponse([]));
      });

      const client = buildClient();
      await expect(
        client.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }, abort.signal),
      ).rejects.toMatchObject({ kind: 'aborted', message: 'stream aborted' });
    });
  });

  describe('JSON responses', () => {
    it('uses non-stream Accept header and maps message tool calls', async () => {
      fetchMock.mockResolvedValueOnce(
        Response.json({
          model: 'actual/model',
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          choices: [
            {
              message: {
                content: 'json result',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'tool', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'stop',
            },
          ],
        }),
      );

      const client = new OpenRouterClient({
        apiKey: 'test-key',
        baseUrl: 'https://example.test/v1',
        referer: 'https://shipcode.test',
        title: 'Custom ShipCode',
      });
      const result = await client.chat(
        { model: 'm', messages: [{ role: 'user', content: 'x' }], stream: false },
        new AbortController().signal,
      );

      expect(result).toEqual({
        content: 'json result',
        toolCalls: [
          { id: 'call_1', type: 'function', function: { name: 'tool', arguments: '{}' } },
        ],
        finishReason: 'stop',
        model: 'actual/model',
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      });
      const init = fetchMock.mock.calls[0][1];
      expect(init.headers.Accept).toBe('application/json');
      expect(init.headers['HTTP-Referer']).toBe('https://shipcode.test');
      expect(init.headers['X-Title']).toBe('Custom ShipCode');
      expect(JSON.parse(init.body)).toMatchObject({ stream: false });
    });

    it('defaults missing JSON choice fields', async () => {
      fetchMock.mockResolvedValueOnce(Response.json({ choices: [] }));

      const client = buildClient();
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }], stream: false },
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        content: '',
        toolCalls: [],
        finishReason: null,
        model: null,
        usage: null,
      });
    });

    it('defaults nullable JSON message fields', async () => {
      fetchMock.mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: null }, finish_reason: null }],
        }),
      );

      const client = buildClient();
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }], stream: false },
          new AbortController().signal,
        ),
      ).resolves.toEqual({
        content: '',
        toolCalls: [],
        finishReason: null,
        model: null,
        usage: null,
      });
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

    it('403 becomes non-retryable auth error and 400 becomes unknown', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(403, 'forbidden'));

      const client = buildClient();
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'auth', status: 403, retryable: false });

      fetchMock.mockResolvedValueOnce(errorResponse(400, 'bad request'));
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'unknown', status: 400, retryable: false });
    });

    it('uses fallback error messages for empty auth and not-found bodies', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(401, ''));
      const client = buildClient();
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'auth', message: 'OpenRouter auth failed: 401' });

      fetchMock.mockResolvedValueOnce(errorResponse(404, ''));
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'not_found', message: 'OpenRouter 404: not found' });
    });

    it('handles unreadable error response bodies and rate limits without retry-after', async () => {
      const unreadable = errorResponse(400, 'bad request');
      vi.spyOn(unreadable, 'text').mockRejectedValueOnce(new Error('body locked'));
      fetchMock.mockResolvedValueOnce(unreadable);
      vi.spyOn(_internals, 'sleep').mockResolvedValue(undefined);

      const client = buildClient();
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'unknown', status: 400, message: 'OpenRouter 400: ' });

      fetchMock.mockImplementation(async () => errorResponse(429, 'slow down'));
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'rate_limit', retryAfterMs: undefined });
    });

    it('429 retries after Retry-After and succeeds', async () => {
      fetchMock
        .mockResolvedValueOnce(errorResponse(429, 'slow down', { 'Retry-After': '2' }))
        .mockResolvedValueOnce(
          sseResponse([
            'data: {"choices":[{"index":0,"finish_reason":"stop","delta":{"content":"ok"}}]}\n\n',
            'data: [DONE]\n\n',
          ]),
        );
      const sleepSpy = vi.spyOn(_internals, 'sleep').mockResolvedValue(undefined);

      const client = buildClient();
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({ content: 'ok' });
      expect(sleepSpy).toHaveBeenCalledWith(2000, expect.any(AbortSignal));
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

    it('uses generic messages for non-Error fetch and JSON failures', async () => {
      fetchMock.mockRejectedValue('socket closed');
      vi.spyOn(_internals, 'sleep').mockResolvedValue(undefined);
      const client = buildClient();

      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'network', message: 'fetch failed' });

      fetchMock.mockResolvedValueOnce(new Response('not-json', { status: 200 }));
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }], stream: false },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'unknown' });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw 'plain json failure';
        },
        headers: new Headers(),
      } as unknown as Response);
      await expect(
        client.chat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }], stream: false },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ kind: 'unknown', message: 'plain json failure' });
    });

    it('classifies request timeouts as retryable network errors', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted by timeout')), {
            once: true,
          });
        });
      });
      vi.spyOn(_internals, 'sleep').mockResolvedValue(undefined);

      const client = buildClient();
      const promise = client.chat(
        { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        new AbortController().signal,
      );
      const expectation = expect(promise).rejects.toMatchObject({
        kind: 'network',
        message: 'request timeout',
        retryable: true,
      });

      await vi.advanceTimersByTimeAsync(600_000);
      await vi.advanceTimersByTimeAsync(600_000);
      await vi.advanceTimersByTimeAsync(600_000);
      await vi.advanceTimersByTimeAsync(600_000);

      await expectation;
    });

    it('wraps fetch aborts from the caller as aborted', async () => {
      const abort = new AbortController();
      fetchMock.mockImplementationOnce(() => {
        abort.abort();
        return Promise.reject(new Error('aborted by fetch'));
      });

      const client = buildClient();
      await expect(
        client.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }, abort.signal),
      ).rejects.toMatchObject({ kind: 'aborted', retryable: false });
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

    // Node 25 + Vitest fork workers currently leave this stream test hanging
    // after assertions pass, which blocks the package test process from exiting.
    // Quarantine it from CI until the underlying cleanup issue is fixed.
    it.skip('mid-stream abort cancels the reader', async () => {
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

  it('clamps past HTTP-date values to zero', () => {
    const past = new Date(Date.now() - 5_000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
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
    const err = new OpenRouterError('rate_limit', 'x', true, undefined, 7_500);
    expect(computeBackoffMs(0, err)).toBe(7_500);
  });
});

describe('OpenRouter internals', () => {
  it('caps retry-after backoff and resolves anySignal from pre-aborted input', () => {
    const err = new OpenRouterError('rate_limit', 'x', true, undefined, 120_000);
    expect(_internals.computeBackoffMs(0, err)).toBeLessThanOrEqual(30_000);

    const abort = new AbortController();
    abort.abort();
    expect(_internals.anySignal([abort.signal]).aborted).toBe(true);
  });

  it('aborts sleep while waiting', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const promise = _internals.sleep(10_000, abort.signal);

    abort.abort();
    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('rejects sleep immediately when already aborted and forwards later aborts through anySignal', async () => {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(_internals.sleep(1, alreadyAborted.signal)).rejects.toMatchObject({
      kind: 'aborted',
    });

    const first = new AbortController();
    const second = new AbortController();
    const combined = _internals.anySignal([first.signal, second.signal]);
    expect(combined.aborted).toBe(false);
    second.abort();
    expect(combined.aborted).toBe(true);
  });

  it('resolves sleep after the timer fires', async () => {
    vi.useFakeTimers();
    const promise = _internals.sleep(10, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toBeUndefined();
  });
});
