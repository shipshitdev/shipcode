# shipcode

## What this codebase does

Electron desktop app that orchestrates AI coding agents (Claude, Codex, Gemini) to work on GitHub issues through a multi-phase pipeline (plan → review → execute → verify). Turborepo + Bun monorepo: `apps/desktop` (Electron main/renderer), `packages/agents` (CLI wrappers), `packages/pipeline` (state machine), `packages/git` (worktree management), `packages/db` (SQLite via Drizzle), `packages/shared` (path helpers, validators).

## Auth shape

No server-side auth — local-first desktop app. Security-relevant credentials:
- **GitHub**: delegated to `gh` CLI; app never holds tokens directly
- **API keys** (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`): read from env, forwarded via `SAFE_ENV_KEYS` allowlist in `ProcessManager`
- **Telegram bot token / Discord webhook URL**: stored plaintext in SQLite settings table, validated by regex (`TELEGRAM_TOKEN_RE`, `DISCORD_WEBHOOK_RE`)
- **Claude/Codex auth**: existence-checked (`~/.claude/.credentials.json`, `~/.codex/auth.json`), never parsed or forwarded

## Threat model

1. **Command injection via subprocess spawning** — `ProcessManager` is the spawn gateway with an `ALLOWED_AGENT_COMMANDS` allowlist and `SAFE_ENV_KEYS` filter. `health-check.ts` uses string-interpolated `exec()` calls with internal-only values — if any caller passes user-controlled strings to `readEnvVar` or `checkCli`, it becomes injectable.
2. **IPC abuse from renderer XSS** — no per-handler origin/frame validation; relies on `contextIsolation: true`. Renderer runs with `sandbox: false`. XSS in renderer = full IPC access (kill processes, trigger pipeline runs, read settings including Telegram/Discord tokens).
3. **Path traversal via GitHub issue titles** — worktree directories derived from `slugifyIssueTitle(title)`. Mitigated by `assertWorkspaceSafe` basename regex at spawn time, but directory creation precedes that check.
4. **Prompt injection via project files** — `github:rewrite-issue` reads `skills/writing-prds/SKILL.md` from user project repos and injects into LLM prompt.

## Project-specific patterns to flag

- `execAsync` / `promisify(exec)` calls in `packages/agents/src/health-check.ts` with string interpolation — monitor for user-controlled values reaching `${command}`, `${binaryPath}`, `${name}` slots
- `diagnostics:renderer-ipc` channel accepts arbitrary unvalidated objects from renderer → logs via `logEvent` — log injection surface
- `process:kill` IPC handler kills agent processes by `processId` from renderer without validation beyond registry lookup — XSS could terminate running agents
- `resolveWorktreeParent` accepts user-configured absolute paths as `worktreeRoot` with minimal validation — allows writing worktrees to arbitrary locations
- `fs.readFileSync(path.join(project.path, 'skills/...'))` in IPC handlers reads from cloned repos into prompts

## Known false-positives

- `exec()` in `health-check.ts` with `'which ${command}'` / `'${binaryPath} --version'` — all interpolated values are hardcoded CLI names or resolved paths, not user input
- `spawnWithStdin` writing issue/PR bodies to `gh` stdin via `--body-file -` — data channel, not argument injection
- `'unsafe-eval'` in CSP — development mode only (when `VITE_RENDERER_URL` is set); production uses `script-src 'self'`
- `sandbox: false` in webPreferences — standard Electron preload pattern; security boundary is `contextIsolation`
- `ensureCodexDirTrusted` writing to `~/.codex/config.toml` — scoped to provider probe directory only
