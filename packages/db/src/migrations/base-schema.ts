import type { DatabaseSync } from 'node:sqlite';
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
