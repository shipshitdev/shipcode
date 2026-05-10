import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

import {
  generateMemoryFiles,
  inspectRepoMemory,
  listMemoryFiles,
  readMemoryFile,
} from './memory-generator';

function createFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { chunks: string[]; write: (chunk: string) => boolean; end: () => void };
    kill: (signal: string) => void;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    chunks: [],
    write: (chunk: string) => {
      proc.stdin.chunks.push(chunk);
      return true;
    },
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

  it('reports memory file status, obsolete context dirs, and safe reads', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'shipcode-memory-status-'));
    mkdirSync(join(projectPath, '.agents/memory'), { recursive: true });
    mkdirSync(join(projectPath, '.agents/context'), { recursive: true });
    writeFileSync(join(projectPath, '.agents/memory/goal.md'), 'Goal body', 'utf8');

    const files = listMemoryFiles(projectPath);
    expect(files.find((file) => file.name === 'goal.md')).toMatchObject({
      exists: true,
      size: 'Goal body'.length,
    });
    expect(files.find((file) => file.name === 'architecture.md')).toMatchObject({
      exists: false,
    });
    expect(inspectRepoMemory(projectPath).hasObsoleteContextDirectory).toBe(true);
    expect(readMemoryFile(projectPath, 'goal.md')).toBe('Goal body');
    expect(readMemoryFile(projectPath, 'not-generated.md')).toBeNull();
    expect(readMemoryFile(projectPath, 'constraints.md')).toBeNull();

    rmSync(projectPath, { recursive: true, force: true });
  });

  it('reports no obsolete context directory when it is absent', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'shipcode-memory-no-context-'));

    expect(inspectRepoMemory(projectPath).hasObsoleteContextDirectory).toBe(false);

    rmSync(projectPath, { recursive: true, force: true });
  });

  it('passes missing source markers to Codex and parses a raw fenced response', async () => {
    const fake = createFakeProc();
    mockSpawn.mockReturnValueOnce(fake.proc);
    const projectPath = mkdtempSync(join(tmpdir(), 'shipcode-memory-codex-'));

    const promise = generateMemoryFiles(projectPath, 'codex');
    await Promise.resolve();

    expect(mockSpawn).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['exec', '-', '--sandbox', 'read-only']),
      expect.objectContaining({ cwd: projectPath }),
    );
    expect(fake.proc.stdin.chunks.join('')).toContain('### README.md\n(not found)');

    fake.close(0, {
      stdout:
        '```shipcode-memory\n{"goal":"Goal","architecture":"Architecture","constraints":"Constraints","doDont":"Do"}\n```',
    });

    await expect(promise).resolves.toMatchObject({
      success: true,
      written: ['goal.md', 'architecture.md', 'constraints.md', 'do-dont.md'],
    });

    rmSync(projectPath, { recursive: true, force: true });
  });

  it('returns a failure when the CLI exits non-zero or emits invalid memory JSON', async () => {
    const cliFailure = createFakeProc();
    mockSpawn.mockReturnValueOnce(cliFailure.proc);
    const projectPath = mkdtempSync(join(tmpdir(), 'shipcode-memory-failures-'));

    const failedCli = generateMemoryFiles(projectPath, 'claude');
    await Promise.resolve();
    cliFailure.close(2, { stderr: 'no auth' });
    await expect(failedCli).resolves.toMatchObject({
      success: false,
      written: [],
      error: expect.stringContaining('Claude CLI exited 2'),
    });

    const invalidJson = createFakeProc();
    mockSpawn.mockReturnValueOnce(invalidJson.proc);
    const failedJson = generateMemoryFiles(projectPath, 'claude');
    await Promise.resolve();
    invalidJson.close(0, { stdout: '```shipcode-memory\nnot json\n```' });
    await expect(failedJson).resolves.toMatchObject({
      success: false,
      written: [],
      error: expect.stringContaining('Failed to parse memory JSON'),
    });

    const plainParseError = createFakeProc();
    mockSpawn.mockReturnValueOnce(plainParseError.proc);
    const realParse = JSON.parse;
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation((value, reviver) => {
      if (typeof value === 'string' && value.includes('"goal":"Goal"')) {
        throw 'plain parse failure';
      }
      return realParse(value, reviver);
    });
    const failedPlainParse = generateMemoryFiles(projectPath, 'claude');
    await Promise.resolve();
    plainParseError.close(0, {
      stdout:
        '```shipcode-memory\n{"goal":"Goal","architecture":"A","constraints":"C","doDont":"D"}\n```',
    });
    await expect(failedPlainParse).resolves.toMatchObject({
      success: false,
      written: [],
      error: expect.stringContaining('plain parse failure'),
    });
    parseSpy.mockRestore();

    const missingKey = createFakeProc();
    mockSpawn.mockReturnValueOnce(missingKey.proc);
    const failedMissingKey = generateMemoryFiles(projectPath, 'claude');
    await Promise.resolve();
    missingKey.close(0, {
      stdout: '```shipcode-memory\n{"goal":"Goal","architecture":"A","constraints":"C"}\n```',
    });
    await expect(failedMissingKey).resolves.toMatchObject({
      success: false,
      written: [],
      error: expect.stringContaining('empty `doDont` key'),
    });

    const noFence = createFakeProc();
    mockSpawn.mockReturnValueOnce(noFence.proc);
    const failedFence = generateMemoryFiles(projectPath, 'claude');
    await Promise.resolve();
    noFence.close(0, { stdout: 'plain text' });
    await expect(failedFence).resolves.toMatchObject({
      success: false,
      written: [],
      error: expect.stringContaining('No `shipcode-memory` fenced block'),
    });

    rmSync(projectPath, { recursive: true, force: true });
  });
});
