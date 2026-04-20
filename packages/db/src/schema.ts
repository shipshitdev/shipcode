import type { DatabaseSync } from 'node:sqlite';
import { ISO_NOW_SQL } from '@shipcode/shared';
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
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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

    CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id);
    CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status);
    CREATE INDEX IF NOT EXISTS idx_plans_thread ON plans(thread_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_plan ON reviews(plan_id);
    CREATE INDEX IF NOT EXISTS idx_diffs_thread ON diffs(thread_id);
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
         SET status = 'awaiting_approval'
       WHERE status = 'rejected'
         AND thread_id IN (
           SELECT id
             FROM threads
            WHERE status = 'awaiting_approval'
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
         SET pipeline_status = 'done',
             last_phase_update = COALESCE(last_phase_update, ${ISO_NOW_SQL})
       WHERE state = 'closed'
         AND pipeline_status = 'completed'
    `);

    db.exec(`
      UPDATE github_issue_cache
         SET pipeline_status = 'completed',
             last_phase_update = COALESCE(last_phase_update, ${ISO_NOW_SQL})
       WHERE state = 'open'
         AND pipeline_status IN ('todo', 'queued', 'awaiting_approval', 'failed')
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
