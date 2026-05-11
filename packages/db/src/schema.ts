import type { DatabaseSync } from 'node:sqlite';
import {
  ISO_NOW_SQL,
  MAX_PIPELINE_RAW_OUTPUT_CHARS,
  PLAN_FENCE_TAG,
  REVIEW_FENCE_TAG,
  VERIFICATION_FENCE_TAG,
} from '@shipcode/shared';
import { transaction } from './utils';

function execAlterTableIfMissing(db: DatabaseSync, ddl: string): void {
  try {
    db.exec(ddl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Only suppress the idempotent duplicate-column case. Any other ALTER
    // failure must abort the migration so startup retries instead of silently
    // leaving the schema half-updated.
    if (!/duplicate column name/i.test(message)) throw err;
  }
}

function execAlterTablesIfMissing(db: DatabaseSync, ddls: readonly string[]): void {
  for (const ddl of ddls) {
    execAlterTableIfMissing(db, ddl);
  }
}

export function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      git_remote TEXT,
      github_project_url TEXT,
      planner_model_override TEXT,
      reviewer_model_override TEXT,
      executor_model_override TEXT,
      verifier_model_override TEXT,
      planner_model_id_override TEXT,
      reviewer_model_id_override TEXT,
      executor_model_id_override TEXT,
      verifier_model_id_override TEXT,
      planner_reasoning_effort_override TEXT,
      reviewer_reasoning_effort_override TEXT,
      executor_reasoning_effort_override TEXT,
      verifier_reasoning_effort_override TEXT,
      pipeline_speed_profile_override TEXT,
      discord_routing TEXT NOT NULL DEFAULT 'inherit',
      discord_webhook_url_override TEXT,
      telegram_routing TEXT NOT NULL DEFAULT 'inherit',
      telegram_chat_id_override TEXT,
      default_branch TEXT NOT NULL DEFAULT 'main',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      worktree_branch TEXT,
      worktree_path TEXT,
      planner_model TEXT NOT NULL DEFAULT 'claude',
      reviewer_model TEXT NOT NULL DEFAULT 'codex',
      verifier_model TEXT NOT NULL DEFAULT 'claude',
      executor_model TEXT NOT NULL DEFAULT 'claude',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      raw_output TEXT NOT NULL,
      structured TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      decision TEXT NOT NULL,
      confidence TEXT NOT NULL,
      raw_output TEXT NOT NULL,
      structured TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS diffs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      action TEXT NOT NULL,
      diff_content TEXT,
      before_hash TEXT,
      after_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_telemetry (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      phase TEXT NOT NULL,
      invocation_id TEXT NOT NULL,
      attempt INTEGER,
      provider TEXT,
      model TEXT,
      prompt_characters INTEGER NOT NULL,
      prompt_bytes INTEGER NOT NULL,
      prompt_lines INTEGER NOT NULL,
      selected_materials TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      cost_usd REAL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id);
    CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status);
    CREATE INDEX IF NOT EXISTS idx_plans_thread ON plans(thread_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_plan ON reviews(plan_id);
    CREATE INDEX IF NOT EXISTS idx_diffs_thread ON diffs(thread_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_telemetry_thread ON prompt_telemetry(thread_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_prompt_telemetry_invocation ON prompt_telemetry(thread_id, invocation_id);
  `);
}

export function migrateV2(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL PRIMARY KEY
    );
  `);

  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 2) return;

  transaction(db, () => {
    const alterColumns = [
      'ALTER TABLE threads ADD COLUMN github_issue_number INTEGER',
      'ALTER TABLE threads ADD COLUMN github_pr_number INTEGER',
      'ALTER TABLE threads ADD COLUMN github_repo TEXT',
      "ALTER TABLE threads ADD COLUMN executor_model TEXT DEFAULT 'claude'",
      'ALTER TABLE threads ADD COLUMN review_round INTEGER DEFAULT 0',
      'ALTER TABLE threads ADD COLUMN verification_status TEXT',
      'ALTER TABLE threads ADD COLUMN verification_retries INTEGER DEFAULT 0',
      'ALTER TABLE threads ADD COLUMN autonomous INTEGER DEFAULT 0',
      'ALTER TABLE threads ADD COLUMN base_branch TEXT',
      'ALTER TABLE threads ADD COLUMN fork_point_sha TEXT',
    ];

    execAlterTablesIfMissing(db, alterColumns);

    db.exec(`
      CREATE TABLE IF NOT EXISTS verifications (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        raw_output TEXT NOT NULL,
        structured TEXT,
        result TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_verifications_thread ON verifications(thread_id);

      CREATE TABLE IF NOT EXISTS github_issue_cache (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        issue_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        labels TEXT NOT NULL DEFAULT '[]',
        assignee TEXT,
        state TEXT NOT NULL DEFAULT 'open',
        pipeline_status TEXT NOT NULL DEFAULT 'todo',
        thread_id TEXT REFERENCES threads(id),
        claimed_at TEXT,
        claimed_by TEXT,
        last_phase_update TEXT,
        executor_model_override TEXT,
        linked_pr_number INTEGER,
        linked_pr_url TEXT,
        linked_pr_is_draft INTEGER NOT NULL DEFAULT 0,
        ci_blocked INTEGER NOT NULL DEFAULT 0,
        failing_checks TEXT NOT NULL DEFAULT '[]',
        unresolved_review_comments TEXT NOT NULL DEFAULT '[]',
        unresolved_review_comment_count INTEGER NOT NULL DEFAULT 0,
        pr_last_sync_at TEXT,
        fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE(project_id, issue_number)
      );

      CREATE INDEX IF NOT EXISTS idx_github_issues_project ON github_issue_cache(project_id);
      CREATE INDEX IF NOT EXISTS idx_github_issues_status ON github_issue_cache(pipeline_status);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (2)`);
  });
}

