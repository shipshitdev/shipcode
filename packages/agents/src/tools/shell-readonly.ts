/**
 * ShellReadOnly tool — strict allowlist, non-interpolated command execution.
 *
 * Lets the model run a narrow set of read-only commands (git status,
 * tsc --noEmit, rg, etc.) without giving it shell access. Every
 * invocation runs via `execFile` with `shell: false`, so:
 *
 *   - No command chaining (`;`, `&&`, `||`) — the chars are literal in argv.
 *   - No redirection (`>`, `<`, `|`) — same reason.
 *   - No expansion (`$(...)`, backticks, `~`) — never interpreted.
 *
 * Enforcement layers:
 *
 *   1. The `command` itself must be in SHELL_ALLOWLIST. Interpreters
 *      and package managers (`node`, `python`, `npm`, `bun`, etc.) are
 *      intentionally NOT in the allowlist because they can execute
 *      arbitrary code via `-e` / `-c` / `exec` / `run`. If the model
 *      needs to run tests, VERIFY phase handles that after execute.
 *
 *   2. For `git`, the first positional arg (after skipping global
 *      options we allow) must be in GIT_ALLOWED_SUBCOMMANDS — an
 *      allowlist rather than a blocklist, so new upstream subcommands
 *      are rejected by default.
 *
 *   3. Git global options that can escape the worktree or inject shell
 *      (`-C<path>`, `--git-dir`, `--work-tree`, `-c alias.X='!...'`,
 *      `--config-env`, `--exec-path`, etc.) are rejected before the
 *      subcommand is parsed. Both the spaced form (`-C /etc`) and the
 *      stuck form (`-C/etc`) are caught.
 *
 *   4. `cwd` is resolved via `fs.realpath()` before the child is
 *      spawned. Symlinks inside the worktree that resolve outside are
 *      rejected at call time, matching the TOCTOU mitigation used by
 *      the file tools' path-guard.
 *
 * This is NOT a sandbox. It's a read-only allowlist. Anything that
 * needs broader surface waits for a proper sandbox design.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  SHELL_ALLOWLIST,
  SHELL_EXEC_TIMEOUT_MS,
  GIT_ALLOWED_SUBCOMMANDS,
  GIT_BLOCKED_GLOBAL_OPTION_PREFIXES,
} from '@shipcode/shared';
import type { Tool, ToolContext, ToolResult } from './types';

const execFileAsync = promisify(execFile);

const ShellReadOnlyInput = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  /** Working directory, relative to the worktree. Defaults to worktree root. */
  cwd: z.string().optional(),
});

type ShellReadOnlyInput = z.infer<typeof ShellReadOnlyInput>;

const ALLOWLIST_SET = new Set<string>(SHELL_ALLOWLIST);
const GIT_ALLOWED_SET = new Set<string>(GIT_ALLOWED_SUBCOMMANDS);

