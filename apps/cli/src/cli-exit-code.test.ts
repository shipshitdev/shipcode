import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Exit-code contract, asserted against the shipped binary.
 *
 * These run the real `dist/index.js` in a child process on purpose. Every
 * guarded command returns early from its action handler on failure, so a test
 * that asserts on return values sees the same thing whether or not the exit
 * code is set — which is exactly how `shipcode run 123 && deploy` shipped with
 * failures exiting 0. Only a subprocess can observe the difference.
 */

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distEntry = path.join(cliRoot, 'dist', 'index.js');

/** Both npm and bun create this symlink; bun may hoist it to the workspace root. */
function resolveTsupBin(): string {
  const candidates = [
    path.join(cliRoot, 'node_modules', '.bin', 'tsup'),
    path.join(cliRoot, '..', '..', 'node_modules', '.bin', 'tsup'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `tsup not found — run \`bun install\`. Looked in:\n  ${candidates.join('\n  ')}`,
    );
  }
  // Run the resolved script through node rather than exec'ing the symlink, so
  // the test does not depend on the shebang or the executable bit.
  return fs.realpathSync(found);
}

let home = '';

beforeAll(() => {
  // Node 22 cannot execute the TypeScript entrypoint, and `dist/` is not
  // guaranteed fresh (turbo's `test` task only builds workspace dependencies),
  // so build the artifact under test here. tsup takes well under a second.
  execFileSync(process.execPath, [resolveTsupBin()], { cwd: cliRoot, stdio: 'pipe' });
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-cli-exit-'));
}, 120_000);

afterAll(() => {
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, [distEntry, ...args], {
    cwd: home,
    encoding: 'utf8',
    // An un-onboarded machine is simulated entirely through HOME:
    // `requireOnboarding` looks for `$HOME/.shipcode/data/shipcode.db`.
    env: { ...process.env, HOME: home },
    timeout: 60_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('shipcode exit codes', () => {
  it.each([
    ['run <issue>', ['run', '123']],
    ['plan <issue>', ['plan', '123']],
    ['approve <issue>', ['approve', '123']],
    ['review <issue>', ['review', '123']],
    ['retry <issue>', ['retry', '123']],
    ['logs <issue>', ['logs', '123']],
    ['prd <keywords...>', ['prd', 'add', 'search']],
  ])(
    'exits non-zero when %s is blocked by the onboarding guard',
    (_label, args) => {
      const { status, stdout } = runCli(args);

      expect(stdout).toContain('shipcode onboard');
      expect(status).toBe(1);
    },
    90_000,
  );

  it('exits zero for --version', () => {
    const { status, stdout } = runCli(['--version']);

    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(status).toBe(0);
  }, 90_000);

  it('exits zero for status, which reports empty state rather than failing', () => {
    // `status` is deliberately not behind the onboarding guard: "nothing to
    // report" is a successful report, the same way `git status` succeeds in a
    // repo with no commits. Pinned so the guard is not added to it by reflex.
    const { status, stdout } = runCli(['status']);

    expect(stdout).toContain('No ShipCode database found');
    expect(status).toBe(0);
  }, 90_000);
});
