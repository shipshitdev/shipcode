import fs from 'node:fs';
import path from 'node:path';
import {
  type DetectedProjectKind,
  type DetectedProjectProfile,
  type ProjectSetupDraft,
  type ProjectSetupInspection,
  REPO_SETUP_CONTRACT_FILE,
  type RepoSetupContract,
  repoSetupContractSchema,
} from '@shipcode/shared';
import { loadRepoSetupContract } from './repo-setup-contract';

const EMPTY_CONTRACT: RepoSetupContract = {
  version: 1,
  setupCommands: [],
  verifyCommands: [],
  envFiles: [],
  setupBeforeVerify: false,
  testingContext: null,
};

type DetectedProfileWithoutSuggestion = Omit<DetectedProjectProfile, 'suggestedContract'>;
type NodePackageManager = Extract<DetectedProjectKind, 'bun' | 'npm' | 'pnpm' | 'yarn'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPackageJson(packageJsonPath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function packageName(packageJson: Record<string, unknown> | null): string | null {
  return typeof packageJson?.name === 'string' && packageJson.name.trim().length > 0
    ? packageJson.name
    : null;
}

function readTopLevelNames(projectPath: string): Set<string> {
  try {
    return new Set(fs.readdirSync(projectPath));
  } catch {
    return new Set<string>();
  }
}

function topLevelFilesWithSuffix(topLevel: Set<string>, suffix: string): string[] {
  return [...topLevel].filter((name) => name.endsWith(suffix));
}

function readTextFile(projectPath: string, fileName: string): string | null {
  try {
    return fs.readFileSync(path.join(projectPath, fileName), 'utf-8');
  } catch {
    return null;
  }
}

function hasTopLevelDirectory(projectPath: string, name: string): boolean {
  try {
    return fs.statSync(path.join(projectPath, name)).isDirectory();
  } catch {
    return false;
  }
}

function packageRunner(kind: NodePackageManager): string {
  switch (kind) {
    case 'bun':
      return 'bun run';
    case 'npm':
      return 'npm run';
    case 'pnpm':
      return 'pnpm run';
    case 'yarn':
      return 'yarn run';
    default:
      throw new Error(`Unsupported package manager: ${String(kind)}`);
  }
}

function turboRunner(kind: NodePackageManager): string {
  switch (kind) {
    case 'bun':
      return 'bunx turbo';
    case 'npm':
      return 'npx turbo';
    case 'pnpm':
      return 'pnpm exec turbo';
    case 'yarn':
      return 'yarn turbo';
    default:
      throw new Error(`Unsupported package manager: ${String(kind)}`);
  }
}

function inferNodeProfile(
  projectPath: string,
  topLevel: Set<string>,
): DetectedProfileWithoutSuggestion | null {
  if (!topLevel.has('package.json')) return null;

  const lockPreference: Array<{
    file: string;
    kind: Extract<DetectedProjectKind, 'bun' | 'pnpm' | 'yarn' | 'npm'>;
    label: string;
  }> = [
    { file: 'bun.lock', kind: 'bun', label: 'Bun' },
    { file: 'bun.lockb', kind: 'bun', label: 'Bun' },
    { file: 'pnpm-lock.yaml', kind: 'pnpm', label: 'pnpm' },
    { file: 'yarn.lock', kind: 'yarn', label: 'Yarn' },
    { file: 'package-lock.json', kind: 'npm', label: 'npm' },
  ];

  const match = lockPreference.find((entry) => topLevel.has(entry.file));
  const kind = match?.kind ?? 'npm';
  const evidence = ['package.json'];
  if (match) evidence.push(match.file);
  else evidence.push('no lockfile detected');

  const pkgRaw = readPackageJson(path.join(projectPath, 'package.json'));
  const name = packageName(pkgRaw);
  if (name) {
    evidence.push(`package:${name}`);
  } else if (!pkgRaw) {
    evidence.push('package.json unreadable');
  }

  return {
    kind,
    label: match?.label ?? 'Node.js',
    recommended: false,
    evidence,
  };
}

function inferAppleProfiles(topLevel: Set<string>): DetectedProfileWithoutSuggestion[] {
  const names = [...topLevel];
  const hasXcodeProject = names.some((name) => name.endsWith('.xcodeproj'));
  const hasWorkspace = names.some((name) => name.endsWith('.xcworkspace'));
  const hasSwiftPackage = topLevel.has('Package.swift');
  const profiles: DetectedProfileWithoutSuggestion[] = [];

  if (hasXcodeProject || hasWorkspace) {
    const evidence = names.filter(
      (name) => name.endsWith('.xcodeproj') || name.endsWith('.xcworkspace'),
    );
    if (hasSwiftPackage) evidence.push('Package.swift');
    profiles.push({
      kind: 'xcode',
      label: 'Xcode',
      recommended: false,
      evidence,
    });
  }

  if (hasSwiftPackage) {
    profiles.push({
      kind: 'swiftpm',
      label: 'Swift Package Manager',
      recommended: false,
      evidence: ['Package.swift'],
    });
  }

  return profiles;
}

function inferRustProfile(topLevel: Set<string>): DetectedProfileWithoutSuggestion | null {
  if (!topLevel.has('Cargo.toml')) return null;
  const evidence = ['Cargo.toml'];
  if (topLevel.has('Cargo.lock')) evidence.push('Cargo.lock');
  return {
    kind: 'rust',
    label: 'Rust',
    recommended: false,
    evidence,
  };
}

function inferGoProfile(topLevel: Set<string>): DetectedProfileWithoutSuggestion | null {
  if (!topLevel.has('go.mod') && !topLevel.has('go.work')) return null;
  const evidence = [];
  if (topLevel.has('go.mod')) evidence.push('go.mod');
  if (topLevel.has('go.work')) evidence.push('go.work');
  if (topLevel.has('go.sum')) evidence.push('go.sum');
  return {
    kind: 'go',
    label: 'Go',
    recommended: false,
    evidence,
  };
}

function inferPythonProfile(topLevel: Set<string>): DetectedProfileWithoutSuggestion | null {
  const markers = ['pyproject.toml', 'requirements.txt', 'uv.lock', 'poetry.lock', 'Pipfile'];
  const evidence = markers.filter((marker) => topLevel.has(marker));
  if (evidence.length === 0) return null;
  return {
    kind: 'python',
    label: 'Python',
    recommended: false,
    evidence,
  };
}

function inferRubyProfile(topLevel: Set<string>): DetectedProfileWithoutSuggestion | null {
  if (!topLevel.has('Gemfile')) return null;
  const evidence = ['Gemfile'];
  if (topLevel.has('Gemfile.lock')) evidence.push('Gemfile.lock');
  if (topLevel.has('.rspec')) evidence.push('.rspec');
  return {
    kind: 'ruby',
    label: 'Ruby',
    recommended: false,
    evidence,
  };
}

function inferJavaProfile(topLevel: Set<string>): DetectedProfileWithoutSuggestion | null {
  const markers = [
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'gradlew',
    'settings.gradle',
    'settings.gradle.kts',
  ];
  const evidence = markers.filter((marker) => topLevel.has(marker));
  if (evidence.length === 0) return null;
  return {
    kind: 'java',
    label: topLevel.has('pom.xml') ? 'Maven' : 'Gradle',
    recommended: false,
    evidence,
  };
}

function inferDotnetProfile(topLevel: Set<string>): DetectedProfileWithoutSuggestion | null {
  const solutionFiles = topLevelFilesWithSuffix(topLevel, '.sln');
  const projectFiles = topLevelFilesWithSuffix(topLevel, '.csproj');
  const evidence = [...solutionFiles, ...projectFiles];
  if (evidence.length === 0) return null;
  return {
    kind: 'dotnet',
    label: '.NET',
    recommended: false,
    evidence,
  };
}

function inferPhpProfile(topLevel: Set<string>): DetectedProfileWithoutSuggestion | null {
  if (!topLevel.has('composer.json')) return null;
  const evidence = ['composer.json'];
  if (topLevel.has('composer.lock')) evidence.push('composer.lock');
  if (topLevel.has('phpunit.xml') || topLevel.has('phpunit.xml.dist')) {
    evidence.push(topLevel.has('phpunit.xml') ? 'phpunit.xml' : 'phpunit.xml.dist');
  }
  return {
    kind: 'php',
    label: 'PHP',
    recommended: false,
    evidence,
  };
}

function chooseRecommendedProfile(
  profiles: DetectedProfileWithoutSuggestion[],
): DetectedProfileWithoutSuggestion[] {
  const priority: DetectedProjectKind[] = [
    'xcode',
    'swiftpm',
    'rust',
    'go',
    'java',
    'dotnet',
    'python',
    'ruby',
    'php',
    'bun',
    'pnpm',
    'yarn',
    'npm',
    'unknown',
  ];
  const recommended = profiles
    .slice()
    .sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind))[0];
  return profiles.map((profile) => ({
    ...profile,
    recommended: profile.kind === recommended?.kind,
  }));
}