export function migrateV3(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 3) return;

  transaction(db, () => {
    execAlterTableIfMissing(db, 'ALTER TABLE github_issue_cache ADD COLUMN last_status_label TEXT');

    // Reclassify unclaimed queued issues as todo
    db.exec(`
      UPDATE github_issue_cache
      SET pipeline_status = 'todo'
      WHERE pipeline_status = 'queued' AND claimed_at IS NULL AND thread_id IS NULL
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (3)`);
  });
}

export function migrateV4(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 4) return;

  transaction(db, () => {
    // Per-issue executor model selection (claude | codex) — defaults to 'claude'.
    // The existing threads.executor_model (v2) remains as the pipeline-context default
    // for non-GitHub threads; this column stores the user's choice per cached issue.
    execAlterTableIfMissing(
      db,
      "ALTER TABLE github_issue_cache ADD COLUMN executor_model TEXT NOT NULL DEFAULT 'claude'",
    );

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (4)`);
  });
}

export function migrateV5(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 5) return;

  transaction(db, () => {
    // Mission Control activity feed — chronological log of pipeline events
    // across all projects. Written by the pipeline-bridge fan-out; read by
    // DashboardQueries for the "Recent Activity" column.
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id TEXT PRIMARY KEY,
        thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        actor TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_thread ON activity_log(thread_id);
      CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_log(project_id);

      -- Persistent notification records for the dock-badge count and in-app
      -- history. Written by NotificationService.fire(), dismissed by user
      -- action or auto-dismissed when the relevant thread is viewed.
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        dismissed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_active ON notifications(dismissed_at, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_thread ON notifications(thread_id);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (5)`);
  });
}

export function migrateV6(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 6) return;

  transaction(db, () => {
    // Tier 3 telemetry: per-phase resolved model + running token + cost
    // totals. Resolved columns capture what openrouter/auto actually
    // routed to when the pipeline uses the meta-router; for claude/codex
    // they just hold the literal 'claude'/'codex' string.
    //
    // Forward-only migration — no downgrade path, matching the rest of
    // the schema. Operators must restore from backup if they need to
    // downgrade.
    const alterColumns = [
      'ALTER TABLE threads ADD COLUMN planner_resolved_model TEXT',
      'ALTER TABLE threads ADD COLUMN reviewer_resolved_model TEXT',
      'ALTER TABLE threads ADD COLUMN revisor_resolved_model TEXT',
      'ALTER TABLE threads ADD COLUMN executor_resolved_model TEXT',
      'ALTER TABLE threads ADD COLUMN verifier_resolved_model TEXT',
      'ALTER TABLE threads ADD COLUMN total_tokens_prompt INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE threads ADD COLUMN total_tokens_completion INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE threads ADD COLUMN total_cost_usd REAL NOT NULL DEFAULT 0',
    ];
    execAlterTablesIfMissing(db, alterColumns);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (6)`);
  });
}

export function migrateV7(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 7) return;

  transaction(db, () => {
    // Project-level pin + archive state for sidebar management.
    execAlterTableIfMissing(
      db,
      `ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`,
    );
    execAlterTableIfMissing(
      db,
      `ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`,
    );

    // Defence-in-depth: verify columns actually exist before marking V7 applied.
    const cols = db.prepare(`PRAGMA table_info(projects)`).all() as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('pinned') || !names.has('archived')) {
      throw new Error('migrateV7: projects table is missing pinned/archived columns after ALTER');
    }

    // Auto-unarchive triggers: when a project is archived but receives new
    // work (thread, notification, or GitHub issue), flip archived=0 so the
    // project reappears in the sidebar automatically. This enforces the
    // "archived = quiet" invariant without threading unarchive calls through
    // every work-creating IPC handler.
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS projects_unarchive_on_thread_insert
        AFTER INSERT ON threads
        WHEN (SELECT archived FROM projects WHERE id = NEW.project_id) = 1
      BEGIN
        UPDATE projects SET archived = 0 WHERE id = NEW.project_id;
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS projects_unarchive_on_notification_insert
        AFTER INSERT ON notifications
        WHEN (SELECT archived FROM projects WHERE id = NEW.project_id) = 1
      BEGIN
        UPDATE projects SET archived = 0 WHERE id = NEW.project_id;
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS projects_unarchive_on_github_issue_insert
        AFTER INSERT ON github_issue_cache
        WHEN (SELECT archived FROM projects WHERE id = NEW.project_id) = 1
      BEGIN
        UPDATE projects SET archived = 0 WHERE id = NEW.project_id;
      END;
    `);
    // UPDATE trigger for github_issue_cache: `GitHubIssueQueries.upsert()`
    // updates existing rows on `github:refresh-issues`, so an INSERT trigger
    // alone would miss already-cached issues transitioning into active work.
    // Scope is narrowly limited to the claim transition (NULL → non-NULL)
    // so trivial metadata refreshes (labels, title, assignee) on archived
    // projects do NOT unarchive them — this preserves the user's archive
    // intent when GitHub polling is enabled.
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS projects_unarchive_on_github_issue_claim
        AFTER UPDATE OF claimed_at ON github_issue_cache
        WHEN NEW.claimed_at IS NOT NULL
          AND OLD.claimed_at IS NULL
          AND (SELECT archived FROM projects WHERE id = NEW.project_id) = 1
      BEGIN
        UPDATE projects SET archived = 0 WHERE id = NEW.project_id;
      END;
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (7)`);
  });
}

export function migrateV8(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 8) return;

  transaction(db, () => {
    // Store the last failure reason so the UI can surface it in IssueDetail.
    execAlterTableIfMissing(db, 'ALTER TABLE threads ADD COLUMN last_error TEXT');

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (8)`);
  });
}

