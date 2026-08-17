import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../utils';
import { execAlterTableIfMissing } from './schema-helpers';

export function migrateV63(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 63) return;

  transaction(db, () => {
    // Multi-repo automations: an automation can target more than one project.
    // automation_targets is the junction (one row per automation×project) and
    // is the source of truth for fan-out. automations.project_id is retained as
    // the "primary" target so existing single-project callers keep working;
    // dropping it would require an FK-aware table rebuild (threads.automation_id
    // references automations) and is deferred to a later cleanup.
    db.exec(`
      CREATE TABLE IF NOT EXISTS automation_targets (
        id            TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
        project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (automation_id, project_id)
      );

      CREATE INDEX IF NOT EXISTS idx_automation_targets_automation
        ON automation_targets(automation_id);
      CREATE INDEX IF NOT EXISTS idx_automation_targets_project
        ON automation_targets(project_id);
    `);

    // Backfill exactly one target per existing automation from its current
    // single project_id. Idempotent via the NOT EXISTS guard so re-running the
    // migration (or running it on a partially-migrated DB) never duplicates.
    db.exec(`
      INSERT INTO automation_targets (id, automation_id, project_id, created_at)
      SELECT lower(hex(randomblob(10))),
             id,
             project_id,
             COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        FROM automations
       WHERE project_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM automation_targets t
            WHERE t.automation_id = automations.id
              AND t.project_id = automations.project_id
         );
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (63)`);
  });
}

export function migrateV64(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 64) return;

  transaction(db, () => {
    // Checkpoint refs (#212): each pipeline checkpoint can carry a hidden
    // ShipCode-owned git ref (refs/shipcode/checkpoints/<threadId>/turn/<n>)
    // snapshotting the full dirty worktree state at capture time. Nullable —
    // legacy rows and rows whose ref capture failed keep commit-sha-only
    // restore semantics.
    execAlterTableIfMissing(db, 'ALTER TABLE pipeline_checkpoints ADD COLUMN ref_name TEXT');

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (64)`);
  });
}

export function migrateV65(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 65) return;

  transaction(db, () => {
    // Per-target run bookkeeping. A multi-repo automation dispatches one
    // pipeline per target project (PR #268 fan-out), so run lifecycle state
    // must live per (automation, target). The old automation-level counters
    // raced: every target bumped the same run_count, and concurrent finishes
    // clobbered last_status via `UPDATE automations ... WHERE id = ?` — the
    // status badge showed whichever target finished last, not a meaningful
    // rollup. These columns are the source of truth; automation-level
    // lastStatus/runCount/timestamps are now derived aggregates (worst-of
    // status, most-recent timestamps, summed counts).
    execAlterTableIfMissing(db, 'ALTER TABLE automation_targets ADD COLUMN last_started_at TEXT');
    execAlterTableIfMissing(db, 'ALTER TABLE automation_targets ADD COLUMN last_completed_at TEXT');
    execAlterTableIfMissing(db, 'ALTER TABLE automation_targets ADD COLUMN last_status TEXT');
    execAlterTableIfMissing(
      db,
      'ALTER TABLE automation_targets ADD COLUMN run_count INTEGER NOT NULL DEFAULT 0',
    );

    // Backfill losslessly: every pre-v65 automation has exactly one target row
    // (v63 backfilled one target = project_id), so copy the automation-level
    // counters into it. Multi-target automations did not exist before this, so
    // there is no aggregate to split.
    db.exec(`
      UPDATE automation_targets
         SET last_started_at   = (SELECT a.last_started_at   FROM automations a WHERE a.id = automation_targets.automation_id),
             last_completed_at = (SELECT a.last_completed_at FROM automations a WHERE a.id = automation_targets.automation_id),
             last_status       = (SELECT a.last_status       FROM automations a WHERE a.id = automation_targets.automation_id),
             run_count         = COALESCE(
               (SELECT a.run_count FROM automations a WHERE a.id = automation_targets.automation_id),
               0
             )
       WHERE EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_targets.automation_id);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (65)`);
  });
}

export function migrateV66(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 66) return;

  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pr_evidence_manifests (
        id              TEXT PRIMARY KEY,
        thread_id       TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        plan_id         TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        schema_version  INTEGER NOT NULL CHECK(schema_version = 1),
        revision        INTEGER NOT NULL CHECK(revision > 0),
        idempotency_key TEXT NOT NULL UNIQUE,
        manifest_json   TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (plan_id, revision)
      );

      CREATE INDEX IF NOT EXISTS idx_pr_evidence_manifests_thread_updated
        ON pr_evidence_manifests(thread_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pr_evidence_manifests_plan_revision
        ON pr_evidence_manifests(plan_id, revision DESC);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (66)`);
  });
}

/**
 * Promote issue_edges from constructor-side DDL into the numbered migration
 * chain so every entry point (desktop, CLI, tests) has the same schema after
 * getDatabase/runMigrations — without requiring IssueEdgeQueries construction.
 */