function detectProfiles(projectPath: string): DetectedProjectProfile[] {
  const topLevel = readTopLevelNames(projectPath);
  const profiles: DetectedProfileWithoutSuggestion[] = [];
  const nodeProfile = inferNodeProfile(projectPath, topLevel);
  if (nodeProfile) profiles.push(nodeProfile);
  profiles.push(...inferAppleProfiles(topLevel));
  const rustProfile = inferRustProfile(topLevel);
  if (rustProfile) profiles.push(rustProfile);
  const goProfile = inferGoProfile(topLevel);
  if (goProfile) profiles.push(goProfile);
  const pythonProfile = inferPythonProfile(topLevel);
  if (pythonProfile) profiles.push(pythonProfile);
  const rubyProfile = inferRubyProfile(topLevel);
  if (rubyProfile) profiles.push(rubyProfile);
  const javaProfile = inferJavaProfile(topLevel);
  if (javaProfile) profiles.push(javaProfile);
  const dotnetProfile = inferDotnetProfile(topLevel);
  if (dotnetProfile) profiles.push(dotnetProfile);
  const phpProfile = inferPhpProfile(topLevel);
  if (phpProfile) profiles.push(phpProfile);
  if (profiles.length === 0) {
    profiles.push({
      kind: 'unknown',
      label: 'Unknown',
      recommended: true,
      evidence: ['No supported repo markers detected'],
    });
  }
  return chooseRecommendedProfile(profiles).map((profile) => ({
    ...profile,
    suggestedContract: suggestContractForKind(projectPath, profile.kind),
  }));
}