export function migrateV9(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 9) return;

  transaction(db, () => {
    // Per-phase prompt skill overrides. Composite key (project_id, phase) where
    // project_id IS NULL is the global override. The runtime loader (in
    // @shipcode/agents) walks project → global → bundled default and quarantines
    // any row that fails validation. Quarantined rows are NOT deleted — the
    // user content is preserved for manual recovery via the /skills page.
    db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        project_id     TEXT,
        phase          TEXT NOT NULL,
        content        TEXT NOT NULL,
        base_version   TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        status         TEXT NOT NULL DEFAULT 'ok',
        status_reason  TEXT,
        updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      -- Composite uniqueness: one row per (project_id, phase). NULL project_id
      -- is the global override; SQLite's UNIQUE treats multiple NULLs as
      -- distinct, so we use a partial unique index instead of a PRIMARY KEY.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_project_phase
        ON skills(COALESCE(project_id, ''), phase);
      CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (9)`);
  });
}

export function migrateV10(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 10) return;

  transaction(db, () => {
    // Per-project override for the Kanban `board` quick-link. GitHub Projects v2
    // live under a user/org and can span multiple repos, so we can't derive this
    // from `git_remote` alone. NULL means "use the repo Projects tab fallback".
    execAlterTableIfMissing(db, 'ALTER TABLE projects ADD COLUMN github_project_url TEXT');

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (10)`);
  });
}

export function migrateV11(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 11) return;

  transaction(db, () => {
    // Timestamp when a DONE issue was archived (closed on GitHub + hidden in UI).
    // NULL means the issue has not been archived. Non-null means it is hidden from
    // the Kanban board unless the user explicitly requests archived issues.
    execAlterTableIfMissing(db, 'ALTER TABLE github_issue_cache ADD COLUMN archived_at TEXT');

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (11)`);
  });
}

export function migrateV12(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 12) return;

  transaction(db, () => {
    const projectColumns = [
      'ALTER TABLE projects ADD COLUMN planner_model_override TEXT',
      'ALTER TABLE projects ADD COLUMN reviewer_model_override TEXT',
      'ALTER TABLE projects ADD COLUMN executor_model_override TEXT',
      'ALTER TABLE projects ADD COLUMN verifier_model_override TEXT',
    ];
    execAlterTablesIfMissing(db, projectColumns);
    execAlterTableIfMissing(
      db,
      "ALTER TABLE threads ADD COLUMN verifier_model TEXT DEFAULT 'claude'",
    );
    execAlterTableIfMissing(
      db,
      'ALTER TABLE github_issue_cache ADD COLUMN executor_model_override TEXT',
    );

    db.exec(`
      UPDATE github_issue_cache
      SET executor_model_override = executor_model
      WHERE executor_model_override IS NULL
        AND executor_model IS NOT NULL
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (12)`);
  });
}

export function migrateV13(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 13) return;

  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_checkpoints (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        phase TEXT NOT NULL,
        reason TEXT NOT NULL,
        label TEXT NOT NULL,
        branch TEXT,
        commit_sha TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_pipeline_checkpoints_thread
        ON pipeline_checkpoints(thread_id, created_at DESC);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (13)`);
  });
}

export function migrateV14(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 14) return;

  transaction(db, () => {
    const alterColumns = [
      'ALTER TABLE github_issue_cache ADD COLUMN linked_pr_number INTEGER',
      'ALTER TABLE github_issue_cache ADD COLUMN linked_pr_url TEXT',
      'ALTER TABLE github_issue_cache ADD COLUMN linked_pr_is_draft INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE github_issue_cache ADD COLUMN ci_blocked INTEGER NOT NULL DEFAULT 0',
      "ALTER TABLE github_issue_cache ADD COLUMN failing_checks TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE github_issue_cache ADD COLUMN unresolved_review_comments TEXT NOT NULL DEFAULT '[]'",
      'ALTER TABLE github_issue_cache ADD COLUMN unresolved_review_comment_count INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE github_issue_cache ADD COLUMN pr_last_sync_at TEXT',
    ];

    execAlterTablesIfMissing(db, alterColumns);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (14)`);
  });
}

export function migrateV15(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 15) return;

  transaction(db, () => {
    const projectColumns = [
      'ALTER TABLE projects ADD COLUMN planner_model_id_override TEXT',
      'ALTER TABLE projects ADD COLUMN reviewer_model_id_override TEXT',
      'ALTER TABLE projects ADD COLUMN executor_model_id_override TEXT',
      'ALTER TABLE projects ADD COLUMN verifier_model_id_override TEXT',
      'ALTER TABLE projects ADD COLUMN planner_reasoning_effort_override TEXT',
      'ALTER TABLE projects ADD COLUMN reviewer_reasoning_effort_override TEXT',
      'ALTER TABLE projects ADD COLUMN executor_reasoning_effort_override TEXT',
      'ALTER TABLE projects ADD COLUMN verifier_reasoning_effort_override TEXT',
    ];

    execAlterTablesIfMissing(db, projectColumns);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (15)`);
  });
}

