import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { executeViaOpenRouter } from './openrouter-execute'
import type { OpenRouterClient, OpenRouterChatResult, OpenRouterToolCall } from './openrouter-http'
import type { ProviderRequest } from './types'

/**
 * Build a scripted OpenRouterClient that returns a predetermined
 * sequence of responses across successive .chat() calls. This lets
 * tests simulate multi-turn tool-call conversations without real HTTP.
 */
function scriptedClient(turns: Partial<OpenRouterChatResult>[]): OpenRouterClient {
  let turnIdx = 0
  return {
    chat: vi.fn(async () => {
      const turn = turns[turnIdx++] ?? { content: '', toolCalls: [], finishReason: 'stop' }
      return {
        content: '',
        toolCalls: [],
        finishReason: 'stop',
        model: 'openrouter/auto',
        usage: null,
        ...turn,
      } as OpenRouterChatResult
    }),
  } as unknown as OpenRouterClient
}

function toolCall(id: string, name: string, args: Record<string, unknown>): OpenRouterToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

function req(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    phase: 'execute',
    prompt: 'do the plan',
    cwd: '/tmp/worktree-placeholder',
    projectPath: '/tmp/project-placeholder',
    signal: new AbortController().signal,
    threadId: 't1',
    ...overrides,
  }
}

let wt: string

beforeEach(async () => {
  wt = await fs.mkdtemp(path.join(os.tmpdir(), 'shipcode-execute-'))
  await fs.writeFile(path.join(wt, 'target.txt'), 'hello world\n', 'utf-8')
})