export function migrateV67(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 67) return;

  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS issue_edges (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_issue_id TEXT NOT NULL REFERENCES github_issue_cache(id) ON DELETE CASCADE,
        target_issue_id TEXT NOT NULL REFERENCES github_issue_cache(id) ON DELETE CASCADE,
        edge_type TEXT NOT NULL CHECK (edge_type IN ('blocks', 'depends_on', 'reference')),
        origin TEXT NOT NULL CHECK (origin IN ('body', 'manual')),
        source_body_issue_id TEXT REFERENCES github_issue_cache(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        -- Body-derived edges always carry their source issue; manual edges never do.
        -- The query layer relies on this to scope cleanup and uniqueness by origin.
        CHECK (
          (origin = 'body' AND source_body_issue_id IS NOT NULL)
          OR (origin = 'manual' AND source_body_issue_id IS NULL)
        ),
        CHECK (source_issue_id <> target_issue_id)
      );

      CREATE INDEX IF NOT EXISTS idx_issue_edges_project ON issue_edges(project_id);
      CREATE INDEX IF NOT EXISTS idx_issue_edges_source ON issue_edges(source_issue_id);
      CREATE INDEX IF NOT EXISTS idx_issue_edges_target ON issue_edges(target_issue_id);
      CREATE INDEX IF NOT EXISTS idx_issue_edges_type ON issue_edges(edge_type);
      CREATE INDEX IF NOT EXISTS idx_issue_edges_source_body ON issue_edges(source_body_issue_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_edges_unique_manual
        ON issue_edges(project_id, source_issue_id, target_issue_id, edge_type, origin)
        WHERE origin = 'manual';

      CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_edges_unique_body
        ON issue_edges(project_id, source_issue_id, target_issue_id, edge_type, origin, source_body_issue_id)
        WHERE origin = 'body';
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (67)`);
  });
}

/**
 * Expand issue_chat_sessions.provider CHECK to include Grok Build (`grok`).
 * SQLite cannot alter CHECK constraints in place — rebuild the table.
 */
export function migrateV68(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 68) return;

  transaction(db, () => {
    db.exec(`
      CREATE TABLE issue_chat_sessions_v68 (
        thread_id        TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
        provider         TEXT NOT NULL CHECK(provider IN ('claude', 'codex', 'grok')),
        session_id       TEXT,
        cwd              TEXT NOT NULL,
        model            TEXT,
        reasoning_effort TEXT,
        created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      INSERT INTO issue_chat_sessions_v68
        (thread_id, provider, session_id, cwd, model, reasoning_effort, created_at, updated_at)
      SELECT thread_id, provider, session_id, cwd, model, reasoning_effort, created_at, updated_at
        FROM issue_chat_sessions;

      DROP TABLE issue_chat_sessions;
      ALTER TABLE issue_chat_sessions_v68 RENAME TO issue_chat_sessions;

      CREATE INDEX IF NOT EXISTS idx_issue_chat_sessions_updated
        ON issue_chat_sessions(updated_at DESC);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (68)`);
  });
}

/**
 * Clear saved selections of `qwen/qwen3-coder:free`, which OpenRouter delisted (verified
 * absent from the live catalog on 2026-08-17). It was a curated picker option, so a user
 * could have it saved at app, project, or issue scope, and every one of those would 404
 * mid-run against a model that no longer exists.
 *
 * Selections are cleared rather than rewritten to a substitute: which model should replace
 * it is the user's call, and each cleared scope falls back through the normal app default.
 * For `settings` that means deleting the key — the loader reads a missing key as "unset" and
 * applies DEFAULT_SETTINGS — so a DELETE, not an UPDATE to a sentinel.
 *
 * The key list is not "every key starting with openrouter". `triageModelId` and
 * `autoCommitModel` are provider-agnostic fields that hold an OpenRouter slug whenever their
 * companion provider (`triageModel` / `autoCommitProvider`) is set to openrouter — and
 * `autoCommitProvider` *defaults* to openrouter, so `autoCommitModel` is an OpenRouter model
 * id out of the box. Matching on the value rather than the key prefix is what makes including
 * them safe: a Claude or Codex id in either field can never equal this slug.
 *
 * Deliberately does NOT touch threads.*_resolved_model or the cost rows: those record what
 * actually ran on a past pipeline. They are history, not configuration, and rewriting them
 * would falsify the telemetry this app is built to trust.
 */
export function migrateV69(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 69) return;

  transaction(db, () => {
    db.exec(`
      DELETE FROM settings
       WHERE value = 'qwen/qwen3-coder:free'
         AND key IN (
           'openrouterPlannerModel',
           'openrouterReviewerModel',
           'openrouterVerifierModel',
           'openrouterExecutorModel',
           'openrouterDefaultPaidModel',
           'openrouterDefaultFreeModel',
           'openrouterExplicitFallback',
           'triageModelId',
           'autoCommitModel'
         );

      UPDATE projects
         SET planner_model_id_override  = NULLIF(planner_model_id_override,  'qwen/qwen3-coder:free'),
             reviewer_model_id_override = NULLIF(reviewer_model_id_override, 'qwen/qwen3-coder:free'),
             executor_model_id_override = NULLIF(executor_model_id_override, 'qwen/qwen3-coder:free'),
             verifier_model_id_override = NULLIF(verifier_model_id_override, 'qwen/qwen3-coder:free')
       WHERE 'qwen/qwen3-coder:free' IN (
               planner_model_id_override,
               reviewer_model_id_override,
               executor_model_id_override,
               verifier_model_id_override
             );

      UPDATE github_issue_cache
         SET planner_model_id_override  = NULLIF(planner_model_id_override,  'qwen/qwen3-coder:free'),
             reviewer_model_id_override = NULLIF(reviewer_model_id_override, 'qwen/qwen3-coder:free'),
             executor_model_id_override = NULLIF(executor_model_id_override, 'qwen/qwen3-coder:free'),
             verifier_model_id_override = NULLIF(verifier_model_id_override, 'qwen/qwen3-coder:free')
       WHERE 'qwen/qwen3-coder:free' IN (
               planner_model_id_override,
               reviewer_model_id_override,
               executor_model_id_override,
               verifier_model_id_override
             );
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (69)`);
  });
}