export function migrateV16(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 16) return;

  transaction(db, () => {
    const issueColumns = [
      'ALTER TABLE github_issue_cache ADD COLUMN planner_model_override TEXT',
      'ALTER TABLE github_issue_cache ADD COLUMN reviewer_model_override TEXT',
      'ALTER TABLE github_issue_cache ADD COLUMN verifier_model_override TEXT',
    ];

    execAlterTablesIfMissing(db, issueColumns);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (16)`);
  });
}

export function migrateV17(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 17) return;

  transaction(db, () => {
    const issueColumns = [
      'ALTER TABLE github_issue_cache ADD COLUMN planner_model_id_override TEXT',
      'ALTER TABLE github_issue_cache ADD COLUMN reviewer_model_id_override TEXT',
      'ALTER TABLE github_issue_cache ADD COLUMN executor_model_id_override TEXT',
      'ALTER TABLE github_issue_cache ADD COLUMN verifier_model_id_override TEXT',
    ];

    execAlterTablesIfMissing(db, issueColumns);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (17)`);
  });
}

export function migrateV18(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 18) return;

  transaction(db, () => {
    db.exec(`
      UPDATE plans
         SET status = 'approval'
       WHERE status = 'rejected'
         AND thread_id IN (
           SELECT id
             FROM threads
            WHERE status IN ('approval', 'awaiting_approval')
         )
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (18)`);
  });
}

export function migrateV19(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 19) return;

  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS terminal_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        event TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_terminal_events_thread_seq
        ON terminal_events(thread_id, seq DESC);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (19)`);
  });
}

export function migrateV20(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 20) return;

  transaction(db, () => {
    const projectColumns = [
      "ALTER TABLE projects ADD COLUMN discord_routing TEXT NOT NULL DEFAULT 'inherit'",
      'ALTER TABLE projects ADD COLUMN discord_webhook_url_override TEXT',
      "ALTER TABLE projects ADD COLUMN telegram_routing TEXT NOT NULL DEFAULT 'inherit'",
      'ALTER TABLE projects ADD COLUMN telegram_chat_id_override TEXT',
    ];

    execAlterTablesIfMissing(db, projectColumns);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (20)`);
  });
}

export function migrateV21(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 21) return;

  transaction(db, () => {
    db.exec(`
      UPDATE github_issue_cache
         SET pipeline_status = 'closed',
             last_phase_update = COALESCE(last_phase_update, ${ISO_NOW_SQL})
       WHERE state = 'closed'
         AND pipeline_status = 'completed'
    `);

    db.exec(`
      UPDATE github_issue_cache
         SET pipeline_status = 'completed',
             last_phase_update = COALESCE(last_phase_update, ${ISO_NOW_SQL})
       WHERE state = 'open'
         AND pipeline_status IN ('todo', 'queued', 'approval', 'awaiting_approval', 'failed')
         AND (
           linked_pr_number IS NOT NULL
           OR EXISTS (
             SELECT 1
             FROM threads
             WHERE threads.id = github_issue_cache.thread_id
               AND threads.status = 'completed'
           )
         )
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (21)`);
  });
}

export function migrateV22(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 22) return;

  transaction(db, () => {
    db.exec(`
      UPDATE github_issue_cache
         SET pipeline_status = 'todo',
             last_phase_update = NULL
       WHERE pipeline_status = 'queued'
         AND claimed_at IS NULL
         AND thread_id IS NULL
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (22)`);
  });
}

export function migrateV23(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 23) return;

  transaction(db, () => {
    execAlterTablesIfMissing(db, [
      'ALTER TABLE github_issue_cache ADD COLUMN planner_reasoning_effort_override TEXT',
      'ALTER TABLE github_issue_cache ADD COLUMN reviewer_reasoning_effort_override TEXT',
      'ALTER TABLE github_issue_cache ADD COLUMN executor_reasoning_effort_override TEXT',
      'ALTER TABLE github_issue_cache ADD COLUMN verifier_reasoning_effort_override TEXT',
    ]);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (23)`);
  });
}

export function migrateV24(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 24) return;

  transaction(db, () => {
    execAlterTablesIfMissing(db, [
      "ALTER TABLE threads ADD COLUMN kind TEXT NOT NULL DEFAULT 'pipeline'",
      'ALTER TABLE projects ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0',
    ]);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (24)`);
  });
}

export function migrateV25(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 25) return;

  transaction(db, () => {
    execAlterTableIfMissing(db, 'ALTER TABLE projects ADD COLUMN notify_github_user TEXT');
    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (25)`);
  });
}

export function migrateV26(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 26) return;

  transaction(db, () => {
    execAlterTableIfMissing(db, 'ALTER TABLE threads ADD COLUMN failure_phase TEXT');
    execAlterTableIfMissing(
      db,
      'ALTER TABLE threads ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0',
    );

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (26)`);
  });
}

