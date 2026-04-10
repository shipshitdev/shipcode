/**
 * ShellReadOnly tool — allowlisted, non-interpolated command execution.
 *
 * Lets the model run a narrow set of read-only commands (git status,
 * tsc --noEmit, bun test, rg, etc.) without giving it shell access.
 * Every invocation runs via `execFile` with `shell: false`, so:
 *
 *   - No command chaining (`;`, `&&`, `||`) — the chars are literal in argv.
 *   - No redirection (`>`, `<`, `|`) — same reason.
 *   - No expansion (`$(...)`, backticks, `~`) — never interpreted.
 *   - The `command` itself must be in SHELL_ALLOWLIST.
 *   - For `git`, the first positional arg must NOT be in GIT_BLOCKED_SUBCOMMANDS.
 *   - cwd is the worktree; the tool cannot escape via -C / --git-dir flags
 *     because git subcommands like `-C /etc git log` would require the
 *     model to pass `-C` as args[0] which is blocked below.
 *
 * The tool is not a sandbox. It is a blunt allowlist, intended as the
 * minimum viable way for the model to run its own tests / typechecks
 * before claiming execute is done. Anything that needs broader surface
 * should wait for a proper sandbox design.
 */

import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import {
  SHELL_ALLOWLIST,
  SHELL_EXEC_TIMEOUT_MS,
  GIT_BLOCKED_SUBCOMMANDS,
} from '@shipcode/shared'
import type { Tool, ToolContext, ToolResult } from './types'

const execFileAsync = promisify(execFile)

const ShellReadOnlyInput = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  /** Working directory, relative to the worktree. Defaults to worktree root. */
  cwd: z.string().optional(),
})

type ShellReadOnlyInput = z.infer<typeof ShellReadOnlyInput>

const ALLOWLIST_SET = new Set(SHELL_ALLOWLIST)
const GIT_BLOCKED_SET = new Set(GIT_BLOCKED_SUBCOMMANDS)

export const shellReadOnlyTool: Tool<ShellReadOnlyInput> = {
  name: 'shell',
  description:
    'Run an allowlisted read-only command. Allowed commands: ' +
    SHELL_ALLOWLIST.join(', ') +
    '. Git mutating subcommands (push, reset, checkout, commit, etc.) are blocked — use the edit/write tools for file changes. ' +
    'Commands run with shell: false, so metacharacters in args are literal; no chaining, redirection, or expansion.',
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
      }
    }

    // Block git's mutating subcommands. We specifically reject ANY arg
    // starting with `-C` or `--git-dir`/`--work-tree` to prevent the
    // model from redirecting git to another repository.
    if (input.command === 'git') {
      const firstArg = input.args[0]
      if (firstArg && GIT_BLOCKED_SET.has(firstArg)) {
        return {
          ok: false,
          error: `git subcommand '${firstArg}' is blocked. Use the edit/write tools for file changes.`,
        }
      }
      for (const arg of input.args) {
        if (arg === '-C' || arg.startsWith('--git-dir') || arg.startsWith('--work-tree')) {
          return {
            ok: false,
            error: `git arg '${arg}' is blocked (would escape the worktree).`,
          }
        }
      }
    }

    // cwd must resolve inside the worktree. We use path.resolve to
    // normalize `..` and then check the result is still under the
    // worktree via a trailing-separator prefix check (so /foo is not
    // accepted as under /foobar).
    const resolvedCwd = resolveWorktreeCwd(ctx.worktreePath, input.cwd)
    if (resolvedCwd === null) {
      return { ok: false, error: `cwd '${input.cwd}' escapes the worktree` }
    }

    if (ctx.signal.aborted) return { ok: false, error: 'aborted' }

    try {
      const { stdout, stderr } = await execFileAsync(input.command, input.args, {
        cwd: resolvedCwd,
        timeout: SHELL_EXEC_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
        shell: false,
        signal: ctx.signal,
      })
      const combined = (stdout ? `stdout:\n${stdout}` : '') +
        (stderr ? `${stdout ? '\n' : ''}stderr:\n${stderr}` : '') ||
        '(no output)'
      return {
        ok: true,
        content: combined,
        data: { exitCode: 0, stdout, stderr },
      }
    } catch (err) {
      // execFile throws on non-zero exit AND on timeout. We want the
      // model to see the output either way so it can react.
      const e = err as { code?: number; stdout?: string; stderr?: string; signal?: string; killed?: boolean; message?: string }
      if (e.killed && e.signal === 'SIGTERM') {
        return { ok: false, error: `command timed out after ${SHELL_EXEC_TIMEOUT_MS}ms` }
      }
      const stdout = e.stdout ?? ''
      const stderr = e.stderr ?? ''
      const exitCode = e.code ?? 1
      return {
        ok: true,
        content:
          `exit ${exitCode}\n` +
          (stdout ? `stdout:\n${stdout}\n` : '') +
          (stderr ? `stderr:\n${stderr}\n` : '') +
          (stdout || stderr ? '' : e.message ?? 'no output'),
        data: { exitCode, stdout, stderr },
      }
    }
  },
}

/**
 * Resolve the model-provided cwd against the worktree root and return
 * an absolute path if it stays inside the worktree, or null if it
 * escapes.
 *
 * - Undefined/empty/`.` → worktree root
 * - Absolute paths → rejected if outside the worktree
 * - Relative paths → joined + resolved, then checked via trailing-
 *   separator prefix so '/foo' can't pass as under '/foobar'
 */
function resolveWorktreeCwd(worktreePath: string, sub: string | undefined): string | null {
  if (!sub || sub === '.' || sub === '') return worktreePath
  const resolved = path.isAbsolute(sub) ? path.resolve(sub) : path.resolve(worktreePath, sub)
  const boundary = worktreePath.endsWith(path.sep) ? worktreePath : worktreePath + path.sep
  const candidate = resolved.endsWith(path.sep) ? resolved : resolved + path.sep
  if (candidate !== boundary && !candidate.startsWith(boundary)) return null
  return resolved
}
