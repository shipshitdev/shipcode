import type { DatabaseSync } from 'node:sqlite';
import { ISO_NOW_SQL } from '@shipcode/shared';
import { transaction } from '../utils';
import { execAlterTableIfMissing, execAlterTablesIfMissing } from './schema-helpers';

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

export function migrateV55(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 55) return;

  transaction(db, () => {
    execAlterTableIfMissing(db, 'ALTER TABLE github_issue_cache ADD COLUMN issue_type TEXT');

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (55)`);
  });
}

export function migrateV56(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 56) return;

  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id              TEXT PRIMARY KEY,
        thread_id       TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
        source          TEXT NOT NULL,
        trigger_detail  TEXT,
        status          TEXT NOT NULL DEFAULT 'queued',
        current_phase   TEXT,
        started_at      TEXT,
        finished_at     TEXT,
        error_message   TEXT,
        error_kind      TEXT,
        context_json    TEXT,
        retry_of_run_id TEXT REFERENCES pipeline_runs(id) ON DELETE SET NULL,
        created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_pipeline_runs_thread_created
        ON pipeline_runs(thread_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pipeline_runs_project_status
        ON pipeline_runs(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_pipeline_runs_retry
        ON pipeline_runs(retry_of_run_id);
    `);

    execAlterTablesIfMissing(db, [
      'ALTER TABLE threads ADD COLUMN current_run_id TEXT',
      'ALTER TABLE github_issue_cache ADD COLUMN execution_run_id TEXT',
      'ALTER TABLE github_issue_cache ADD COLUMN execution_locked_at TEXT',
      'ALTER TABLE github_issue_cache ADD COLUMN execution_lock_owner TEXT',
    ]);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_threads_current_run
        ON threads(current_run_id);
      CREATE INDEX IF NOT EXISTS idx_github_issues_execution_run
        ON github_issue_cache(execution_run_id);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (56)`);
  });
}

export function migrateV57(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 57) return;

  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_wake_requests (
        id                TEXT PRIMARY KEY,
        kind              TEXT NOT NULL,
        source            TEXT NOT NULL,
        reason            TEXT NOT NULL,
        target_type       TEXT NOT NULL,
        target_id         TEXT NOT NULL,
        project_id        TEXT REFERENCES projects(id) ON DELETE CASCADE,
        thread_id         TEXT REFERENCES threads(id) ON DELETE CASCADE,
        run_id            TEXT REFERENCES pipeline_runs(id) ON DELETE SET NULL,
        idempotency_key   TEXT,
        status            TEXT NOT NULL DEFAULT 'pending',
        scheduled_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        claimed_at        TEXT,
        claimed_by        TEXT,
        completed_at      TEXT,
        failed_at         TEXT,
        last_error        TEXT,
        coalesced_count   INTEGER NOT NULL DEFAULT 0,
        payload_json      TEXT,
        created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_pipeline_wake_requests_pending
        ON pipeline_wake_requests(status, kind, scheduled_at, created_at);
      CREATE INDEX IF NOT EXISTS idx_pipeline_wake_requests_idempotency
        ON pipeline_wake_requests(idempotency_key, status);
      CREATE INDEX IF NOT EXISTS idx_pipeline_wake_requests_thread
        ON pipeline_wake_requests(thread_id);
      CREATE INDEX IF NOT EXISTS idx_pipeline_wake_requests_run
        ON pipeline_wake_requests(run_id);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (57)`);
  });
}

