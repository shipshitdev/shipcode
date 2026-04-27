import { describe, expect, it, vi } from 'vitest';
import type { ProcessManager } from '../process-manager';
import { _internals, createClaudeCliProvider, createCodexCliProvider } from './cli-provider';
import type { ProviderRequest } from './types';

const { buildClaudeArgs, buildCodexArgs, buildCodexPrompt, stripCodexProtocol } = _internals;

// Base request helper — only the phase + prompt vary per test.
function req(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    phase: 'plan',
    prompt: 'PROMPT',
    cwd: '/tmp/wt',
    projectPath: '/tmp/proj',
    signal: new AbortController().signal,
    threadId: 't1',
    ...overrides,
  };
}

// ─── Arg-construction regression snapshots ────────────────────────────
// These lock the CLI provider to the exact arg lists that previously
// lived inline in packages/pipeline/src/pipeline.ts so the refactor
// stays behavior-preserving.

describe('buildClaudeArgs', () => {
  it('plan phase mirrors pipeline.ts:78', () => {
    expect(buildClaudeArgs(req({ phase: 'plan' }))).toEqual([
      '-p',
      'PROMPT',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '1',
      '--max-thinking-tokens',
      '32000',
      '--dangerously-skip-permissions',
      '--disallowedTools',
      'Edit,Write,Bash,NotebookEdit',
    ]);
  });

  it('revision phase mirrors pipeline.ts:253', () => {
    expect(buildClaudeArgs(req({ phase: 'revision' }))).toEqual([
      '-p',
      'PROMPT',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '1',
      '--max-thinking-tokens',
      '32000',
      '--dangerously-skip-permissions',
      '--disallowedTools',
      'Edit,Write,Bash,NotebookEdit',
    ]);
  });

  it('verify phase mirrors pipeline.ts:385', () => {
    expect(buildClaudeArgs(req({ phase: 'verify' }))).toEqual([
      '-p',
      'PROMPT',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '1',
      '--max-thinking-tokens',
      '32000',
      '--dangerously-skip-permissions',
      '--disallowedTools',
      'Edit,Write,Bash,NotebookEdit',
    ]);
  });

  it('execute phase mirrors pipeline.ts:300', () => {
    expect(buildClaudeArgs(req({ phase: 'execute' }))).toEqual([
      '-p',
      'PROMPT',
      '--allowedTools',
      'Edit,Write,Bash,Glob,Grep,Read',
      '--max-thinking-tokens',
      '32000',
      '--dangerously-skip-permissions',
    ]);
  });

  it('maps xhigh to the highest supported Claude thinking budget', () => {
    expect(
      buildClaudeArgs(req({ phase: 'plan', phaseHints: { reasoningEffort: 'xhigh' } })),
    ).toEqual([
      '-p',
      'PROMPT',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '1',
      '--max-thinking-tokens',
      '32000',
      '--dangerously-skip-permissions',
      '--disallowedTools',
      'Edit,Write,Bash,NotebookEdit',
    ]);
  });

  it('maps none to omitted Claude thinking tokens', () => {
    expect(
      buildClaudeArgs(req({ phase: 'plan', phaseHints: { reasoningEffort: 'none' } })),
    ).toEqual([
      '-p',
      'PROMPT',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '1',
      '--dangerously-skip-permissions',
      '--disallowedTools',
      'Edit,Write,Bash,NotebookEdit',
    ]);
  });
});

