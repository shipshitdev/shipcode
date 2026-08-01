import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SHELL_ALLOWLIST } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalEvent } from '../terminal-events';
import { getAllToolNames } from '../tools/registry';
import {
  EXECUTE_SYSTEM_PROMPT,
  executeViaOpenRouter,
  OPENROUTER_EXECUTE_TOOLS,
} from './openrouter-execute';
import {
  type OpenRouterChatResult,
  type OpenRouterClient,
  OpenRouterError,
  type OpenRouterToolCall,
} from './openrouter-http';
import { PHASE_TOOL_POLICIES, type ProviderRequest } from './types';

const mockAssertWorkspaceSafe = vi.hoisted(() => vi.fn());

vi.mock('@shipcode/shared/worktree-path', () => ({
  assertWorkspaceSafe: mockAssertWorkspaceSafe,
}));

/**
 * Build a scripted OpenRouterClient that returns a predetermined
 * sequence of responses across successive .chat() calls. This lets
 * tests simulate multi-turn tool-call conversations without real HTTP.
 */
function scriptedClient(turns: Partial<OpenRouterChatResult>[]): OpenRouterClient {
  let turnIdx = 0;
  return {
    chat: vi.fn(async () => {
      const turn = turns[turnIdx++] ?? { content: '', toolCalls: [], finishReason: 'stop' };
      return {
        content: '',
        toolCalls: [],
        finishReason: 'stop',
        model: 'openrouter/auto',
        usage: null,
        ...turn,
      } as OpenRouterChatResult;
    }),
  } as unknown as OpenRouterClient;
}

function toolCall(id: string, name: string, args: Record<string, unknown>): OpenRouterToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

function req(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    phase: 'execute',
    prompt: 'do the plan',
    cwd: '/tmp/worktree-placeholder',
    projectPath: '/tmp/project-placeholder',
    workspaceRoot: null,
    signal: new AbortController().signal,
    threadId: 't1',
    ...overrides,
  };
}

let wt: string;

beforeEach(async () => {
  mockAssertWorkspaceSafe.mockReset();
  wt = await fs.mkdtemp(path.join(os.tmpdir(), 'shipcode-execute-'));
  await fs.writeFile(path.join(wt, 'target.txt'), 'hello world\n', 'utf-8');
});