export function migrateV27(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 27) return;

  transaction(db, () => {
    const tailPrefix = '[truncated historical raw_output]\n';
    const keepChars = MAX_PIPELINE_RAW_OUTPUT_CHARS - tailPrefix.length;
    const planFencePrefix = `\`\`\`${PLAN_FENCE_TAG}\n`;
    const reviewFencePrefix = `\`\`\`${REVIEW_FENCE_TAG}\n`;
    const verificationFencePrefix = `\`\`\`${VERIFICATION_FENCE_TAG}\n`;
    const fenceSuffix = '\n```';

    db.prepare(
      `UPDATE plans
          SET raw_output = ? || structured || ?
        WHERE structured IS NOT NULL`,
    ).run(planFencePrefix, fenceSuffix);
    db.prepare(
      `UPDATE reviews
          SET raw_output = ? || structured || ?
        WHERE structured IS NOT NULL`,
    ).run(reviewFencePrefix, fenceSuffix);
    db.prepare(
      `UPDATE verifications
          SET raw_output = ? || structured || ?
        WHERE structured IS NOT NULL`,
    ).run(verificationFencePrefix, fenceSuffix);

    db.prepare(
      `UPDATE plans
          SET raw_output = ? || substr(raw_output, -?)
        WHERE length(raw_output) > ?`,
    ).run(tailPrefix, keepChars, MAX_PIPELINE_RAW_OUTPUT_CHARS);
    db.prepare(
      `UPDATE reviews
          SET raw_output = ? || substr(raw_output, -?)
        WHERE length(raw_output) > ?`,
    ).run(tailPrefix, keepChars, MAX_PIPELINE_RAW_OUTPUT_CHARS);
    db.prepare(
      `UPDATE verifications
          SET raw_output = ? || substr(raw_output, -?)
        WHERE length(raw_output) > ?`,
    ).run(tailPrefix, keepChars, MAX_PIPELINE_RAW_OUTPUT_CHARS);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (27)`);
  });
}

export function migrateV28(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 28) return;

  transaction(db, () => {
    execAlterTablesIfMissing(db, [
      'ALTER TABLE threads ADD COLUMN clarification_round INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE threads ADD COLUMN clarification_request TEXT',
      "ALTER TABLE threads ADD COLUMN clarification_answers TEXT NOT NULL DEFAULT '[]'",
    ]);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (28)`);
  });
}

export function migrateV29(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 29) return;

  transaction(db, () => {
    execAlterTablesIfMissing(db, [
      'ALTER TABLE projects ADD COLUMN github_repo_id TEXT',
      'ALTER TABLE projects ADD COLUMN github_repo_full_name TEXT',
      'ALTER TABLE projects ADD COLUMN starter_issue_number INTEGER',
      'ALTER TABLE projects ADD COLUMN starter_issue_created_at TEXT',
      'ALTER TABLE projects ADD COLUMN revision_count_override INTEGER',
      'ALTER TABLE github_issue_cache ADD COLUMN revision_count_override INTEGER',
    ]);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_projects_github_repo_id ON projects(github_repo_id);
      CREATE INDEX IF NOT EXISTS idx_projects_github_repo_full_name ON projects(github_repo_full_name);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (29)`);
  });
}

export function migrateV30(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 30) return;

  transaction(db, () => {
    db.exec(`
      INSERT INTO settings (key, value)
      SELECT 'revisionCount', value
        FROM settings
       WHERE key = 'maxReviewRounds'
         AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'revisionCount');

      DELETE FROM settings
       WHERE key IN ('maxReviewRounds', 'plannerMaxTurns');
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (30)`);
  });
}

export function migrateV31(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 31) return;

  transaction(db, () => {
    execAlterTablesIfMissing(db, [
      'ALTER TABLE projects ADD COLUMN require_approval_override INTEGER',
      'ALTER TABLE github_issue_cache ADD COLUMN require_approval_override INTEGER',
    ]);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (31)`);
  });
}

export function migrateV32(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 32) return;

  transaction(db, () => {
    execAlterTablesIfMissing(db, [
      'ALTER TABLE projects ADD COLUMN prd_quality_gate INTEGER DEFAULT 0',
    ]);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (32)`);
  });
}

export function migrateV33(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 33) return;

  transaction(db, () => {
    execAlterTablesIfMissing(db, ['ALTER TABLE threads ADD COLUMN answered_clarification TEXT']);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (33)`);
  });
}

export function migrateV34(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 34) return;

  transaction(db, () => {
    db.exec(`
      UPDATE settings
         SET value = '3'
       WHERE key = 'maxConcurrentExecutions'
         AND trim(value) = '1'
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (34)`);
  });
}

export function migrateV35(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 35) return;

  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_telemetry (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        phase TEXT NOT NULL,
        invocation_id TEXT NOT NULL,
        attempt INTEGER,
        provider TEXT,
        model TEXT,
        prompt_characters INTEGER NOT NULL,
        prompt_bytes INTEGER NOT NULL,
        prompt_lines INTEGER NOT NULL,
        selected_materials TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        cost_usd REAL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_prompt_telemetry_thread
        ON prompt_telemetry(thread_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_prompt_telemetry_invocation
        ON prompt_telemetry(thread_id, invocation_id);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (35)`);
  });
}

export function migrateV36(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 36) return;

  transaction(db, () => {
    // Persist GitHub Projects v2 "Priority" single-select field per issue.
    // priority_rank is the normalized bucket ('p0'..'p3'); priority_raw is
    // the original option name (e.g. "Critical", "Icebox") so we never
    // lose source semantics. priority_fetched_at distinguishes
    // "we know it has no priority" from "we never asked".
    execAlterTableIfMissing(db, 'ALTER TABLE github_issue_cache ADD COLUMN priority_rank TEXT');
    execAlterTableIfMissing(db, 'ALTER TABLE github_issue_cache ADD COLUMN priority_raw TEXT');
    execAlterTableIfMissing(
      db,
      'ALTER TABLE github_issue_cache ADD COLUMN priority_fetched_at TEXT',
    );

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (36)`);
  });
}

