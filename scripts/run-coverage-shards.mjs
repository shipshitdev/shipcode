import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const VITEST_BIN = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vitest.cmd' : 'vitest',
);
const DEFAULT_SHARDS = 4;
const DEFAULT_MAX_WORKERS = 1;
const shards = Number(process.env.COVERAGE_SHARDS ?? DEFAULT_SHARDS);
const maxWorkers = Number(process.env.COVERAGE_MAX_WORKERS ?? DEFAULT_MAX_WORKERS);
const workspaceFilter = process.env.COVERAGE_WORKSPACES?.split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (!Number.isInteger(shards) || shards < 1) {
  console.error(
    `COVERAGE_SHARDS must be a positive integer. Received: ${process.env.COVERAGE_SHARDS}`,
  );
  process.exit(1);
}

if (!Number.isInteger(maxWorkers) || maxWorkers < 1) {
  console.error(
    `COVERAGE_MAX_WORKERS must be a positive integer. Received: ${process.env.COVERAGE_MAX_WORKERS}`,
  );
  process.exit(1);
}

if (!fs.existsSync(VITEST_BIN)) {
  console.error('Vitest binary not found. Run `bun install` before sharded coverage.');
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function expandWorkspace(pattern) {
  if (!pattern.endsWith('/*')) return [];

  const parent = path.join(ROOT, pattern.slice(0, -2));
  if (!fs.existsSync(parent)) return [];

  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parent, entry.name))
    .filter((workspacePath) => fs.existsSync(path.join(workspacePath, 'package.json')));
}

function run(command, args, cwd) {
  const label = `${command} ${args.join(' ')}`;
  console.log(`\n$ ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error(`\nCoverage command failed in ${path.relative(ROOT, cwd)}: ${label}`);
    process.exit(result.status ?? 1);
  }
}

const rootPackage = readJson(path.join(ROOT, 'package.json'));
const workspaces = rootPackage.workspaces.flatMap(expandWorkspace);
const coverageWorkspaces = workspaces
  .map((workspacePath) => ({
    path: workspacePath,
    packageJson: readJson(path.join(workspacePath, 'package.json')),
  }))
  .filter((workspace) => workspace.packageJson.scripts?.coverage)
  .filter(
    (workspace) =>
      !workspaceFilter?.length ||
      workspaceFilter.includes(path.relative(ROOT, workspace.path)) ||
      workspaceFilter.includes(workspace.packageJson.name),
  )
  .sort((a, b) => a.path.localeCompare(b.path));

if (coverageWorkspaces.length === 0) {
  console.error('No matching workspaces with a coverage script found.');
  process.exit(1);
}

for (const workspace of coverageWorkspaces) {
  const relativePath = path.relative(ROOT, workspace.path);
  console.log(`\n== ${relativePath} coverage (${shards} shards, maxWorkers=${maxWorkers}) ==`);

  fs.rmSync(path.join(workspace.path, '.vitest-reports'), { force: true, recursive: true });
  fs.rmSync(path.join(workspace.path, 'coverage'), { force: true, recursive: true });

  for (let shard = 1; shard <= shards; shard += 1) {
    run(
      VITEST_BIN,
      [
        'run',
        '--coverage',
        '--reporter=blob',
        '--passWithNoTests',
        `--shard=${shard}/${shards}`,
        `--maxWorkers=${maxWorkers}`,
      ],
      workspace.path,
    );
  }

  run(VITEST_BIN, ['--merge-reports', '--coverage'], workspace.path);
}