afterEach(async () => {
  await fs.rm(wt, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('executeViaOpenRouter', () => {
  // ─── Defense-in-depth: worktree safety ────────────────────────────

  it('refuses to run when cwd equals projectPath', async () => {
    const client = scriptedClient([]);
    const res = await executeViaOpenRouter(req({ cwd: '/tmp/proj', projectPath: '/tmp/proj' }), {
      client,
      model: 'openrouter/auto',
    });
    expect(res.exitCode).toBe(1);
    expect(res.providerError?.kind).toBe('unexpected_stop');
    expect(res.providerError?.message).toMatch(/worktree/i);
  });

  it('refuses to run when cwd is empty', async () => {
    const client = scriptedClient([]);
    const res = await executeViaOpenRouter(req({ cwd: '', projectPath: '/tmp/proj' }), {
      client,
      model: 'openrouter/auto',
    });
    expect(res.exitCode).toBe(1);
  });

  it('refuses to run when the workspace identity guard fails', async () => {
    mockAssertWorkspaceSafe.mockImplementationOnce(() => {
      throw new Error('workspacePath belongs to a foreign Git repository');
    });
    const res = await executeViaOpenRouter(req({ cwd: wt }), {
      client: scriptedClient([]),
      model: 'openrouter/auto',
    });

    expect(res.exitCode).toBe(1);
    expect(res.providerError).toMatchObject({
      kind: 'unexpected_stop',
      retryable: false,
      message: 'workspacePath belongs to a foreign Git repository',
    });
  });

  // ─── Happy path: tool calls + stop ────────────────────────────────

  it('executes tool calls, then returns success when the model stops', async () => {
    const client = scriptedClient([
      // Turn 1: edit the target file
      {
        toolCalls: [
          toolCall('c1', 'edit', { path: 'target.txt', oldString: 'hello', newString: 'bonjour' }),
        ],
        finishReason: 'tool_calls',
      },
      // Turn 2: stop with a confirmation message
      { content: 'Done.', finishReason: 'stop' },
    ]);

    const res = await executeViaOpenRouter(req({ cwd: wt }), { client, model: 'openrouter/auto' });

    expect(res.exitCode).toBe(0);
    expect(res.rawOutput).toBe('Done.');
    expect(res.resolvedModel).toBe('openrouter/auto');

    // Verify the edit actually happened
    const after = await fs.readFile(path.join(wt, 'target.txt'), 'utf-8');
    expect(after).toBe('bonjour world\n');
  });

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
    ]);

    const res = await executeViaOpenRouter(req({ cwd: wt }), { client, model: 'openrouter/auto' });

    expect(res.exitCode).toBe(0);
    expect(res.tokensUsed).toEqual({ prompt: 300, completion: 80 });
  });

  it('emits successful tool summaries to the terminal stream', async () => {
    const client = scriptedClient([
      {
        toolCalls: [toolCall('c1', 'read', { path: 'target.txt' })],
        finishReason: 'tool_calls',
      },
      { content: 'ok', finishReason: 'stop' },
    ]);
    const events: TerminalEvent[] = [];

    const res = await executeViaOpenRouter(req({ cwd: wt }), {
      client,
      model: 'openrouter/auto',
      onTerminalEvent: (event) => events.push(event),
    });

    expect(res.exitCode).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'tool_start', name: 'read', summary: 'read' }),
    );
    expect(events).toContainEqual(expect.objectContaining({ kind: 'tool_end', name: 'read' }));
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'done', totalTokens: { prompt: 0, completion: 0 } }),
    );
  });

  it('blocks GitHub GraphQL tools during execute and emits per-turn token usage', async () => {
    const client = scriptedClient([
      {
        toolCalls: [
          toolCall('c1', 'github_graphql', {
            query: 'query { viewer { login } }',
            variables: {},
          }),
        ],
        finishReason: 'tool_calls',
        model: null,
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      },
      { content: 'ok', finishReason: 'stop' },
    ]);
    const events: TerminalEvent[] = [];
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { viewer: { login: 'octocat' } } }),
    })) as unknown as typeof globalThis.fetch;

    const res = await executeViaOpenRouter(
      req({
        cwd: wt,
        githubGraphql: {
          getToken: async () => 'ghp_test',
          fetch,
        },
      }),
      {
        client,
        model: 'openrouter/auto',
        onTerminalEvent: (event) => events.push(event),
      },
    );

    expect(res.exitCode).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'turn_end',
        turn: 1,
        tokensUsed: { prompt: 4, completion: 2 },
      }),
    );
  });

  it('emits failed tool summaries to the terminal stream', async () => {
    const client = scriptedClient([
      {
        toolCalls: [toolCall('c1', 'notatool', {})],
        finishReason: 'tool_calls',
      },
      { content: 'Done.', finishReason: 'stop' },
    ]);
    const events: TerminalEvent[] = [];

    const res = await executeViaOpenRouter(req({ cwd: wt }), {
      client,
      model: 'openrouter/auto',
      onTerminalEvent: (event) => events.push(event),
    });

    expect(res.exitCode).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'tool_end',
        name: 'notatool',
        exitCode: 1,
        outputSummary: "tool 'notatool' is not allowed in this phase",
      }),
    );
  });

  it('forwards reasoning effort into execute chat requests', async () => {
    const chat = vi.fn(async () => ({
      content: 'ok',
      toolCalls: [toolCall('c1', 'read', { path: 'target.txt' })],
      finishReason: 'tool_calls',
      model: 'openrouter/auto',
      usage: null,
    }));
    const client = { chat } as unknown as OpenRouterClient;

    await executeViaOpenRouter(req({ cwd: wt, phaseHints: { reasoningEffort: 'xhigh' } }), {
      client,
      model: 'openrouter/auto',
    });

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: { effort: 'xhigh' },
      }),
      expect.anything(),
    );
  });

  // ─── Unexpected-stop: 0 tool calls ────────────────────────────────

  it('treats finish_reason=stop with ZERO tool calls as a retryable failure', async () => {
    const client = scriptedClient([{ content: 'I cannot do this task', finishReason: 'stop' }]);

    const res = await executeViaOpenRouter(req({ cwd: wt }), { client, model: 'openrouter/auto' });

    expect(res.exitCode).toBe(1);
    expect(res.providerError?.kind).toBe('unexpected_stop');
    expect(res.providerError?.retryable).toBe(true);
    expect(res.providerError?.message).toMatch(/stopped without executing any tools/);
  });

  // ─── Unexpected finish_reason ─────────────────────────────────────

  it('treats finish_reason=length as a non-retryable failure', async () => {
    const client = scriptedClient([{ content: '', finishReason: 'length' }]);

    const res = await executeViaOpenRouter(req({ cwd: wt }), { client, model: 'openrouter/auto' });

    expect(res.exitCode).toBe(1);
    expect(res.providerError?.kind).toBe('unexpected_stop');
    expect(res.providerError?.retryable).toBe(false);
  });

  it('treats null finish_reason as a non-retryable unexpected stop', async () => {
    const client = scriptedClient([{ content: 'partial', finishReason: null }]);

    const res = await executeViaOpenRouter(req({ cwd: wt }), { client, model: 'openrouter/auto' });

    expect(res.exitCode).toBe(1);
    expect(res.providerError?.message).toMatch(/unexpected reason: null/);
  });

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
    }));
    const client = scriptedClient(turns);

    const res = await executeViaOpenRouter(req({ cwd: wt }), { client, model: 'openrouter/auto' });

    expect(res.exitCode).toBe(1);
    expect(res.providerError?.kind).toBe('tool_loop_overflow');
    expect(res.providerError?.message).toMatch(/MAX_TOOL_CALL_ITERATIONS/);
  });

  // ─── Token cap ────────────────────────────────────────────────────

  it('fires tool_loop_overflow when exceeding MAX_EXECUTE_TOTAL_TOKENS', async () => {
    const client = scriptedClient([
      {
        toolCalls: [toolCall('c1', 'read', { path: 'target.txt' })],
        finishReason: 'tool_calls',
        usage: { prompt_tokens: 600_000, completion_tokens: 0, total_tokens: 600_000 },
      },
    ]);

    const res = await executeViaOpenRouter(req({ cwd: wt }), { client, model: 'openrouter/auto' });

    expect(res.exitCode).toBe(1);
    expect(res.providerError?.kind).toBe('tool_loop_overflow');
    expect(res.providerError?.message).toMatch(/MAX_EXECUTE_TOTAL_TOKENS/);
  });

  // ─── Duplicate-call detection ─────────────────────────────────────

  it('fires duplicate-call guard when the same (tool,args) repeats', async () => {
    // 3 identical calls in a row should trip MAX_DUPLICATE_TOOL_CALLS.
    const dupArgs = { path: 'target.txt' };
    const client = scriptedClient([
      { toolCalls: [toolCall('c1', 'read', dupArgs)], finishReason: 'tool_calls' },
      { toolCalls: [toolCall('c2', 'read', dupArgs)], finishReason: 'tool_calls' },
      { toolCalls: [toolCall('c3', 'read', dupArgs)], finishReason: 'tool_calls' },
    ]);

    const res = await executeViaOpenRouter(req({ cwd: wt }), { client, model: 'openrouter/auto' });

    expect(res.exitCode).toBe(1);
    expect(res.providerError?.kind).toBe('tool_loop_overflow');
    expect(res.providerError?.message).toMatch(/duplicate/i);
    expect(res.providerError?.retryable).toBe(true);
  });

  it('does NOT fire the duplicate guard when tool or args differ', async () => {
    const client = scriptedClient([
      { toolCalls: [toolCall('c1', 'read', { path: 'target.txt' })], finishReason: 'tool_calls' },
      { toolCalls: [toolCall('c2', 'glob', { pattern: '*.txt' })], finishReason: 'tool_calls' },
      { toolCalls: [toolCall('c3', 'read', { path: 'target.txt' })], finishReason: 'tool_calls' },
      { content: 'done', finishReason: 'stop' },
    ]);

    const res = await executeViaOpenRouter(req({ cwd: wt }), { client, model: 'openrouter/auto' });

    expect(res.exitCode).toBe(0);
  });

  // ─── Abort ────────────────────────────────────────────────────────

  it('returns aborted error when signal fires pre-start', async () => {
    const abort = new AbortController();
    abort.abort();
    const client = scriptedClient([]);
    const res = await executeViaOpenRouter(req({ cwd: wt, signal: abort.signal }), {
      client,
      model: 'openrouter/auto',
    });
    expect(res.exitCode).toBe(1);
    expect(res.providerError?.kind).toBe('aborted');
  });

  it('returns aborted with accumulated tokens when the signal fires between turns', async () => {
    const abort = new AbortController();
    const chat = vi.fn(async () => {
      abort.abort();
      return {
        content: '',
        toolCalls: [toolCall('c1', 'read', { path: 'target.txt' })],
        finishReason: 'tool_calls',
        model: 'anthropic/claude-sonnet-4.6',
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      } satisfies OpenRouterChatResult;
    });
    const client = { chat } as unknown as OpenRouterClient;

    const res = await executeViaOpenRouter(req({ cwd: wt, signal: abort.signal }), {
      client,
      model: 'openrouter/auto',
    });

    expect(res.providerError?.kind).toBe('aborted');
    expect(res.resolvedModel).toBe('anthropic/claude-sonnet-4.6');
    expect(res.tokensUsed).toEqual({ prompt: 7, completion: 3 });
  });

  it('maps OpenRouter and unknown client failures to provider errors', async () => {
    const openRouterFailure = {
      chat: vi.fn(async () => {
        throw new OpenRouterError('rate_limit', 'slow down', true);
      }),
    } as unknown as OpenRouterClient;

    const rateLimited = await executeViaOpenRouter(req({ cwd: wt }), {
      client: openRouterFailure,
      model: 'openrouter/auto',
    });
    expect(rateLimited.providerError).toEqual({
      kind: 'rate_limit',
      message: 'slow down',
      retryable: true,
    });
    expect(rateLimited.tokensUsed).toEqual({ prompt: 0, completion: 0 });

    const genericFailure = {
      chat: vi.fn(async () => {
        throw new Error('boom');
      }),
    } as unknown as OpenRouterClient;

    const unknown = await executeViaOpenRouter(req({ cwd: wt }), {
      client: genericFailure,
      model: 'openrouter/auto',
    });
    expect(unknown.providerError).toEqual({
      kind: 'unknown',
      message: 'boom',
      retryable: false,
    });

    const plainFailure = {
      chat: vi.fn(async () => {
        throw 'plain boom';
      }),
    } as unknown as OpenRouterClient;

    const plain = await executeViaOpenRouter(req({ cwd: wt }), {
      client: plainFailure,
      model: 'openrouter/auto',
    });
    expect(plain.providerError).toEqual({
      kind: 'unknown',
      message: 'plain boom',
      retryable: false,
    });
  });

  // ─── shell: read-only inspection is actually reachable ────────────

  it('runs an allowlisted read-only shell command inside the worktree', async () => {
    const client = scriptedClient([
      {
        toolCalls: [toolCall('c1', 'shell', { command: 'ls', args: ['-1'] })],
        finishReason: 'tool_calls',
      },
      { content: 'listed', finishReason: 'stop' },
    ]);
    const events: TerminalEvent[] = [];

    const res = await executeViaOpenRouter(req({ cwd: wt }), {
      client,
      model: 'openrouter/auto',
      onTerminalEvent: (event) => events.push(event),
    });

    expect(res.exitCode).toBe(0);
    const shellEnd = events.find(
      (event): event is Extract<TerminalEvent, { kind: 'tool_end' }> =>
        event.kind === 'tool_end' && event.name === 'shell',
    );
    // tool_end carries exitCode/outputSummary only on failure, so their
    // absence means the command actually ran rather than being rejected as
    // a tool this phase does not expose.
    expect(shellEnd).toBeDefined();
    expect(shellEnd).not.toHaveProperty('exitCode');
    expect(shellEnd).not.toHaveProperty('outputSummary');
  });

  it('still rejects mutating git subcommands through the shell tool', async () => {
    const client = scriptedClient([
      {
        toolCalls: [toolCall('c1', 'shell', { command: 'git', args: ['push'] })],
        finishReason: 'tool_calls',
      },
      { content: 'blocked', finishReason: 'stop' },
    ]);
    const events: TerminalEvent[] = [];

    const res = await executeViaOpenRouter(req({ cwd: wt }), {
      client,
      model: 'openrouter/auto',
      onTerminalEvent: (event) => events.push(event),
    });

    expect(res.exitCode).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'tool_end',
        name: 'shell',
        exitCode: 1,
        outputSummary: expect.stringContaining('not in the read-only allowlist'),
      }),
    );
  });
});

