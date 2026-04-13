/**
 * Thin HTTP client for OpenRouter's OpenAI-compatible chat completions
 * endpoint.
 *
 * Responsibilities:
 * - Build request with Bearer auth + HTTP-Referer/X-Title identification
 * - Consume SSE stream via response.body as ReadableStream<Uint8Array>
 * - Frame accumulator that survives arbitrary byte-boundary splits
 * - Retry on 429 with exponential backoff + jitter, honoring Retry-After
 * - Propagate AbortSignal cleanly (cancels in-flight reader + avoids retry)
 *
 * Non-responsibilities (handled at higher layers):
 * - Parsing the message content into plans/reviews/verifications (that's
 *   the existing StreamParser; this client just concatenates `delta.content`)
 * - Tool-call handling (Tier 2; this client carries tools through but
 *   does not execute them)
 * - Telemetry persistence (Tier 3; this client surfaces tokens/model and
 *   the provider layer forwards them to the pipeline events)
 *
 * No new dependencies: uses native Node 22 fetch + ReadableStream.
 */

import {
  OPENROUTER_API_BASE,
  OPENROUTER_BACKOFF_BASE_MS,
  OPENROUTER_BACKOFF_MAX_MS,
  OPENROUTER_MAX_HTTP_RETRIES,
  OPENROUTER_REQUEST_TIMEOUT_MS,
} from '@shipcode/shared';
import type { TerminalEvent } from '../terminal-events';

// === Public types ===

export interface OpenRouterChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenRouterToolCall[];
}

export interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenRouterTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenRouterChatRequest {
  model: string;
  messages: OpenRouterChatMessage[];
  tools?: OpenRouterTool[];
  /** If true, stream the response via SSE. Tier 1 always uses true. */
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  /** Enable reasoning/thinking tokens from supported models. */
  include_reasoning?: boolean;
  /** Reasoning effort configuration. */
  reasoning?: { effort?: 'low' | 'medium' | 'high' };
}

export interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenRouterChatResult {
  /** Concatenated assistant text content across all deltas. */
  content: string;
  /**
   * Tool calls emitted by the model. For Tier 1 these should be empty;
   * Tier 2 populates them.
   */
  toolCalls: OpenRouterToolCall[];
  /**
   * The finish_reason from the final delta. 'stop' = clean end,
   * 'tool_calls' = model wants to call tools (Tier 2), 'length' = ran
   * out of tokens, others may appear per provider.
   */
  finishReason: string | null;
  /** What model actually served this (for openrouter/auto transparency). */
  model: string | null;
  /** Token usage totals from the final chunk's `usage` field, if provided. */
  usage: OpenRouterUsage | null;
}

export type OpenRouterErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'not_found'
  | 'aborted'
  | 'unknown';

export class OpenRouterError extends Error {
  constructor(
    public readonly kind: OpenRouterErrorKind,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

export interface OpenRouterClientOptions {
  apiKey: string;
  /** Base URL override — mostly for tests. Defaults to OPENROUTER_API_BASE. */
  baseUrl?: string;
  /** Referer sent in HTTP-Referer header. Helps OpenRouter attribute usage. */
  referer?: string;
  /** X-Title header value. Identifies the client to OpenRouter dashboards. */
  title?: string;
}

// === Client ===

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly referer: string;
  private readonly title: string;

  constructor(opts: OpenRouterClientOptions) {
    if (!opts.apiKey) throw new Error('OpenRouterClient: apiKey is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? OPENROUTER_API_BASE;
    this.referer = opts.referer ?? 'https://github.com/shipshitdev/shipcode';
    this.title = opts.title ?? 'ShipCode';
  }

  /**
   * Perform a chat completion with SSE streaming. Returns the
   * concatenated result + any tool calls emitted.
   */
  async chat(
    req: OpenRouterChatRequest,
    signal: AbortSignal,
    onDelta?: (event: TerminalEvent) => void,
  ): Promise<OpenRouterChatResult> {
    const body = { ...req, stream: req.stream !== false };

    let lastError: OpenRouterError | null = null;
    for (let attempt = 0; attempt <= OPENROUTER_MAX_HTTP_RETRIES; attempt++) {
      if (signal.aborted) {
        throw new OpenRouterError('aborted', 'request aborted', false);
      }

      try {
        return await this.chatOnce(body, signal, onDelta);
      } catch (err) {
        if (!(err instanceof OpenRouterError)) {
          // Unknown error — wrap and do not retry.
          throw new OpenRouterError(
            'unknown',
            err instanceof Error ? err.message : String(err),
            false,
          );
        }

        lastError = err;

        if (!err.retryable) throw err;
        if (attempt >= OPENROUTER_MAX_HTTP_RETRIES) throw err;

        // Compute backoff. Honor Retry-After if present on the error's
        // carrier, otherwise exponential with jitter capped at BACKOFF_MAX.
        // Route through `_internals` so tests can mock the sleep hop.
        const backoffMs = _internals.computeBackoffMs(attempt, err);
        await _internals.sleep(backoffMs, signal);
      }
    }

    // Unreachable because the loop either returns or throws, but TS
    // doesn't know that.
    throw lastError ?? new OpenRouterError('unknown', 'exhausted retries', false);
  }

  private async chatOnce(
    body: OpenRouterChatRequest,
    signal: AbortSignal,
    onDelta?: (event: TerminalEvent) => void,
  ): Promise<OpenRouterChatResult> {
    // Race the fetch against an absolute request timeout while also
    // honoring the outer cancellation signal.
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), OPENROUTER_REQUEST_TIMEOUT_MS);

    const combinedSignal = anySignal([signal, timeoutController.signal]);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': this.referer,
          'X-Title': this.title,
          Accept: body.stream ? 'text/event-stream' : 'application/json',
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (signal.aborted) throw new OpenRouterError('aborted', 'request aborted', false);
      if (timeoutController.signal.aborted) {
        throw new OpenRouterError('network', 'request timeout', true);
      }
      throw new OpenRouterError(
        'network',
        err instanceof Error ? err.message : 'fetch failed',
        true,
      );
    }

