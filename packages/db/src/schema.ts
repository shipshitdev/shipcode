import type Database from 'better-sqlite3'

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      git_remote TEXT,
      default_branch TEXT NOT NULL DEFAULT 'main',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      raw_output TEXT NOT NULL,
      structured TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      decision TEXT NOT NULL,
      confidence TEXT NOT NULL,
      raw_output TEXT NOT NULL,
      structured TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS diffs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      action TEXT NOT NULL,
      diff_content TEXT,
      before_hash TEXT,
      after_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  `)
}

export function migrateV2(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL PRIMARY KEY
    );
  `)

  const row = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number } | undefined
  if (row && row.version >= 2) return

  db.transaction(() => {
    const alterColumns = [
      'ALTER TABLE threads ADD COLUMN github_issue_number INTEGER',
      'ALTER TABLE threads ADD COLUMN github_pr_number INTEGER',
      'ALTER TABLE threads ADD COLUMN github_repo TEXT',
      'ALTER TABLE threads ADD COLUMN executor_model TEXT DEFAULT \'claude\'',
      'ALTER TABLE threads ADD COLUMN review_round INTEGER DEFAULT 0',
      'ALTER TABLE threads ADD COLUMN verification_status TEXT',
      'ALTER TABLE threads ADD COLUMN verification_retries INTEGER DEFAULT 0',
      'ALTER TABLE threads ADD COLUMN autonomous INTEGER DEFAULT 0',
      'ALTER TABLE threads ADD COLUMN base_branch TEXT',
      'ALTER TABLE threads ADD COLUMN fork_point_sha TEXT',
    ]

    for (const sql of alterColumns) {
      try { db.exec(sql) } catch {}
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
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
        fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, issue_number)
      );

      CREATE INDEX IF NOT EXISTS idx_github_issues_project ON github_issue_cache(project_id);
      CREATE INDEX IF NOT EXISTS idx_github_issues_status ON github_issue_cache(pipeline_status);
    `)

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (2)`)
  })()
}

export function migrateV3(db: Database.Database): void {
  const row = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number } | undefined
  if (row && row.version >= 3) return

  db.transaction(() => {
    // Add last_status_label column to github_issue_cache
    try { db.exec('ALTER TABLE github_issue_cache ADD COLUMN last_status_label TEXT') } catch {}

    // Reclassify unclaimed queued issues as todo
    db.exec(`
      UPDATE github_issue_cache
      SET pipeline_status = 'todo'
      WHERE pipeline_status = 'queued' AND claimed_at IS NULL AND thread_id IS NULL
    `)

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (3)`)
  })()
}
