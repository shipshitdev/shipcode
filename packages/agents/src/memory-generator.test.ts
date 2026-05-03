import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('./health-check', () => ({
  shellExecEnv: () => ({ PATH: '/usr/bin' }),
}));

import { generateMemoryFiles } from './memory-generator';

function createFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: (chunk: string) => boolean; end: () => void };
    kill: (signal: string) => void;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    write: () => true,
    end: () => {},
  };
  proc.kill = vi.fn();
  return {
    proc,
    close: (code: number, options?: { stdout?: string; stderr?: string }) => {
      if (options?.stdout) proc.stdout.emit('data', options.stdout);
      if (options?.stderr) proc.stderr.emit('data', options.stderr);
      proc.emit('close', code);
    },
  };
}

describe('generateMemoryFiles', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('writes the generated memory files from a Claude result envelope', async () => {
    const fake = createFakeProc();
    mockSpawn.mockReturnValueOnce(fake.proc);

    const projectPath = mkdtempSync(join(tmpdir(), 'shipcode-memory-generator-'));
    writeFileSync(join(projectPath, 'README.md'), '# Repo\n', 'utf8');

    const promise = generateMemoryFiles(projectPath, 'claude');

    await Promise.resolve();

    fake.close(0, {
      stdout: JSON.stringify({
        result:
          '```shipcode-memory\n{"goal":"Goal body","architecture":"Architecture body","constraints":"Constraints body","doDont":"Do body"}\n```',
      }),
    });

    await expect(promise).resolves.toMatchObject({
      success: true,
      written: ['goal.md', 'architecture.md', 'constraints.md', 'do-dont.md'],
    });

    expect(readFileSync(join(projectPath, '.agents/memory/goal.md'), 'utf8')).toContain(
      'Goal body',
    );
    expect(readFileSync(join(projectPath, '.agents/memory/architecture.md'), 'utf8')).toContain(
      'Architecture body',
    );

    rmSync(projectPath, { recursive: true, force: true });
  });
});