export function migrateV37(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 37) return;

  transaction(db, () => {
    // Cover foreign-key columns whose parent rows can be deleted via ON
    // DELETE CASCADE. SQLite does not auto-index FK columns, so an unindexed
    // FK forces a full child-table scan on every parent delete. Harmless at
    // current sizes; turns into a real penalty on long-running installs.
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_verifications_plan ON verifications(plan_id);
      CREATE INDEX IF NOT EXISTS idx_github_issues_thread ON github_issue_cache(thread_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_project ON notifications(project_id);
      CREATE INDEX IF NOT EXISTS idx_pipeline_checkpoints_project ON pipeline_checkpoints(project_id);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (37)`);
  });
}

export function migrateV38(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 38) return;

  transaction(db, () => {
    // Lifecycle envelope around each provider invocation. One row per phase
    // attempt. Captures status, timing, error class, and resolved model so
    // any downstream debugger / dashboard can correlate `pipeline:phase`,
    // `terminal:event`, `pipeline:model-resolved`, and `prompt_telemetry`
    // rows for a single run via this row's id.
    db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_step_log (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        phase TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        provider TEXT,
        requested_model TEXT,
        resolved_model TEXT,
        status TEXT NOT NULL,
        error_kind TEXT,
        error_message TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        cost_usd REAL,
        started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        completed_at TEXT,
        duration_ms INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_pipeline_step_log_thread
        ON pipeline_step_log(thread_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pipeline_step_log_thread_phase
        ON pipeline_step_log(thread_id, phase, attempt);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (38)`);
  });
}

export function migrateV39(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 39) return;

  transaction(db, () => {
    // Automations: scheduled AI tasks per project (cron-driven). Each tick
    // synthesizes an approved plan and runs the executor + verifier phases
    // unattended. last_started_at / last_completed_at / last_status track
    // run lifecycle without losing thread history (threads.automation_id
    // SET NULL on delete preserves prior runs in sessions list).
    db.exec(`
      CREATE TABLE IF NOT EXISTS automations (
        id                          TEXT PRIMARY KEY,
        project_id                  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name                        TEXT NOT NULL,
        prompt                      TEXT NOT NULL,
        cron_expr                   TEXT NOT NULL,
        enabled                     INTEGER NOT NULL DEFAULT 1,
        executor_provider           TEXT,
        executor_model_id           TEXT,
        executor_reasoning_effort   TEXT,
        last_started_at             TEXT,
        last_completed_at           TEXT,
        last_status                 TEXT,
        next_run_at                 TEXT,
        run_count                   INTEGER NOT NULL DEFAULT 0,
        created_at                  TEXT NOT NULL,
        updated_at                  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_automations_project_id
        ON automations(project_id);
      CREATE INDEX IF NOT EXISTS idx_automations_next_run
        ON automations(next_run_at) WHERE enabled = 1;

      ALTER TABLE threads ADD COLUMN automation_id TEXT
        REFERENCES automations(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_threads_automation_id
        ON threads(automation_id);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (39)`);
  });
}

export function migrateV40(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 40) return;

  transaction(db, () => {
    // Quick Mode: synthetic github_issue_cache rows for tasks created without
    // a real GitHub issue. Marker column lets handlers/UI skip GH-specific
    // actions for these rows. Sentinel issue_number is allocated negative
    // per project (see GitHubIssueQueries.insertQuickTask).
    execAlterTableIfMissing(
      db,
      'ALTER TABLE github_issue_cache ADD COLUMN is_quick_mode INTEGER NOT NULL DEFAULT 0',
    );

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (40)`);
  });
}

export function migrateV41(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 41) return;

  transaction(db, () => {
    // Store GitHub's issue updatedAt separately from fetched_at so renderer
    // staleness flags are not reset by local polling.
    execAlterTableIfMissing(db, 'ALTER TABLE github_issue_cache ADD COLUMN github_updated_at TEXT');
    db.exec(`
      UPDATE github_issue_cache
         SET github_updated_at = COALESCE(github_updated_at, fetched_at)
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (41)`);
  });
}

export function migrateV42(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 42) return;

  transaction(db, () => {
    // Internal task graphs decompose a planned issue into independently
    // executable nodes. This is separate from issue_edges: issue_edges models
    // GitHub issue dependencies, while task_graphs models one pipeline run's
    // execution contract.
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_graphs (
        id            TEXT PRIMARY KEY,
        thread_id     TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        plan_id       TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        mode          TEXT NOT NULL CHECK (mode IN ('direct', 'internal', 'github-subissues')),
        status        TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'completed', 'failed')) DEFAULT 'active',
        risk_score    REAL NOT NULL DEFAULT 0,
        assessment    TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS task_nodes (
        id                          TEXT PRIMARY KEY,
        graph_id                    TEXT NOT NULL REFERENCES task_graphs(id) ON DELETE CASCADE,
        stable_key                  TEXT NOT NULL,
        order_index                 INTEGER NOT NULL,
        title                       TEXT NOT NULL,
        description                 TEXT NOT NULL,
        status                      TEXT NOT NULL CHECK (status IN ('ready', 'pending', 'running', 'completed', 'failed', 'blocked')),
        files                       TEXT NOT NULL,
        acceptance_criteria         TEXT NOT NULL,
        surfaces                    TEXT NOT NULL,
        agent_role                  TEXT NOT NULL CHECK (agent_role IN ('frontend', 'backend', 'database', 'security', 'infra', 'docs', 'tests', 'general')),
        suggested_executor_model    TEXT CHECK (suggested_executor_model IN ('claude', 'codex', 'openrouter')),
        suggested_reasoning_effort  TEXT NOT NULL CHECK (suggested_reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')),
        github_issue_number         INTEGER,
        started_at                  TEXT,
        completed_at                TEXT,
        created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (graph_id, stable_key)
      );

      CREATE TABLE IF NOT EXISTS task_edges (
        id              TEXT PRIMARY KEY,
        graph_id        TEXT NOT NULL REFERENCES task_graphs(id) ON DELETE CASCADE,
        source_node_id  TEXT NOT NULL REFERENCES task_nodes(id) ON DELETE CASCADE,
        target_node_id  TEXT NOT NULL REFERENCES task_nodes(id) ON DELETE CASCADE,
        edge_type       TEXT NOT NULL CHECK (edge_type IN ('depends_on', 'blocks', 'relates_to')),
        created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CHECK (source_node_id <> target_node_id)
      );

      CREATE INDEX IF NOT EXISTS idx_task_graphs_thread
        ON task_graphs(thread_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_graphs_plan
        ON task_graphs(plan_id);
      CREATE INDEX IF NOT EXISTS idx_task_nodes_graph
        ON task_nodes(graph_id, order_index);
      CREATE INDEX IF NOT EXISTS idx_task_nodes_status
        ON task_nodes(graph_id, status);
      CREATE INDEX IF NOT EXISTS idx_task_edges_graph
        ON task_edges(graph_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_edges_unique
        ON task_edges(graph_id, source_node_id, target_node_id, edge_type);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (42)`);
  });
}

