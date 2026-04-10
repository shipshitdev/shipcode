import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { shellReadOnlyTool } from './shell-readonly'
import type { ToolContext } from './types'

let wt: string
let ctx: ToolContext

beforeEach(async () => {
  wt = await fs.mkdtemp(path.join(os.tmpdir(), 'shipcode-shell-'))
  ctx = {
    worktreePath: wt,
    signal: new AbortController().signal,
    threadId: 't-test',
  }
})

afterEach(async () => {
  await fs.rm(wt, { recursive: true, force: true })
})

describe('shellReadOnlyTool', () => {
  // ─── Allowlist enforcement ─────────────────────────────────────────

  it('rejects commands not in the allowlist', async () => {
    const res = await shellReadOnlyTool.execute({ command: 'rm', args: ['-rf', '/'] }, ctx)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not in the shell allowlist/)
  })

  it('rejects bash (shell interpreters are never allowed)', async () => {
    const res = await shellReadOnlyTool.execute({ command: 'bash', args: ['-c', 'ls'] }, ctx)
    expect(res.ok).toBe(false)
  })

  it('rejects sh', async () => {
    const res = await shellReadOnlyTool.execute({ command: 'sh', args: ['-c', 'ls'] }, ctx)
    expect(res.ok).toBe(false)
  })

  // ─── Git subcommand safety ─────────────────────────────────────────

  it('rejects git push', async () => {
    const res = await shellReadOnlyTool.execute({ command: 'git', args: ['push', 'origin', 'main'] }, ctx)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/blocked/)
  })

  it('rejects git reset', async () => {
    const res = await shellReadOnlyTool.execute({ command: 'git', args: ['reset', '--hard'] }, ctx)
    expect(res.ok).toBe(false)
  })

  it('rejects git checkout', async () => {
    const res = await shellReadOnlyTool.execute({ command: 'git', args: ['checkout', 'main'] }, ctx)
    expect(res.ok).toBe(false)
  })

  it('rejects git commit', async () => {
    const res = await shellReadOnlyTool.execute({ command: 'git', args: ['commit', '-m', 'x'] }, ctx)
    expect(res.ok).toBe(false)
  })

  it('rejects git add', async () => {
    const res = await shellReadOnlyTool.execute({ command: 'git', args: ['add', '.'] }, ctx)
    expect(res.ok).toBe(false)
  })

  it('rejects git fetch / pull / config / remote / branch / tag', async () => {
    for (const sub of ['fetch', 'pull', 'config', 'remote', 'branch', 'tag']) {
      const res = await shellReadOnlyTool.execute({ command: 'git', args: [sub] }, ctx)
      expect(res.ok).toBe(false)
    }
  })

  it('rejects git -C /other/path (would escape the worktree)', async () => {
    const res = await shellReadOnlyTool.execute(
      { command: 'git', args: ['-C', '/etc', 'status'] },
      ctx,
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/escape/)
  })

  it('rejects --git-dir and --work-tree flags', async () => {
    for (const flag of ['--git-dir=/other', '--work-tree=/other']) {
      const res = await shellReadOnlyTool.execute({ command: 'git', args: [flag, 'status'] }, ctx)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/blocked/)
    }
  })

  // ─── shell: false safety ──────────────────────────────────────────

  it('treats shell metacharacters in args as literal (not interpreted)', async () => {
    // Passing `; rm -rf /` as a literal arg to ls would try to look
    // for a file named "; rm -rf /" — it never runs as a shell
    // command. The exit code reflects that the target doesn't exist,
    // NOT that rm ran. Either way we just want to verify no crash
    // and no actual deletion.
    const tempFile = path.join(wt, 'sentinel.txt')
    await fs.writeFile(tempFile, 'still here', 'utf-8')

    const res = await shellReadOnlyTool.execute(
      { command: 'ls', args: ['; rm -rf /'] },
      ctx,
    )
    // May succeed or fail depending on ls behavior; what matters is
    // the sentinel file still exists.
    expect(await fs.readFile(tempFile, 'utf-8')).toBe('still here')
    void res
  })

  // ─── cwd confinement ──────────────────────────────────────────────

  it('accepts cwd inside the worktree', async () => {
    await fs.mkdir(path.join(wt, 'sub'), { recursive: true })
    const res = await shellReadOnlyTool.execute({ command: 'ls', args: [], cwd: 'sub' }, ctx)
    // ls of an empty dir returns empty output; just verify no error
    expect(res.ok).toBe(true)
  })

  it('rejects cwd that escapes the worktree', async () => {
    const res = await shellReadOnlyTool.execute({ command: 'ls', args: [], cwd: '../..' }, ctx)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/escape/i)
  })

  // ─── Happy paths ──────────────────────────────────────────────────

  it('runs ls and returns stdout', async () => {
    await fs.writeFile(path.join(wt, 'hello.txt'), 'x', 'utf-8')
    const res = await shellReadOnlyTool.execute({ command: 'ls', args: [] }, ctx)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.content).toContain('hello.txt')
  })

  it('captures non-zero exit as ok:true with the exit code in the result', async () => {
    // `cat /definitely-not-there` exits 1 — we want the model to SEE
    // the error output, not have the loop blow up.
    const res = await shellReadOnlyTool.execute(
      { command: 'cat', args: ['definitely-not-there'] },
      ctx,
    )
    // Result depends on platform (some catch it as ok:true, others as
    // a throw we catch). Accept both as long as an error is reported.
    if (res.ok) {
      expect(res.content).toMatch(/No such file|exit [1-9]/)
      expect((res.data as { exitCode: number }).exitCode).not.toBe(0)
    } else {
      expect(res.error).toBeTruthy()
    }
  })
})
