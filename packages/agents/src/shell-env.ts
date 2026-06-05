import { execFile, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SAFE_COMMAND_NAME = /^[a-zA-Z0-9._-]+$/;
const SAFE_ENV_VAR_NAME = /^[A-Z_][A-Z0-9_]*$/;

function assertSafeCommandName(command: string): void {
  if (!SAFE_COMMAND_NAME.test(command)) {
    throw new Error(`Unsafe command name: ${command}`);
  }
}

export function assertSafeEnvVarName(name: string): void {
  if (!SAFE_ENV_VAR_NAME.test(name)) {
    throw new Error(`Unsafe environment variable name: ${name}`);
  }
}

export async function resolveCommandOnPath(
  command: string,
  env: Record<string, string>,
): Promise<string> {
  assertSafeCommandName(command);
  const { stdout } = await execFileAsync('which', [command], { env });
  return stdout.trim();
}

const TRUSTED_SHELLS = new Set([
  '/bin/bash',
  '/bin/zsh',
  '/bin/sh',
  '/usr/bin/bash',
  '/usr/bin/zsh',
  '/usr/local/bin/bash',
  '/usr/local/bin/zsh',
  '/opt/homebrew/bin/bash',
  '/opt/homebrew/bin/zsh',
]);

let cachedShellPath: string | null = null;
let cachedShellPathKey: string | null = null;

function splitPath(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(':').filter((segment) => segment.length > 0);
}

function mergePathSegments(...pathGroups: Array<string[] | string | null | undefined>): string {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const group of pathGroups) {
    const segments = Array.isArray(group) ? group : splitPath(group);
    for (const segment of segments) {
      if (seen.has(segment)) continue;
      seen.add(segment);
      merged.push(segment);
    }
  }

  return merged.join(':');
}

function fallbackExecPathSegments(): string[] {
  const home = homedir();
  const bunInstall = process.env.BUN_INSTALL || join(home, '.bun');
  return [
    join(bunInstall, 'bin'),
    join(home, 'bin'),
    join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
}

function getShellPath(): string {
  /* v8 ignore start -- env nullish fallbacks are process hygiene and not semantically meaningful branches */
  const cacheKey = [
    process.env.SHELL ?? '',
    process.env.PATH ?? '',
    process.env.BUN_INSTALL ?? '',
  ].join('\0');
  /* v8 ignore stop */
  if (cachedShellPath && cachedShellPathKey === cacheKey) return cachedShellPath;
  let shellPath = '';
  try {
    /* v8 ignore start -- SHELL is normally defined in runtime; fallback is process hygiene */
    const shell = process.env.SHELL ?? '/bin/zsh';
    /* v8 ignore stop */
    if (!TRUSTED_SHELLS.has(shell)) {
      cachedShellPath = mergePathSegments(process.env.PATH, fallbackExecPathSegments());
      cachedShellPathKey = cacheKey;
      return cachedShellPath;
    }
    const output = execFileSync(shell, ['-ilc', 'printf "%s" "$PATH"'], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    /* v8 ignore next -- split always contains at least one entry */
    shellPath = output.split('\n').at(-1)?.trim() ?? '';
  } catch {
    shellPath = '';
  }

  cachedShellPath = mergePathSegments(shellPath, process.env.PATH, fallbackExecPathSegments());
  cachedShellPathKey = cacheKey;
  return cachedShellPath;
}

export function shellExecEnv(): Record<string, string> {
  return {
    ...process.env,
    BUN_INSTALL: process.env.BUN_INSTALL || join(homedir(), '.bun'),
    PATH: getShellPath(),
  } as Record<string, string>;
}

/**
 * @knipignore
 */
export function __resetShellExecEnvCacheForTests(): void {
  cachedShellPath = null;
  cachedShellPathKey = null;
}