export function migrateV43(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 43) return;

  transaction(db, () => {
    // Composite index on threads(kind, status) for dashboard stats.
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_threads_kind_status
        ON threads(kind, status);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (43)`);
  });
}

export function migrateV44(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 44) return;

  transaction(db, () => {
    // Composite indexes for common lookup patterns.
    // threads(project_id, github_issue_number) — used by getByProjectAndGithubIssue,
    // activity:list-for-issue, costs:list-tasks-for-issue.
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_threads_project_issue
        ON threads(project_id, github_issue_number);
    `);

    // plans(thread_id, version DESC) — eliminates sort for correlated subqueries
    // in getStats pending-approvals check and listAwaitingWithApprovedPlans.
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_plans_thread_version
        ON plans(thread_id, version DESC);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (44)`);
  });
}

export function migrateV45(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 45) return;

  transaction(db, () => {
    // Agent conversation log — append-only audit trail of every prompt
    // and response exchanged between pipeline phases and their providers.
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_conversations (
        id          TEXT PRIMARY KEY,
        thread_id   TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        phase       TEXT NOT NULL,
        round       INTEGER NOT NULL DEFAULT 0,
        speaker     TEXT NOT NULL,
        role        TEXT NOT NULL CHECK(role IN ('prompt', 'response')),
        parent_id   TEXT REFERENCES agent_conversations(id) ON DELETE SET NULL,
        provider    TEXT,
        model       TEXT,
        content     TEXT NOT NULL DEFAULT '',
        tokens_in   INTEGER,
        tokens_out  INTEGER,
        cost_usd    REAL,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_agent_conv_thread_time
        ON agent_conversations(thread_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_conv_thread_phase_round
        ON agent_conversations(thread_id, phase, round);
    `);

    // Link pipeline_step_log rows to their conversation prompt/response pair.
    db.exec(`
      ALTER TABLE pipeline_step_log ADD COLUMN conversation_id TEXT
        REFERENCES agent_conversations(id) ON DELETE SET NULL;
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (45)`);
  });
}

export function migrateV46(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 46) return;

  transaction(db, () => {
    // Feature QA results — persists the outcome of focused QA runs.
    // One row per feature per run. flowResults stored as JSON array.
    db.exec(`
      CREATE TABLE IF NOT EXISTS feature_qa_results (
        id            TEXT PRIMARY KEY,
        thread_id     TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        feature_id    TEXT NOT NULL,
        status        TEXT NOT NULL CHECK(status IN ('passed', 'failed', 'partial')),
        flow_results  TEXT NOT NULL DEFAULT '[]',
        summary       TEXT NOT NULL DEFAULT '',
        evidence_paths TEXT,
        run_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_feature_qa_thread
        ON feature_qa_results(thread_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_feature_qa_feature
        ON feature_qa_results(feature_id, run_at);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (46)`);
  });
}

export function migrateV47(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 47) return;

  transaction(db, () => {
    // Per-project GitHub Projects v2 Status field option name mapping.
    // JSON column storing a GhStatusMapping: { todo, inProgress, humanReview, done }
    // NULL means not yet configured (no project URL, or validation never run).
    execAlterTableIfMissing(db, 'ALTER TABLE projects ADD COLUMN github_status_mapping TEXT');

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (47)`);
  });
}

export function migrateV48(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 48) return;

  transaction(db, () => {
    // Automation threads have no github_issue_cache row, so closing has
    // nowhere to persist. Adding done_at to threads lets the renderer map
    // completed automation threads → ISSUE_PIPELINE_STATUS.closed when the
    // column is set.
    execAlterTableIfMissing(db, 'ALTER TABLE threads ADD COLUMN done_at TEXT');

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (48)`);
  });
}