function packageScripts(packageJson: Record<string, unknown> | null): Record<string, string> {
  if (!isRecord(packageJson?.scripts)) return {};

  return Object.fromEntries(
    Object.entries(packageJson.scripts).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[1].trim().length > 0,
    ),
  );
}

function hasWorkspaceConfig(packageJson: Record<string, unknown> | null): boolean {
  const workspaces = packageJson?.workspaces;
  return Array.isArray(workspaces) || (isRecord(workspaces) && Array.isArray(workspaces.packages));
}

function hasTurboConfig(topLevel: Set<string>, scripts: Record<string, string>): boolean {
  return (
    topLevel.has('turbo.json') ||
    Object.values(scripts).some((script) => /\bturbo\s+run\b/.test(script))
  );
}

function buildTurboAffectedCommand(kind: NodePackageManager, scriptNames: string[]): string {
  const tasks = scriptNames.join(' ');
  return `TURBO_SCM_BASE="\${TURBO_SCM_BASE:-HEAD}" ${turboRunner(kind)} run ${tasks} --affected --concurrency=1`;
}

function detectNodeContract(projectPath: string, kind: NodePackageManager): RepoSetupContract {
  const topLevel = readTopLevelNames(projectPath);
  const packageJsonPath = path.join(projectPath, 'package.json');
  const packageJson = readPackageJson(packageJsonPath);
  const scripts = packageScripts(packageJson);

  const setupCommands: string[] = [];
  if (kind === 'bun') {
    setupCommands.push(
      topLevel.has('bun.lock') || topLevel.has('bun.lockb')
        ? 'bun install --frozen-lockfile'
        : 'bun install',
    );
  } else if (kind === 'pnpm') {
    setupCommands.push(
      topLevel.has('pnpm-lock.yaml') ? 'pnpm install --frozen-lockfile' : 'pnpm install',
    );
  } else if (kind === 'yarn') {
    setupCommands.push(
      topLevel.has('yarn.lock') ? 'yarn install --frozen-lockfile' : 'yarn install',
    );
  } else {
    setupCommands.push(topLevel.has('package-lock.json') ? 'npm ci' : 'npm install');
  }

  const verifyScriptNames = ['typecheck', 'test', 'build'].filter(
    (name) => typeof scripts[name] === 'string',
  );
  const hasWorkspaces = hasWorkspaceConfig(packageJson);
  const hasRepoOwnedAffectedVerify = typeof scripts['verify:affected'] === 'string';
  const hasTurbo = hasTurboConfig(topLevel, scripts);
  const verifyCommands = hasRepoOwnedAffectedVerify
    ? [`${packageRunner(kind)} verify:affected`]
    : verifyScriptNames.length === 0
      ? []
      : hasTurbo
        ? [buildTurboAffectedCommand(kind, verifyScriptNames)]
        : hasWorkspaces
          ? []
          : verifyScriptNames.map((name) => `${packageRunner(kind)} ${name}`);

  return {
    ...EMPTY_CONTRACT,
    setupCommands,
    verifyCommands,
    testingContext: hasRepoOwnedAffectedVerify
      ? `Detected a ${kind} workspace with a repo-owned verify:affected script. ShipCode will use that scoped verifier instead of root-wide test commands.`
      : hasTurbo
        ? `Detected a ${kind} Turborepo workspace. Verification uses Turbo affected mode against HEAD and --concurrency=1 so ShipCode runs only packages impacted by worktree changes.`
        : hasWorkspaces
          ? `Detected a ${kind} workspace root, but no scoped workspace runner. Full root verification scripts are intentionally not suggested; add repo-specific scoped commands manually.`
          : verifyCommands.length > 0
            ? `Detected ${kind} package scripts for verification. Confirm these commands match the repo's real test workflow.`
            : `Detected a ${kind} project, but no package scripts were found for typecheck/test/build. Add the right verification commands manually.`,
  };
}