describe('buildCodexArgs', () => {
  // codex v0.120.0: top-level flags (-a, -c) BEFORE the `exec` subcommand;
  // subcommand flags (--sandbox, --json) AFTER the prompt.
  it('review phase (non-autonomous) puts -a never before exec', () => {
    expect(buildCodexArgs(req({ phase: 'review' }))).toEqual([
      '-a',
      'never',
      '-c',
      'model_reasoning_effort=high',
      'exec',
      expect.stringContaining('PROMPT'),
      '--sandbox',
      'read-only',
      '--json',
    ]);
  });

  it('review phase (autonomous) sets reasoning effort via -c model_reasoning_effort', () => {
    const args = buildCodexArgs(req({ phase: 'review', phaseHints: { reasoningEffort: 'high' } }));
    expect(args).toEqual([
      '-a',
      'never',
      '-c',
      'model_reasoning_effort=high',
      'exec',
      expect.stringContaining('PROMPT'),
      '--sandbox',
      'read-only',
      '--json',
    ]);
  });

  it('execute phase puts -a never before exec', () => {
    expect(buildCodexArgs(req({ phase: 'execute' }))).toEqual([
      '-a',
      'never',
      '-c',
      'model_reasoning_effort=high',
      'exec',
      'PROMPT',
      '--sandbox',
      'workspace-write',
      '--json',
    ]);
  });

  it('plan phase uses read-only sandbox', () => {
    expect(buildCodexArgs(req({ phase: 'plan' }))).toEqual([
      '-a',
      'never',
      '-c',
      'model_reasoning_effort=high',
      'exec',
      expect.stringContaining('PROMPT'),
      '--sandbox',
      'read-only',
      '--json',
    ]);
  });

  it('revision phase uses read-only sandbox', () => {
    expect(buildCodexArgs(req({ phase: 'revision' }))).toEqual([
      '-a',
      'never',
      '-c',
      'model_reasoning_effort=high',
      'exec',
      expect.stringContaining('PROMPT'),
      '--sandbox',
      'read-only',
      '--json',
    ]);
  });

  it('verify phase uses read-only sandbox', () => {
    expect(buildCodexArgs(req({ phase: 'verify' }))).toEqual([
      '-a',
      'never',
      '-c',
      'model_reasoning_effort=high',
      'exec',
      expect.stringContaining('PROMPT'),
      '--sandbox',
      'read-only',
      '--json',
    ]);
  });

  it('keeps xhigh exact for codex', () => {
    expect(
      buildCodexArgs(req({ phase: 'review', phaseHints: { reasoningEffort: 'xhigh' } })),
    ).toEqual([
      '-a',
      'never',
      '-c',
      'model_reasoning_effort=xhigh',
      'exec',
      expect.stringContaining('PROMPT'),
      '--sandbox',
      'read-only',
      '--json',
    ]);
  });

  it('keeps none exact for codex', () => {
    expect(
      buildCodexArgs(req({ phase: 'review', phaseHints: { reasoningEffort: 'none' } })),
    ).toEqual([
      '-a',
      'never',
      '-c',
      'model_reasoning_effort=none',
      'exec',
      expect.stringContaining('PROMPT'),
      '--sandbox',
      'read-only',
      '--json',
    ]);
  });
});

describe('buildCodexPrompt', () => {
  it('lets plan phase ground output in repo (read-only inspection allowed)', () => {
    const prompt = buildCodexPrompt(req({ phase: 'plan' }));

    expect(prompt).toContain('ShipCode structured-output mode');
    expect(prompt).toContain('You may read files in the working directory');
    expect(prompt).not.toContain('Do not run shell commands, inspect files, or use tools');
    expect(prompt).toContain('Return only the requested fenced shipcode-* JSON block');
    expect(prompt).toContain('PROMPT');
  });

  it('lets revision phase ground output in repo (read-only inspection allowed)', () => {
    const prompt = buildCodexPrompt(req({ phase: 'revision' }));

    expect(prompt).toContain('You may read files in the working directory');
    expect(prompt).not.toContain('Do not run shell commands, inspect files, or use tools');
  });

  it('keeps prompt-only guardrail for review phase', () => {
    const prompt = buildCodexPrompt(req({ phase: 'review' }));

    expect(prompt).toContain('Do not run shell commands, inspect files, or use tools');
    expect(prompt).toContain('Use only the prompt content below');
  });

  it('keeps prompt-only guardrail for verify phase', () => {
    const prompt = buildCodexPrompt(req({ phase: 'verify' }));

    expect(prompt).toContain('Do not run shell commands, inspect files, or use tools');
  });

  it('leaves execute prompts unchanged', () => {
    expect(buildCodexPrompt(req({ phase: 'execute' }))).toBe('PROMPT');
  });
});

