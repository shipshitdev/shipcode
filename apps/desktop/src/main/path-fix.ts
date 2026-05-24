// Fix PATH for packaged Electron apps on macOS / Linux.
//
// Apps launched from Finder, Dock, or Spotlight inherit a minimal PATH
// (typically `/usr/bin:/bin:/usr/sbin:/sbin`) that excludes common
// install dirs for git, bun, codex, claude, etc. (`/usr/local/bin`,
// `/opt/homebrew/bin`, `~/.bun/bin`, `~/.cargo/bin`, …).
//
// Strategy: spawn the user's login shell with `-ilc 'echo "<sentinel>$PATH<sentinel>"'`
// to read the PATH as the user's terminal sees it, then prepend the
// resulting entries onto `process.env.PATH` so all subsequent
// `execFileSync` / `spawn` calls inherit the corrected PATH.
//
// Synchronous + idempotent. Safe to call once at main bootstrap.
//
// On Windows we no-op: GUI launches inherit user+system PATH already.
// In dev (`npm run dev`) Electron is launched from a terminal so PATH
// is fine — only patch when `app.isPackaged === true`.

import { spawnSync as nodeSpawnSync, type SpawnSyncReturns } from 'node:child_process';

const SENTINEL = '__SHIPCODE_PATH_FIX_SENTINEL__';
let applied = false;

export interface FixPathResult {
  applied: boolean;
  reason: 'already_applied' | 'not_supported_platform' | 'not_packaged' | 'shell_failed' | 'ok';
  newPathEntries?: string[];
  shellError?: string;
}

export type SpawnSyncFn = (
  command: string,
  args: string[],
  options: { encoding: 'utf-8'; timeout: number; env: NodeJS.ProcessEnv },
) => SpawnSyncReturns<string>;

/**
 * Patch `process.env.PATH` with the user's login-shell PATH.
 *
 * @param opts.force        Run even when not packaged (useful for tests).
 * @param opts.shell        Override the shell binary (defaults to `process.env.SHELL`).
 * @param opts.isPackaged   Override the packaged check.
 * @param opts.spawnSyncImpl Inject a spawnSync impl for tests.
 */
export function fixMainProcessPath(
  opts: { force?: boolean; shell?: string; isPackaged?: boolean; spawnSyncImpl?: SpawnSyncFn } = {},
): FixPathResult {
  if (applied && !opts.force) {
    return { applied: false, reason: 'already_applied' };
  }

  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return { applied: false, reason: 'not_supported_platform' };
  }

  const isPackaged = opts.isPackaged ?? detectPackaged();
  if (!isPackaged && !opts.force) {
    return { applied: false, reason: 'not_packaged' };
  }

  const shell = opts.shell ?? process.env.SHELL ?? '/bin/zsh';
  const spawn = opts.spawnSyncImpl ?? (nodeSpawnSync as unknown as SpawnSyncFn);

  // -i = interactive (loads ~/.zshrc, ~/.bashrc), -l = login (loads
  // ~/.zprofile, ~/.profile, ~/.bash_profile). Both are needed because
  // PATH mutations live in either set depending on the user's setup.
  const result = spawn(shell, ['-ilc', `echo "${SENTINEL}$PATH${SENTINEL}"`], {
    encoding: 'utf-8',
    timeout: 5_000,
    env: { ...process.env, DISABLE_AUTO_TITLE: 'true' },
  });

  if (result.error || result.status !== 0) {
    return {
      applied: false,
      reason: 'shell_failed',
      shellError: result.error?.message ?? `exit ${result.status}`,
    };
  }

  const stdout = String(result.stdout ?? '');
  const match = stdout.match(new RegExp(`${SENTINEL}(.*)${SENTINEL}`));
  if (!match || !match[1]) {
    return { applied: false, reason: 'shell_failed', shellError: 'no sentinel match' };
  }

  const shellPath = match[1];
  const newEntries = shellPath.split(':').filter(Boolean);
  const existing = (process.env.PATH ?? '').split(':').filter(Boolean);
  const merged = dedupe([...newEntries, ...existing]);

  process.env.PATH = merged.join(':');
  applied = true;
  return { applied: true, reason: 'ok', newPathEntries: newEntries };
}

function detectPackaged(): boolean {
  // Avoid importing electron at module top-level so this file is safe
  // to import from tests without an electron runtime.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { app?: { isPackaged?: boolean } };
    return Boolean(electron.app?.isPackaged);
  } catch {
    return false;
  }
}

function dedupe(entries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    if (!seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

/** Test-only reset. */
export function __resetForTests(): void {
  applied = false;
}

export const __TEST_INTERNALS = { SENTINEL };
