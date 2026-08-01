import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessManager } from '../process-manager';
import { _internals, createClaudeCliProvider, createCodexCliProvider } from './cli-provider';
import type { ProviderRequest } from './types';

const {
  buildClaudeArgs,
  buildClaudeStdin,
  buildCodexArgs,
  buildCodexStdin,
  buildCodexPrompt,
  buildNativeExecutionGoal,
  withExecutionGoalContract,
  buildClaudeInteractiveStructuredCommand,
  buildCodexInteractiveStructuredCommand,
  buildStructuredInstruction,
  phaseOutputArtifactPath,
  isInteractiveStructured,
  readPhaseOutputArtifact,
  materializeStdinArgsForLegacySpawn,
  stripCodexProtocol,
} = _internals;

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

async function waitForSpawn(spawnCalls: unknown[]): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (spawnCalls.length > 0) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ─── Arg-construction regression snapshots ────────────────────────────
// These lock the provider arg lists while keeping the full prompt in stdin.

describe('buildClaudeArgs', () => {
  it('plan phase uses stdin prompt mode', () => {
    expect(buildClaudeArgs(req({ phase: 'plan' }))).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '1',
      '--max-thinking-tokens',
      '32000',
      '--dangerously-skip-permissions',
      '--disallowedTools',
      'Edit,Write,Bash,NotebookEdit,Read,Glob,Grep,Task,WebFetch,WebSearch',
    ]);
  });

  it('revision phase uses stdin prompt mode', () => {
    expect(buildClaudeArgs(req({ phase: 'revision' }))).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '1',
      '--max-thinking-tokens',
      '32000',
      '--dangerously-skip-permissions',
      '--disallowedTools',
      'Edit,Write,Bash,NotebookEdit,Read,Glob,Grep,Task,WebFetch,WebSearch',
    ]);
  });

  it('verify phase uses stdin prompt mode', () => {
    expect(buildClaudeArgs(req({ phase: 'verify' }))).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '1',
      '--max-thinking-tokens',
      '32000',
      '--dangerously-skip-permissions',
      '--disallowedTools',
      'Edit,Write,Bash,NotebookEdit,Read,Glob,Grep,Task,WebFetch,WebSearch',
    ]);
  });

  it('execute phase uses stdin prompt mode', () => {
    expect(buildClaudeArgs(req({ phase: 'execute' }))).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--allowedTools',
      'Edit,Write,Bash,Glob,Grep,Read',
      '--max-thinking-tokens',
      '32000',
      '--dangerously-skip-permissions',
    ]);
  });

  it('execute phase honors explicit disallowed tool hints', () => {
    expect(
      buildClaudeArgs(
        req({
          phase: 'execute',
          phaseHints: {
            allowedTools: ['Read'],
            disallowedTools: ['WebFetch'],
          },
        }),
      ),
    ).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--allowedTools',
      'Read',
      '--disallowedTools',
      'WebFetch',
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
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '1',
      '--max-thinking-tokens',
      '32000',
      '--dangerously-skip-permissions',
      '--disallowedTools',
      'Edit,Write,Bash,NotebookEdit,Read,Glob,Grep,Task,WebFetch,WebSearch',
    ]);
  });

  it('maps none to omitted Claude thinking tokens', () => {
    expect(
      buildClaudeArgs(req({ phase: 'plan', phaseHints: { reasoningEffort: 'none' } })),
    ).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '1',
      '--dangerously-skip-permissions',
      '--disallowedTools',
      'Edit,Write,Bash,NotebookEdit,Read,Glob,Grep,Task,WebFetch,WebSearch',
    ]);
  });

  it('keeps the Claude prompt in stdin', () => {
    expect(buildClaudeStdin(req({ phase: 'plan' }))).toBe('PROMPT');
  });

  it('materializes Claude stdin after -p only for legacy spawn managers', () => {
    expect(materializeStdinArgsForLegacySpawn(['-p', '--output-format', 'json'], 'PROMPT')).toEqual(
      ['-p', 'PROMPT', '--output-format', 'json'],
    );
  });

  it('materializes placeholder stdin forms and leaves unrelated args alone', () => {
    expect(materializeStdinArgsForLegacySpawn(['-p', '-'], 'PROMPT')).toEqual(['-p', 'PROMPT']);
    expect(materializeStdinArgsForLegacySpawn(['exec', '-', '--json'], 'PROMPT')).toEqual([
      'exec',
      'PROMPT',
      '--json',
    ]);
    expect(materializeStdinArgsForLegacySpawn(['--version'], 'PROMPT')).toEqual(['--version']);
    const args = ['-p', 'existing'];
    expect(materializeStdinArgsForLegacySpawn(args)).toBe(args);
  });

  it('review phase supports model and explicit tool hints', () => {
    expect(
      buildClaudeArgs(
        req({
          phase: 'review',
          modelHint: 'claude-opus-4-5',
          phaseHints: {
            allowedTools: ['Read'],
            disallowedTools: ['Bash'],
          },
        }),
      ),
    ).toEqual([
      '-p',
      '--model',
      'claude-opus-4-5',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '1',
      '--dangerously-skip-permissions',
      '--disallowedTools',
      'Bash',
      '--allowedTools',
      'Read',
    ]);
  });

  it('plan phase honors model, maxTurns, and explicit allowed tools', () => {
    expect(
      buildClaudeArgs(
        req({
          phase: 'plan',
          modelHint: 'claude-sonnet-4-6',
          phaseHints: {
            maxTurns: 3,
            allowedTools: ['Read', 'Grep'],
            disallowedTools: undefined,
          },
        }),
      ),
    ).toEqual([
      '-p',
      '--model',
      'claude-sonnet-4-6',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '3',
      '--max-thinking-tokens',
      '32000',
      '--dangerously-skip-permissions',
      '--disallowedTools',
      'Edit,Write,Bash,NotebookEdit,Read,Glob,Grep,Task,WebFetch,WebSearch',
      '--allowedTools',
      'Read,Grep',
    ]);
  });

  it('passes rolling and pinned Claude model values through unchanged', () => {
    expect(buildClaudeArgs(req({ phase: 'plan', modelHint: 'opus' }))).toEqual(
      expect.arrayContaining(['--model', 'opus']),
    );
    expect(buildClaudeArgs(req({ phase: 'plan', modelHint: 'claude-opus-4-8' }))).toEqual(
      expect.arrayContaining(['--model', 'claude-opus-4-8']),
    );
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
      '-',
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
      '-',
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
      '-',
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
      '-',
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
      '-',
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
      '-',
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
      '-',
      '--sandbox',
      'read-only',
      '--json',
    ]);
  });

  it('maps none to low for codex', () => {
    expect(
      buildCodexArgs(req({ phase: 'review', phaseHints: { reasoningEffort: 'none' } })),
    ).toEqual([
      '-a',
      'never',
      '-c',
      'model_reasoning_effort=low',
      'exec',
      '-',
      '--sandbox',
      'read-only',
      '--json',
    ]);
  });

  it('keeps the Codex prompt in stdin', () => {
    expect(buildCodexStdin(req({ phase: 'review' }))).toContain('PROMPT');
  });

  it('supports model hints and explicit sandbox overrides', () => {
    expect(
      buildCodexArgs(
        req({
          phase: 'execute',
          modelHint: 'gpt-5.4',
          phaseHints: { sandbox: 'workspace-write', reasoningEffort: 'low' },
        }),
      ),
    ).toEqual([
      '-a',
      'never',
      '-m',
      'gpt-5.4',
      '-c',
      'model_reasoning_effort=low',
      'exec',
      '-',
      '--sandbox',
      'workspace-write',
      '--json',
    ]);
  });
});

