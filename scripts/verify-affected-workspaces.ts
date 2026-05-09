#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

interface WorkspacePackage {
  name: string;
  dir: string;
  relativeDir: string;
  scripts: Record<string, string>;
  workspaceDependencies: string[];
}

const ROOT = process.cwd();
const DEFAULT_TASKS = ['typecheck', 'test'];
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const forceAll = args.has('--all');

function readJson(filePath: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as PackageJson;
  } catch {
    return null;
  }
}

function workspacePatterns(rootPackage: PackageJson): string[] {
  if (Array.isArray(rootPackage.workspaces)) return rootPackage.workspaces;
  return rootPackage.workspaces?.packages ?? [];
}

function workspaceDirs(patterns: string[]): string[] {
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    if (!pattern.endsWith('/*')) continue;
    const base = pattern.slice(0, -2);
    const absoluteBase = join(ROOT, base);
    if (!existsSync(absoluteBase)) continue;
    for (const entry of readdirSync(absoluteBase, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relativeDir = `${base}/${entry.name}`;
      if (existsSync(join(ROOT, relativeDir, 'package.json'))) {
        dirs.add(relativeDir);
      }
    }
  }
  return [...dirs].sort();
}

function discoverWorkspaces(): WorkspacePackage[] {
  const rootPackage = readJson(join(ROOT, 'package.json'));
  if (!rootPackage) throw new Error('Unable to read root package.json');

  const packages = workspaceDirs(workspacePatterns(rootPackage)).map((relativeDir) => {
    const packageJson = readJson(join(ROOT, relativeDir, 'package.json'));
    if (!packageJson?.name) {
      throw new Error(`${relativeDir}/package.json is missing a package name`);
    }
    return {
      name: packageJson.name,
      dir: join(ROOT, relativeDir),
      relativeDir,
      scripts: packageJson.scripts ?? {},
      workspaceDependencies: [],
    };
  });
  const workspaceNames = new Set(packages.map((pkg) => pkg.name));

  return packages.map((pkg) => {
    const packageJson = readJson(join(ROOT, pkg.relativeDir, 'package.json'));
    const dependencyNames = [
      ...Object.keys(packageJson?.dependencies ?? {}),
      ...Object.keys(packageJson?.devDependencies ?? {}),
    ];
    return {
      ...pkg,
      workspaceDependencies: dependencyNames.filter((name) => workspaceNames.has(name)).sort(),
    };
  });
}

function runGit(args: string[]): string[] {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function changedFiles(): string[] {
  if (forceAll) return [];
  const base = process.env.SHIPCODE_VERIFY_BASE ?? process.env.TURBO_SCM_BASE ?? 'HEAD';
  return [
    ...runGit(['diff', '--name-only', base, '--']),
    ...runGit(['ls-files', '--others', '--exclude-standard']),
  ].filter((file, index, files) => files.indexOf(file) === index);
}

function requestedTasks(): string[] {
  const arg = process.argv.find((value) => value.startsWith('--tasks='));
  const raw = arg?.slice('--tasks='.length) ?? process.env.SHIPCODE_VERIFY_TASKS;
  return (raw ?? DEFAULT_TASKS.join(','))
    .split(',')
    .map((task) => task.trim())
    .filter(Boolean);
}

function commandTaskName(pkg: WorkspacePackage, task: string): string | null {
  if (task === 'build' && pkg.relativeDir === 'apps/desktop' && pkg.scripts['build:code']) {
    return 'build:code';
  }
  return pkg.scripts[task] ? task : null;
}

function packageForFile(file: string, workspaces: WorkspacePackage[]): WorkspacePackage | null {
  return (
    workspaces
      .slice()
      .sort((a, b) => b.relativeDir.length - a.relativeDir.length)
      .find((pkg) => file === pkg.relativeDir || file.startsWith(`${pkg.relativeDir}/`)) ?? null
  );
}

function affectedPackages(workspaces: WorkspacePackage[], files: string[]): WorkspacePackage[] {
  if (forceAll) return workspaces;
  const selected = new Map<string, WorkspacePackage>();
  for (const file of files) {
    const pkg = packageForFile(file, workspaces);
    if (pkg) selected.set(pkg.name, pkg);
  }
  return [...selected.values()].sort((a, b) => a.relativeDir.localeCompare(b.relativeDir));
}

function dependencyBuildOrder(
  selected: WorkspacePackage[],
  byName: Map<string, WorkspacePackage>,
): WorkspacePackage[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: WorkspacePackage[] = [];

  function visit(pkg: WorkspacePackage) {
    for (const dependencyName of pkg.workspaceDependencies) {
      const dependency = byName.get(dependencyName);
      if (!dependency || visited.has(dependency.name)) continue;
      if (visiting.has(dependency.name)) {
        throw new Error(`Workspace dependency cycle involving ${dependency.name}`);
      }
      visiting.add(dependency.name);
      visit(dependency);
      visiting.delete(dependency.name);
      visited.add(dependency.name);
      ordered.push(dependency);
    }
  }

  for (const pkg of selected) {
    visit(pkg);
  }

  return ordered;
}

function runPackageTask(pkg: WorkspacePackage, task: string): number {
  console.log(`[verify:affected] ${pkg.name}: bun run --cwd ${relative(ROOT, pkg.dir)} ${task}`);
  if (dryRun) return 0;

  const result = spawnSync('bun', ['run', '--cwd', pkg.dir, task], {
    cwd: ROOT,
    env: { ...process.env, CI: process.env.CI ?? '1' },
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

const workspaces = discoverWorkspaces();
const workspaceByName = new Map(workspaces.map((pkg) => [pkg.name, pkg]));
const files = changedFiles();
const packages = affectedPackages(workspaces, files);
const tasks = requestedTasks();

if (dryRun) {
  console.log(`[verify:affected] Dry run enabled`);
}
if (forceAll) {
  console.log(`[verify:affected] --all selected ${packages.length} workspace package(s)`);
} else {
  console.log(`[verify:affected] Changed files: ${files.length}`);
}

const rootFiles = forceAll ? [] : files.filter((file) => !packageForFile(file, workspaces));
if (rootFiles.length > 0) {
  console.log(
    `[verify:affected] Root-level files changed; package verification remains scoped: ${rootFiles.join(', ')}`,
  );
}

if (packages.length === 0) {
  console.log(
    '[verify:affected] No workspace package files changed; skipping package verification.',
  );
  process.exit(0);
}

for (const dependency of dependencyBuildOrder(packages, workspaceByName)) {
  if (!dependency.scripts.build) continue;
  const status = runPackageTask(dependency, 'build');
  if (status !== 0) process.exit(status);
}

for (const pkg of packages) {
  const runnableTasks = tasks
    .map((task) => commandTaskName(pkg, task))
    .filter((task): task is string => Boolean(task));
  if (runnableTasks.length === 0) {
    console.log(`[verify:affected] ${pkg.name}: no matching scripts for ${tasks.join(', ')}`);
    continue;
  }

  for (const task of runnableTasks) {
    const status = runPackageTask(pkg, task);
    if (status !== 0) process.exit(status);
  }
}

console.log('[verify:affected] Affected workspace verification passed.');