function detectXcodeContract(projectPath: string): RepoSetupContract {
  const topLevel = readTopLevelNames(projectPath);
  const hasXcode = [...topLevel].some(
    (name) => name.endsWith('.xcodeproj') || name.endsWith('.xcworkspace'),
  );
  return {
    ...EMPTY_CONTRACT,
    setupCommands: hasXcode ? ['xcodebuild -resolvePackageDependencies'] : [],
    testingContext:
      'Detected an Xcode project. Confirm the exact xcodebuild test command with scheme and destination before relying on automated verification.',
  };
}

function detectSwiftPmContract(): RepoSetupContract {
  return {
    ...EMPTY_CONTRACT,
    verifyCommands: ['swift test'],
    testingContext:
      'Detected a Swift Package Manager repo. Confirm `swift test` is the right verification command for this package.',
  };
}

function detectRustContract(projectPath: string): RepoSetupContract {
  const cargoToml = readTextFile(projectPath, 'Cargo.toml') ?? '';
  const isWorkspace = /^\s*\[workspace\]/m.test(cargoToml);
  return {
    ...EMPTY_CONTRACT,
    verifyCommands: isWorkspace ? [] : ['cargo test'],
    testingContext: isWorkspace
      ? 'Detected a Rust Cargo workspace. Full-workspace `cargo test --workspace` is intentionally not suggested; add a scoped package test command for this repo.'
      : 'Detected a Rust crate. `cargo test` is suggested for crate-local verification.',
  };
}

