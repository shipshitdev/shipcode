import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('parses candidates parts, empty output, ANSI output, and fallback model keys', () => {
    expect(_internals.parseGeminiOutput('')).toEqual({ text: '' });
    expect(_internals.parseGeminiOutput('\u001b[31mplain\u001b[0m')).toEqual({ text: 'plain' });
    expect(
      _internals.parseGeminiOutput(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'first' }, { text: '' }, { inlineData: {} }, { text: 'second' }],
              },
            },
          ],
          modelId: 'gemini-model-id',
        }),
      ),
    ).toEqual({ text: 'first\nsecond', resolvedModel: 'gemini-model-id' });
    expect(
      _internals.parseGeminiOutput(JSON.stringify({ output: 'from output', resolvedModel: 'r' })),
    ).toEqual({ text: 'from output', resolvedModel: 'r' });
    expect(_internals.parseGeminiOutput(JSON.stringify({ candidates: [] }))).toEqual({
      text: '{"candidates":[]}',
    });
  });

  it('uses generic failure text when stderr only echoes the prompt', () => {
    expect(_internals.clampGeminiFailure('PROMPT\n', 'PROMPT')).toBe('Gemini CLI failed');
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

  it('passes workspace roots and selected prompt materials into execution telemetry', async () => {
    const processManager = new FakeProcessManager();
    const provider = createGeminiCliProvider(processManager as unknown as ProcessManager);
    const promptMaterialSummary = {
      count: 1,
      labels: ['issue'],
      kinds: ['issue_prompt' as const],
    };
    const resultPromise = provider.generate(
      req({
        workspaceRoot: '/tmp/workspace',
        promptMaterialSummary,
      }),
    );

    processManager.emit('output', 'other-proc', 'ignored');
    processManager.emit('output', 'proc-1', JSON.stringify({ text: 'done', model: 'gemini' }));
    processManager.emit('exit', 'other-proc', 1);
    processManager.emit('exit', 'proc-1', 0);

    const result = await resultPromise;
    expect(processManager.spawnWithStdin).toHaveBeenCalledWith(
      'gemini',
      'gemini',
      expect.any(Array),
      '/tmp/wt',
      'PROMPT',
      't1',
      expect.objectContaining({ workspaceRoot: '/tmp/workspace' }),
    );
    expect(result.rawOutput).toBe('done');
    expect(result.resolvedModel).toBe('gemini');
    expect(result.promptTelemetry?.selectedMaterials).toBe(promptMaterialSummary);
  });

  it('clamps failures without leaking later stderr lines', async () => {
    const processManager = new FakeProcessManager();
    const provider = createGeminiCliProvider(processManager as unknown as ProcessManager);
    const resultPromise = provider.generate(req());

    processManager.emit('output', 'proc-1', 'PROMPT\nAuth failed\n'.repeat(50));
    processManager.emit('exit', 'proc-1', 1);

    const result = await resultPromise;
    expect(result.providerError?.message).toBe('Auth failed');
    expect(result.providerError?.message).not.toContain('PROMPT');
  });

  it('does not fall back to passing the prompt through argv', async () => {
    const processManager = new FakeProcessManager();
    processManager.spawnWithStdin = undefined as unknown as FakeProcessManager['spawnWithStdin'];
    const provider = createGeminiCliProvider(processManager as unknown as ProcessManager);

    const result = await provider.generate(req());

    expect(processManager.spawn).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(1);
    expect(result.providerError?.message).not.toContain('PROMPT');
    expect(result.providerError?.retryable).toBe(false);
  });

  it('reports binary-missing when process spawn throws', async () => {
    const processManager = new FakeProcessManager();
    processManager.spawnWithStdin.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    const provider = createGeminiCliProvider(processManager as unknown as ProcessManager);

    const result = await provider.generate(req());

    expect(result.exitCode).toBe(127);
    expect(result.rawOutput).toBe('ENOENT');
    expect(result.providerError).toEqual({
      kind: 'binary_missing',
      message: 'gemini CLI not found on PATH',
      retryable: false,
    });
  });

  it('stringifies non-Error spawn failures', async () => {
    const processManager = new FakeProcessManager();
    processManager.spawnWithStdin.mockImplementationOnce(() => {
      throw 'spawn failed';
    });
    const provider = createGeminiCliProvider(processManager as unknown as ProcessManager);

    const result = await provider.generate(req());

    expect(result.exitCode).toBe(127);
    expect(result.rawOutput).toBe('spawn failed');
  });

  it('short-circuits already-aborted requests', async () => {
    const controller = new AbortController();
    controller.abort();
    const processManager = new FakeProcessManager();
    const provider = createGeminiCliProvider(processManager as unknown as ProcessManager);

    const result = await provider.generate(req({ signal: controller.signal }));

    expect(processManager.spawnWithStdin).not.toHaveBeenCalled();
    expect(result.providerError).toEqual({
      kind: 'aborted',
      message: 'aborted',
      retryable: false,
    });
  });

  it('kills running Gemini processes on abort and settles if no exit event arrives', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const processManager = new FakeProcessManager();
    processManager.kill.mockImplementationOnce(() => {
      throw new Error('already gone');
    });
    const provider = createGeminiCliProvider(processManager as unknown as ProcessManager);

    const resultPromise = provider.generate(req({ signal: controller.signal }));
    processManager.emit('output', 'proc-1', 'partial');
    controller.abort();

    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(processManager.kill).toHaveBeenCalledWith('proc-1');
    expect(result).toMatchObject({
      rawOutput: 'partial',
      exitCode: 130,
      providerError: { kind: 'aborted', message: 'aborted', retryable: false },
    });
  });

  it('does not overwrite an exit result when abort fallback timer fires later', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const processManager = new FakeProcessManager();
    const provider = createGeminiCliProvider(processManager as unknown as ProcessManager);

    const resultPromise = provider.generate(req({ signal: controller.signal }));
    controller.abort();
    processManager.emit('exit', 'proc-1', 0);
    processManager.emit('exit', 'proc-1', 1);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await resultPromise;
    expect(result.exitCode).toBe(0);
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

  it('reports a healthy provider shell', async () => {
    const provider = createGeminiCliProvider(new FakeProcessManager() as unknown as ProcessManager);

    await expect(provider.healthCheck()).resolves.toEqual({ ok: true });
  });
});