    // Error status handling BEFORE streaming the body, so we can classify
    // auth/rate-limit/not-found cleanly and attach Retry-After.
    if (!response.ok) {
      clearTimeout(timeoutId);
      return await this.handleErrorResponse(response);
    }

    try {
      if (body.stream) {
        return await this.consumeSseStream(response, signal, onDelta);
      }
      return await this.consumeJsonResponse(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {}

    const status = response.status;
    const retryAfterHeader = response.headers.get('Retry-After');

    if (status === 401 || status === 403) {
      throw new OpenRouterError(
        'auth',
        `OpenRouter auth failed: ${bodyText || status}`,
        false,
        status,
      );
    }
    if (status === 404) {
      throw new OpenRouterError(
        'not_found',
        `OpenRouter 404: ${bodyText || 'not found'}`,
        false,
        status,
      );
    }
    if (status === 429) {
      const err = new OpenRouterError(
        'rate_limit',
        `OpenRouter rate limit: ${bodyText}`,
        true,
        status,
      );
      if (retryAfterHeader)
        (err as unknown as { retryAfterMs: number }).retryAfterMs =
          parseRetryAfter(retryAfterHeader);
      throw err;
    }
    if (status >= 500 && status < 600) {
      throw new OpenRouterError('network', `OpenRouter ${status}: ${bodyText}`, true, status);
    }
    throw new OpenRouterError('unknown', `OpenRouter ${status}: ${bodyText}`, false, status);
  }

  private async consumeJsonResponse(response: Response): Promise<OpenRouterChatResult> {
    const payload = (await response.json()) as {
      choices: Array<{
        message: { content: string | null; tool_calls?: OpenRouterToolCall[] };
        finish_reason: string | null;
      }>;
      model?: string;
      usage?: OpenRouterUsage;
    };
    const choice = payload.choices[0];
    return {
      content: choice?.message?.content ?? '',
      toolCalls: choice?.message?.tool_calls ?? [],
      finishReason: choice?.finish_reason ?? null,
      model: payload.model ?? null,
      usage: payload.usage ?? null,
    };
  }

  /**
   * Read the SSE stream, dispatch one event per `data: {...}` frame, and
   * assemble the final message from delta content + tool-call fragments.
   *
   * Survives arbitrary byte-boundary splits: the decoder + line-buffer
   * works on whatever chunks the reader produces.
   */
  private async consumeSseStream(
    response: Response,
    signal: AbortSignal,
    onDelta?: (event: TerminalEvent) => void,
  ): Promise<OpenRouterChatResult> {
    if (!response.body) {
      throw new OpenRouterError('network', 'OpenRouter response has no body', false);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let lineBuffer = '';

    let content = '';
    const toolCallsById = new Map<number, OpenRouterToolCall>();
    let finishReason: string | null = null;
    let model: string | null = null;
    let usage: OpenRouterUsage | null = null;

    const onAbort = () => {
      reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });

        // Process complete lines; SSE frames are line-delimited by \n\n
        // but we read line-by-line and use blank-line as frame terminator.
        let newlineIdx: number;
        while ((newlineIdx = lineBuffer.indexOf('\n')) !== -1) {
          const line = lineBuffer.slice(0, newlineIdx).replace(/\r$/, '');
          lineBuffer = lineBuffer.slice(newlineIdx + 1);

          // Empty line = frame terminator. We don't buffer multi-line
          // events; OpenRouter only sends single-line `data:` frames.
          if (line === '') continue;

          // Ignore SSE event names, comments, and keep-alives.
          if (!line.startsWith('data:')) continue;

          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            // Stream terminator. Drain any remaining bytes and finish.
            signal.removeEventListener('abort', onAbort);
            onDelta?.({
              kind: 'done',
              totalTokens: usage
                ? { prompt: usage.prompt_tokens, completion: usage.completion_tokens }
                : undefined,
            });
            return {
              content,
              toolCalls: collectToolCalls(toolCallsById),
              finishReason,
              model,
              usage,
            };
          }

          let frame: SseFrame;
          try {
            frame = JSON.parse(payload) as SseFrame;
          } catch {
            // Malformed frame — skip it rather than tear down the stream.
            continue;
          }

          if (frame.model && !model) model = frame.model;
          if (frame.usage) usage = frame.usage;

          const choice = frame.choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;

          const delta = choice.delta;
          if (!delta) continue;

          if (typeof delta.reasoning === 'string' && delta.reasoning) {
            onDelta?.({ kind: 'thinking', content: delta.reasoning });
          }

          if (typeof delta.content === 'string') {
            content += delta.content;
            if (delta.content) {
              onDelta?.({ kind: 'text', content: delta.content });
            }
          }

          if (delta.tool_calls) {
            for (const partial of delta.tool_calls) {
              const idx = partial.index;
              const existing = toolCallsById.get(idx) ?? {
                id: partial.id ?? '',
                type: 'function' as const,
                function: { name: '', arguments: '' },
              };
              if (partial.id) existing.id = partial.id;
              if (partial.function?.name) existing.function.name += partial.function.name;
              if (partial.function?.arguments)
                existing.function.arguments += partial.function.arguments;
              toolCallsById.set(idx, existing);
            }
          }
        }
      }

