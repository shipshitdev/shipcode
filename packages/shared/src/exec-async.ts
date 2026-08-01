import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Promise-returning `child_process.exec` / `execFile`.
 *
 * Node-only, so this lives outside the package barrel (see index.ts) — import
 * it as '@shipcode/shared/exec-async' to keep node:child_process out of the
 * renderer bundle.
 *
 * Prefer `execFileAsync`: it takes an argv array and never invokes a shell, so
 * interpolated paths cannot be reinterpreted as shell syntax. Reach for
 * `execAsync` only when the command genuinely needs shell features.
 */
export const execAsync = promisify(exec);
export const execFileAsync = promisify(execFile);
