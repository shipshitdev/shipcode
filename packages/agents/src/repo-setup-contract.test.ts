import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
});