export const shellReadOnlyTool: Tool<ShellReadOnlyInput> = {
  name: 'shell',
  description:
    'Run an allowlisted read-only command. Allowed commands: ' +
    SHELL_ALLOWLIST.join(', ') +
    '. For git, only these subcommands are permitted: ' +
    GIT_ALLOWED_SUBCOMMANDS.join(', ') +
    '. Commands run with shell: false, so metacharacters in args are literal; no chaining, redirection, or expansion. For file changes use the edit/write tools.',
  schema: ShellReadOnlyInput,
  parameters: {
    type: 'object',
    required: ['command'],
    properties: {
      command: {
        type: 'string',
        description: 'The executable name. Must be in the allowlist.',
        enum: [...SHELL_ALLOWLIST],
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Arguments passed directly to the command. No shell interpretation.',
      },
      cwd: {
        type: 'string',
        description: 'Working directory, relative to the worktree. Defaults to the worktree root.',
      },
    },
    additionalProperties: false,
  },

  async execute(input: ShellReadOnlyInput, ctx: ToolContext): Promise<ToolResult> {
    if (!ALLOWLIST_SET.has(input.command)) {
      return {
        ok: false,
        error: `command '${input.command}' is not in the shell allowlist. Allowed: ${SHELL_ALLOWLIST.join(', ')}`,
      };
    }

    // Git gets special treatment because its global options can escape
    // the worktree, redirect the config source, or inject shell via
    // aliases. Validate globals, then require the subcommand to be in
    // the explicit allowlist.
    if (input.command === 'git') {
      const gitCheck = validateGitArgs(input.args);
      if (gitCheck !== null) {
        return { ok: false, error: gitCheck };
      }
    }

    // cwd must resolve to a path inside the REAL worktree (after
    // following symlinks). This matches path-guard.ts's TOCTOU
    // mitigation for the file tools.
    let resolvedCwd: string;
    try {
      resolvedCwd = await resolveWorktreeCwd(ctx.worktreePath, input.cwd);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (ctx.signal.aborted) return { ok: false, error: 'aborted' };

    try {
      const { stdout, stderr } = await execFileAsync(input.command, input.args, {
        cwd: resolvedCwd,
        timeout: SHELL_EXEC_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
        shell: false,
        signal: ctx.signal,
      });
      const combined =
        (stdout ? `stdout:\n${stdout}` : '') +
          (stderr ? `${stdout ? '\n' : ''}stderr:\n${stderr}` : '') || '(no output)';
      return {
        ok: true,
        content: combined,
        data: { exitCode: 0, stdout, stderr },
      };
    } catch (err) {
      // execFile throws on non-zero exit AND on timeout. We want the
      // model to see the output either way so it can react.
      const e = err as {
        code?: number;
        stdout?: string;
        stderr?: string;
        signal?: string;
        killed?: boolean;
        message?: string;
      };
      if (e.killed && e.signal === 'SIGTERM') {
        return { ok: false, error: `command timed out after ${SHELL_EXEC_TIMEOUT_MS}ms` };
      }
      const stdout = e.stdout ?? '';
      const stderr = e.stderr ?? '';
      const exitCode = e.code ?? 1;
      return {
        ok: true,
        content:
          `exit ${exitCode}\n` +
          (stdout ? `stdout:\n${stdout}\n` : '') +
          (stderr ? `stderr:\n${stderr}\n` : '') +
          (stdout || stderr ? '' : (e.message ?? 'no output')),
        data: { exitCode, stdout, stderr },
      };
    }
  },
};

/**
 * Walk git's arg list, rejecting any global option that can:
 *   - redirect the effective cwd/worktree (`-C`, `--git-dir`, `--work-tree`)
 *   - inject shell via aliases (`-c alias.X=!...`, `--config-env`, `-c core.sshCommand=...`)
 *   - escape the binary (`--exec-path`)
 *
 * If the global options check out, require the first non-global arg to
 * be in GIT_ALLOWED_SUBCOMMANDS.
 *
 * Returns null on success, or an error message on rejection.
 */
function validateGitArgs(args: string[]): string | null {
  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    // Any arg starting with a blocked global option prefix is rejected.
    // This catches BOTH `-C /path` AND `-C/path` AND `--git-dir=...`
    // AND `--work-tree=...`. startsWith covers the stuck form and the
    // `=value` form.
    const blockedPrefix = GIT_BLOCKED_GLOBAL_OPTION_PREFIXES.find((p) => {
      // Exact match (-C alone) or startsWith for attached/= forms
      return arg === p || arg.startsWith(p);
    });
    if (blockedPrefix !== undefined) {
      return `git arg '${arg}' is blocked (prefix '${blockedPrefix}' can escape the worktree or alter git behavior).`;
    }

    // -c name=value : one-off config. Reject aliases (which can inject
    // shell via `!`) and any ssh/gpg/pager command override that could
    // execute arbitrary binaries.
    if (arg === '-c') {
      const value = args[i + 1];
      if (typeof value !== 'string') {
        return `git '-c' missing value`;
      }
      const rejection = validateGitConfigValue(value);
      if (rejection !== null) return rejection;
      i += 2;
      continue;
    }
    if (arg.startsWith('-c') && arg.length > 2) {
      // Stuck form `-cname=value`
      const value = arg.slice(2);
      const rejection = validateGitConfigValue(value);
      if (rejection !== null) return rejection;
      i++;
      continue;
    }

    // Once we hit a non-option arg, that's the subcommand. Require it
    // to be in the explicit allowlist.
    if (!arg.startsWith('-')) {
      if (!GIT_ALLOWED_SET.has(arg)) {
        return `git subcommand '${arg}' is not in the read-only allowlist (${GIT_ALLOWED_SUBCOMMANDS.join(', ')}). Use the edit/write tools for file changes.`;
      }
      // Stop scanning — anything after the subcommand is that
      // subcommand's own args, and we trust our subcommand allowlist
      // to mean "these are read-only and do not take shell-injection flags".
      return null;
    }

    // Unknown option form. Reject rather than silently pass — the
    // surface is narrow and we'd rather fail loud than guess.
    return `git option '${arg}' is not recognized; only explicit read-only subcommands are allowed.`;
  }

  // No subcommand provided — `git` alone prints help. That's harmless
  // but not useful; reject for clarity.
  return `git invocation missing a subcommand (allowed: ${GIT_ALLOWED_SUBCOMMANDS.join(', ')}).`;
}

