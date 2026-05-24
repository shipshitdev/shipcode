import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => {
  const mod = {
    exec: vi.fn(),
    execFileSync: vi.fn(() => ''),
    spawn: mockSpawn,
  };
  return { ...mod, default: mod };
});

import { generateContextFiles } from './context-generator';
import { createFakeProc } from './test-fake-proc';

describe('generateContextFiles', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the structured Claude stdout error when stderr is empty', async () => {
    const fake = createFakeProc();
    mockSpawn.mockReturnValueOnce(fake.proc);

    const promise = generateContextFiles('/repo', 'claude');

    await Promise.resolve();

    fake.close(1, {
      stdout:
        '{"type":"result","subtype":"success","is_error":true,"result":"You\\u2019ve hit your limit \\u00b7 resets 6am (Europe/Malta)"}',
    });

    await expect(promise).resolves.toEqual({
      success: false,
      error: 'Claude CLI exited 1: You’ve hit your limit · resets 6am (Europe/Malta)',
      written: [],
    });
  });

  it('writes canonical repo memory files with frontmatter', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'shipcode-context-generator-'));
    const fake = createFakeProc();
    mockSpawn.mockReturnValueOnce(fake.proc);

    const promise = generateContextFiles(repoDir, 'claude');

    await Promise.resolve();

    fake.close(0, {
      stdout: [
        '```shipcode-memory',
        JSON.stringify({
          goal: '# Goal\n\nShip customer-ready software.',
          architecture: '# Architecture\n\nBun monorepo with Electron desktop app.',
          constraints: '# Constraints\n\nAlways typecheck before shipping.',
          doDont: "# Do / Don't\n\n- Do follow existing patterns.\n- Don't invent new ones.",
        }),
        '```',
      ].join('\n'),
    });

    await expect(promise).resolves.toEqual({
      success: true,
      written: ['goal.md', 'architecture.md', 'constraints.md', 'do-dont.md'],
    });

    expect(readFileSync(join(repoDir, '.agents/memory/goal.md'), 'utf8')).toContain(
      'name: repo_goal',
    );
    expect(readFileSync(join(repoDir, '.agents/memory/goal.md'), 'utf8')).toContain(
      '# Goal\n\nShip customer-ready software.',
    );
    expect(readFileSync(join(repoDir, '.agents/memory/do-dont.md'), 'utf8')).toContain(
      'name: repo_do_dont',
    );
    expect(readFileSync(join(repoDir, '.agents/memory/do-dont.md'), 'utf8')).toContain(
      "# Do / Don't",
    );

    rmSync(repoDir, { recursive: true, force: true });
  });
});