function detectGoContract(projectPath: string): RepoSetupContract {
  const topLevel = readTopLevelNames(projectPath);
  const isWorkspace = topLevel.has('go.work');
  return {
    ...EMPTY_CONTRACT,
    setupCommands: topLevel.has('go.mod') ? ['go mod download'] : [],
    verifyCommands: isWorkspace ? [] : ['go test ./...'],
    testingContext: isWorkspace
      ? 'Detected a Go workspace. Full-workspace testing is intentionally not suggested; add scoped module test commands for this repo.'
      : 'Detected a Go module. `go test ./...` is suggested for module-local verification.',
  };
}

function detectPythonContract(projectPath: string): RepoSetupContract {
  const topLevel = readTopLevelNames(projectPath);
  const pyproject = readTextFile(projectPath, 'pyproject.toml') ?? '';
  const requirements = readTextFile(projectPath, 'requirements.txt') ?? '';
  const hasPytest =
    topLevel.has('pytest.ini') ||
    topLevel.has('conftest.py') ||
    /\bpytest\b/.test(pyproject) ||
    /\bpytest\b/.test(requirements);
  const setupCommands = topLevel.has('uv.lock')
    ? ['uv sync --frozen']
    : topLevel.has('poetry.lock')
      ? ['poetry install --no-interaction']
      : topLevel.has('requirements.txt')
        ? ['python -m pip install -r requirements.txt']
        : [];
  return {
    ...EMPTY_CONTRACT,
    setupCommands,
    verifyCommands: hasPytest ? ['python -m pytest'] : [],
    testingContext: hasPytest
      ? 'Detected a Python project with pytest markers. `python -m pytest` is suggested for project-local verification.'
      : 'Detected a Python project, but no explicit pytest markers were found. Add the repo-specific test command manually.',
  };
}

function detectRubyContract(projectPath: string): RepoSetupContract {
  const topLevel = readTopLevelNames(projectPath);
  const hasRspec = topLevel.has('.rspec') || hasTopLevelDirectory(projectPath, 'spec');
  return {
    ...EMPTY_CONTRACT,
    setupCommands: ['bundle install'],
    verifyCommands: hasRspec ? ['bundle exec rspec'] : [],
    testingContext: hasRspec
      ? 'Detected a Ruby project with RSpec markers. `bundle exec rspec` is suggested for project-local verification.'
      : 'Detected a Ruby project, but no RSpec markers were found. Add the repo-specific test command manually.',
  };
}

