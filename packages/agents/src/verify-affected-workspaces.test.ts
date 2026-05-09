import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const scriptPath = path.join(repoRoot, 'scripts', 'verify-affected-workspaces.ts');
const tempDirs: string[] = [];

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ShipCode Test',
      GIT_AUTHOR_EMAIL: 'shipcode@example.com',
      GIT_COMMITTER_NAME: 'ShipCode Test',
      GIT_COMMITTER_EMAIL: 'shipcode@example.com',
    },
  });
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeWorkspaceRepo() {
  const dir = path.join(
    os.tmpdir(),
    `shipcode-affected-verify-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  tempDirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, 'package.json'), {
    workspaces: ['apps/*', 'packages/*'],
  });

  const packages = [
    {
      dir: 'packages/shared',
      json: {
        name: '@demo/shared',
        scripts: {
          build: 'printf shared-build',
          typecheck: 'printf shared-typecheck',
          test: 'printf shared-test',
        },
      },
    },
    {
      dir: 'packages/agents',
      json: {
        name: '@demo/agents',
        dependencies: {
          '@demo/shared': 'workspace:*',
        },
        scripts: {
          build: 'printf agents-build',
          typecheck: 'printf agents-typecheck',
          test: 'printf agents-test',
        },
      },
    },
    {
      dir: 'apps/desktop',
      json: {
        name: '@demo/desktop',
        dependencies: {
          '@demo/agents': 'workspace:*',
        },
        scripts: {
          build: 'printf desktop-installer-build',
          'build:code': 'printf desktop-code-build',
          typecheck: 'printf desktop-typecheck',
          test: 'printf desktop-test',
        },
      },
    },
  ];

  for (const pkg of packages) {
    const packageDir = path.join(dir, pkg.dir);
    mkdirSync(path.join(packageDir, 'src'), { recursive: true });
    writeJson(path.join(packageDir, 'package.json'), pkg.json);
    writeFileSync(path.join(packageDir, 'src', 'index.ts'), 'export const value = 1;\n');
  }

  run('git', ['init', '--initial-branch=main'], dir);
  run('git', ['add', '.'], dir);
  run('git', ['commit', '-m', 'initial'], dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('verify-affected-workspaces script', () => {
  it('runs dependency builds and only affected package verify tasks', () => {
    const repo = makeWorkspaceRepo();
    writeFileSync(path.join(repo, 'apps/desktop/src/index.ts'), 'export const value = 2;\n');

    const output = run('bun', [scriptPath, '--dry-run'], repo);

    expect(output).toContain('@demo/shared: bun run --cwd packages/shared build');
    expect(output).toContain('@demo/agents: bun run --cwd packages/agents build');
    expect(output).toContain('@demo/desktop: bun run --cwd apps/desktop typecheck');
    expect(output).toContain('@demo/desktop: bun run --cwd apps/desktop test');
    expect(output).not.toContain('@demo/shared: bun run --cwd packages/shared test');
    expect(output).not.toContain('@demo/agents: bun run --cwd packages/agents test');
  });

  it('skips package verification when only root files changed', () => {
    const repo = makeWorkspaceRepo();
    writeFileSync(path.join(repo, 'README.md'), 'root-only\n');

    const output = run('bun', [scriptPath, '--dry-run'], repo);

    expect(output).toContain('Root-level files changed');
    expect(output).toContain('No workspace package files changed');
    expect(output).not.toContain('bun run --cwd');
  });

  it('uses desktop build:code when build is explicitly requested', () => {
    const repo = makeWorkspaceRepo();
    writeFileSync(path.join(repo, 'apps/desktop/src/index.ts'), 'export const value = 3;\n');

    const output = run('bun', [scriptPath, '--dry-run', '--tasks=build'], repo);

    expect(output).toContain('@demo/desktop: bun run --cwd apps/desktop build:code');
    expect(output).not.toContain('@demo/desktop: bun run --cwd apps/desktop build\n');
  });
});
