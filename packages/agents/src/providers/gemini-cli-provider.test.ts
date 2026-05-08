import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessManager } from '../process-manager';
import { _internals, createGeminiCliProvider } from './gemini-cli-provider';
import type { ProviderRequest } from './types';

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

class FakeProcessManager extends EventEmitter {
  spawnWithStdin = vi.fn(
    (
      _type: string,
      _command: string,
      _args: string[],
      _cwd: string,
      _input: string,
      _threadId?: string,
    ) => ({ id: 'proc-1' }),
  );
  spawn = vi.fn();
  kill = vi.fn();
}

describe('gemini-cli-provider', () => {
  it('builds headless JSON args and keeps the prompt in stdin', () => {
    expect(
      _internals.buildGeminiCommand(req({ phase: 'execute', modelHint: 'gemini-2.5-pro' })),
    ).toEqual({
      args: [
        '-p',
        '-',
        '--output-format',
        'json',
        '-m',
        'gemini-2.5-pro',
        '--approval-mode',
        'never',
        '--sandbox',
        'workspace-write',
      ],
      stdin: 'PROMPT',
    });
  });

  it('parses JSON text and resolved model when Gemini reports one', () => {
    expect(
      _internals.parseGeminiOutput(
        JSON.stringify({ response: 'done', model: 'gemini-2.5-pro', usage: { totalTokens: 9 } }),
      ),
    ).toEqual({ text: 'done', resolvedModel: 'gemini-2.5-pro' });
  });

  it('falls back to plain text and omits unstable telemetry', async () => {
    const processManager = new FakeProcessManager();
    const provider = createGeminiCliProvider(processManager as unknown as ProcessManager);
    const resultPromise = provider.generate(req());

    processManager.emit('output', 'proc-1', JSON.stringify({ response: 'done' }));
    processManager.emit('exit', 'proc-1', 0);

    const result = await resultPromise;
    expect(result.rawOutput).toBe('done');
    expect(result.resolvedModel).toBeUndefined();
    expect(result.tokensUsed).toBeUndefined();
    expect(result.costUsd).toBeUndefined();
  });

  it('clamps failures without leaking later stderr lines', async () => {
    const processManager = new FakeProcessManager();
    const provider = createGeminiCliProvider(processManager as unknown as ProcessManager);
    const resultPromise = provider.generate(req());

    processManager.emit('output', 'proc-1', 'Auth failed\nPROMPT\n'.repeat(50));
    processManager.emit('exit', 'proc-1', 1);

    const result = await resultPromise;
    expect(result.providerError?.message).toBe('Auth failed');
    expect(result.providerError?.message).not.toContain('PROMPT');
  });

  it('emits canonical lifecycle, raw, and done terminal events', async () => {
    const processManager = new FakeProcessManager();
    const onTerminalEvent = vi.fn();
    const provider = createGeminiCliProvider(processManager as unknown as ProcessManager);
    const resultPromise = provider.generate(req({ onTerminalEvent }));

    processManager.emit('output', 'proc-1', '{"response":"done"}');
    processManager.emit('exit', 'proc-1', 0);
    await resultPromise;

    expect(onTerminalEvent).toHaveBeenCalledWith({
      kind: 'lifecycle',
      message: 'Gemini CLI started',
    });
    expect(onTerminalEvent).toHaveBeenCalledWith({ kind: 'raw', content: '{"response":"done"}' });
    expect(onTerminalEvent).toHaveBeenCalledWith({ kind: 'done' });
  });
});
