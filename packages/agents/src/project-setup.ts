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

function chooseRecommendedProfile(
  profiles: DetectedProfileWithoutSuggestion[],
): DetectedProfileWithoutSuggestion[] {
  const priority: DetectedProjectKind[] = [
    'xcode',
    'bun',
    'pnpm',
    'yarn',
    'npm',
    'swiftpm',
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

function dependencyNames(packageJson: Record<string, unknown> | null): Set<string> {
  const names = new Set<string>();
  for (const key of ['dependencies', 'devDependencies']) {
    const deps = packageJson?.[key];
    if (!isRecord(deps)) continue;
    for (const name of Object.keys(deps)) {
      names.add(name);
    }
  }
  return names;
}

function hasTurboConfig(
  topLevel: Set<string>,
  packageJson: Record<string, unknown> | null,
  scripts: Record<string, string>,
): boolean {
  return (
    topLevel.has('turbo.json') ||
    dependencyNames(packageJson).has('turbo') ||
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
  const hasTurbo = hasTurboConfig(topLevel, packageJson, scripts);
  const verifyCommands =
    verifyScriptNames.length === 0
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
    testingContext: hasTurbo
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
