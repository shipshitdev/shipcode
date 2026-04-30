import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { ISSUE_PIPELINE_STATUS } from '@shipcode/shared';

export type { PromptTelemetryInsert, PromptTelemetryRecord } from '@shipcode/shared';

// Lazy-load node:sqlite so the CLI's Node version guard can fire before this
// throws ERR_UNKNOWN_BUILTIN_MODULE on Node < 22.5. ESM static imports hoist
// before any user code, so we use createRequire deferred to first call.
// When bundled as CJS (Electron main), import.meta.url is rewritten to
// `{}.url` (undefined); fall back to __filename in that case.
const _require = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
let _DatabaseSyncCtor: typeof DatabaseSync | null = null;
function loadDatabaseSync(): typeof DatabaseSync {
  if (_DatabaseSyncCtor) return _DatabaseSyncCtor;
  const mod = _require('node:sqlite') as { DatabaseSync: typeof DatabaseSync };
  _DatabaseSyncCtor = mod.DatabaseSync;
  return _DatabaseSyncCtor;
}

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
  migrateV35,
  migrateV36,
  migrateV37,
  migrateV38,
  migrateV39,
  migrateV40,
  migrateV41,
  migrateV42,
} from './schema';

export { ActivityQueries } from './queries/activity';
export { AutomationQueries } from './queries/automations';
export { CheckpointQueries } from './queries/checkpoints';
export { CostsQueries } from './queries/costs';
export { DashboardQueries } from './queries/dashboard';
export type { DiffInsert } from './queries/diffs';
export { DiffQueries } from './queries/diffs';
export { GitHubIssueQueries } from './queries/github-issues';
export { HeatmapQueries } from './queries/heatmap';
// Issue graph persistence backs the project-level dependency view.
export { IssueEdgeQueries } from './queries/issue-edges';
export { NotificationsQueries } from './queries/notifications';
export { PipelineStepQueries } from './queries/pipeline-steps';
export { PlanQueries } from './queries/plans';
export { ProjectQueries } from './queries/projects';
export { PromptTelemetryQueries } from './queries/prompt-telemetry';
export { ReviewQueries } from './queries/reviews';
export { SettingsQueries } from './queries/settings';
export type { SkillRow } from './queries/skills';
export { SkillsQueries } from './queries/skills';
export { TaskGraphQueries } from './queries/task-graphs';
export { TerminalEventQueries } from './queries/terminal-events';
export { ThreadQueries } from './queries/threads';
export { VerificationQueries } from './queries/verifications';
export { transaction } from './utils';

let db: DatabaseSync | null = null;

export function getDatabase(dataDir: string): DatabaseSync {
  if (db) return db;

  const dbPath = path.join(dataDir, 'shipcode.db');
  const Ctor = loadDatabaseSync();
  db = new Ctor(dbPath, { enableForeignKeyConstraints: true });

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
  migrateV35(db);
  migrateV36(db);
  migrateV37(db);
  migrateV38(db);
  migrateV39(db);
  migrateV40(db);
  migrateV41(db);
  migrateV42(db);

  // Startup cleanup: reset unclaimed queued issues to todo on every launch.
  // An unclaimed queued issue has no active worker holding it — it's stale state
  // from a crash, restart, or interrupted pipeline. V22 migration only cleared
  // issues without thread_id; this catches the remainder on every startup.
  db.prepare(`
    UPDATE github_issue_cache
       SET pipeline_status = ?, last_phase_update = NULL
     WHERE pipeline_status = ?
       AND claimed_at IS NULL
  `).run(ISSUE_PIPELINE_STATUS.todo, ISSUE_PIPELINE_STATUS.queued);

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
