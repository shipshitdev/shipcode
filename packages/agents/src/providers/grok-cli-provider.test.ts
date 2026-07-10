import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessManager } from '../process-manager';
import { _internals, createGrokCliProvider } from './grok-cli-provider';
import type { ProviderRequest } from './types';

function req(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    phase: 'execute',
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

describe('grok-cli-provider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds --always-approve only for execute and keeps the prompt in stdin', () => {
    expect(_internals.buildGrokCommand(req({ phase: 'execute', modelHint: 'grok-4.5' }))).toEqual({
      args: [
        '-p',
        '--output-format',
        'json',
        '--no-auto-update',
        '--model',
        'grok-4.5',
        '--always-approve',
      ],
      stdin: 'PROMPT',
    });
  });

  it('omits --always-approve for read-only phases and --model when no hint is given', () => {
    expect(_internals.buildGrokCommand(req({ phase: 'review' }))).toEqual({
      args: ['-p', '--output-format', 'json', '--no-auto-update'],
      stdin: 'PROMPT',
    });
  });

  it('parses the result object and resolved model', () => {
    expect(
      _internals.parseGrokOutput(
        JSON.stringify({ type: 'result', result: 'done', model: 'grok-4.5' }),
      ),
    ).toEqual({ text: 'done', resolvedModel: 'grok-4.5' });
  });

  it('parses empty output, ANSI output, and alternate text keys', () => {
    expect(_internals.parseGrokOutput('')).toEqual({ text: '' });
    expect(_internals.parseGrokOutput('\u001b[31mplain\u001b[0m')).toEqual({ text: 'plain' });
    expect(_internals.parseGrokOutput(JSON.stringify({ text: 'from text' }))).toEqual({
      text: 'from text',
    });
  });

  it('falls back to the last result line of NDJSON stream output', () => {
    const stream = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', text: 'thinking' }),
      JSON.stringify({ type: 'result', result: 'final answer', model: 'grok-4.5' }),
    ].join('\n');
    expect(_internals.parseGrokOutput(stream)).toEqual({
      text: 'final answer',
      resolvedModel: 'grok-4.5',
    });
  });

  it('returns cleaned raw text when nothing parses as a result', () => {
    expect(_internals.parseGrokOutput('not json at all')).toEqual({ text: 'not json at all' });
  });

  it('uses generic failure text when stderr only echoes the prompt', () => {
    expect(_internals.clampGrokFailure('PROMPT\n', 'PROMPT')).toBe('Grok CLI failed');
  });

  it('spawns the grok binary and allowlists XAI_API_KEY in the spawn env', async () => {
    const processManager = new FakeProcessManager();
    const provider = createGrokCliProvider(processManager as unknown as ProcessManager);
    const resultPromise = provider.generate(req());

    processManager.emit('output', 'proc-1', JSON.stringify({ type: 'result', result: 'ok' }));
    processManager.emit('exit', 'proc-1', 0);
    await resultPromise;

    expect(processManager.spawnWithStdin).toHaveBeenCalledWith(
      'grok',
      'grok',
      expect.any(Array),
      '/tmp/wt',
      'PROMPT',
      't1',
      expect.any(Object),
    );
    const options = processManager.spawnWithStdin.mock.calls[0]?.[6];
    expect(options?.envKeyAllowlist).toContain('XAI_API_KEY');
  });

  it('clamps failures without leaking later stderr lines', async () => {
    const processManager = new FakeProcessManager();
    const provider = createGrokCliProvider(processManager as unknown as ProcessManager);
    const resultPromise = provider.generate(req());

    processManager.emit('output', 'proc-1', 'PROMPT\nAuth failed\n'.repeat(50));
    processManager.emit('exit', 'proc-1', 1);

    const result = await resultPromise;
    expect(result.providerError?.message).toBe('Auth failed');
    expect(result.providerError?.message).not.toContain('PROMPT');
    expect(result.providerError?.retryable).toBe(true);
  });

  it('reports binary-missing when process spawn throws', async () => {
    const processManager = new FakeProcessManager();
    processManager.spawnWithStdin.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    const provider = createGrokCliProvider(processManager as unknown as ProcessManager);

    const result = await provider.generate(req());

    expect(result.exitCode).toBe(127);
    expect(result.providerError).toEqual({
      kind: 'binary_missing',
      message: 'grok CLI not found on PATH',
      retryable: false,
    });
  });

  it('reports a healthy provider shell', async () => {
    const provider = createGrokCliProvider(new FakeProcessManager() as unknown as ProcessManager);

    await expect(provider.healthCheck()).resolves.toEqual({ ok: true });
  });

  it('supports only the execute phase (no read-only mode available)', () => {
    const provider = createGrokCliProvider(new FakeProcessManager() as unknown as ProcessManager);

    expect([...provider.supports]).toEqual(['execute']);
    expect(provider.supports.has('plan')).toBe(false);
    expect(provider.supports.has('review')).toBe(false);
    expect(provider.supports.has('revision')).toBe(false);
    expect(provider.supports.has('verify')).toBe(false);
  });
});
