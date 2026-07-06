import type { DatabaseSync } from 'node:sqlite';
import {
  ISO_NOW_SQL,
  MAX_PIPELINE_RAW_OUTPUT_CHARS,
  PLAN_FENCE_TAG,
  REVIEW_FENCE_TAG,
  VERIFICATION_FENCE_TAG,
} from '@shipcode/shared';
import { transaction } from '../utils';
import { execAlterTableIfMissing, execAlterTablesIfMissing } from './schema-helpers';

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
    const rawStructuredSeparator = '\n\n';
    const appendStructuredArtifact = (
      table: 'plans' | 'reviews' | 'verifications',
      fencePrefix: string,
    ) => {
      db.prepare(
        `UPDATE ${table}
            SET raw_output = CASE
              WHEN COALESCE(raw_output, '') = '' THEN ? || structured || ?
              ELSE raw_output || ? || ? || structured || ?
            END
          WHERE structured IS NOT NULL`,
      ).run(fencePrefix, fenceSuffix, rawStructuredSeparator, fencePrefix, fenceSuffix);
    };

    appendStructuredArtifact('plans', planFencePrefix);
    appendStructuredArtifact('reviews', reviewFencePrefix);
    appendStructuredArtifact('verifications', verificationFencePrefix);

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