afterEach(async () => {
  await fs.rm(wt, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('executeViaOpenRouter', () => {
  // ─── Defense-in-depth: worktree safety ────────────────────────────

  it('refuses to run when cwd equals projectPath', async () => {
    const client = scriptedClient([])
    const res = await executeViaOpenRouter(
      req({ cwd: '/tmp/proj', projectPath: '/tmp/proj' }),
      { client, model: 'openrouter/auto' },
    )
    expect(res.exitCode).toBe(1)
    expect(res.providerError?.kind).toBe('unexpected_stop')
    expect(res.providerError?.message).toMatch(/worktree/i)
  })

  it('refuses to run when cwd is empty', async () => {
    const client = scriptedClient([])
    const res = await executeViaOpenRouter(
      req({ cwd: '', projectPath: '/tmp/proj' }),
      { client, model: 'openrouter/auto' },
    )
    expect(res.exitCode).toBe(1)
  })

  // ─── Happy path: tool calls + stop ────────────────────────────────

  it('executes tool calls, then returns success when the model stops', async () => {
    const client = scriptedClient([
      // Turn 1: edit the target file
      {
        toolCalls: [toolCall('c1', 'edit', { path: 'target.txt', oldString: 'hello', newString: 'bonjour' })],
        finishReason: 'tool_calls',
      },
      // Turn 2: stop with a confirmation message
      { content: 'Done.', finishReason: 'stop' },
    ])

    const res = await executeViaOpenRouter(
      req({ cwd: wt }),
      { client, model: 'openrouter/auto' },
    )

    expect(res.exitCode).toBe(0)
    expect(res.rawOutput).toBe('Done.')
    expect(res.resolvedModel).toBe('openrouter/auto')

    // Verify the edit actually happened
    const after = await fs.readFile(path.join(wt, 'target.txt'), 'utf-8')
    expect(after).toBe('bonjour world\n')
  })

  it('accumulates token usage across turns', async () => {
    const client = scriptedClient([
      {
        toolCalls: [toolCall('c1', 'read', { path: 'target.txt' })],
        finishReason: 'tool_calls',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      },
      {
        content: 'ok',
        finishReason: 'stop',
        usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 },
      },
    ])

    const res = await executeViaOpenRouter(
      req({ cwd: wt }),
      { client, model: 'openrouter/auto' },
    )

    expect(res.exitCode).toBe(0)
    expect(res.tokensUsed).toEqual({ prompt: 300, completion: 80 })
  })

  // ─── Unexpected-stop: 0 tool calls ────────────────────────────────

  it('treats finish_reason=stop with ZERO tool calls as a retryable failure', async () => {
    const client = scriptedClient([
      { content: 'I cannot do this task', finishReason: 'stop' },
    ])

    const res = await executeViaOpenRouter(
      req({ cwd: wt }),
      { client, model: 'openrouter/auto' },
    )

    expect(res.exitCode).toBe(1)
    expect(res.providerError?.kind).toBe('unexpected_stop')
    expect(res.providerError?.retryable).toBe(true)
    expect(res.providerError?.message).toMatch(/stopped without executing any tools/)
  })

  // ─── Unexpected finish_reason ─────────────────────────────────────

  it('treats finish_reason=length as a non-retryable failure', async () => {
    const client = scriptedClient([
      { content: '', finishReason: 'length' },
    ])

    const res = await executeViaOpenRouter(
      req({ cwd: wt }),
      { client, model: 'openrouter/auto' },
    )

    expect(res.exitCode).toBe(1)
    expect(res.providerError?.kind).toBe('unexpected_stop')
    expect(res.providerError?.retryable).toBe(false)
  })

  // ─── Iteration cap ────────────────────────────────────────────────

  it('fires tool_loop_overflow when exceeding MAX_TOOL_CALL_ITERATIONS', async () => {
    // Build 35 turns that each call a tool but never stop.
    // MAX_TOOL_CALL_ITERATIONS = 30, so the loop should abort before turn 30.
    //
    // Alternate the tool and offset so the duplicate-call guard does
    // not fire first (that would mask the iteration cap we're testing).
    const turns = Array.from({ length: 35 }, (_, i) => ({
      toolCalls: [
        toolCall(
          `c${i}`,
          i % 2 === 0 ? 'read' : 'glob',
          i % 2 === 0 ? { path: 'target.txt', offset: i + 1 } : { pattern: `*.${i}` },
        ),
      ],
      finishReason: 'tool_calls' as const,
    }))
    const client = scriptedClient(turns)

    const res = await executeViaOpenRouter(
      req({ cwd: wt }),
      { client, model: 'openrouter/auto' },
    )

    expect(res.exitCode).toBe(1)
    expect(res.providerError?.kind).toBe('tool_loop_overflow')
    expect(res.providerError?.message).toMatch(/MAX_TOOL_CALL_ITERATIONS/)
  })

  // ─── Token cap ────────────────────────────────────────────────────

  it('fires tool_loop_overflow when exceeding MAX_EXECUTE_TOTAL_TOKENS', async () => {
    const client = scriptedClient([
      {
        toolCalls: [toolCall('c1', 'read', { path: 'target.txt' })],
        finishReason: 'tool_calls',
        usage: { prompt_tokens: 600_000, completion_tokens: 0, total_tokens: 600_000 },
      },
    ])

    const res = await executeViaOpenRouter(
      req({ cwd: wt }),
      { client, model: 'openrouter/auto' },
    )

    expect(res.exitCode).toBe(1)
    expect(res.providerError?.kind).toBe('tool_loop_overflow')
    expect(res.providerError?.message).toMatch(/MAX_EXECUTE_TOTAL_TOKENS/)
  })

  // ─── Duplicate-call detection ─────────────────────────────────────

  it('fires duplicate-call guard when the same (tool,args) repeats', async () => {
    // 3 identical calls in a row should trip MAX_DUPLICATE_TOOL_CALLS.
    const dupArgs = { path: 'target.txt' }
    const client = scriptedClient([
      { toolCalls: [toolCall('c1', 'read', dupArgs)], finishReason: 'tool_calls' },
      { toolCalls: [toolCall('c2', 'read', dupArgs)], finishReason: 'tool_calls' },
      { toolCalls: [toolCall('c3', 'read', dupArgs)], finishReason: 'tool_calls' },
    ])

    const res = await executeViaOpenRouter(
      req({ cwd: wt }),
      { client, model: 'openrouter/auto' },
    )

    expect(res.exitCode).toBe(1)
    expect(res.providerError?.kind).toBe('tool_loop_overflow')
    expect(res.providerError?.message).toMatch(/duplicate/i)
    expect(res.providerError?.retryable).toBe(true)
  })

  it('does NOT fire the duplicate guard when tool or args differ', async () => {
    const client = scriptedClient([
      { toolCalls: [toolCall('c1', 'read', { path: 'target.txt' })], finishReason: 'tool_calls' },
      { toolCalls: [toolCall('c2', 'glob', { pattern: '*.txt' })], finishReason: 'tool_calls' },
      { toolCalls: [toolCall('c3', 'read', { path: 'target.txt' })], finishReason: 'tool_calls' },
      { content: 'done', finishReason: 'stop' },
    ])

    const res = await executeViaOpenRouter(
      req({ cwd: wt }),
      { client, model: 'openrouter/auto' },
    )

    expect(res.exitCode).toBe(0)
  })

  // ─── Abort ────────────────────────────────────────────────────────

  it('returns aborted error when signal fires pre-start', async () => {
    const abort = new AbortController()
    abort.abort()
    const client = scriptedClient([])
    const res = await executeViaOpenRouter(
      req({ cwd: wt, signal: abort.signal }),
      { client, model: 'openrouter/auto' },
    )
    expect(res.exitCode).toBe(1)
    expect(res.providerError?.kind).toBe('network')
  })
})
