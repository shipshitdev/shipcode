/**
 * Grep tool — regex content search across the worktree.
 *
 * Uses ripgrep (`rg`) when available (fast, respects .gitignore),
 * falling back to a JS walker for environments without rg. Results
 * capped to avoid flooding the model's context.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { IGNORED_DIRECTORIES } from '@shipcode/shared'
import type { Tool, ToolContext, ToolResult } from './types'
import { assertPathInWorktree, PathGuardError } from './path-guard'

const execFileAsync = promisify(execFile)

const GrepInput = z.object({
  pattern: z.string().min(1),
  /** Search root, relative to the worktree. Defaults to '.'. */
  path: z.string().optional(),
  /** Only match files matching this glob-ish include (e.g. "*.ts"). */
  include: z.string().optional(),
  /** Case-insensitive matching. */
  ignoreCase: z.boolean().optional(),
})

type GrepInput = z.infer<typeof GrepInput>

const MAX_MATCHES = 200
const MAX_LINE_LENGTH = 500

export const grepTool: Tool<GrepInput> = {
  name: 'grep',
  description:
    'Search file contents for a regex pattern, worktree-confined. ' +
    'Uses ripgrep when available. Returns up to 200 matches, each line capped at 500 chars.',
  schema: GrepInput,
  parameters: {
    type: 'object',
    required: ['pattern'],
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for.' },
      path: { type: 'string', description: 'Search root, relative to the worktree.' },
      include: { type: 'string', description: 'Optional glob to filter which files are searched (e.g. "*.ts").' },
      ignoreCase: { type: 'boolean', description: 'Case-insensitive matching.' },
    },
    additionalProperties: false,
  },

  async execute(input: GrepInput, ctx: ToolContext): Promise<ToolResult> {
    const searchRoot = input.path ?? '.'
    let rootAbs: string
    try {
      rootAbs = await assertPathInWorktree(searchRoot, ctx.worktreePath, { mustExist: true })
    } catch (err) {
      if (err instanceof PathGuardError) return { ok: false, error: err.message }
      throw err
    }

    const useRg = await hasRipgrep()
    if (useRg) {
      return runRipgrep(input, rootAbs)
    }
    return runJsGrep(input, rootAbs, ctx)
  },
}

async function hasRipgrep(): Promise<boolean> {
  try {
    await execFileAsync('rg', ['--version'], { timeout: 2_000 })
    return true
  } catch {
    return false
  }
}

async function runRipgrep(input: GrepInput, rootAbs: string): Promise<ToolResult> {
  const args = ['--no-heading', '--line-number', '--with-filename', '--max-count', String(MAX_MATCHES)]
  if (input.ignoreCase) args.push('--ignore-case')
  if (input.include) args.push('--glob', input.include)
  args.push('--', input.pattern, rootAbs)

  try {
    const { stdout } = await execFileAsync('rg', args, {
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    const lines = stdout.split('\n').filter(Boolean).slice(0, MAX_MATCHES)
    const cappedLines = lines.map((line) => (line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + '…' : line))
    const truncated = lines.length >= MAX_MATCHES
    return {
      ok: true,
      content: cappedLines.length === 0
        ? 'No matches.'
        : cappedLines.join('\n') + (truncated ? `\n\n[truncated at ${MAX_MATCHES} matches]` : ''),
      data: { matches: cappedLines.length, truncated, backend: 'rg' },
    }
  } catch (err) {
    // rg exits 1 when nothing matches — normalize that to an empty result
    const e = err as { code?: number; stdout?: string; message?: string }
    if (e.code === 1 && (e.stdout === '' || e.stdout === undefined)) {
      return { ok: true, content: 'No matches.', data: { matches: 0, truncated: false, backend: 'rg' } }
    }
    return { ok: false, error: `rg failed: ${e.message ?? 'unknown'}` }
  }
}

async function runJsGrep(input: GrepInput, rootAbs: string, ctx: ToolContext): Promise<ToolResult> {
  const flags = input.ignoreCase ? 'gi' : 'g'
  let regex: RegExp
  try {
    regex = new RegExp(input.pattern, flags)
  } catch (err) {
    return { ok: false, error: `invalid regex: ${(err as Error).message}` }
  }

  const matches: string[] = []

  async function walk(dir: string): Promise<void> {
    if (matches.length >= MAX_MATCHES) return
    if (ctx.signal.aborted) return

    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (matches.length >= MAX_MATCHES) break
      if (ctx.signal.aborted) break
      if (IGNORED_DIRECTORIES.includes(entry.name)) continue

      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        if (input.include && !simpleIncludeMatch(entry.name, input.include)) continue
        try {
          const content = await fs.readFile(full, 'utf-8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= MAX_MATCHES) break
            if (regex.test(lines[i])) {
              const rel = path.relative(rootAbs, full)
              const line = lines[i].length > MAX_LINE_LENGTH
                ? lines[i].slice(0, MAX_LINE_LENGTH) + '…'
                : lines[i]
              matches.push(`${rel}:${i + 1}:${line}`)
            }
          }
        } catch {
          // Unreadable file — skip silently
        }
      }
    }
  }

  await walk(rootAbs)

  const truncated = matches.length >= MAX_MATCHES
  return {
    ok: true,
    content: matches.length === 0
      ? 'No matches.'
      : matches.join('\n') + (truncated ? `\n\n[truncated at ${MAX_MATCHES} matches]` : ''),
    data: { matches: matches.length, truncated, backend: 'js' },
  }
}

function simpleIncludeMatch(filename: string, include: string): boolean {
  // Very small subset: "*.ts", "*.{ts,tsx}", exact name.
  if (include.startsWith('*.{') && include.endsWith('}')) {
    const exts = include.slice(3, -1).split(',')
    return exts.some((ext) => filename.endsWith('.' + ext))
  }
  if (include.startsWith('*.')) {
    return filename.endsWith(include.slice(1))
  }
  return filename === include
}