export function migrateV49(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 49) return;

  transaction(db, () => {
    execAlterTableIfMissing(
      db,
      'ALTER TABLE projects ADD COLUMN pipeline_speed_profile_override TEXT',
    );

    db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_phase_log (
        id              TEXT PRIMARY KEY,
        thread_id       TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        phase           TEXT NOT NULL,
        started_at      TEXT NOT NULL,
        completed_at    TEXT,
        duration_ms     INTEGER,
        terminal_status TEXT,
        error_message   TEXT,
        metadata_json   TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_pipeline_phase_log_thread
        ON pipeline_phase_log(thread_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_pipeline_phase_log_phase
        ON pipeline_phase_log(phase, completed_at);

      CREATE TABLE IF NOT EXISTS skill_resolution_log (
        id             TEXT PRIMARY KEY,
        thread_id      TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        provider_phase TEXT NOT NULL,
        skill_key      TEXT NOT NULL,
        source         TEXT NOT NULL DEFAULT 'unknown',
        base_version   TEXT,
        fallback_used  INTEGER NOT NULL DEFAULT 0,
        error_code     TEXT,
        error_message  TEXT,
        created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_skill_resolution_thread
        ON skill_resolution_log(thread_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_skill_resolution_skill
        ON skill_resolution_log(skill_key, source, fallback_used);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (49)`);
  });
}

export function migrateV50(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 50) return;

  transaction(db, () => {
    execAlterTableIfMissing(db, 'ALTER TABLE threads ADD COLUMN archived_at TEXT');

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (50)`);
  });
}

export function migrateV51(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 51) return;

  transaction(db, () => {
    // Project-level shared test failure ledger. Worktrees stay isolated, but
    // repeated failures should be claimed once per project/base/fingerprint
    // so parallel tasks do not independently patch the same root cause.
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_failures (
        id                    TEXT PRIMARY KEY,
        project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        base_branch           TEXT,
        fingerprint           TEXT NOT NULL,
        status                TEXT NOT NULL CHECK(status IN ('in_progress', 'resolved')),
        owner_thread_id       TEXT REFERENCES threads(id) ON DELETE SET NULL,
        first_seen_thread_id  TEXT REFERENCES threads(id) ON DELETE SET NULL,
        seen_thread_ids       TEXT NOT NULL DEFAULT '[]',
        command               TEXT NOT NULL,
        summary               TEXT NOT NULL,
        output_excerpt        TEXT NOT NULL,
        implicated_files      TEXT NOT NULL DEFAULT '[]',
        resolved_by_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
        resolved_commit_sha   TEXT,
        resolved_at           TEXT,
        created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_project_failures_unique
        ON project_failures(project_id, COALESCE(base_branch, ''), fingerprint);
      CREATE INDEX IF NOT EXISTS idx_project_failures_project_status
        ON project_failures(project_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_project_failures_owner
        ON project_failures(owner_thread_id, status);
      CREATE INDEX IF NOT EXISTS idx_project_failures_first_seen
        ON project_failures(first_seen_thread_id, created_at);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (51)`);
  });
}

export function migrateV52(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 52) return;

  transaction(db, () => {
    execAlterTableIfMissing(db, 'ALTER TABLE threads ADD COLUMN paused_phase TEXT');
    execAlterTableIfMissing(db, 'ALTER TABLE threads ADD COLUMN paused_at TEXT');

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (52)`);
  });
}

export function migrateV53(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 53) return;

  transaction(db, () => {
    db.exec(`
      UPDATE threads
         SET status = 'approval'
       WHERE status = 'awaiting_approval';

      UPDATE threads
         SET paused_phase = 'approval'
       WHERE paused_phase = 'awaiting_approval';

      UPDATE plans
         SET status = 'approval'
       WHERE status = 'awaiting_approval';

      UPDATE github_issue_cache
         SET pipeline_status = 'approval'
       WHERE pipeline_status = 'awaiting_approval';

      UPDATE github_issue_cache
         SET pipeline_status = 'closed'
       WHERE pipeline_status = 'done';

      UPDATE pipeline_phase_log
         SET phase = 'approval'
       WHERE phase = 'awaiting_approval';

      UPDATE pipeline_phase_log
         SET terminal_status = 'approval'
       WHERE terminal_status = 'awaiting_approval';

      UPDATE notifications
         SET kind = 'approval'
       WHERE kind = 'awaiting_approval';

      UPDATE settings
         SET value = replace(value, '"awaitingApproval"', '"approval"')
       WHERE key IN ('notificationEvents', 'chatNotificationEvents');
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (53)`);
  });
}

export function migrateV54(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 54) return;

  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS triage_rules (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        order_index INTEGER NOT NULL,
        name        TEXT NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1,
        conditions  TEXT NOT NULL,
        actions     TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_triage_rules_project_order
        ON triage_rules(project_id, order_index ASC);
      CREATE INDEX IF NOT EXISTS idx_triage_rules_project_enabled_order
        ON triage_rules(project_id, enabled, order_index ASC);
    `);

    execAlterTablesIfMissing(db, [
      'ALTER TABLE github_issue_cache ADD COLUMN rules_applied_at TEXT',
      'ALTER TABLE github_issue_cache ADD COLUMN triage_failure_reason TEXT',
    ]);

    db.exec(`
      UPDATE github_issue_cache
         SET rules_applied_at = COALESCE(rules_applied_at, ${ISO_NOW_SQL})
       WHERE rules_applied_at IS NULL;
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (54)`);
  });
}
