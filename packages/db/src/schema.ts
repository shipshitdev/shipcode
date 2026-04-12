import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './utils';

export function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      git_remote TEXT,
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

    for (const sql of alterColumns) {
      try {
        db.exec(sql);
      } catch {}
    }

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
        pipeline_status TEXT NOT NULL DEFAULT 'queued',
        thread_id TEXT REFERENCES threads(id),
        claimed_at TEXT,
        claimed_by TEXT,
        last_phase_update TEXT,
        fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        archived_at TEXT,
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
    // Add last_status_label column to github_issue_cache
    try {
      db.exec('ALTER TABLE github_issue_cache ADD COLUMN last_status_label TEXT');
    } catch {}

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
    try {
      db.exec(
        "ALTER TABLE github_issue_cache ADD COLUMN executor_model TEXT NOT NULL DEFAULT 'claude'",
      );
    } catch {}

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
    for (const sql of alterColumns) {
      try {
        db.exec(sql);
      } catch {}
    }

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (6)`);
  });
}

export function migrateV7(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 7) return;

  const addColumnIfMissing = (ddl: string): void => {
    try {
      db.exec(ddl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Only ignore the specific "already applied" case. Any other failure
      // (locked DB, malformed schema, partial write) must abort so we retry
      // on next startup instead of masking the problem and leaving the
      // projects table missing expected columns.
      if (!/duplicate column name/i.test(message)) throw err;
    }
  };

  transaction(db, () => {
    // Project-level pin + archive state for sidebar management.
    addColumnIfMissing(`ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
    addColumnIfMissing(`ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);

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
    try {
      db.exec('ALTER TABLE threads ADD COLUMN last_error TEXT');
    } catch {}

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
    try {
      db.exec('ALTER TABLE projects ADD COLUMN github_project_url TEXT');
    } catch {}

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
    try {
      db.exec('ALTER TABLE github_issue_cache ADD COLUMN archived_at TEXT');
    } catch {}

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (11)`);
  });
}