// ─── Prompt / allowlist drift guard ─────────────────────────────────
//
// The original bug: the system prompt advertised `shell` while the phase
// allowlist omitted it, so every shell call was rejected — burning loop
// iterations, or worse, tempting the model to narrate output it never got.
// The prompt is now derived from OPENROUTER_EXECUTE_TOOLS; these tests fail
// if anyone reintroduces a hardcoded tool name in the prose.

describe('EXECUTE_SYSTEM_PROMPT', () => {
  it('names no tool the phase allowlist withholds', () => {
    const named = getAllToolNames().filter((name) =>
      new RegExp(`\\b${name}\\b`).test(EXECUTE_SYSTEM_PROMPT),
    );
    const withheld = named.filter((name) => !OPENROUTER_EXECUTE_TOOLS.has(name));

    expect(withheld).toEqual([]);
    // Sanity check that the regex scan actually finds anything at all —
    // otherwise an empty `withheld` would prove nothing.
    expect(named.length).toBeGreaterThan(0);
  });

  it('names every tool the phase allowlist grants', () => {
    for (const name of OPENROUTER_EXECUTE_TOOLS) {
      expect(EXECUTE_SYSTEM_PROMPT).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it('exposes the same capability surface as the claude/codex execute phase', () => {
    // PHASE_TOOL_POLICIES.execute grants Bash; `shell` is its read-only
    // counterpart here. Drops of either side should be deliberate.
    expect(OPENROUTER_EXECUTE_TOOLS.has('shell')).toBe(true);
    expect(PHASE_TOOL_POLICIES.execute.allowedTools).toContain('Bash');
  });

  it('does not claim shell can run tests or typechecks', () => {
    // SHELL_ALLOWLIST has no interpreters or package managers, so those runs
    // belong to the VERIFY phase. Promising them here produced fabrications.
    expect(EXECUTE_SYSTEM_PROMPT).toContain(SHELL_ALLOWLIST.join(', '));
    expect(EXECUTE_SYSTEM_PROMPT).toMatch(/no way to\s+run test runners/);
  });
});
