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
