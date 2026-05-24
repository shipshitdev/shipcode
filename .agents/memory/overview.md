---
name: project_shipcode_overview
description: Electron app orchestrating AI dev pipelines on GitHub issues; Turborepo + Bun monorepo; pre-release
type: project
status: active
last_verified: 2026-04-10
topics: [architecture, monorepo, electron]
---

**ShipCode** is an Electron desktop app that orchestrates AI-driven development pipelines on GitHub issues.

- **Monorepo:** Turborepo + Bun workspaces.
- **Apps:**
  - `apps/desktop/` — the Electron app (main + preload + renderer). React + Vite + Tailwind + shadcn-style UI primitives.
  - `apps/docs/` — Nextra 4 docs site, static-exported and embedded into `apps/web/public/docs/`.
  - `apps/web/` — marketing site that also serves `/docs`, deployed to Vercel as `shipcode-web` on `shipcode.shipshit.dev`.
- **Packages:**
  - `packages/agents/` — CLI provider wrappers (`claude`, `codex`, `openrouter`), PRD generator, GitHub integration, health checks.
  - `packages/pipeline/` — state machine for issue → plan → review → execute → verify.
  - `packages/git/` — `WorktreeManager` for creating and cleaning up git worktrees.
  - `packages/db/` — SQLite queries + schema migrations (better-sqlite3).
  - `packages/shared/` — types, constants, path helpers (`worktree-path.ts`), IPC channel names.
  - `packages/ui/` — reusable React primitives + icon re-exports from lucide.
- **Runtime:** Electron main process owns IPC, DB, GitHub polling, file I/O. Renderer is a React SPA. Pipeline work runs as spawned subprocesses (`claude -p`, `codex exec`) in git worktrees.
- **Pre-release:** No backward-compat concerns when refactoring defaults. Breaking changes are fine if they improve correctness.

**How to apply:** When adding features, pick the right package — don't drop app-specific logic into `shared`, don't dump orchestration logic into `ui`. See `.agents/memory/feedback_path_as_truth_worktrees.md` and other repo-specific rules.
