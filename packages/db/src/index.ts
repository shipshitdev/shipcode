import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
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
} from './schema';

export { transaction } from './utils';
export { ProjectQueries } from './queries/projects';
export { ThreadQueries } from './queries/threads';
export { PlanQueries } from './queries/plans';
export { ReviewQueries } from './queries/reviews';
export { DiffQueries } from './queries/diffs';
export { SettingsQueries } from './queries/settings';
export { VerificationQueries } from './queries/verifications';
export { GitHubIssueQueries } from './queries/github-issues';
export { CheckpointQueries } from './queries/checkpoints';
export { ActivityQueries } from './queries/activity';
export { NotificationsQueries } from './queries/notifications';
export { DashboardQueries } from './queries/dashboard';
export { CostsQueries } from './queries/costs';
export { SkillsQueries } from './queries/skills';
export type { SkillRow } from './queries/skills';

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
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
