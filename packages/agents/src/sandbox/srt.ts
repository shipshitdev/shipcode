/**
 * OS-level sandbox wrapper for programmatic (`claude -p`) EXECUTE runs.
 *
 * Programmatic claude execute grants the agent host Edit/Write/Bash with no
 * built-in OS sandbox (the Claude Code Bash sandbox only constrains Bash, not
 * the Edit/Write file tools or MCP servers). To run it unattended we wrap the
 * WHOLE claude process in @anthropic-ai/sandbox-runtime (`srt`), which applies
 * Seatbelt (macOS) / bubblewrap (Linux) to claude and every tool/MCP it spawns.
 *
 * Empirically verified (v0.0.55) before wiring: srt passes stdin through to the
 * child, propagates the child's exact exit code, confines writes to
 * `filesystem.allowWrite`, and denies network except `network.allowedDomains`.
 *
 * IMPORTANT: srt does NOT fail closed on a missing/malformed policy — it falls
 * back to an OPEN default (no allowlist, no write confinement). So this module
 * must always emit a complete, well-formed policy with a fixed key set; that is
 * what keeps the sandbox actually restrictive. `buildSrtPolicy` is the single
 * source of that object.
 */
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { registerSandboxBinary } from '../process-manager';

export type SandboxNetworkPolicy = 'anthropic-only' | 'anthropic-github';

/**
 * Outbound domain allowlists. Network is deny-by-default; only these resolve.
 * `anthropic-github` adds the hosts an execute phase needs to push branches and
 * install dependencies. Broader allowlists widen exfiltration surface (srt does
 * hostname filtering, not TLS inspection), so keep these tight.
 */
// Exact hosts only — no `*.anthropic.com` wildcard. The agent holds its own
// ANTHROPIC_API_KEY and srt does hostname filtering (not TLS inspection), so a
// broad wildcard would widen the exfil surface for no functional gain.
const ANTHROPIC_HOSTS = ['api.anthropic.com', 'statsig.anthropic.com'] as const;
const NETWORK_PRESETS: Record<SandboxNetworkPolicy, readonly string[]> = {
  'anthropic-only': [...ANTHROPIC_HOSTS],
  'anthropic-github': [
    ...ANTHROPIC_HOSTS,
    'github.com',
    'api.github.com',
    'codeload.github.com',
    'objects.githubusercontent.com',
    'raw.githubusercontent.com',
    'registry.npmjs.org',
  ],
};

/**
 * Home-relative secret stores the sandboxed agent must never read. srt is
 * default-allow-read, so this is the explicit denylist of credential stores —
 * keep it broad. (A full deny-`~`/allow-exceptions inversion would be tighter
 * but risks breaking legitimate reads claude needs; this is the pragmatic line.)
 */
const DEFAULT_DENY_READ = [
  '~/.ssh',
  '~/.aws',
  '~/.gnupg',
  '~/.config',
  '~/.npmrc',
  '~/.netrc',
  '~/.gitconfig',
  '~/.git-credentials',
  '~/.docker',
  '~/.kube',
  '~/.pypirc',
  '~/.password-store',
  // ShipCode global state (other projects' worktrees + local SQLite/settings).
  '~/.shipcode',
  // Provider secret / session stores outside ~/.config.
  '~/.codex',
  '~/.cursor',
  // Electron app userData defaults (SQLite + encrypted settings live here).
  '~/Library/Application Support/shipcode',
  '~/Library/Application Support/ShipCode',
  '~/.config/shipcode',
  '~/.local/share/shipcode',
] as const;

/**
 * Writes always denied even though `~/.claude` is writable for session state:
 * these files persist outside the sandbox and would let a prompt-injected run
 * plant instructions/commands/subagents that affect FUTURE host Claude sessions.
 */
const DEFAULT_DENY_WRITE = [
  '~/.claude/CLAUDE.md',
  '~/.claude/commands',
  '~/.claude/agents',
  '~/.claude/settings.json',
] as const;