      // If the reader finished because we cancelled it in response to
      // an abort, surface that as an aborted error rather than returning
      // the partial content as a "successful" response.
      if (signal.aborted) {
        throw new OpenRouterError('aborted', 'stream aborted', false);
      }
      // Stream ended without [DONE] sentinel. Accept what we have.
      return { content, toolCalls: collectToolCalls(toolCallsById), finishReason, model, usage };
    } catch (err) {
      if (signal.aborted) {
        throw new OpenRouterError('aborted', 'stream aborted', false);
      }
      if (err instanceof OpenRouterError) throw err;
      throw new OpenRouterError(
        'network',
        err instanceof Error ? err.message : 'stream read failed',
        true,
      );
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

// === Helpers ===

interface SseFrame {
  id?: string;
  model?: string;
  usage?: OpenRouterUsage;
  choices?: Array<{
    index: number;
    finish_reason: string | null;
    delta?: {
      role?: string;
      content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

function collectToolCalls(map: Map<number, OpenRouterToolCall>): OpenRouterToolCall[] {
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

function computeBackoffMs(attempt: number, err: OpenRouterError): number {
  const retryAfterMs = (err as unknown as { retryAfterMs?: number }).retryAfterMs;
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return Math.min(retryAfterMs, OPENROUTER_BACKOFF_MAX_MS);
  }
  const base = OPENROUTER_BACKOFF_BASE_MS * 2 ** attempt;
  const jitter = Math.random() * base * 0.25;
  return Math.min(base + jitter, OPENROUTER_BACKOFF_MAX_MS);
}

/**
 * Parse a Retry-After header value. Supports both delta-seconds and HTTP-date.
 */
function parseRetryAfter(raw: string): number {
  const asInt = parseInt(raw, 10);
  if (!Number.isNaN(asInt)) return asInt * 1000;
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    const delta = asDate - Date.now();
    return delta > 0 ? delta : 0;
  }
  return 0;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new OpenRouterError('aborted', 'aborted during backoff', false));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new OpenRouterError('aborted', 'aborted during backoff', false));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Combine multiple abort signals into one. Fires when any input fires.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort();
      return controller.signal;
    }
    sig.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

// Exported for unit testing
export const _internals = {
  computeBackoffMs,
  parseRetryAfter,
  sleep,
  anySignal,
};
