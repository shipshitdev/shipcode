import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
export type { PromptTelemetryInsert, PromptTelemetryRecord } from '@shipcode/shared';
import {
  migrate,
  migrateV2,
  migrateV3,
  migrateV4,
  migrateV5,
  migrateV6,
  migrateV7,
  migrateV8,
  migrateV9,
  migrateV10,
  migrateV11,
  migrateV12,
  migrateV13,
  migrateV14,
  migrateV15,
  migrateV16,
  migrateV17,
  migrateV18,
  migrateV19,
  migrateV20,
  migrateV21,
  migrateV22,
  migrateV23,
  migrateV24,
  migrateV25,
  migrateV26,
  migrateV27,
  migrateV28,
  migrateV29,
  migrateV30,
  migrateV31,
  migrateV32,
  migrateV33,
  migrateV34,
} from './schema';

export { ActivityQueries } from './queries/activity';
export { CheckpointQueries } from './queries/checkpoints';
export { CostsQueries } from './queries/costs';
export { DashboardQueries } from './queries/dashboard';
export type { DiffInsert } from './queries/diffs';
export { DiffQueries } from './queries/diffs';
export { GitHubIssueQueries } from './queries/github-issues';
export { NotificationsQueries } from './queries/notifications';
export { PlanQueries } from './queries/plans';
export { PromptTelemetryQueries } from './queries/prompt-telemetry';
export { ProjectQueries } from './queries/projects';
export { ReviewQueries } from './queries/reviews';
export { SettingsQueries } from './queries/settings';
export type { SkillRow } from './queries/skills';
export { SkillsQueries } from './queries/skills';
export { TerminalEventQueries } from './queries/terminal-events';
export { ThreadQueries } from './queries/threads';
export { VerificationQueries } from './queries/verifications';
export { transaction } from './utils';

let db: DatabaseSync | null = null;

export function getDatabase(dataDir: string): DatabaseSync {
  if (db) return db;

  const dbPath = path.join(dataDir, 'shipcode.db');
  db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');

  migrate(db);
  migrateV2(db);
  migrateV3(db);
  migrateV4(db);
  migrateV5(db);
  migrateV6(db);
  migrateV7(db);
  migrateV8(db);
  migrateV9(db);
  migrateV10(db);
  migrateV11(db);
  migrateV12(db);
  migrateV13(db);
  migrateV14(db);
  migrateV15(db);
  migrateV16(db);
  migrateV17(db);
  migrateV18(db);
  migrateV19(db);
  migrateV20(db);
  migrateV21(db);
  migrateV22(db);
  migrateV23(db);
  migrateV24(db);
  migrateV25(db);
  migrateV26(db);
  migrateV27(db);
  migrateV28(db);
  migrateV29(db);
  migrateV30(db);
  migrateV31(db);
  migrateV32(db);
  migrateV33(db);
  migrateV34(db);

  // Startup cleanup: reset unclaimed queued issues to todo on every launch.
  // An unclaimed queued issue has no active worker holding it — it's stale state
  // from a crash, restart, or interrupted pipeline. V22 migration only cleared
  // issues without thread_id; this catches the remainder on every startup.
  db.exec(`
    UPDATE github_issue_cache
       SET pipeline_status = 'todo', last_phase_update = NULL
     WHERE pipeline_status = 'queued'
       AND claimed_at IS NULL
  `);

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
