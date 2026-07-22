import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessManager } from '../process-manager';

const srtMocks = vi.hoisted(() => ({
  build: vi.fn(),
}));

vi.mock('../sandbox/srt', () => ({
  buildSandboxedClaudeExecuteCommand: srtMocks.build,
}));

import { createClaudeCliProvider } from './cli-provider';
import type { ProviderRequest } from './types';

function mockPm() {
  const spawnCalls: unknown[] = [];
  const pm = {
    spawn: vi.fn(() => {
      spawnCalls.push(true);
      return { id: 'p' };
    }),
    kill: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as ProcessManager & { spawnWithStdin?: (...a: unknown[]) => { id: string } };
  (pm as unknown as { spawnWithStdin: unknown }).spawnWithStdin = vi.fn(() => {
    spawnCalls.push(true);
    return { id: 'p' };
  });
  return { pm, spawnCalls };
}

describe('programmatic claude execute — srt unavailable', () => {
  beforeEach(() => {
    srtMocks.build.mockReset().mockResolvedValue(null);
  });

  it('fails closed with binary_missing and never spawns', async () => {
    const { pm, spawnCalls } = mockPm();
    const provider = createClaudeCliProvider(pm);

    const req: ProviderRequest = {
      phase: 'execute',
      prompt: 'DO IT',
      cwd: '/tmp/wt',
      projectPath: '/tmp/proj',
      signal: new AbortController().signal,
      threadId: 't1',
      phaseHints: {
        runMode: 'programmatic',
        osSandbox: { backend: 'srt', networkPolicy: 'anthropic-github', extraWritePaths: [] },
      },
    };

    const result = await provider.generate(req);

    expect(spawnCalls).toHaveLength(0);
    expect(result.exitCode).toBe(127);
    expect(result.providerError?.kind).toBe('binary_missing');
    expect(result.rawOutput).toMatch(/sandbox-runtime/i);
    expect(result.rawOutput.length).toBeLessThanOrEqual(280);
    expect(result.rawOutput).not.toContain('DO IT');
  });

  it('bounds policy setup failures without leaking exception content', async () => {
    const { pm, spawnCalls } = mockPm();
    const provider = createClaudeCliProvider(pm);
    srtMocks.build.mockRejectedValueOnce(
      new Error('invalid policy for DO IT with token sk-ant-secret\n'.repeat(40)),
    );

    const result = await provider.generate({
      phase: 'execute',
      prompt: 'DO IT with token sk-ant-secret',
      cwd: '/tmp/wt',
      projectPath: '/tmp/proj',
      signal: new AbortController().signal,
      threadId: 't1',
      phaseHints: {
        runMode: 'programmatic',
        osSandbox: { backend: 'srt', networkPolicy: 'anthropic-github', extraWritePaths: [] },
      },
    });

    expect(spawnCalls).toHaveLength(0);
    expect(result.exitCode).toBe(1);
    expect(result.providerError?.kind).toBe('unexpected_stop');
    expect(result.providerError?.message).toBe(result.rawOutput);
    expect(result.rawOutput).toMatch(/policy setup failed/i);
    expect(result.rawOutput.length).toBeLessThanOrEqual(280);
    expect(result.rawOutput).not.toContain('DO IT');
    expect(result.rawOutput).not.toContain('sk-ant-secret');
  });
});