function detectJavaContract(projectPath: string): RepoSetupContract {
  const topLevel = readTopLevelNames(projectPath);
  const pom = readTextFile(projectPath, 'pom.xml') ?? '';
  const gradleSettings =
    readTextFile(projectPath, 'settings.gradle') ??
    readTextFile(projectPath, 'settings.gradle.kts') ??
    '';
  const hasMaven = topLevel.has('pom.xml');
  const hasMavenModules = /<modules>[\s\S]*?<module>/.test(pom);
  const hasGradleMultiProject = /\binclude\s*(\(|["'])/.test(gradleSettings);
  const gradleCommand = topLevel.has('gradlew') ? './gradlew test' : 'gradle test';

  if (hasMaven) {
    return {
      ...EMPTY_CONTRACT,
      verifyCommands: hasMavenModules ? [] : [topLevel.has('mvnw') ? './mvnw test' : 'mvn test'],
      testingContext: hasMavenModules
        ? 'Detected a multi-module Maven project. Full-root testing is intentionally not suggested; add scoped module test commands for this repo.'
        : 'Detected a Maven project. The root module test command is suggested.',
    };
  }

  return {
    ...EMPTY_CONTRACT,
    verifyCommands: hasGradleMultiProject ? [] : [gradleCommand],
    testingContext: hasGradleMultiProject
      ? 'Detected a multi-project Gradle build. Full-root testing is intentionally not suggested; add scoped project test commands for this repo.'
      : 'Detected a Gradle project. The root project test command is suggested.',
  };
}

function detectDotnetContract(projectPath: string): RepoSetupContract {
  const topLevel = readTopLevelNames(projectPath);
  const solutionFiles = topLevelFilesWithSuffix(topLevel, '.sln');
  const projectFiles = topLevelFilesWithSuffix(topLevel, '.csproj');
  const target = solutionFiles.length === 1 ? solutionFiles[0] : projectFiles[0];
  const hasSingleTarget = solutionFiles.length + projectFiles.length === 1;
  return {
    ...EMPTY_CONTRACT,
    setupCommands: ['dotnet restore'],
    verifyCommands: hasSingleTarget && target ? [`dotnet test ${target}`] : [],
    testingContext: hasSingleTarget
      ? 'Detected a .NET project. A single solution/project test command is suggested.'
      : 'Detected multiple .NET solution/project files. Full-root testing is intentionally not suggested; add the scoped test command manually.',
  };
}

function detectPhpContract(projectPath: string): RepoSetupContract {
  const topLevel = readTopLevelNames(projectPath);
  const composer = readPackageJson(path.join(projectPath, 'composer.json'));
  const scripts = packageScripts(composer);
  const hasPhpUnit = topLevel.has('phpunit.xml') || topLevel.has('phpunit.xml.dist');
  return {
    ...EMPTY_CONTRACT,
    setupCommands: ['composer install'],
    verifyCommands: scripts.test ? ['composer test'] : hasPhpUnit ? ['vendor/bin/phpunit'] : [],
    testingContext:
      scripts.test || hasPhpUnit
        ? 'Detected a PHP project with test markers. A project-local test command is suggested.'
        : 'Detected a PHP project, but no Composer test script or PHPUnit config was found. Add the repo-specific test command manually.',
  };
}

function suggestContractForKind(projectPath: string, kind: DetectedProjectProfile['kind']) {
  switch (kind) {
    case 'bun':
    case 'npm':
    case 'pnpm':
    case 'yarn':
      return detectNodeContract(projectPath, kind);
    case 'xcode':
      return detectXcodeContract(projectPath);
    case 'swiftpm':
      return detectSwiftPmContract();
    case 'rust':
      return detectRustContract(projectPath);
    case 'go':
      return detectGoContract(projectPath);
    case 'python':
      return detectPythonContract(projectPath);
    case 'ruby':
      return detectRubyContract(projectPath);
    case 'java':
      return detectJavaContract(projectPath);
    case 'dotnet':
      return detectDotnetContract(projectPath);
    case 'php':
      return detectPhpContract(projectPath);
    default:
      return { ...EMPTY_CONTRACT };
  }
}

function suggestContract(profiles: DetectedProjectProfile[]): RepoSetupContract {
  return (
    profiles.find((profile) => profile.recommended)?.suggestedContract ?? { ...EMPTY_CONTRACT }
  );
}

export function inspectProjectSetup(projectPath: string): ProjectSetupInspection {
  const contractPath = path.join(projectPath, REPO_SETUP_CONTRACT_FILE);
  try {
    const loaded = loadRepoSetupContract(projectPath);
    if (!loaded) {
      return {
        status: 'missing',
        path: contractPath,
        contract: null,
        error: null,
      };
    }
    return {
      status: 'configured',
      path: loaded.path,
      contract: loaded.contract,
      error: null,
    };
  } catch (error) {
    return {
      status: 'invalid',
      path: contractPath,
      contract: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function detectProjectSetup(projectPath: string): ProjectSetupDraft {
  const inspection = inspectProjectSetup(projectPath);
  const profiles = detectProfiles(projectPath);
  return {
    inspection,
    profiles,
    suggestedContract: inspection.contract ?? suggestContract(profiles),
  };
}

export function writeProjectSetup(
  projectPath: string,
  contract: RepoSetupContract,
): ProjectSetupInspection {
  const parsed = repoSetupContractSchema.parse(contract);
  const contractPath = path.join(projectPath, REPO_SETUP_CONTRACT_FILE);
  fs.mkdirSync(path.dirname(contractPath), { recursive: true });
  fs.writeFileSync(contractPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
  return {
    status: 'configured',
    path: contractPath,
    contract: parsed,
    error: null,
  };
}