/**
 * Validate a single `-c key=value` pair. Rejects alias injection, ssh
 * command override, gpg program override, pager/editor override, and
 * anything that looks like a `!shell` leading value.
 */
function validateGitConfigValue(entry: string): string | null {
  // `entry` looks like `key=value` or just `key` (no value is harmless
  // at git's level; reject anyway for parser simplicity).
  const eq = entry.indexOf('=');
  if (eq === -1) {
    return `git '-c ${entry}' missing value`;
  }
  const key = entry.slice(0, eq).toLowerCase();
  const value = entry.slice(eq + 1);

  // Any alias.* entry with a `!` value executes as a shell command.
  // Same logic: reject ANY alias.* even without the bang — aliases are
  // not useful in a read-only context.
  if (key.startsWith('alias.')) {
    return `git '-c ${entry}' is blocked (aliases can execute shell commands).`;
  }

  // Leading `!` in any config value that ends up being executed —
  // core.sshCommand, core.pager, core.editor, core.askPass,
  // credential.helper, sendemail.smtpEncryption, etc. — runs as shell.
  if (value.trimStart().startsWith('!')) {
    return `git '-c ${entry}' is blocked (value starts with '!', which git interprets as shell).`;
  }

  // Any override of a command-style config is a shell vector. Block
  // the well-known ones rather than chase the full list.
  const COMMAND_CONFIG_KEYS = new Set([
    'core.sshcommand',
    'core.editor',
    'core.pager',
    'core.askpass',
    'core.hookspath',
    'credential.helper',
    'pager',
    'http.sslcapath',
  ]);
  if (COMMAND_CONFIG_KEYS.has(key)) {
    return `git '-c ${entry}' is blocked (${key} is a command-style config).`;
  }

  return null;
}

/**
 * Resolve the model-provided cwd against the worktree root and return
 * an absolute path if it stays inside the worktree, or throw if it
 * escapes.
 *
 * Uses fs.realpath() on BOTH the worktree and the candidate so symlinks
 * inside the worktree pointing elsewhere (a TOCTOU vector the previous
 * lexical prefix check missed) are rejected at access time.
 *
 * - Undefined/empty/`.` → worktree root (realpath'd once)
 * - Absolute paths → rejected if the realpath is outside the worktree
 * - Relative paths → joined to the worktree, realpath'd, then checked
 */
async function resolveWorktreeCwd(worktreePath: string, sub: string | undefined): Promise<string> {
  const worktreeReal = await fs.realpath(worktreePath);

  if (!sub || sub === '.' || sub === '') return worktreeReal;

  const candidate = path.isAbsolute(sub) ? sub : path.resolve(worktreeReal, sub);

  // If the candidate doesn't exist yet, fs.realpath throws. Since the
  // shell tool's cwd MUST exist (execFile will fail otherwise), let
  // the error propagate — we don't support creating directories here.
  let candidateReal: string;
  try {
    candidateReal = await fs.realpath(candidate);
  } catch (err) {
    throw new Error(`cwd '${sub}' does not exist or is unreachable: ${(err as Error).message}`);
  }

  const boundary = worktreeReal.endsWith(path.sep) ? worktreeReal : worktreeReal + path.sep;
  const candidateNorm = candidateReal.endsWith(path.sep) ? candidateReal : candidateReal + path.sep;
  if (candidateNorm !== boundary && !candidateNorm.startsWith(boundary)) {
    throw new Error(
      `cwd '${sub}' escapes the worktree (resolves to ${candidateReal}, worktree is ${worktreeReal})`,
    );
  }
  return candidateReal;
}

// Exported for unit tests
export const _internals = {
  validateGitArgs,
  validateGitConfigValue,
  resolveWorktreeCwd,
};