export function migrateV58(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 58) return;

  transaction(db, () => {
    execAlterTableIfMissing(db, 'ALTER TABLE github_issue_cache ADD COLUMN issue_type TEXT');

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (58)`);
  });
}

export function migrateV59(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 59) return;

  transaction(db, () => {
    execAlterTablesIfMissing(db, [
      'ALTER TABLE github_issue_cache ADD COLUMN pipeline_started_at TEXT',
      'ALTER TABLE terminal_events ADD COLUMN run_id TEXT REFERENCES pipeline_runs(id) ON DELETE SET NULL',
      'ALTER TABLE prompt_telemetry ADD COLUMN run_id TEXT REFERENCES pipeline_runs(id) ON DELETE SET NULL',
      'ALTER TABLE agent_conversations ADD COLUMN run_id TEXT REFERENCES pipeline_runs(id) ON DELETE SET NULL',
      'ALTER TABLE pipeline_phase_log ADD COLUMN run_id TEXT REFERENCES pipeline_runs(id) ON DELETE SET NULL',
      'ALTER TABLE pipeline_step_log ADD COLUMN run_id TEXT REFERENCES pipeline_runs(id) ON DELETE SET NULL',
    ]);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (59)`);
  });
}

export function migrateV60(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 60) return;

  transaction(db, () => {
    // Issue author login, used by the triage `author_is` condition kind.
    execAlterTableIfMissing(db, 'ALTER TABLE github_issue_cache ADD COLUMN author TEXT');

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (60)`);
  });
}

export function migrateV61(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 61) return;

  transaction(db, () => {
    // Durable CI/review lane findings. Reviewer, verifier, CI, and PR review
    // signals are normalized here so the UI and retry prompts can reason over
    // unresolved findings without scraping raw provider output.
    db.exec(`
      CREATE TABLE IF NOT EXISTS review_findings (
        id                 TEXT PRIMARY KEY,
        project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        thread_id          TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        plan_id            TEXT REFERENCES plans(id) ON DELETE SET NULL,
        review_id          TEXT REFERENCES reviews(id) ON DELETE SET NULL,
        verification_id    TEXT REFERENCES verifications(id) ON DELETE SET NULL,
        run_id             TEXT REFERENCES pipeline_runs(id) ON DELETE SET NULL,
        phase              TEXT NOT NULL,
        source             TEXT NOT NULL CHECK(source IN ('review', 'verification', 'ci', 'pr_review')),
        severity           TEXT NOT NULL,
        status             TEXT NOT NULL CHECK(status IN ('open', 'fixed', 'ignored', 'superseded', 'closed')) DEFAULT 'open',
        title              TEXT NOT NULL,
        description        TEXT NOT NULL,
        suggestion         TEXT,
        file_path          TEXT,
        fingerprint        TEXT NOT NULL,
        source_model       TEXT,
        commit_sha         TEXT,
        pr_number          INTEGER,
        worktree_path      TEXT,
        branch             TEXT,
        metadata_json      TEXT,
        resolved_by_run_id TEXT REFERENCES pipeline_runs(id) ON DELETE SET NULL,
        resolved_at        TEXT,
        created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_review_findings_thread_status
        ON review_findings(thread_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_review_findings_project_status
        ON review_findings(project_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_review_findings_plan
        ON review_findings(plan_id, source, status);
      CREATE INDEX IF NOT EXISTS idx_review_findings_review
        ON review_findings(review_id);
      CREATE INDEX IF NOT EXISTS idx_review_findings_verification
        ON review_findings(verification_id);
      CREATE INDEX IF NOT EXISTS idx_review_findings_fingerprint
        ON review_findings(thread_id, source, phase, fingerprint, status);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (61)`);
  });
}

export function migrateV62(db: DatabaseSync): void {
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;
  if (row && row.version >= 62) return;

  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS issue_chat_sessions (
        thread_id        TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
        provider         TEXT NOT NULL CHECK(provider IN ('claude', 'codex')),
        session_id       TEXT,
        cwd              TEXT NOT NULL,
        model            TEXT,
        reasoning_effort TEXT,
        created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_issue_chat_sessions_updated
        ON issue_chat_sessions(updated_at DESC);
    `);

    db.exec(`INSERT OR REPLACE INTO schema_version (version) VALUES (62)`);
  });
}
