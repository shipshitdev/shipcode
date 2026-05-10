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

  it('detects xcode workspaces as xcode projects', () => {
    const projectDir = makeProject();
    mkdirSync(path.join(projectDir, 'Demo.xcworkspace'));

    const draft = detectProjectSetup(projectDir);

    expect(draft.suggestedContract.setupCommands).toEqual([
      'xcodebuild -resolvePackageDependencies',
    ]);
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

  it('suggests install and script commands for other node package managers', () => {
    const cases = [
      {
        lockfile: 'pnpm-lock.yaml',
        expectedSetup: 'pnpm install --frozen-lockfile',
        expectedVerify: 'pnpm run test',
      },
      {
        lockfile: 'yarn.lock',
        expectedSetup: 'yarn install --frozen-lockfile',
        expectedVerify: 'yarn run test',
      },
      {
        lockfile: 'package-lock.json',
        expectedSetup: 'npm ci',
        expectedVerify: 'npm run test',
      },
    ];

    for (const { lockfile, expectedSetup, expectedVerify } of cases) {
      const projectDir = makeProject();
      writeFileSync(path.join(projectDir, lockfile), '');
      writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify({ scripts: { test: 'vitest run' } }),
      );

      const draft = detectProjectSetup(projectDir);
      expect(draft.suggestedContract.setupCommands).toEqual([expectedSetup]);
      expect(draft.suggestedContract.verifyCommands).toEqual([expectedVerify]);
    }
  });

  it('uses non-frozen install commands when node lockfiles are absent', () => {
    const cases = [
      {
        marker: 'pnpm-workspace.yaml',
        packageJson: { packageManager: 'pnpm@10.0.0', scripts: { test: 'vitest run' } },
        expectedSetup: 'npm install',
        expectedVerify: 'npm run test',
      },
      {
        marker: 'package.json',
        packageJson: { scripts: { test: 'vitest run' } },
        expectedSetup: 'npm install',
        expectedVerify: 'npm run test',
      },
    ];

    for (const { marker, packageJson, expectedSetup, expectedVerify } of cases) {
      const projectDir = makeProject();
      if (marker !== 'package.json') writeFileSync(path.join(projectDir, marker), '');
      writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify(packageJson));

      const draft = detectProjectSetup(projectDir);
      expect(draft.suggestedContract.setupCommands).toEqual([expectedSetup]);
      expect(draft.suggestedContract.verifyCommands).toEqual([expectedVerify]);
    }

    const bunDir = makeProject();
    writeFileSync(
      path.join(bunDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'bun test' } }),
    );
    writeFileSync(path.join(bunDir, 'bun.lockb'), '');
    expect(detectProjectSetup(bunDir).suggestedContract.setupCommands).toEqual([
      'bun install --frozen-lockfile',
    ]);
  });

  it('uses package-manager specific turbo runners for npm and yarn workspaces', () => {
    const npmDir = makeProject();
    writeFileSync(path.join(npmDir, 'package-lock.json'), '');
    writeFileSync(path.join(npmDir, 'turbo.json'), JSON.stringify({ tasks: {} }));
    writeFileSync(
      path.join(npmDir, 'package.json'),
      JSON.stringify({ workspaces: ['apps/*'], scripts: { test: 'turbo run test' } }),
    );
    expect(detectProjectSetup(npmDir).suggestedContract.verifyCommands).toEqual([
      'TURBO_SCM_BASE="$' + '{TURBO_SCM_BASE:-HEAD}" npx turbo run test --affected --concurrency=1',
    ]);

    const yarnDir = makeProject();
    writeFileSync(path.join(yarnDir, 'yarn.lock'), '');
    writeFileSync(path.join(yarnDir, 'turbo.json'), JSON.stringify({ tasks: {} }));
    writeFileSync(
      path.join(yarnDir, 'package.json'),
      JSON.stringify({ workspaces: ['apps/*'], scripts: { test: 'turbo run test' } }),
    );
    expect(detectProjectSetup(yarnDir).suggestedContract.verifyCommands).toEqual([
      'TURBO_SCM_BASE="$' +
        '{TURBO_SCM_BASE:-HEAD}" yarn turbo run test --affected --concurrency=1',
    ]);
  });

  it('detects workspace objects and turbo scripts without turbo.json', () => {
    const projectDir = makeProject();
    writeFileSync(path.join(projectDir, 'pnpm-lock.yaml'), '');
    writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        workspaces: { packages: ['apps/*'] },
        scripts: {
          test: 'turbo run test --filter app',
        },
      }),
    );

    const draft = detectProjectSetup(projectDir);
    const expectedTurboCommand =
      'TURBO_SCM_BASE="$' +
      '{TURBO_SCM_BASE:-HEAD}" pnpm exec turbo run test --affected --concurrency=1';

    expect(draft.suggestedContract.verifyCommands).toEqual([expectedTurboCommand]);
  });

  it('falls back to npm and no verification when package metadata is unreadable', () => {
    const projectDir = makeProject();
    writeFileSync(path.join(projectDir, 'package.json'), '{not json');

    const draft = detectProjectSetup(projectDir);

    expect(
      draft.profiles.find((profile: { recommended: boolean }) => profile.recommended),
    ).toMatchObject({
      kind: 'npm',
      evidence: expect.arrayContaining(['package.json unreadable']),
    });
    expect(draft.suggestedContract.setupCommands).toEqual(['npm install']);
    expect(draft.suggestedContract.verifyCommands).toEqual([]);
  });

  it('treats non-object package metadata as unreadable node metadata', () => {
    const projectDir = makeProject();
    writeFileSync(path.join(projectDir, 'package.json'), '[]');

    const draft = detectProjectSetup(projectDir);

    expect(draft.profiles[0]).toMatchObject({
      kind: 'npm',
      evidence: expect.arrayContaining(['package.json unreadable']),
    });
    expect(draft.suggestedContract.verifyCommands).toEqual([]);
  });

  it('records secondary ecosystem marker evidence', () => {
    const rustDir = makeProject();
    writeFileSync(path.join(rustDir, 'Cargo.toml'), '[package]\nname = "demo"\n');
    writeFileSync(path.join(rustDir, 'Cargo.lock'), '');
    expect(detectProjectSetup(rustDir).profiles[0].evidence).toContain('Cargo.lock');

    const goDir = makeProject();
    writeFileSync(path.join(goDir, 'go.mod'), 'module example.com/demo\n');
    writeFileSync(path.join(goDir, 'go.sum'), '');
    expect(detectProjectSetup(goDir).profiles[0].evidence).toContain('go.sum');

    const rubyDir = makeProject();
    writeFileSync(path.join(rubyDir, 'Gemfile'), 'source "https://rubygems.org"\n');
    writeFileSync(path.join(rubyDir, 'Gemfile.lock'), '');
    writeFileSync(path.join(rubyDir, '.rspec'), '');
    expect(detectProjectSetup(rubyDir).profiles[0].evidence).toEqual(
      expect.arrayContaining(['Gemfile.lock', '.rspec']),
    );

    const phpDir = makeProject();
    writeFileSync(path.join(phpDir, 'composer.json'), JSON.stringify({}));
    writeFileSync(path.join(phpDir, 'composer.lock'), '');
    writeFileSync(path.join(phpDir, 'phpunit.xml.dist'), '<phpunit />');
    expect(detectProjectSetup(phpDir).profiles[0].evidence).toEqual(
      expect.arrayContaining(['composer.lock', 'phpunit.xml.dist']),
    );
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

    const goWorkspaceDir = makeProject();
    writeFileSync(path.join(goWorkspaceDir, 'go.work'), 'go 1.23\nuse ./services/api\n');
    expect(detectProjectSetup(goWorkspaceDir).suggestedContract.verifyCommands).toEqual([]);
    expect(detectProjectSetup(goWorkspaceDir).suggestedContract.setupCommands).toEqual([]);

    const gradleDir = makeProject();
    writeFileSync(path.join(gradleDir, 'build.gradle.kts'), 'plugins { java }\n');
    writeFileSync(path.join(gradleDir, 'settings.gradle.kts'), 'include("api")\n');
    expect(detectProjectSetup(gradleDir).suggestedContract.verifyCommands).toEqual([]);
    expect(detectProjectSetup(gradleDir).suggestedContract.testingContext).toMatch(
      /multi-project Gradle/i,
    );
  });

  it('uses checked-in Java wrapper scripts and avoids ambiguous dotnet targets', () => {
    const mavenDir = makeProject();
    writeFileSync(path.join(mavenDir, 'pom.xml'), '<project />');
    writeFileSync(path.join(mavenDir, 'mvnw'), '');
    expect(detectProjectSetup(mavenDir).suggestedContract.verifyCommands).toEqual(['./mvnw test']);

    const plainMavenDir = makeProject();
    writeFileSync(path.join(plainMavenDir, 'pom.xml'), '<project />');
    expect(detectProjectSetup(plainMavenDir).suggestedContract.verifyCommands).toEqual([
      'mvn test',
    ]);

    const gradleDir = makeProject();
    writeFileSync(path.join(gradleDir, 'build.gradle'), 'plugins { id "java" }\n');
    writeFileSync(path.join(gradleDir, 'gradlew'), '');
    expect(detectProjectSetup(gradleDir).suggestedContract.verifyCommands).toEqual([
      './gradlew test',
    ]);

    const dotnetDir = makeProject();
    writeFileSync(path.join(dotnetDir, 'One.sln'), '');
    writeFileSync(path.join(dotnetDir, 'Two.csproj'), '<Project />');
    expect(detectProjectSetup(dotnetDir).suggestedContract.verifyCommands).toEqual([]);
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

  it('detects alternate framework markers and conservative no-test fallbacks', () => {
    const pythonConftestDir = makeProject();
    writeFileSync(path.join(pythonConftestDir, 'pyproject.toml'), '[project]\nname = "demo"\n');
    writeFileSync(path.join(pythonConftestDir, 'conftest.py'), '# pytest fixtures\n');
    expect(detectProjectSetup(pythonConftestDir).suggestedContract.verifyCommands).toEqual([
      'python -m pytest',
    ]);

    const pythonRequirementsDir = makeProject();
    writeFileSync(path.join(pythonRequirementsDir, 'requirements.txt'), 'pytest==8.0.0\n');
    expect(detectProjectSetup(pythonRequirementsDir).suggestedContract.verifyCommands).toEqual([
      'python -m pytest',
    ]);

    const phpDir = makeProject();
    writeFileSync(path.join(phpDir, 'composer.json'), JSON.stringify({}));
    expect(detectProjectSetup(phpDir).suggestedContract.verifyCommands).toEqual([]);
    expect(detectProjectSetup(phpDir).suggestedContract.testingContext).toMatch(
      /no Composer test/i,
    );
  });

  it('suggests setup-only contracts when test markers are absent', () => {
    const pythonDir = makeProject();
    writeFileSync(path.join(pythonDir, 'requirements.txt'), 'requests==2.32.0\n');
    expect(detectProjectSetup(pythonDir).suggestedContract.setupCommands).toEqual([
      'python -m pip install -r requirements.txt',
    ]);
    expect(detectProjectSetup(pythonDir).suggestedContract.verifyCommands).toEqual([]);

    const poetryDir = makeProject();
    writeFileSync(path.join(poetryDir, 'pyproject.toml'), '[project]\nname = "demo"\n');
    writeFileSync(path.join(poetryDir, 'poetry.lock'), '');
    expect(detectProjectSetup(poetryDir).suggestedContract.setupCommands).toEqual([
      'poetry install --no-interaction',
    ]);

    const uvDir = makeProject();
    writeFileSync(path.join(uvDir, 'pyproject.toml'), '[tool.pytest.ini_options]\n');
    writeFileSync(path.join(uvDir, 'uv.lock'), '');
    expect(detectProjectSetup(uvDir).suggestedContract.setupCommands).toEqual(['uv sync --frozen']);

    const rubyDir = makeProject();
    writeFileSync(path.join(rubyDir, 'Gemfile'), 'source "https://rubygems.org"\n');
    expect(detectProjectSetup(rubyDir).suggestedContract.verifyCommands).toEqual([]);

    const phpDir = makeProject();
    writeFileSync(
      path.join(phpDir, 'composer.json'),
      JSON.stringify({ scripts: { test: 'phpunit --colors=always' } }),
    );
    expect(detectProjectSetup(phpDir).suggestedContract.verifyCommands).toEqual(['composer test']);
  });

  it('returns an unknown profile when no supported markers exist', () => {
    const projectDir = makeProject();
    writeFileSync(path.join(projectDir, 'README.md'), '# demo\n');

    const draft = detectProjectSetup(projectDir);

    expect(draft.profiles).toEqual([
      expect.objectContaining({
        kind: 'unknown',
        recommended: true,
        evidence: ['No supported repo markers detected'],
      }),
    ]);
    expect(draft.suggestedContract.verifyCommands).toEqual([]);
  });

  it('returns an unknown profile when the project directory cannot be read', () => {
    const draft = detectProjectSetup(path.join(os.tmpdir(), 'shipcode-missing-project'));

    expect(draft.profiles).toEqual([
      expect.objectContaining({
        kind: 'unknown',
        evidence: ['No supported repo markers detected'],
      }),
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