/** Specific `~/.claude` paths claude -p needs to write for session state. */
const CLAUDE_STATE_WRITE_PATHS = [
  '~/.claude/todos',
  '~/.claude/statsig',
  '~/.claude/.credentials.json',
  '~/.claude.json',
] as const;

export interface SrtResolution {
  available: boolean;
  /** Absolute path to the srt CLI entrypoint (executable node shebang). */
  command: string | null;
  reason: string;
}

let cachedResolution: SrtResolution | null = null;

/**
 * Rewrite an `…/app.asar/…` path to its `app.asar.unpacked` counterpart when
 * that file exists on disk (packaged Electron). Returns the input unchanged in
 * dev or when no unpacked copy is present.
 */
function unpackAsarPath(p: string): string {
  if (!p.includes(`app.asar${path.sep}`)) return p;
  const unpacked = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  return existsSync(unpacked) ? unpacked : p;
}

/**
 * Resolve the bundled `srt` CLI. We ship @anthropic-ai/sandbox-runtime as a
 * dependency of this package, so `require.resolve` finds it regardless of the
 * package-manager hoisting layout. The resolved absolute path is registered
 * with the ProcessManager allowlist so only THIS exact binary may be spawned.
 *
 * Returns unavailable (fail-closed) on Windows (srt is macOS/Linux only) or if
 * the entrypoint cannot be located. Cached for the process lifetime.
 */
