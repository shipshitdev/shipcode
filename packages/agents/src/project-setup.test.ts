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
  it('suggests bun commands from single-package scripts', () => {
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

  it('suggests serialized affected turbo verification for bun workspaces', () => {
    const projectDir = makeProject();
    writeFileSync(path.join(projectDir, 'bun.lock'), '');
    writeFileSync(path.join(projectDir, 'turbo.json'), JSON.stringify({ tasks: {} }));
    writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'demo',
        workspaces: ['apps/*', 'packages/*'],
        devDependencies: {
          turbo: '2.9.10',
        },
        scripts: {
          typecheck: 'turbo run typecheck',
          test: 'turbo run test',
          build: 'turbo run build',
        },
      }),
    );

    const draft = detectProjectSetup(projectDir);
    const expectedTurboCommand =
      'TURBO_SCM_BASE="$' +
      '{TURBO_SCM_BASE:-HEAD}" bunx turbo run typecheck test build --affected --concurrency=1';

    expect(draft.suggestedContract.setupCommands).toEqual(['bun install --frozen-lockfile']);
    expect(draft.suggestedContract.verifyCommands).toEqual([expectedTurboCommand]);
    expect(draft.suggestedContract.testingContext).toMatch(/Turborepo workspace/i);
    expect(draft.suggestedContract.testingContext).toMatch(/--concurrency=1/);
  });

  it('prefers repo-owned affected verification scripts for bun workspaces', () => {
    const projectDir = makeProject();
    writeFileSync(path.join(projectDir, 'bun.lock'), '');
    writeFileSync(path.join(projectDir, 'turbo.json'), JSON.stringify({ tasks: {} }));
    writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'demo',
        workspaces: ['apps/*', 'packages/*'],
        scripts: {
          'verify:affected': 'bun scripts/verify-affected-workspaces.ts',
          test: 'turbo run test',
        },
      }),
    );

    const draft = detectProjectSetup(projectDir);

    expect(draft.suggestedContract.verifyCommands).toEqual(['bun run verify:affected']);
    expect(draft.suggestedContract.testingContext).toMatch(/repo-owned verify:affected/i);
  });

  it('does not suggest full root verification scripts for unscoped workspaces', () => {
    const projectDir = makeProject();
    writeFileSync(path.join(projectDir, 'bun.lock'), '');
    writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'demo',
        workspaces: ['apps/*', 'packages/*'],
        scripts: {
          test: 'vitest run',
          build: 'vite build',
        },
      }),
    );

    const draft = detectProjectSetup(projectDir);

    expect(draft.suggestedContract.verifyCommands).toEqual([]);
    expect(draft.suggestedContract.testingContext).toMatch(/Full root verification scripts/i);
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

  it('recommends xcode over incidental package.json markers', () => {
    const projectDir = makeProject();
    mkdirSync(path.join(projectDir, 'Demo.xcodeproj'));
    writeFileSync(path.join(projectDir, 'bun.lock'), '');
    writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        scripts: {
          test: 'vitest run',
        },
      }),
    );

    const draft = detectProjectSetup(projectDir);

    expect(
      draft.profiles.find((profile: { recommended: boolean }) => profile.recommended)?.kind,
    ).toBe('xcode');
    expect(draft.suggestedContract.verifyCommands).toEqual([]);
    expect(
      draft.profiles.find((profile: { kind: string }) => profile.kind === 'bun')?.suggestedContract
        .verifyCommands,
    ).toEqual(['bun run test']);
  });

  it('detects non-javascript single-project test commands', () => {
    const rustDir = makeProject();
    writeFileSync(path.join(rustDir, 'Cargo.toml'), '[package]\nname = "demo"\n');
    expect(detectProjectSetup(rustDir).suggestedContract.verifyCommands).toEqual(['cargo test']);

    const goDir = makeProject();
    writeFileSync(path.join(goDir, 'go.mod'), 'module example.com/demo\n');
    expect(detectProjectSetup(goDir).suggestedContract.verifyCommands).toEqual(['go test ./...']);

    const dotnetDir = makeProject();
    writeFileSync(path.join(dotnetDir, 'Demo.csproj'), '<Project />');
    expect(detectProjectSetup(dotnetDir).suggestedContract.verifyCommands).toEqual([
      'dotnet test Demo.csproj',
    ]);
  });

  it('avoids full-root test suggestions for non-javascript workspaces', () => {
    const rustDir = makeProject();
    writeFileSync(path.join(rustDir, 'Cargo.toml'), '[workspace]\nmembers = ["crates/*"]\n');
    expect(detectProjectSetup(rustDir).suggestedContract.verifyCommands).toEqual([]);
    expect(detectProjectSetup(rustDir).suggestedContract.testingContext).toMatch(/workspace/i);

    const mavenDir = makeProject();
    writeFileSync(
      path.join(mavenDir, 'pom.xml'),
      '<project><modules><module>core</module></modules></project>',
    );
    expect(detectProjectSetup(mavenDir).suggestedContract.verifyCommands).toEqual([]);
    expect(detectProjectSetup(mavenDir).suggestedContract.testingContext).toMatch(/multi-module/i);
  });

  it('detects explicit framework test markers for script-light stacks', () => {
    const pythonDir = makeProject();
    writeFileSync(path.join(pythonDir, 'pyproject.toml'), '[tool.pytest.ini_options]\n');
    expect(detectProjectSetup(pythonDir).suggestedContract.verifyCommands).toEqual([
      'python -m pytest',
    ]);

    const rubyDir = makeProject();
    writeFileSync(path.join(rubyDir, 'Gemfile'), 'gem "rspec"\n');
    mkdirSync(path.join(rubyDir, 'spec'));
    expect(detectProjectSetup(rubyDir).suggestedContract.verifyCommands).toEqual([
      'bundle exec rspec',
    ]);

    const phpDir = makeProject();
    writeFileSync(path.join(phpDir, 'composer.json'), JSON.stringify({}));
    writeFileSync(path.join(phpDir, 'phpunit.xml'), '<phpunit />');
    expect(detectProjectSetup(phpDir).suggestedContract.verifyCommands).toEqual([
      'vendor/bin/phpunit',
    ]);
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
