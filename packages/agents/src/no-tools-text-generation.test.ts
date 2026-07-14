import { afterEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

import { runNoToolsTextGeneration } from './no-tools-text-generation';
import { createFakeProc } from './test-fake-proc';

describe('runNoToolsTextGeneration', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('pipes prompts through stdin with canonical no-tools args and a least-privilege env', async () => {
    const previousSecret = process.env.SHIPCODE_PRIVATE_TOKEN;
    process.env.SHIPCODE_PRIVATE_TOKEN = 'must-not-leak';
    const fake = createFakeProc({ captureStdin: true });
    mockSpawn.mockReturnValueOnce(fake.proc);

    try {
      const promise = runNoToolsTextGeneration({
        prompt: 'PROMPT_WITH_FRONTMATTER\n---',
        cwd: '/repo',
        timeoutMs: 5_000,
        maxTurns: 3,
        modelId: 'claude-sonnet-4-6',
        reasoningEffort: 'low',
      });

      await Promise.resolve();

      const [, args, spawnOptions] = mockSpawn.mock.calls[0] as [
        string,
        string[],
        { env: Record<string, string> },
      ];
      expect(args).toEqual([
        '-p',
        '--model',
        'claude-sonnet-4-6',
        '--output-format',
        'json',
        '--max-turns',
        '3',
        '--allowedTools',
        '',
      ]);
      expect(args).not.toContain('PROMPT_WITH_FRONTMATTER\n---');
      expect(fake.stdinWrites).toEqual(['PROMPT_WITH_FRONTMATTER\n---']);
      expect(spawnOptions.env.SHIPCODE_PRIVATE_TOKEN).toBeUndefined();

      fake.close(0, { stdout: 'done' });
      await expect(promise).resolves.toBe('done');
    } finally {
      if (previousSecret === undefined) delete process.env.SHIPCODE_PRIVATE_TOKEN;
      else process.env.SHIPCODE_PRIVATE_TOKEN = previousSecret;
    }
  });

  it('rejects model IDs that could inject CLI arguments before spawning', () => {
    expect(() =>
      runNoToolsTextGeneration({
        prompt: 'prompt',
        cwd: '/repo',
        timeoutMs: 5_000,
        maxTurns: 1,
        modelId: '--allowedTools=Bash',
      }),
    ).toThrow('Invalid model ID: --allowedTools=Bash');
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
