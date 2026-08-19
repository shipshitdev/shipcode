---
name: cursor_cloud_specific_instructions
description: Cursor Cloud agent dev-env caveats — Node >=22.16 for node:sqlite, login-shell PATH, running the Electron app headless, load-sensitive tests
type: environment
status: active
last_verified: 2026-08-19
topics: [cursor-cloud, dev-environment, electron, testing]
---

## Cursor Cloud specific instructions

Setup already done by the startup update script: `bun` (1.3.14) is installed, Node 22 (>=22.16) is installed via `nvm` and set as the default alias, and `bun install` has run. The notes below are the non-obvious runtime caveats.

**Node version is load-bearing.** `packages/db` uses `node:sqlite` `DatabaseSync.isTransaction`, which only exists on **Node >= 22.16**. The base VM's `/exec-daemon/node` is 22.14 and will make `@shipcode/db` tests fail (`cannot start a transaction within a transaction`). A **login shell** (`~/.bashrc` sources nvm + bun) resolves `node` to the nvm 22.x default and `bun` correctly — but the Cursor Shell tool's default (non-login) invocation prepends `/exec-daemon` and shadows it with 22.14. So run build/test/lint tooling through a login shell, e.g. `bash -lc 'bun run test:ci'`, or first `export PATH="$HOME/.nvm/versions/node/$(nvm version default)/bin:$HOME/.bun/bin:$PATH"`. Verify with `node --version` (must be >= 22.16, not 22.14).

**Standard commands** live in the root `package.json` scripts (`bun run build|lint|typecheck|test:ci|dev:desktop`) and `turbo.json`; don't duplicate them here.

**Tests are resource-sensitive on this VM.** The full suite via `turbo run test` at default concurrency can flake with timeouts in git-heavy files — `packages/git/src/checkpoint.test.ts` (linked-worktree test) and `apps/desktop/src/main/git-workflows.test.ts` (2 git tests hit a ~20s internal timeout only when the whole file runs). They pass reliably in isolation and in small subsets. Prefer `bunx turbo run test --concurrency=1 -- --maxWorkers=2`, and re-run a failed package alone (`bun run --filter <pkg> test`) before treating a failure as real.

**Running the desktop app headless.** `bun run dev:desktop` runs Vite (port 5173) and auto-launches Electron. In the cloud VM it needs a display and a disabled sandbox: `DISPLAY=:1 ELECTRON_DISABLE_SANDBOX=1`. The dbus / GPU / WebGL errors it logs are non-fatal. Launch it **detached** (`setsid ... < /dev/null &`) — otherwise job control suspends the whole Electron process group (state `T`) between tool invocations and Vite stops answering; a suspended tree can be revived with `kill -CONT <pids>` but detaching avoids it. Never `pkill -f` an electron/vite pattern here — the Shell wrapper's own argv contains your pattern and you will kill your shell; kill by explicit PID (`ps -C electron -o pid=`).

**Onboarding gate.** First run shows "Welcome to ShipCode" and blocks Next until at least one AI CLI (`claude`/`codex`) is authenticated. Those CLIs aren't present in cloud, so pipelines can't run and added projects show a red `BLOCKED` badge — expected. The rest of the app (add git repo → project persisted to `~/.config/ShipCode/data/shipcode.db`, kanban board, health checks that detect the real `gh`) works without them.

**postinstall gotcha:** `scripts/fix-node-pty-permissions.sh` logs `read: Illegal option -d` because `postinstall` runs it under `sh` (dash). Harmless on Linux — the only `spawn-helper` binaries shipped are macOS prebuilds, which Linux never uses.
