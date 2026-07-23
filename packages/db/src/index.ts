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
/* v8 ignore next -- Electron CJS bundle fallback is not reachable in Vitest's ESM runtime. */
const _require = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
let _DatabaseSyncCtor: typeof DatabaseSync | null = null;
function loadDatabaseSync(): typeof DatabaseSync {
  if (_DatabaseSyncCtor) return _DatabaseSyncCtor;
  const mod = _require('node:sqlite') as { DatabaseSync: typeof DatabaseSync };
  _DatabaseSyncCtor = mod.DatabaseSync;
  return _DatabaseSyncCtor;
}

import { runMigrations } from './schema';

export { ActivityQueries } from './queries/activity';
export type {
  AgentConversationRecord,
  InsertAgentConversation,
} from './queries/agent-conversations';
export { AgentConversationQueries } from './queries/agent-conversations';
export { AutomationQueries } from './queries/automations';
export { CheckpointQueries } from './queries/checkpoints';
export { CostsQueries } from './queries/costs';
export { DashboardQueries } from './queries/dashboard';
export type { DiffInsert } from './queries/diffs';
export { DiffQueries } from './queries/diffs';
export type { FeatureQaResultRecord, InsertFeatureQaResult } from './queries/feature-qa-results';
export { FeatureQaResultQueries } from './queries/feature-qa-results';
export { GitHubIssueQueries } from './queries/github-issues';
export { HeatmapQueries } from './queries/heatmap';
export type {
  IssueChatSessionRecord,
  UpsertIssueChatSession,
} from './queries/issue-chat-sessions';
export { IssueChatSessionQueries } from './queries/issue-chat-sessions';
// Issue graph persistence backs the project-level dependency view.
export { IssueEdgeQueries } from './queries/issue-edges';
export { NotificationsQueries } from './queries/notifications';
export { PipelineAnalyticsQueries } from './queries/pipeline-analytics';
export { PhaseLogQueries } from './queries/pipeline-phase-log';
export { PipelineRunQueries } from './queries/pipeline-runs';
export { PipelineStepQueries } from './queries/pipeline-steps';
export { PipelineWakeRequestQueries } from './queries/pipeline-wake-requests';
export { PlanQueries } from './queries/plans';
export type {
  PrEvidenceManifestRecord,
  SavePrEvidenceManifestInput,
} from './queries/pr-evidence-manifests';
export { PrEvidenceManifestQueries } from './queries/pr-evidence-manifests';
export { ProjectFailureQueries } from './queries/project-failures';
export { ProjectQueries } from './queries/projects';
export { PromptTelemetryQueries } from './queries/prompt-telemetry';
export { ReviewFindingQueries } from './queries/review-findings';
export { ReviewQueries } from './queries/reviews';
export { SettingsQueries } from './queries/settings';
export { SkillResolutionLogQueries } from './queries/skill-resolution-log';
export type { SkillRow } from './queries/skills';
export { SkillsQueries } from './queries/skills';
export { TaskGraphQueries } from './queries/task-graphs';
export { TerminalEventQueries } from './queries/terminal-events';
export { ThreadQueries } from './queries/threads';
export { TriageRuleQueries } from './queries/triage-rules';
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
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA journal_size_limit = 67108864');
  db.exec('PRAGMA mmap_size = 134217728');
  db.exec('PRAGMA cache_size = -16000');
  db.exec('PRAGMA temp_store = MEMORY');

  runMigrations(db);

  // Startup cleanup: reset unclaimed queued issues to todo on every launch.
  // An unclaimed queued issue has no active worker holding it — it's stale state
  // from a crash, restart, or interrupted pipeline. V22 migration only cleared
  // issues without thread_id; this catches the remainder on every startup.
  db.prepare(`
    UPDATE github_issue_cache
       SET pipeline_status = ?,
           last_phase_update = NULL,
           pipeline_started_at = NULL,
           execution_run_id = NULL,
           execution_locked_at = NULL,
           execution_lock_owner = NULL
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
