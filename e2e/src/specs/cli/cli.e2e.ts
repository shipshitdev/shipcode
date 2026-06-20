import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const CLI_ENTRY = path.join(REPO_ROOT, 'apps', 'cli', 'dist', 'index.js');
const CLI_PACKAGE = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'apps', 'cli', 'package.json'), 'utf8'),
) as { version: string };

type CliResult = {
  code: number;
  stdout: string;
  stderr: string;
};

async function runShipcode(args: string[], home: string): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_ENTRY, ...args], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        HOME: home,
        SHIPCODE_TELEMETRY_ENABLED: 'false',
      },
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const err = error as Error & {
      code?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? err.message),
    };
  }
}

test.describe('CLI app smoke', () => {
  let home: string;

  test.beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'shipcode-cli-e2e-home-'));
  });

  test.afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('help lists the shipped command surface', async () => {
    const result = await runShipcode(['--help'], home);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('ShipCode');
    expect(result.stdout).toContain('Autonomous AI coding pipeline');
    expect(result.stdout).toContain('onboard');
    expect(result.stdout).toContain('status');
    expect(result.stdout).toContain('run <issue>');
    expect(result.stdout).toContain('terminal [options] <issue>');
    expect(result.stdout).toContain('prd <keywords...>');
  });

  test('version reports the packaged CLI version', async () => {
    const result = await runShipcode(['--version'], home);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(CLI_PACKAGE.version);
  });

  test('status is safe before onboarding or database creation', async () => {
    const result = await runShipcode(['status'], home);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('No ShipCode database found. Run a pipeline first.');
    expect(fs.existsSync(path.join(home, '.shipcode', 'data', 'shipcode.db'))).toBe(false);
  });
});
