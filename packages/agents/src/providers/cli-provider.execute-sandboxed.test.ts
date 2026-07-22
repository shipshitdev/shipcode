import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ProcessManager } from '../process-manager';
import { createClaudeCliProvider } from './cli-provider';
import type { ProviderRequest } from './types';

/** Minimal ProcessManager mock: records spawnWithStdin calls, lets the test fire exit. */
function mockPm() {
  type Listener = (...args: unknown[]) => void;
  const listeners: Record<string, Listener[]> = {};
  const spawnCalls: Array<{ command: string; args: string[]; cwd: string; stdin?: string }> = [];
  let n = 0;
  const pm = {
    spawn: vi.fn((_t: string, command: string, args: string[], cwd: string) => {
      n++;
      spawnCalls.push({ command, args, cwd });
      return { id: `proc-${n}` };
    }),
    kill: vi.fn(),
    on: vi.fn((event: string, h: Listener) => {
      const handlers = listeners[event] ?? [];
      handlers.push(h);
      listeners[event] = handlers;
    }),
    removeListener: vi.fn((event: string, h: Listener) => {
      listeners[event] = (listeners[event] ?? []).filter((x) => x !== h);
    }),
  } as unknown as ProcessManager & {
    spawnWithStdin?: (...a: unknown[]) => { id: string };
  };
  (pm as unknown as { spawnWithStdin: unknown }).spawnWithStdin = vi.fn(
    (_t, command: string, args: string[], cwd: string, stdin: string) => {
      n++;
      spawnCalls.push({ command, args, cwd, stdin });
      return { id: `proc-${n}` };
    },
  );
  async function trigger(event: string, ...args: unknown[]) {
    for (const h of [...(listeners[event] ?? [])]) h(...args);
    await new Promise((r) => setImmediate(r));
  }
  return { pm, trigger, spawnCalls };
}

function mockFailingPm(secret: string) {
  const pm = {
    spawn: vi.fn(),
    spawnWithStdin: vi.fn(() => {
      throw new Error(`spawn failed: ${secret}\n${'x'.repeat(500)}`);
    }),
    kill: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as ProcessManager;
  return pm;
}

function executeReq(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    phase: 'execute',
    prompt: 'IMPLEMENT THE THING',
    cwd: '/tmp/wt',
    projectPath: '/tmp/proj',
    signal: new AbortController().signal,
    threadId: 't1',
    ...overrides,
  };
}

async function waitFor(calls: unknown[]): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (calls.length > 0) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('programmatic claude execute — sandbox gating', () => {
  it('fails closed when programmatic execute has no OS sandbox hint', async () => {
    const { pm, spawnCalls } = mockPm();
    const provider = createClaudeCliProvider(pm);

    const result = await provider.generate(executeReq({ phaseHints: { runMode: 'programmatic' } }));

    expect(spawnCalls).toHaveLength(0); // never spawned
    expect(result.exitCode).toBe(1);
    expect(result.providerError?.kind).toBe('unexpected_stop');
    expect(result.rawOutput).toMatch(/requires the OS sandbox/i);
  });

  it('wraps claude -p in srt when the sandbox hint is present, then cleans up the policy', async () => {
    if (process.platform === 'win32') return; // srt unsupported
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-wt-'));
    try {
      const { pm, trigger, spawnCalls } = mockPm();
      const provider = createClaudeCliProvider(pm);

      const promise = provider.generate(
        executeReq({
          cwd: wt,
          phaseHints: {
            runMode: 'programmatic',
            osSandbox: { backend: 'srt', networkPolicy: 'anthropic-github', extraWritePaths: [] },
          },
        }),
      );

      await waitFor(spawnCalls);
      expect(spawnCalls).toHaveLength(1);
      const call = spawnCalls[0];
      // Spawned command is the srt CLI, not claude directly.
      expect(call.command).toMatch(/cli\.js$/);
      expect(call.args[0]).toBe('-s');
      const policyPath = call.args[1];
      expect(call.args[2]).toBe('claude');
      // Inner claude execute args follow, in programmatic stdin mode.
      expect(call.args).toContain('-p');
      expect(call.args).toContain('--dangerously-skip-permissions');
      // Prompt is piped via stdin, never argv.
      expect(call.stdin).toBe('IMPLEMENT THE THING');

      await trigger('exit', 'proc-1', 0);
      await promise;

      // The per-run policy file is removed after the run settles.
      expect(fs.existsSync(policyPath)).toBe(false);
    } finally {
      fs.rmSync(wt, { recursive: true, force: true });
    }
  });

  it('interactive execute does not use the srt sandbox', async () => {
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-int-wt-'));
    try {
      const { pm, trigger, spawnCalls } = mockPm();
      const provider = createClaudeCliProvider(pm);

      const promise = provider.generate(
        executeReq({ cwd: wt, phaseHints: { runMode: 'interactive' } }),
      );

      await waitFor(spawnCalls);
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].command).toBe('claude');
      expect(spawnCalls[0].args).toContain('--permission-mode');

      await trigger('exit', 'proc-1', 0);
      await promise;
    } finally {
      fs.rmSync(wt, { recursive: true, force: true });
    }
  });

  it('bounds sandbox spawn failures without leaking prompt or secret material', async () => {
    if (process.platform === 'win32') return; // srt unsupported
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-fail-wt-'));
    const secret = 'sk-ant-spawn-secret';
    try {
      const provider = createClaudeCliProvider(mockFailingPm(secret));

      const result = await provider.generate(
        executeReq({
          prompt: `IMPLEMENT WITH ${secret}`,
          cwd: wt,
          phaseHints: {
            runMode: 'programmatic',
            osSandbox: { backend: 'srt', networkPolicy: 'anthropic-github', extraWritePaths: [] },
          },
        }),
      );

      expect(result.exitCode).toBe(127);
      expect(result.providerError?.kind).toBe('binary_missing');
      expect(result.rawOutput).toMatch(/srt sandbox failed to start/i);
      expect(result.rawOutput.length).toBeLessThanOrEqual(280);
      expect(result.rawOutput).not.toContain(secret);
      expect(result.rawOutput).not.toContain('IMPLEMENT WITH');
    } finally {
      fs.rmSync(wt, { recursive: true, force: true });
    }
  });
});