describe('execution goal contracts', () => {
  it('builds a bounded native goal that points at the full prompt artifact', () => {
    const goal = buildNativeExecutionGoal('/tmp/wt/.shipcode/runs/t1/execute-prompt.md');

    expect(goal).toMatch(/^\/goal /);
    expect(goal).toContain('/tmp/wt/.shipcode/runs/t1/execute-prompt.md');
    expect(goal).toContain('every in-scope plan step and acceptance criterion');
    expect(goal).toContain('real blocker outside your authority');
    expect(goal.length).toBeLessThan(4_000);
  });

  it('adds an idempotent provider-neutral completion contract', () => {
    const wrapped = withExecutionGoalContract('PROMPT');

    expect(wrapped).toContain('<execution_goal>');
    expect(wrapped).toContain('Treat completion as a verifiable condition');
    expect(wrapped).toContain('PROMPT');
    expect(withExecutionGoalContract(wrapped)).toBe(wrapped);
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

  it('adds the completion contract without sending unsupported native goal syntax', () => {
    const prompt = buildCodexPrompt(req({ phase: 'execute' }));

    expect(prompt).toContain('<execution_goal>');
    expect(prompt).toContain('PROMPT');
    expect(prompt).not.toContain('/goal');
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

  it('keeps non-protocol content and failed command exit codes', () => {
    const raw = [
      'plain stderr',
      JSON.stringify({ structured: true }),
      JSON.stringify({ type: 'thread.started' }),
      JSON.stringify({
        item: {
          type: 'command_execution',
          command: 'bun test',
          aggregated_output: '\u001b[31mfailed\u001b[0m',
          exit_code: 1,
        },
      }),
      JSON.stringify({ item: { type: 'command_execution', exit_code: 0 } }),
    ].join('\n');

    expect(stripCodexProtocol(raw)).toBe(
      'plain stderr\n{"structured":true}\n$ bun test\nfailed\n[exit 1]',
    );
  });
});

// ─── Provider integration with ProcessManager ─────────────────────────

/**
 * Build a mock ProcessManager that records spawns and lets tests
 * trigger output/exit events synchronously. The trigger helpers
 * return a microtask flush so generate() can resolve cleanly.
 */
function createMockProcessManager(options: { withStdin?: boolean; killThrows?: boolean } = {}) {
  type MockListener = (...args: unknown[]) => void;
  const listeners: Record<string, MockListener[]> = {};
  let spawnCount = 0;
  const spawnCalls: Array<{
    command: string;
    args: string[];
    cwd: string;
    stdin?: string;
    threadId?: string;
    options?: unknown;
  }> = [];

  const pm = {
    spawn: vi.fn(
      (
        _type: string,
        command: string,
        args: string[],
        cwd: string,
        threadId?: string,
        spawnOptions?: unknown,
      ) => {
        spawnCount++;
        spawnCalls.push({ command, args, cwd, threadId, options: spawnOptions });
        return { id: `proc-${spawnCount}` };
      },
    ),
    kill: vi.fn(() => {
      if (options.killThrows) throw new Error('already exited');
    }),
    on: vi.fn((event: string, handler: MockListener) => {
      const eventListeners = listeners[event] ?? [];
      eventListeners.push(handler);
      listeners[event] = eventListeners;
    }),
    removeListener: vi.fn((event: string, handler: MockListener) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
    }),
  } as unknown as ProcessManager & {
    spawnWithStdin?: (
      type: string,
      command: string,
      args: string[],
      cwd: string,
      stdin: string,
      threadId?: string,
      spawnOptions?: unknown,
    ) => { id: string };
  };

  if (options.withStdin !== false) {
    (pm as unknown as { spawnWithStdin: unknown }).spawnWithStdin = vi.fn(
      (_type, command, args, cwd, stdin, threadId, spawnOptions) => {
        spawnCount++;
        spawnCalls.push({ command, args, cwd, stdin, threadId, options: spawnOptions });
        return { id: `proc-${spawnCount}` };
      },
    );
  }

  async function trigger(event: string, ...args: unknown[]) {
    const handlers = [...(listeners[event] ?? [])];
    for (const h of handlers) h(...args);
    // Flush microtasks so generate()'s promise chain settles
    await new Promise((r) => setImmediate(r));
  }

  function emitSync(event: string, ...args: unknown[]) {
    const handlers = [...(listeners[event] ?? [])];
    for (const h of handlers) h(...args);
  }

  return { pm, trigger, emitSync, spawnCalls, getSpawnCount: () => spawnCount };
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
    expect(spawnCalls[0].args[0]).toBe('-p');
    expect(spawnCalls[0].args[1]).not.toBe('-');
    expect(spawnCalls[0].stdin).toBe('PROMPT');
    expect(spawnCalls[0].args).toContain('--disallowedTools');
    expect(spawnCalls[0].cwd).toBe('/tmp/wt');
    expect(spawnCalls[0].options).not.toEqual(expect.objectContaining({ keepStdinOpen: true }));

    await trigger('output', 'proc-1', 'partial ');
    await trigger('output', 'proc-1', 'output');
    await trigger('exit', 'proc-1', 0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.rawOutput).toBe('partial output');
    expect(result.resolvedModel).toBeUndefined();
  });

  it('records the concrete Claude model reported by stream JSON', async () => {
    const { pm, trigger } = createMockProcessManager();
    const provider = createClaudeCliProvider(pm);

    const promise = provider.generate(req({ phase: 'plan', modelHint: 'opus' }));
    await new Promise((r) => setImmediate(r));
    await trigger(
      'output',
      'proc-1',
      `${JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-opus-4-9', content: [{ type: 'text', text: 'done' }] },
      })}\n`,
    );
    await trigger('exit', 'proc-1', 0);

    await expect(promise).resolves.toMatchObject({ resolvedModel: 'claude-opus-4-9' });
  });

  it('notifies callers when the managed Claude process starts', async () => {
    const { trigger, pm } = createMockProcessManager();
    const provider = createClaudeCliProvider(pm);
    const onProcessStart = vi.fn();

    const promise = provider.generate(req({ phase: 'plan', onProcessStart }));
    await new Promise((r) => setImmediate(r));

    expect(onProcessStart).toHaveBeenCalledWith('proc-1');

    await trigger('exit', 'proc-1', 0);
    await promise;
  });

  it('ignores output and exit events for other process IDs', async () => {
    const { trigger, spawnCalls, pm } = createMockProcessManager();
    const provider = createClaudeCliProvider(pm);

    const promise = provider.generate(
      req({
        phase: 'plan',
        promptMaterialSummary: {
          count: 1,
          labels: ['issue'],
          kinds: ['issue_prompt'],
        },
      }),
    );
    await new Promise((r) => setImmediate(r));

    expect(spawnCalls).toHaveLength(1);
    await trigger('output', 'other-proc', 'ignored');
    await trigger('exit', 'other-proc', 99);
    await trigger('output', 'proc-1', 'kept');
    await trigger('exit', 'proc-1', 0);
    await trigger('exit', 'proc-1', 127);

    const result = await promise;
    expect(result.rawOutput).toBe('kept');
    expect(result.exitCode).toBe(0);
    expect(result.promptTelemetry).toEqual(
      expect.objectContaining({
        selectedMaterials: {
          count: 1,
          labels: ['issue'],
          kinds: ['issue_prompt'],
        },
      }),
    );
  });

  it('falls back to legacy spawn args when spawnWithStdin is unavailable', async () => {
    const { pm, trigger, spawnCalls } = createMockProcessManager({ withStdin: false });
    const provider = createClaudeCliProvider(pm);

    const promise = provider.generate(req({ phase: 'plan', workspaceRoot: '/tmp/proj' }));
    await new Promise((r) => setImmediate(r));

    expect(spawnCalls[0].args[1]).toBe('PROMPT');
    expect(spawnCalls[0].stdin).toBeUndefined();
    expect(spawnCalls[0].threadId).toBe('t1');
    expect(spawnCalls[0].options).toEqual(expect.objectContaining({ workspaceRoot: '/tmp/proj' }));

    await trigger('exit', 'proc-1', 0);
    await promise;
  });

  it('surfaces synchronous spawn failures as binary_missing output', async () => {
    const { pm } = createMockProcessManager({ withStdin: false });
    vi.mocked(pm.spawn).mockImplementationOnce(() => {
      throw new Error('spawn ENOENT');
    });
    const provider = createClaudeCliProvider(pm);

    const result = await provider.generate(req({ phase: 'plan' }));

    expect(result.exitCode).toBe(127);
    expect(result.rawOutput).toBe('spawn ENOENT');
    expect(result.providerError?.kind).toBe('binary_missing');
  });

  it('surfaces non-Error synchronous spawn failures as binary_missing output', async () => {
    const { pm } = createMockProcessManager({ withStdin: false });
    vi.mocked(pm.spawn).mockImplementationOnce(() => {
      throw 'spawn failed';
    });
    const provider = createClaudeCliProvider(pm);

    const result = await provider.generate(req({ phase: 'plan' }));

    expect(result.exitCode).toBe(127);
    expect(result.rawOutput).toBe('spawn failed');
    expect(result.providerError?.kind).toBe('binary_missing');
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

  it('execute phase uses the interactive Claude CLI when runMode is interactive', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-claude-interactive-'));
    try {
      const { pm, trigger, spawnCalls } = createMockProcessManager({ withStdin: false });
      const provider = createClaudeCliProvider(pm);

      const promise = provider.generate(
        req({
          phase: 'execute',
          cwd,
          modelHint: 'opus',
          phaseHints: { runMode: 'interactive' },
        }),
      );
      await waitForSpawn(spawnCalls);

      expect(spawnCalls[0].command).toBe('claude');
      expect(spawnCalls[0].stdin).toBeUndefined();
      expect(spawnCalls[0].args).toEqual(
        expect.arrayContaining(['--permission-mode', 'acceptEdits', '--name', 'shipcode-t1']),
      );
      expect(spawnCalls[0].args).toEqual(expect.arrayContaining(['--model', 'opus']));
      expect(spawnCalls[0].args).not.toContain('-p');
      expect(spawnCalls[0].args.at(-1)).toMatch(/^\/goal /);
      expect(spawnCalls[0].args.at(-1)).toContain(`${cwd}/.shipcode/runs/t1/execute-prompt.md`);
      expect(spawnCalls[0].options).toEqual(expect.objectContaining({ outputMode: 'raw' }));
      expect(fs.readFileSync(path.join(cwd, '.shipcode/runs/t1/execute-prompt.md'), 'utf8')).toBe(
        'PROMPT',
      );

      await trigger('exit', 'proc-1', 0);
      const result = await promise;
      expect(result.resolvedModel).toBeUndefined();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
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
    expect(result.providerError?.kind).toBe('aborted');
    expect(result.providerError?.message).toBe('aborted');
  });

  it('force-settles aborted processes when kill throws and no exit event arrives', async () => {
    vi.useFakeTimers();
    try {
      const { pm } = createMockProcessManager({ killThrows: true });
      const provider = createClaudeCliProvider(pm);
      const abort = new AbortController();

      const promise = provider.generate(req({ phase: 'plan', signal: abort.signal }));

      abort.abort();
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;
      expect(result.exitCode).toBe(130);
      expect(result.providerError?.kind).toBe('aborted');
      expect(pm.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores abort fallback timers after the process exits normally', async () => {
    vi.useFakeTimers();
    try {
      const { pm, emitSync } = createMockProcessManager();
      const provider = createClaudeCliProvider(pm);
      const abort = new AbortController();

      const promise = provider.generate(req({ phase: 'plan', signal: abort.signal }));

      abort.abort();
      emitSync('output', 'proc-1', 'done');
      emitSync('exit', 'proc-1', 0);
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;
      expect(result.exitCode).toBe(0);
      expect(result.rawOutput).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pre-aborted signal returns immediately without spawning', async () => {
    const { pm } = createMockProcessManager();
    const provider = createClaudeCliProvider(pm);
    const abort = new AbortController();
    abort.abort();

    const result = await provider.generate(req({ phase: 'plan', signal: abort.signal }));
    expect(result.exitCode).toBe(130);
    expect(pm.spawn).not.toHaveBeenCalled();
    expect(pm.spawnWithStdin).not.toHaveBeenCalled();
  });

  it('reports healthy through the provider interface', async () => {
    const { pm } = createMockProcessManager();
    await expect(createClaudeCliProvider(pm).healthCheck()).resolves.toEqual({ ok: true });
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
      '-',
      '--sandbox',
      'read-only',
      '--json',
    ]);
    expect(spawnCalls[0].stdin).toContain('PROMPT');

    await trigger('exit', 'proc-1', 0);
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.resolvedModel).toBe('codex');
  });

  it('uses legacy spawn materialization for Codex stdin when needed', async () => {
    const { pm, trigger, spawnCalls } = createMockProcessManager({ withStdin: false });
    const provider = createCodexCliProvider(pm);

    const promise = provider.generate(req({ phase: 'review' }));
    await new Promise((r) => setImmediate(r));

    expect(spawnCalls[0].args[5]).toContain('ShipCode structured-output mode');
    expect(spawnCalls[0].stdin).toBeUndefined();

    await trigger('exit', 'proc-1', 0);
    await promise;
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

  it('execute phase uses the interactive Codex CLI when runMode is interactive', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-codex-interactive-'));
    try {
      const { pm, trigger, spawnCalls } = createMockProcessManager({ withStdin: false });
      const provider = createCodexCliProvider(pm);

      const promise = provider.generate(
        req({
          phase: 'execute',
          cwd,
          modelHint: 'gpt-5.4-mini',
          phaseHints: { runMode: 'interactive', reasoningEffort: 'medium' },
        }),
      );
      await waitForSpawn(spawnCalls);

      expect(spawnCalls[0].command).toBe('codex');
      expect(spawnCalls[0].stdin).toBeUndefined();
      expect(spawnCalls[0].args).toEqual(
        expect.arrayContaining([
          '-s',
          'workspace-write',
          '-a',
          'on-request',
          '--no-alt-screen',
          '-m',
          'gpt-5.4-mini',
          '-c',
          'model_reasoning_effort=medium',
        ]),
      );
      expect(spawnCalls[0].args).not.toContain('exec');
      expect(spawnCalls[0].args.at(-1)).toMatch(/^\/goal /);
      expect(spawnCalls[0].options).toEqual(expect.objectContaining({ outputMode: 'raw' }));
      expect(fs.readFileSync(path.join(cwd, '.shipcode/runs/t1/execute-prompt.md'), 'utf8')).toBe(
        'PROMPT',
      );

      await trigger('exit', 'proc-1', 0);
      await promise;
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
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

  it('extracts resolvedModel from response.completed NDJSON event', async () => {
    const { pm, trigger } = createMockProcessManager();
    const provider = createCodexCliProvider(pm);

    const promise = provider.generate(req({ phase: 'plan' }));
    await new Promise((r) => setImmediate(r));

    await trigger(
      'output',
      'proc-1',
      [
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
        JSON.stringify({ item: { type: 'agent_message', text: 'planner text' } }),
        JSON.stringify({
          type: 'response.completed',
          response: {
            model: 'gpt-5.4-high',
            usage: { input_tokens: 12, completion_tokens: 7 },
          },
        }),
      ].join('\n'),
    );
    await trigger('exit', 'proc-1', 0);

    const result = await promise;
    expect(result.resolvedModel).toBe('gpt-5.4-high');
  });

  it('falls back to modelHint when codex output has no model field', async () => {
    const { pm, trigger } = createMockProcessManager();
    const provider = createCodexCliProvider(pm);

    const promise = provider.generate(req({ phase: 'plan', modelHint: 'gpt-5.4-mini' }));
    await new Promise((r) => setImmediate(r));

    await trigger('output', 'proc-1', 'plain text without ndjson model events\n');
    await trigger('exit', 'proc-1', 0);

    const result = await promise;
    expect(result.resolvedModel).toBe('gpt-5.4-mini');
  });

  it('surfaces codex binary missing, aborts, usage, clarification, and healthCheck', async () => {
    const { pm, trigger } = createMockProcessManager();
    const provider = createCodexCliProvider(pm);
    const abort = new AbortController();

    const missing = provider.generate(req({ phase: 'review' }));
    await new Promise((r) => setImmediate(r));
    await trigger('exit', 'proc-1', 127);
    expect((await missing).providerError?.message).toBe('codex CLI not found on PATH');

    const aborted = provider.generate(req({ phase: 'review', signal: abort.signal }));
    await new Promise((r) => setImmediate(r));
    abort.abort();
    await trigger('exit', 'proc-2', 130);
    expect((await aborted).providerError?.kind).toBe('aborted');

    const withMetadata = provider.generate(req({ phase: 'review' }));
    await new Promise((r) => setImmediate(r));
    await trigger(
      'output',
      'proc-3',
      [
        JSON.stringify({
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              input_token_details: { cached_tokens: 2 },
            },
          },
        }),
        JSON.stringify({
          item: {
            type: 'agent_message',
            text: [
              '```shipcode-clarification',
              JSON.stringify({
                id: 'clarify-1',
                threadId: 'thread-1',
                phase: 'plan',
                summary: 'Need input',
                questions: [
                  {
                    id: 'scope',
                    title: 'Scope',
                    prompt: 'Pick a scope.',
                    description: null,
                    choices: [
                      { id: 'narrow', label: 'Narrow', description: 'Smallest useful version.' },
                      { id: 'wide', label: 'Wide', description: 'Include adjacent cleanup.' },
                    ],
                    allowFreeform: false,
                    freeformPlaceholder: null,
                  },
                ],
              }),
              '```',
            ].join('\n'),
          },
        }),
      ].join('\n'),
    );
    await trigger('exit', 'proc-3', 0);
    const result = await withMetadata;
    expect(result.tokensUsed).toEqual({ prompt: 10, completion: 5 });
    expect(result.clarificationRequest?.summary).toBe('Need input');

    await expect(provider.healthCheck()).resolves.toEqual({ ok: true });
  });
});

// ─── Track 2: interactive structured bridge ───────────────────────────

describe('interactive structured bridge', () => {
  it('isInteractiveStructured gates on runMode + phase', () => {
    for (const phase of ['plan', 'review', 'revision', 'verify'] as const) {
      expect(isInteractiveStructured(req({ phase, phaseHints: { runMode: 'interactive' } }))).toBe(
        true,
      );
    }
    // execute uses the dedicated interactive-execute path, not the structured one
    expect(
      isInteractiveStructured(req({ phase: 'execute', phaseHints: { runMode: 'interactive' } })),
    ).toBe(false);
    // programmatic stays programmatic
    expect(
      isInteractiveStructured(req({ phase: 'plan', phaseHints: { runMode: 'programmatic' } })),
    ).toBe(false);
    expect(isInteractiveStructured(req({ phase: 'plan' }))).toBe(false);
  });

  it('phaseOutputArtifactPath lives in the gitignored run scratch dir', () => {
    expect(phaseOutputArtifactPath(req({ phase: 'plan', cwd: '/tmp/wt', threadId: 'abc' }))).toBe(
      path.join('/tmp/wt', '.shipcode', 'runs', 'abc', 'plan-output.md'),
    );
  });

  it('buildStructuredInstruction names the prompt, output, fence tag, and exit', () => {
    const text = buildStructuredInstruction('/p/in.md', '/p/out.md', 'shipcode-plan');
    expect(text).toContain('/p/in.md');
    expect(text).toContain('/p/out.md');
    expect(text).toContain('```shipcode-plan');
    expect(text).toContain('shipcode-clarification');
    expect(text).toMatch(/\bexit\b/);
  });

  it('claude structured command: plan gets repo read tools, instruction last, raw output', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-struct-'));
    const cmd = await buildClaudeInteractiveStructuredCommand(
      req({ phase: 'plan', cwd, threadId: 'tid' }),
    );
    expect(cmd.args).toContain('--permission-mode');
    expect(cmd.args).toContain('acceptEdits');
    const toolsIdx = cmd.args.indexOf('--tools');
    expect(cmd.args[toolsIdx + 1]).toBe('Read,Write,Glob,Grep');
    expect(cmd.options).toEqual({ outputMode: 'raw' });
    // Interactive commands carry no stdin at all — the prompt lives in the
    // artifact the trailing instruction points at, never on the piped path.
    expect('stdin' in cmd).toBe(false);
    const last = cmd.args[cmd.args.length - 1];
    expect(last).toContain(path.join(cwd, '.shipcode', 'runs', 'tid', 'plan-prompt.md'));
    expect(last).toContain(path.join(cwd, '.shipcode', 'runs', 'tid', 'plan-output.md'));
    expect(fs.existsSync(path.join(cwd, '.shipcode', 'runs', 'tid', 'plan-prompt.md'))).toBe(true);
  });

  it('claude structured command: verify is read+write only', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-struct-'));
    const cmd = await buildClaudeInteractiveStructuredCommand(
      req({ phase: 'verify', cwd, threadId: 'tid' }),
    );
    const toolsIdx = cmd.args.indexOf('--tools');
    expect(cmd.args[toolsIdx + 1]).toBe('Read,Write');
  });

  it('codex structured command: workspace-write sandbox, no-alt-screen, raw output', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-struct-'));
    const cmd = await buildCodexInteractiveStructuredCommand(
      req({ phase: 'plan', cwd, threadId: 'tid' }),
    );
    expect(cmd.args.slice(0, 5)).toEqual([
      '-s',
      'workspace-write',
      '-a',
      'on-request',
      '--no-alt-screen',
    ]);
    expect(cmd.args.some((a: string) => a.startsWith('model_reasoning_effort='))).toBe(true);
    expect(cmd.options).toEqual({ outputMode: 'raw' });
    const last = cmd.args[cmd.args.length - 1];
    expect(last).toContain(path.join(cwd, '.shipcode', 'runs', 'tid', 'plan-output.md'));
  });

  it.each([
    ['claude', buildClaudeInteractiveStructuredCommand],
    ['codex', buildCodexInteractiveStructuredCommand],
  ] as const)('%s structured command removes stale phase output before retry', async (_, build) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-struct-stale-'));
    try {
      const request = req({ phase: 'plan', cwd, threadId: 'tid' });
      const outputPath = phaseOutputArtifactPath(request);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, 'stale output');

      await build(request);

      expect(fs.existsSync(outputPath)).toBe(false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('readPhaseOutputArtifact returns file content when present', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-struct-'));
    const dir = path.join(cwd, '.shipcode', 'runs', 'tid');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, 'plan-output.md');
    fs.writeFileSync(out, '```shipcode-plan\n{"summary":"ok"}\n```');
    const content = await readPhaseOutputArtifact(out, new AbortController().signal);
    expect(content).toContain('shipcode-plan');
  });

  it('readPhaseOutputArtifact returns null when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const content = await readPhaseOutputArtifact('/nonexistent/missing.md', ac.signal);
    expect(content).toBeNull();
  });

  it('claude interactive structured plan: reads the artifact, uses no -p, parses clarification', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-struct-gen-'));
    const { pm, trigger, spawnCalls } = createMockProcessManager();
    const provider = createClaudeCliProvider(pm);

    const promise = provider.generate(
      req({
        phase: 'plan',
        cwd,
        threadId: 'tid',
        modelHint: 'opus',
        phaseHints: { runMode: 'interactive' },
      }),
    );
    // Spawn happens only after the builder's prompt/output dirs are created.
    await waitForSpawn(spawnCalls);

    // The agent writes its structured block to the output artifact, then exits.
    const outDir = path.join(cwd, '.shipcode', 'runs', 'tid');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'plan-output.md');
    fs.writeFileSync(
      outPath,
      [
        '```shipcode-clarification',
        JSON.stringify({
          id: 'c1',
          threadId: 'tid',
          phase: 'plan',
          summary: 'Need input',
          questions: [
            {
              id: 'scope',
              title: 'Scope',
              prompt: 'Pick a scope.',
              description: null,
              choices: [
                { id: 'n', label: 'Narrow', description: 'narrow' },
                { id: 'w', label: 'Wide', description: 'wide' },
              ],
              allowFreeform: false,
              freeformPlaceholder: null,
            },
          ],
        }),
        '```',
      ].join('\n'),
    );
    await trigger('exit', 'proc-1', 0);

    const result = await promise;
    // Interactive path never touches `-p`: stays on the subscription seat.
    expect(spawnCalls[0]?.args).not.toContain('-p');
    expect(spawnCalls[0]?.args).toContain('--permission-mode');
    // rawOutput carries the artifact contents so downstream parsers are unchanged.
    expect(result.rawOutput).toContain('shipcode-clarification');
    expect(result.clarificationRequest?.summary).toBe('Need input');
    expect(result.exitCode).toBe(0);
    expect(result.resolvedModel).toBeUndefined();
  });

  it('records concrete model evidence when an interactive Claude transcript exposes it', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-struct-model-'));
    try {
      const { pm, trigger, spawnCalls } = createMockProcessManager();
      const provider = createClaudeCliProvider(pm);
      const promise = provider.generate(
        req({
          phase: 'plan',
          cwd,
          threadId: 'tid',
          modelHint: 'opus',
          phaseHints: { runMode: 'interactive' },
        }),
      );
      await waitForSpawn(spawnCalls);
      const outPath = path.join(cwd, '.shipcode', 'runs', 'tid', 'plan-output.md');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, 'done');
      await trigger(
        'output',
        'proc-1',
        `${JSON.stringify({
          type: 'assistant',
          message: { model: 'claude-opus-4-9', content: [] },
        })}\n`,
      );
      await trigger('exit', 'proc-1', 0);

      await expect(promise).resolves.toMatchObject({ resolvedModel: 'claude-opus-4-9' });
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