describe('stripCodexProtocol', () => {
  it('can suppress command transcripts for structured phases', () => {
    const raw = [
      JSON.stringify({
        item: {
          type: 'command_execution',
          command: 'rg ENOENT',
          aggregated_output: 'throw new Error("ENOENT")',
          exit_code: 0,
        },
      }),
      JSON.stringify({
        item: {
          type: 'agent_message',
          text: 'no valid plan here',
        },
      }),
    ].join('\n');

    expect(stripCodexProtocol(raw, { includeCommandOutput: false })).toBe('no valid plan here');
  });

  it('keeps command transcripts for execute phases', () => {
    const raw = JSON.stringify({
      item: {
        type: 'command_execution',
        command: 'bun test',
        aggregated_output: 'ok',
        exit_code: 0,
      },
    });

    expect(stripCodexProtocol(raw, { includeCommandOutput: true })).toBe('$ bun test\nok');
  });
});

// ─── Provider integration with ProcessManager ─────────────────────────

/**
 * Build a mock ProcessManager that records spawns and lets tests
 * trigger output/exit events synchronously. The trigger helpers
 * return a microtask flush so generate() can resolve cleanly.
 */
function createMockProcessManager() {
  type MockListener = (...args: unknown[]) => void;
  const listeners: Record<string, MockListener[]> = {};
  let spawnCount = 0;
  const spawnCalls: Array<{ command: string; args: string[]; cwd: string }> = [];

  const pm = {
    spawn: vi.fn((_type: string, command: string, args: string[], cwd: string) => {
      spawnCount++;
      spawnCalls.push({ command, args, cwd });
      return { id: `proc-${spawnCount}` };
    }),
    kill: vi.fn(),
    on: vi.fn((event: string, handler: MockListener) => {
      const eventListeners = listeners[event] ?? [];
      eventListeners.push(handler);
      listeners[event] = eventListeners;
    }),
    removeListener: vi.fn((event: string, handler: MockListener) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
    }),
  } as unknown as ProcessManager;

  async function trigger(event: string, ...args: unknown[]) {
    const handlers = [...(listeners[event] ?? [])];
    for (const h of handlers) h(...args);
    // Flush microtasks so generate()'s promise chain settles
    await new Promise((r) => setImmediate(r));
  }

  return { pm, trigger, spawnCalls, getSpawnCount: () => spawnCount };
}

