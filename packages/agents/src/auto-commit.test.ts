import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

import { generateCommitGroups, parseAndValidate } from './auto-commit';

const dirty = new Set(['a.ts', 'b.ts', 'c.ts']);

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function createFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: vi.fn() };
  proc.kill = vi.fn();
  return {
    proc,
    close: (code: number, output: { stdout?: string; stderr?: string } = {}) => {
      if (output.stdout) proc.stdout.emit('data', output.stdout);
      if (output.stderr) proc.stderr.emit('data', output.stderr);
      proc.emit('close', code);
    },
  };
}

async function waitForSpawnCount(count: number) {
  for (let i = 0; i < 20; i++) {
    if (spawnMock.mock.calls.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Expected ${count} spawned processes, got ${spawnMock.mock.calls.length}`);
}

describe('parseAndValidate', () => {
  it('accepts valid JSON covering full dirty set', () => {
    const raw = JSON.stringify({
      groups: [
        { files: ['a.ts', 'b.ts'], message: 'feat: thing' },
        { files: ['c.ts'], message: 'chore: other' },
      ],
    });
    const r = parseAndValidate(raw, dirty);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.groups).toHaveLength(2);
  });

  it('strips markdown fences', () => {
    const raw = '```json\n{"groups":[{"files":["a.ts","b.ts","c.ts"],"message":"chore: x"}]}\n```';
    const r = parseAndValidate(raw, dirty);
    expect(r.ok).toBe(true);
  });

  it('rejects malformed JSON', () => {
    const r = parseAndValidate('not json', dirty);
    expect(r.ok).toBe(false);
  });

  it('rejects hallucinated files', () => {
    const raw = JSON.stringify({
      groups: [{ files: ['a.ts', 'fake.ts'], message: 'feat: x' }],
    });
    const r = parseAndValidate(raw, dirty);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('hallucinated');
  });

  it('rejects duplicates across groups', () => {
    const raw = JSON.stringify({
      groups: [
        { files: ['a.ts'], message: 'feat: x' },
        { files: ['a.ts', 'b.ts', 'c.ts'], message: 'feat: y' },
      ],
    });
    const r = parseAndValidate(raw, dirty);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('duplicate');
  });

  it('rejects orphaned files', () => {
    const raw = JSON.stringify({
      groups: [{ files: ['a.ts', 'b.ts'], message: 'feat: x' }],
    });
    const r = parseAndValidate(raw, dirty);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('orphan');
  });

  it('rejects empty groups array', () => {
    const r = parseAndValidate(JSON.stringify({ groups: [] }), dirty);
    expect(r.ok).toBe(false);
  });

  it('rejects messages over 200 chars', () => {
    const long = 'a'.repeat(201);
    const raw = JSON.stringify({
      groups: [{ files: ['a.ts', 'b.ts', 'c.ts'], message: long }],
    });
    const r = parseAndValidate(raw, dirty);
    expect(r.ok).toBe(false);
  });

  it('rejects malformed group shapes and empty messages', () => {
    expect(parseAndValidate(JSON.stringify({ nope: [] }), dirty)).toMatchObject({
      ok: false,
      reason: 'missing groups',
    });
    expect(parseAndValidate(JSON.stringify({ groups: [null] }), dirty)).toMatchObject({
      ok: false,
      reason: 'group not object',
    });
    expect(
      parseAndValidate(JSON.stringify({ groups: [{ files: [], message: 'x' }] }), dirty),
    ).toMatchObject({ ok: false, reason: 'empty files' });
    expect(
      parseAndValidate(JSON.stringify({ groups: [{ files: ['a.ts'], message: '' }] }), dirty),
    ).toMatchObject({ ok: false, reason: 'empty message' });
    expect(
      parseAndValidate(JSON.stringify({ groups: [{ files: [42], message: 'x' }] }), dirty),
    ).toMatchObject({ ok: false, reason: 'non-string file' });
    expect(parseAndValidate(JSON.stringify(null), dirty)).toMatchObject({
      ok: false,
      reason: 'missing groups',
    });
  });
});

describe('generateCommitGroups', () => {
  it('returns an error when there are no dirty files', async () => {
    await expect(
      generateCommitGroups({
        provider: 'claude',
        model: 'claude',
        dirtyFiles: [],
        diff: '',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ ok: false, error: 'no dirty files' });
  });

  it('falls back offline when Claude auto-commit generation is disabled', async () => {
    await expect(
      generateCommitGroups({
        provider: 'claude',
        model: 'claude-opus-4-6',
        cwd: '/repo',
        dirtyFiles: ['a.ts', 'b.ts'],
        diff: 'diff',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      ok: true,
      groups: [{ files: ['a.ts', 'b.ts'], message: 'chore: update 2 files' }],
      fallbackUsed: true,
      modelUsed: 'claude-opus-4-6',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('generates split groups with OpenRouter when an API key is provided', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  groups: [{ files: ['a.ts'], message: 'fix: update a' }],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          model: 'anthropic/claude-sonnet-4.6',
        }),
      ),
    );

    await expect(
      generateCommitGroups({
        provider: 'openrouter',
        apiKey: 'sk-test',
        model: 'openrouter/auto',
        dirtyFiles: ['a.ts'],
        diff: 'diff',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      ok: true,
      groups: [{ files: ['a.ts'], message: 'fix: update a' }],
      fallbackUsed: false,
      modelUsed: 'anthropic/claude-sonnet-4.6',
    });
  });

  it('defaults to OpenRouter provider when provider is omitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  groups: [{ files: ['a.ts'], message: 'fix: update a' }],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          model: 'openrouter/auto',
        }),
      ),
    );

    await expect(
      generateCommitGroups({
        apiKey: 'sk-test',
        model: 'openrouter/auto',
        dirtyFiles: ['a.ts'],
        diff: 'diff',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      ok: true,
      groups: [{ files: ['a.ts'], message: 'fix: update a' }],
      fallbackUsed: false,
      modelUsed: 'openrouter/auto',
    });
  });

  it('falls back to requested OpenRouter model when the response model is null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  groups: [{ files: ['a.ts'], message: 'fix: update a' }],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          model: null,
        }),
      ),
    );

    await expect(
      generateCommitGroups({
        apiKey: 'sk-test',
        model: 'openrouter/auto',
        dirtyFiles: ['a.ts'],
        diff: 'x'.repeat(120_010),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      ok: true,
      groups: [{ files: ['a.ts'], message: 'fix: update a' }],
      fallbackUsed: false,
      modelUsed: 'openrouter/auto',
    });

    const body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.messages[1].content).toContain('[...truncated 10 chars...]');
  });

  it('falls back offline when Codex auto-commit generation is disabled', async () => {
    await expect(
      generateCommitGroups({
        provider: 'codex',
        model: 'codex',
        dirtyFiles: ['a.ts', 'b.ts'],
        diff: 'diff',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      ok: true,
      groups: [{ files: ['a.ts', 'b.ts'], message: 'chore: update 2 files' }],
      fallbackUsed: true,
      modelUsed: 'codex',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('uses single mode directly and falls back to an offline message on CLI failure', async () => {
    await expect(
      generateCommitGroups({
        provider: 'claude',
        model: 'claude',
        mode: 'single',
        dirtyFiles: ['a.ts', 'b.ts'],
        diff: 'diff',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      ok: true,
      groups: [{ files: ['a.ts', 'b.ts'], message: 'chore: update 2 files' }],
      fallbackUsed: false,
      modelUsed: 'claude',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('uses a generic fallback message when single mode returns empty content', async () => {
    await expect(
      generateCommitGroups({
        provider: 'claude',
        model: 'claude',
        mode: 'single',
        dirtyFiles: ['a.ts', 'b.ts'],
        diff: 'diff',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      ok: true,
      groups: [{ files: ['a.ts', 'b.ts'], message: 'chore: update 2 files' }],
      fallbackUsed: false,
      modelUsed: 'claude',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('falls back after split generation throws on both attempts', async () => {
    await expect(
      generateCommitGroups({
        provider: 'codex',
        model: 'gpt-5.4',
        dirtyFiles: ['a.ts'],
        diff: 'diff',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      ok: true,
      groups: [{ files: ['a.ts'], message: 'chore: update 1 files' }],
      fallbackUsed: true,
      modelUsed: 'gpt-5.4',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('uses offline fallback when fallback single generation cannot spawn local CLIs', async () => {
    const controller = new AbortController();
    await expect(
      generateCommitGroups({
        provider: 'codex',
        model: 'codex',
        dirtyFiles: ['a.ts'],
        diff: 'diff',
        signal: controller.signal,
      }),
    ).resolves.toEqual({
      ok: true,
      groups: [{ files: ['a.ts'], message: 'chore: update 1 files' }],
      fallbackUsed: true,
      modelUsed: 'codex',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('uses offline fallback when a nonzero CLI exit has no stderr', async () => {
    await expect(
      generateCommitGroups({
        provider: 'claude',
        model: 'claude',
        mode: 'single',
        dirtyFiles: ['a.ts'],
        diff: 'diff',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      ok: true,
      groups: [{ files: ['a.ts'], message: 'chore: update 1 files' }],
      fallbackUsed: false,
      modelUsed: 'claude',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('uses offline fallback when OpenRouter is selected without an API key', async () => {
    await expect(
      generateCommitGroups({
        model: 'openrouter/auto',
        dirtyFiles: ['a.ts'],
        diff: 'diff',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      ok: true,
      groups: [{ files: ['a.ts'], message: 'chore: update 1 files' }],
      fallbackUsed: true,
      modelUsed: 'openrouter/auto',
    });
  });

  it('uses offline fallback for unsupported auto-commit providers', async () => {
    await expect(
      generateCommitGroups({
        provider: 'gemini',
        model: 'gemini',
        dirtyFiles: ['a.ts'],
        diff: 'diff',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      ok: true,
      groups: [{ files: ['a.ts'], message: 'chore: update 1 files' }],
      fallbackUsed: true,
      modelUsed: 'gemini',
    });
  });

  it('uses offline fallback when the signal is already aborted before disabled CLI generation', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      generateCommitGroups({
        provider: 'codex',
        model: 'codex',
        dirtyFiles: ['a.ts'],
        diff: 'diff',
        signal: controller.signal,
      }),
    ).resolves.toEqual({
      ok: true,
      groups: [{ files: ['a.ts'], message: 'chore: update 1 files' }],
      fallbackUsed: true,
      modelUsed: 'codex',
    });
  });

  it('uses offline fallback when aborting disabled CLI generation', async () => {
    const controller = new AbortController();
    const promise = generateCommitGroups({
      provider: 'claude',
      model: 'claude',
      mode: 'single',
      dirtyFiles: ['a.ts'],
      diff: 'diff',
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).resolves.toEqual({
      ok: true,
      groups: [{ files: ['a.ts'], message: 'chore: update 1 files' }],
      fallbackUsed: false,
      modelUsed: 'claude',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('falls back when CLI generation times out', async () => {
    vi.useFakeTimers();
    try {
      const promise = generateCommitGroups({
        provider: 'claude',
        model: 'claude',
        mode: 'single',
        dirtyFiles: ['a.ts'],
        diff: 'diff',
        signal: new AbortController().signal,
      });

      await vi.advanceTimersByTimeAsync(120_000);

      await expect(promise).resolves.toEqual({
        ok: true,
        groups: [{ files: ['a.ts'], message: 'chore: update 1 files' }],
        fallbackUsed: false,
        modelUsed: 'claude',
      });
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
