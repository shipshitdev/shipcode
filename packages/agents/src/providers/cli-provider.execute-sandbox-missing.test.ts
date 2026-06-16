import { describe, expect, it, vi } from 'vitest';
import type { ProcessManager } from '../process-manager';

// Force the srt sandbox to resolve as unavailable for this whole file.
vi.mock('../sandbox/srt', () => ({
  buildSandboxedClaudeExecuteCommand: vi.fn(async () => null),
  resolveSrt: vi.fn(() => ({
    available: false,
    command: null,
    reason: 'srt sandbox unavailable: @anthropic-ai/sandbox-runtime not installed',
  })),
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
  });
});