describe('createClaudeCliProvider', () => {
  it('generate() spawns claude with plan args and resolves on exit', async () => {
    const { pm, trigger, spawnCalls } = createMockProcessManager();
    const provider = createClaudeCliProvider(pm);

    const promise = provider.generate(req({ phase: 'plan' }));
    // Microtask hop so generate() reaches the await before we trigger
    await new Promise((r) => setImmediate(r));

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('claude');
    expect(spawnCalls[0].args).toContain('--disallowedTools');
    expect(spawnCalls[0].cwd).toBe('/tmp/wt');

    await trigger('output', 'proc-1', 'partial ');
    await trigger('output', 'proc-1', 'output');
    await trigger('exit', 'proc-1', 0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.rawOutput).toBe('partial output');
    expect(result.resolvedModel).toBe('claude');
  });

  it('surfaces exit 127 as binary_missing providerError', async () => {
    const { pm, trigger } = createMockProcessManager();
    const provider = createClaudeCliProvider(pm);

    const promise = provider.generate(req({ phase: 'plan' }));
    await new Promise((r) => setImmediate(r));
    await trigger('exit', 'proc-1', 127);

    const result = await promise;
    expect(result.exitCode).toBe(127);
    expect(result.providerError?.kind).toBe('binary_missing');
    expect(result.providerError?.retryable).toBe(false);
  });

  it('aborts running process when signal fires', async () => {
    const { pm, trigger } = createMockProcessManager();
    const provider = createClaudeCliProvider(pm);
    const abort = new AbortController();

    const promise = provider.generate(req({ phase: 'plan', signal: abort.signal }));
    await new Promise((r) => setImmediate(r));

    abort.abort();
    await new Promise((r) => setImmediate(r));
    expect(pm.kill).toHaveBeenCalled();

    // Simulate the process exiting with SIGTERM-like 130
    await trigger('exit', 'proc-1', 130);

    const result = await promise;
    expect(result.exitCode).toBe(130);
    expect(result.providerError?.kind).toBe('network');
    expect(result.providerError?.message).toBe('aborted');
  });

  it('pre-aborted signal returns immediately without spawning', async () => {
    const { pm } = createMockProcessManager();
    const provider = createClaudeCliProvider(pm);
    const abort = new AbortController();
    abort.abort();

    const result = await provider.generate(req({ phase: 'plan', signal: abort.signal }));
    expect(result.exitCode).toBe(130);
    expect(pm.spawn).not.toHaveBeenCalled();
  });
});

describe('createCodexCliProvider', () => {
  it('generate() for review phase spawns codex with non-autonomous args', async () => {
    const { pm, trigger, spawnCalls } = createMockProcessManager();
    const provider = createCodexCliProvider(pm);

    const promise = provider.generate(req({ phase: 'review' }));
    await new Promise((r) => setImmediate(r));

    expect(spawnCalls[0].command).toBe('codex');
    expect(spawnCalls[0].args).toEqual([
      '-a',
      'never',
      '-c',
      'model_reasoning_effort=high',
      'exec',
      expect.stringContaining('PROMPT'),
      '--sandbox',
      'read-only',
      '--json',
    ]);

    await trigger('exit', 'proc-1', 0);
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.resolvedModel).toBe('codex');
  });

  it('review phase with reasoningEffort hint sets -c model_reasoning_effort=high', async () => {
    const { pm, trigger, spawnCalls } = createMockProcessManager();
    const provider = createCodexCliProvider(pm);

    const promise = provider.generate(
      req({ phase: 'review', phaseHints: { reasoningEffort: 'high' } }),
    );
    await new Promise((r) => setImmediate(r));

    expect(spawnCalls[0].args).toContain('-c');
    expect(spawnCalls[0].args).toContain('model_reasoning_effort=high');

    await trigger('exit', 'proc-1', 0);
    await promise;
  });

  it('omits command execution output from non-execute rawOutput', async () => {
    const { pm, trigger } = createMockProcessManager();
    const provider = createCodexCliProvider(pm);

    const promise = provider.generate(req({ phase: 'plan' }));
    await new Promise((r) => setImmediate(r));

    await trigger(
      'output',
      'proc-1',
      [
        JSON.stringify({
          item: {
            type: 'command_execution',
            command: 'rg ENOENT',
            aggregated_output: 'source mentions ENOENT',
            exit_code: 0,
          },
        }),
        JSON.stringify({ item: { type: 'agent_message', text: 'planner text' } }),
      ].join('\n'),
    );
    await trigger('exit', 'proc-1', 0);

    const result = await promise;
    expect(result.rawOutput).toBe('planner text');
  });

  it('codex provider supports all non-gh pipeline phases', () => {
    const { pm } = createMockProcessManager();
    const provider = createCodexCliProvider(pm);
    expect(provider.supports.has('plan')).toBe(true);
    expect(provider.supports.has('review')).toBe(true);
    expect(provider.supports.has('revision')).toBe(true);
    expect(provider.supports.has('verify')).toBe(true);
    expect(provider.supports.has('execute')).toBe(true);
  });
});
