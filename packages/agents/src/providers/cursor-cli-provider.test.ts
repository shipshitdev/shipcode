import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessManager } from '../process-manager';
import { _internals, createCursorCliProvider } from './cursor-cli-provider';
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
      _options?: { envKeyAllowlist?: readonly string[]; workspaceRoot?: string | null },
    ) => ({ id: 'proc-1' }),
  );
  spawn = vi.fn();
  kill = vi.fn();
}

describe('cursor-cli-provider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds --force only for the execute phase and keeps the prompt in stdin', () => {
    expect(_internals.buildCursorCommand(req({ phase: 'execute', modelHint: 'auto' }))).toEqual({
      args: ['-p', '--output-format', 'json', '--model', 'auto', '--force'],
      stdin: 'PROMPT',
    });
  });

  it('omits --force for read-only phases and --model when no hint is given', () => {
    expect(_internals.buildCursorCommand(req({ phase: 'review' }))).toEqual({
      args: ['-p', '--output-format', 'json'],
      stdin: 'PROMPT',
    });
  });

  it('parses the result object and resolved model', () => {
    expect(
      _internals.parseCursorOutput(
        JSON.stringify({ type: 'result', result: 'done', model: 'gpt-5' }),
      ),
    ).toEqual({ text: 'done', resolvedModel: 'gpt-5' });
  });

  it('parses empty output, ANSI output, and alternate text keys', () => {
    expect(_internals.parseCursorOutput('')).toEqual({ text: '' });
    expect(_internals.parseCursorOutput('[31mplain[0m')).toEqual({ text: 'plain' });
    expect(_internals.parseCursorOutput(JSON.stringify({ text: 'from text' }))).toEqual({
      text: 'from text',
    });
  });

  it('falls back to the last result line of NDJSON stream output', () => {
    const stream = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', text: 'thinking' }),
      JSON.stringify({ type: 'result', result: 'final answer', model: 'sonnet-4.5' }),
    ].join('\n');
    expect(_internals.parseCursorOutput(stream)).toEqual({
      text: 'final answer',
      resolvedModel: 'sonnet-4.5',
    });
  });

  it('returns cleaned raw text when nothing parses as a result', () => {
    expect(_internals.parseCursorOutput('not json at all')).toEqual({ text: 'not json at all' });
  });

  it('uses generic failure text when stderr only echoes the prompt', () => {
    expect(_internals.clampCursorFailure('PROMPT\n', 'PROMPT')).toBe('Cursor CLI failed');
  });

  it('falls back to plain text and omits unstable telemetry', async () => {
    const processManager = new FakeProcessManager();
    const provider = createCursorCliProvider(processManager as unknown as ProcessManager);
    const resultPromise = provider.generate(req());

    processManager.emit('output', 'proc-1', JSON.stringify({ type: 'result', result: 'done' }));
    processManager.emit('exit', 'proc-1', 0);

    const result = await resultPromise;
    expect(result.rawOutput).toBe('done');
    expect(result.resolvedModel).toBeUndefined();
    expect(result.tokensUsed).toBeUndefined();
    expect(result.costUsd).toBeUndefined();
  });

  it('passes workspace roots and selected prompt materials into execution telemetry', async () => {
    const processManager = new FakeProcessManager();
    const provider = createCursorCliProvider(processManager as unknown as ProcessManager);
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
    processManager.emit(
      'output',
      'proc-1',
      JSON.stringify({ type: 'result', result: 'done', model: 'auto' }),
    );
    processManager.emit('exit', 'other-proc', 1);
    processManager.emit('exit', 'proc-1', 0);

    const result = await resultPromise;
    expect(processManager.spawnWithStdin).toHaveBeenCalledWith(
      'cursor',
      'cursor-agent',
      expect.any(Array),
      '/tmp/wt',
      'PROMPT',
      't1',
      expect.objectContaining({ workspaceRoot: '/tmp/workspace' }),
    );
    expect(result.rawOutput).toBe('done');
    expect(result.resolvedModel).toBe('auto');
    expect(result.promptTelemetry?.selectedMaterials).toBe(promptMaterialSummary);
  });

  it('allowlists CURSOR_API_KEY in the spawn env', async () => {
    const processManager = new FakeProcessManager();
    const provider = createCursorCliProvider(processManager as unknown as ProcessManager);
    const resultPromise = provider.generate(req());

    processManager.emit('output', 'proc-1', JSON.stringify({ type: 'result', result: 'ok' }));
    processManager.emit('exit', 'proc-1', 0);
    await resultPromise;

    const options = processManager.spawnWithStdin.mock.calls[0]?.[6];
    expect(options?.envKeyAllowlist).toContain('CURSOR_API_KEY');
  });

  it('clamps failures without leaking later stderr lines', async () => {
    const processManager = new FakeProcessManager();
    const provider = createCursorCliProvider(processManager as unknown as ProcessManager);
    const resultPromise = provider.generate(req());

    processManager.emit('output', 'proc-1', 'PROMPT\nAuth failed\n'.repeat(50));
    processManager.emit('exit', 'proc-1', 1);

    const result = await resultPromise;
    expect(result.providerError?.message).toBe('Auth failed');
    expect(result.providerError?.message).not.toContain('PROMPT');
    expect(result.providerError?.retryable).toBe(true);
  });

  it('does not fall back to passing the prompt through argv', async () => {
    const processManager = new FakeProcessManager();
    processManager.spawnWithStdin = undefined as unknown as FakeProcessManager['spawnWithStdin'];
    const provider = createCursorCliProvider(processManager as unknown as ProcessManager);

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
    const provider = createCursorCliProvider(processManager as unknown as ProcessManager);

    const result = await provider.generate(req());

    expect(result.exitCode).toBe(127);
    expect(result.rawOutput).toBe('ENOENT');
    expect(result.providerError).toEqual({
      kind: 'binary_missing',
      message: 'cursor-agent CLI not found on PATH',
      retryable: false,
    });
  });

  it('stringifies non-Error spawn failures', async () => {
    const processManager = new FakeProcessManager();
    processManager.spawnWithStdin.mockImplementationOnce(() => {
      throw 'spawn failed';
    });
    const provider = createCursorCliProvider(processManager as unknown as ProcessManager);

    const result = await provider.generate(req());

    expect(result.exitCode).toBe(127);
    expect(result.rawOutput).toBe('spawn failed');
  });

  it('short-circuits already-aborted requests', async () => {
    const controller = new AbortController();
    controller.abort();
    const processManager = new FakeProcessManager();
    const provider = createCursorCliProvider(processManager as unknown as ProcessManager);

    const result = await provider.generate(req({ signal: controller.signal }));

    expect(processManager.spawnWithStdin).not.toHaveBeenCalled();
    expect(result.providerError).toEqual({
      kind: 'aborted',
      message: 'aborted',
      retryable: false,
    });
  });

  it('kills running Cursor processes on abort and settles if no exit event arrives', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const processManager = new FakeProcessManager();
    processManager.kill.mockImplementationOnce(() => {
      throw new Error('already gone');
    });
    const provider = createCursorCliProvider(processManager as unknown as ProcessManager);

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
    const provider = createCursorCliProvider(processManager as unknown as ProcessManager);

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
    const provider = createCursorCliProvider(processManager as unknown as ProcessManager);
    const resultPromise = provider.generate(req({ onTerminalEvent }));

    processManager.emit('output', 'proc-1', '{"type":"result","result":"done"}');
    processManager.emit('exit', 'proc-1', 0);
    await resultPromise;

    expect(onTerminalEvent).toHaveBeenCalledWith({
      kind: 'lifecycle',
      message: 'Cursor CLI started',
    });
    expect(onTerminalEvent).toHaveBeenCalledWith({
      kind: 'raw',
      content: '{"type":"result","result":"done"}',
    });
    expect(onTerminalEvent).toHaveBeenCalledWith({ kind: 'done' });
  });

  it('reports a healthy provider shell', async () => {
    const provider = createCursorCliProvider(new FakeProcessManager() as unknown as ProcessManager);

    await expect(provider.healthCheck()).resolves.toEqual({ ok: true });
  });

  it('supports only the execute phase (no read-only mode available)', () => {
    const provider = createCursorCliProvider(new FakeProcessManager() as unknown as ProcessManager);

    expect([...provider.supports]).toEqual(['execute']);
    expect(provider.supports.has('plan')).toBe(false);
    expect(provider.supports.has('review')).toBe(false);
    expect(provider.supports.has('revision')).toBe(false);
    expect(provider.supports.has('verify')).toBe(false);
  });
});