export function resolveSrt(): SrtResolution {
  if (cachedResolution) return cachedResolution;

  if (process.platform === 'win32') {
    cachedResolution = {
      available: false,
      command: null,
      reason:
        'srt sandbox is not supported on Windows (requires macOS Seatbelt or Linux bubblewrap)',
    };
    return cachedResolution;
  }

  try {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('@anthropic-ai/sandbox-runtime/package.json');
    const pkgDir = path.dirname(pkgJsonPath);
    const pkg = require('@anthropic-ai/sandbox-runtime/package.json') as { bin?: { srt?: string } };
    const binRel = pkg.bin?.srt ?? 'dist/cli.js';
    // In a packaged Electron build the module resolves inside app.asar, which
    // the OS cannot exec as a subprocess. electron-builder unpacks this package
    // to app.asar.unpacked (see asarUnpack in electron-builder.yml); rewrite the
    // path to the unpacked copy when present. No-op in dev (no asar segment).
    const cliPath = unpackAsarPath(path.join(pkgDir, binRel));
    if (!existsSync(cliPath)) {
      cachedResolution = {
        available: false,
        command: null,
        reason: `srt entrypoint not found at ${cliPath} — reinstall @anthropic-ai/sandbox-runtime`,
      };
      return cachedResolution;
    }
    registerSandboxBinary(cliPath);
    cachedResolution = { available: true, command: cliPath, reason: 'ok' };
  } catch (error) {
    cachedResolution = {
      available: false,
      command: null,
      reason: `srt sandbox unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return cachedResolution;
}

/** Reset the cached resolution. Test-only. */
export function resetSrtResolutionCache(): void {
  cachedResolution = null;
}

/** Sensitive roots an extra write path may never equal or sit under. */
const FORBIDDEN_WRITE_ROOTS = ['/etc', '/usr', '/bin', '/sbin', '/System', '/private/etc', '/var'];

/**
 * Validate a user-supplied extra write path before it lands in the srt policy.
 * Must be absolute or `~/`-prefixed, contain no traversal segments, and not
 * target the filesystem root or a sensitive system root.
 */
function isPlausibleWritePath(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (!p.startsWith('/') && !p.startsWith('~/')) return false;
  if (path.normalize(p) !== p) return false; // rejects `..` / redundant segments
  if (p === '/') return false;
  return !FORBIDDEN_WRITE_ROOTS.some((root) => p === root || p.startsWith(`${root}/`));
}

export interface SrtPolicyHandle {
  policyPath: string;
  cleanup: () => Promise<void>;
}

function assertSrtPolicyInputs(opts: {
  worktreePath: string;
  networkPolicy: SandboxNetworkPolicy;
}): void {
  if (!path.isAbsolute(opts.worktreePath)) {
    throw new Error('srt policy requires an absolute worktree path');
  }
  if (!Object.hasOwn(NETWORK_PRESETS, opts.networkPolicy)) {
    throw new Error(`unsupported srt network policy: ${String(opts.networkPolicy)}`);
  }
}

/**
 * Write a per-run srt policy to a 0700 temp dir and return its path plus a
 * cleanup. The policy object is built from a FIXED key set — extra write paths
 * only ever land in `filesystem.allowWrite` as strings; no caller-controlled
 * keys are spread into the JSON, so a future srt weakening flag can never be
 * injected through here.
 */
export async function buildSrtPolicy(opts: {
  worktreePath: string;
  networkPolicy: SandboxNetworkPolicy;
  extraWritePaths: string[];
}): Promise<SrtPolicyHandle> {
  // Validate before creating any policy artifact. A missing/malformed policy
  // makes srt fall back to an open default, so invalid inputs must stop the run
  // before the sandbox process can be spawned.
  assertSrtPolicyInputs(opts);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipcode-srt-'));
  try {
    await fs.chmod(dir, 0o700);
    const policyPath = path.join(dir, 'policy.json');

    // Canonicalize: on macOS os.tmpdir() is /var/folders/… but /var → /private/var,
    // and a custom worktreeRoot may be a symlink. Seatbelt/bubblewrap match on the
    // real path, so include the resolved form (plus the original, defensively).
    const tmpReal = await fs.realpath(os.tmpdir()).catch(() => os.tmpdir());
    const worktreeReal = await fs.realpath(opts.worktreePath).catch(() => opts.worktreePath);

    const allowWrite = Array.from(
      new Set(
        [
          opts.worktreePath,
          worktreeReal,
          os.tmpdir(),
          tmpReal,
          // Scoped claude session-state paths only — NOT the whole ~/.claude dir,
          // which would let a run rewrite CLAUDE.md / commands / agents for all
          // future host sessions (see DEFAULT_DENY_WRITE).
          ...CLAUDE_STATE_WRITE_PATHS,
          ...opts.extraWritePaths.filter(isPlausibleWritePath),
        ].filter(Boolean),
      ),
    );

    const policy = {
      network: {
        allowedDomains: [...NETWORK_PRESETS[opts.networkPolicy]],
        deniedDomains: [] as string[],
        allowUnixSockets: [] as string[],
        allowLocalBinding: false,
      },
      filesystem: {
        denyRead: [...DEFAULT_DENY_READ],
        allowRead: [] as string[],
        allowWrite,
        denyWrite: [...DEFAULT_DENY_WRITE],
      },
    };

    await fs.writeFile(policyPath, JSON.stringify(policy, null, 2), { mode: 0o600 });

    return {
      policyPath,
      cleanup: async () => {
        await fs.rm(dir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    // Never leak the temp dir if chmod/realpath/writeFile throws after mkdtemp.
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

export interface SandboxedExecuteCommand {
  /** The srt CLI path to spawn (passed to runCli as the command override). */
  command: string;
  /** srt flags + the wrapped `claude` argv, with policy applied. */
  args: string[];
  cleanup: () => Promise<void>;
}

/**
 * Build the srt-wrapped command for a programmatic claude execute run.
 * Shape: `srt -s <policy> claude <innerClaudeArgs...>` with the prompt piped
 * via stdin (handled by runCli). Returns null when the sandbox is unavailable
 * so the caller can fail closed instead of running unsandboxed.
 */
export async function buildSandboxedClaudeExecuteCommand(opts: {
  worktreePath: string;
  innerClaudeArgs: string[];
  networkPolicy: SandboxNetworkPolicy;
  extraWritePaths: string[];
}): Promise<SandboxedExecuteCommand | null> {
  const srt = resolveSrt();
  if (!srt.available || !srt.command) return null;
  const policy = await buildSrtPolicy({
    worktreePath: opts.worktreePath,
    networkPolicy: opts.networkPolicy,
    extraWritePaths: opts.extraWritePaths,
  });
  return {
    command: srt.command,
    args: ['-s', policy.policyPath, 'claude', ...opts.innerClaudeArgs],
    cleanup: policy.cleanup,
  };
}
