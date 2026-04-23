import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectProjectSetup, inspectProjectSetup, writeProjectSetup } from './project-setup';

const tempDirs: string[] = [];

function makeProject() {
  const dir = path.join(
    os.tmpdir(),
    `shipcode-project-setup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('project setup detection', () => {
  it('suggests bun commands from package scripts', () => {
    const projectDir = makeProject();
    writeFileSync(path.join(projectDir, 'bun.lock'), '');
    writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'demo',
        scripts: {
          typecheck: 'tsc --noEmit',
          test: 'vitest run',
          build: 'vite build',
        },
      }),
    );

    const draft = detectProjectSetup(projectDir);

    expect(draft.inspection.status).toBe('missing');
    expect(
      draft.profiles.find((profile: { recommended: boolean }) => profile.recommended)?.kind,
    ).toBe('bun');
    expect(draft.suggestedContract.setupCommands).toEqual(['bun install --frozen-lockfile']);
    expect(draft.suggestedContract.verifyCommands).toEqual([
      'bun run typecheck',
      'bun run test',
      'bun run build',
    ]);
    expect(
      draft.profiles.find((profile: { kind: string }) => profile.kind === 'bun')?.suggestedContract
        .verifyCommands,
    ).toEqual(['bun run typecheck', 'bun run test', 'bun run build']);
  });

  it('detects xcode repos conservatively', () => {
    const projectDir = makeProject();
    mkdirSync(path.join(projectDir, 'Demo.xcodeproj'));
    writeFileSync(path.join(projectDir, 'Package.swift'), '// swift package');

    const draft = detectProjectSetup(projectDir);

    expect(draft.profiles.some((profile: { kind: string }) => profile.kind === 'xcode')).toBe(true);
    expect(draft.suggestedContract.setupCommands).toEqual([
      'xcodebuild -resolvePackageDependencies',
    ]);
    expect(draft.suggestedContract.verifyCommands).toEqual([]);
    expect(draft.suggestedContract.testingContext).toMatch(/scheme and destination/i);
    expect(
      draft.profiles.find((profile: { kind: string }) => profile.kind === 'swiftpm')
        ?.suggestedContract.verifyCommands,
    ).toEqual(['swift test']);
  });

  it('prefers an existing valid setup contract over heuristics', () => {
    const projectDir = makeProject();
    mkdirSync(path.join(projectDir, '.shipcode'), { recursive: true });
    writeFileSync(
      path.join(projectDir, '.shipcode', 'setup.json'),
      JSON.stringify({
        setupCommands: ['bun install'],
        verifyCommands: ['bun run test'],
      }),
    );

    const draft = detectProjectSetup(projectDir);

    expect(draft.inspection.status).toBe('configured');
    expect(draft.suggestedContract.setupCommands).toEqual(['bun install']);
    expect(draft.suggestedContract.verifyCommands).toEqual(['bun run test']);
  });

  it('surfaces invalid setup files with an actionable status', () => {
    const projectDir = makeProject();
    mkdirSync(path.join(projectDir, '.shipcode'), { recursive: true });
    writeFileSync(path.join(projectDir, '.shipcode', 'setup.json'), '{"version":2}');

    const inspection = inspectProjectSetup(projectDir);

    expect(inspection.status).toBe('invalid');
    expect(inspection.error).toMatch(/Invalid repo setup contract/);
  });

  it('writes normalized setup contracts to the repo file', () => {
    const projectDir = makeProject();

    const inspection = writeProjectSetup(projectDir, {
      version: 1,
      setupCommands: ['bun install'],
      verifyCommands: ['bun run test'],
      envFiles: [{ source: '.env.local', required: true }],
      setupBeforeVerify: false,
      testingContext: 'Vitest only.',
    });

    expect(inspection.status).toBe('configured');
    expect(inspection.contract?.setupCommands).toEqual(['bun install']);
    expect(inspection.path).toBe(path.join(projectDir, '.shipcode', 'setup.json'));
  });
});
