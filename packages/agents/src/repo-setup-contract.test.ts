import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRepoSetupContract } from './repo-setup-contract';

const tempDirs: string[] = [];

function makeProject() {
  const dir = path.join(
    os.tmpdir(),
    `shipcode-setup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(path.join(dir, '.shipcode'), { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadRepoSetupContract', () => {
  it('returns null when the repo contract file is missing', () => {
    const projectDir = makeProject();
    expect(loadRepoSetupContract(projectDir)).toBeNull();
  });

  it('loads and normalizes a valid repo contract', () => {
    const projectDir = makeProject();
    writeFileSync(
      path.join(projectDir, '.shipcode', 'setup.json'),
      JSON.stringify({
        setupCommands: ['bun install'],
        verifyCommands: ['bun run test'],
        envFiles: [{ source: '.env.local' }],
        testingContext: 'Vitest only.',
      }),
    );

    const loaded = loadRepoSetupContract(projectDir);
    expect(loaded?.contract).toEqual({
      version: 1,
      setupCommands: ['bun install'],
      verifyCommands: ['bun run test'],
      envFiles: [{ source: '.env.local', required: true }],
      setupBeforeVerify: false,
      testingContext: 'Vitest only.',
    });
  });

  it('throws a short actionable error for invalid contract shape', () => {
    const projectDir = makeProject();
    writeFileSync(
      path.join(projectDir, '.shipcode', 'setup.json'),
      JSON.stringify({
        version: 2,
      }),
    );

    expect(() => loadRepoSetupContract(projectDir)).toThrow(
      /Invalid repo setup contract at \.shipcode\/setup\.json/,
    );
  });

  it('labels root-level contract validation failures', () => {
    const projectDir = makeProject();
    writeFileSync(path.join(projectDir, '.shipcode', 'setup.json'), 'null');

    expect(() => loadRepoSetupContract(projectDir)).toThrow(/root:/);
  });

  it('throws a short actionable error for malformed JSON', () => {
    const projectDir = makeProject();
    writeFileSync(path.join(projectDir, '.shipcode', 'setup.json'), '{not-json');

    expect(() => loadRepoSetupContract(projectDir)).toThrow(
      /Invalid repo setup contract at \.shipcode\/setup\.json/,
    );
  });

  it('formats non-Error JSON parse failures', () => {
    const projectDir = makeProject();
    writeFileSync(path.join(projectDir, '.shipcode', 'setup.json'), '{"version":1}');
    const realParse = JSON.parse;
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation((value, reviver) => {
      if (typeof value === 'string' && value.includes('"version":1')) {
        throw 'plain parse failure';
      }
      return realParse(value, reviver);
    });

    expect(() => loadRepoSetupContract(projectDir)).toThrow(/plain parse failure/);

    parseSpy.mockRestore();
  });
});
