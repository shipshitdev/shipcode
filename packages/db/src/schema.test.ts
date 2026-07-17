import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  migrate,
  migrateV2,
  migrateV3,
  migrateV4,
  migrateV5,
  migrateV6,
  migrateV7,
  migrateV18,
  migrateV20,
  migrateV21,
  migrateV22,
  migrateV27,
  migrateV29,
  migrateV30,
  migrateV31,
  migrateV33,
  migrateV34,
  migrateV35,
  migrateV36,
  migrateV37,
  migrateV39,
  migrateV40,
  migrateV41,
  migrateV42,
  migrateV43,
  migrateV45,
  migrateV46,
  migrateV47,
  migrateV48,
  migrateV49,
  migrateV50,
  migrateV52,
  migrateV53,
  migrateV54,
  migrateV58,
  migrateV59,
  migrateV60,
  migrateV61,
  migrateV62,
} from './schema';
import { createTestDb } from './test-helpers';
import { asRow } from './utils';

interface ThreadV2Row {
  github_issue_number: number;
  autonomous: number;
}

interface GitHubIssueCacheV3Row {
  pipeline_status: string;
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  return !!row;
}

function getColumns(db: DatabaseSync, table: string): Array<{ name: string; type: string }> {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => {
      const r = row as { name: string; type: string };
      return { name: r.name, type: r.type };
    });
}

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  return getColumns(db, table).some((r) => r.name === column);
}

function indexExists(db: DatabaseSync, name: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);
  return !!row;
}

// Iterate the canonical MIGRATIONS registry (the same list the production runner
// and createTestDb consume) so this helper can never fall behind the real
// migration chain. Runs each migration in order and stops after `target`.
function migrateThrough(db: DatabaseSync, target: (db: DatabaseSync) => void): void {
  for (const migration of MIGRATIONS) {
    migration(db);
    if (migration === target) return;
  }
}

describe('migrate', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates core tables', () => {
    migrate(db);

    for (const table of ['projects', 'threads', 'plans', 'reviews', 'diffs', 'settings']) {
      expect(tableExists(db, table)).toBe(true);
    }
  });

  it('skips every versioned migration when schema_version is already newer', () => {
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER NOT NULL PRIMARY KEY
      );
      INSERT INTO schema_version (version) VALUES (999);
    `);

    for (const runMigration of MIGRATIONS.slice(1)) {
      expect(() => runMigration(db)).not.toThrow();
    }

    expect(
      db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get(),
    ).toEqual({ version: 999 });
  });
});

describe('migrateV7', () => {
  it('throws non-duplicate ALTER errors', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    migrateV2(db);
    migrateV3(db);
    migrateV4(db);
    migrateV5(db);
    migrateV6(db);
    db.prepare('DROP TABLE projects').run();

    expect(() => migrateV7(db)).toThrow(/no such table: projects/);
    db.close();
  });

  it('rethrows non-Error ALTER failures', () => {
    const fakeDb = {
      isTransaction: true,
      exec: (sql: string) => {
        if (sql.includes('ALTER TABLE')) throw 'alter failed';
      },
      prepare: () => ({
        get: () => undefined,
        all: () => [],
        run: () => ({ changes: 1 }),
      }),
    } as unknown as DatabaseSync;

    try {
      migrateV7(fakeDb);
      throw new Error('Expected migrateV7 to throw');
    } catch (err) {
      expect(err).toBe('alter failed');
    }
  });

  it('verifies pinned and archived columns before marking the migration applied', () => {
    const fakeDb = {
      isTransaction: true,
      exec: () => undefined,
      prepare: (sql: string) => ({
        get: () => (sql.includes('schema_version') ? undefined : {}),
        all: () => [{ name: 'id' }],
        run: () => ({ changes: 1 }),
      }),
    } as unknown as DatabaseSync;

    expect(() => migrateV7(fakeDb)).toThrow(
      'migrateV7: projects table is missing pinned/archived columns after ALTER',
    );
  });
});

describe('migrateV42', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrateThrough(db, migrateV41);
  });

  afterEach(() => {
    db.close();
  });

  it('creates internal task graph tables', () => {
    migrateV42(db);

    for (const table of ['task_graphs', 'task_nodes', 'task_edges']) {
      expect(tableExists(db, table)).toBe(true);
    }
  });

  it('is idempotent', () => {
    migrateV42(db);
    expect(() => migrateV42(db)).not.toThrow();
  });
});

describe('migrateV43', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrateThrough(db, migrateV42);
  });

  afterEach(() => {
    db.close();
  });

  it('runs for databases already at v42', () => {
    migrateV43(db);

    const index = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_threads_kind_status'",
      )
      .get();
    const version = db
      .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
      .get() as {
      version: number;
    };

    expect(index).toBeTruthy();
    expect(version.version).toBe(43);
  });
});

describe('migrateV2', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates v2 tables and adds thread columns', () => {
    migrateV2(db);

    for (const table of ['verifications', 'github_issue_cache', 'schema_version']) {
      expect(tableExists(db, table)).toBe(true);
    }

    // Verify new thread columns exist by inserting a project and thread with v2 fields
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'test', '/tmp/test')").run();
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt, github_issue_number, autonomous) VALUES ('t1', 'p1', 'title', 'prompt', 42, 1)",
    ).run();
    const row = db
      .prepare('SELECT github_issue_number, autonomous FROM threads WHERE id = ?')
      .get('t1');
    const typedRow = asRow<ThreadV2Row>(row);
    expect(typedRow.github_issue_number).toBe(42);
    expect(typedRow.autonomous).toBe(1);
  });

  it('is idempotent', () => {
    migrateV2(db);
    expect(() => migrateV2(db)).not.toThrow();
  });
});

describe('migrateV3', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrate(db);
    migrateV2(db);
  });

  afterEach(() => {
    db.close();
  });

  it('adds last_status_label column and reclassifies queued to todo', () => {
    // Insert a queued issue to verify reclassification
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'test', '/tmp/test')").run();
    db.prepare(
      "INSERT INTO github_issue_cache (id, project_id, issue_number, title, labels, state, pipeline_status) VALUES ('i1', 'p1', 1, 'Issue', '[]', 'open', 'queued')",
    ).run();

    migrateV3(db);

    const row = db.prepare('SELECT pipeline_status FROM github_issue_cache WHERE id = ?').get('i1');
    expect(asRow<GitHubIssueCacheV3Row>(row).pipeline_status).toBe('todo');
  });

  it('is idempotent', () => {
    migrateV3(db);
    expect(() => migrateV3(db)).not.toThrow();
  });
});

describe('migrateV18', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrate(db);
    migrateV2(db);
    migrateV3(db);
  });

  afterEach(() => {
    db.close();
  });

  it('rewrites rejected plans to approval when the owning thread is in approval', () => {
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'test', '/tmp/test')").run();
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt, status) VALUES ('t1', 'p1', 'title', 'prompt', 'approval')",
    ).run();
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt, status) VALUES ('t2', 'p1', 'title 2', 'prompt', 'failed')",
    ).run();
    db.prepare(
      "INSERT INTO plans (id, thread_id, version, raw_output, status) VALUES ('plan-1', 't1', 1, 'raw', 'rejected')",
    ).run();
    db.prepare(
      "INSERT INTO plans (id, thread_id, version, raw_output, status) VALUES ('plan-2', 't2', 1, 'raw', 'rejected')",
    ).run();

    migrateV18(db);

    const rewritten = db.prepare('SELECT status FROM plans WHERE id = ?').get('plan-1') as {
      status: string;
    };
    const untouched = db.prepare('SELECT status FROM plans WHERE id = ?').get('plan-2') as {
      status: string;
    };

    expect(rewritten.status).toBe('approval');
    expect(untouched.status).toBe('rejected');
  });
});

describe('migrateV20', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrate(db);
    migrateV2(db);
    migrateV3(db);
  });

  afterEach(() => {
    db.close();
  });

  it('adds project chat routing columns', () => {
    migrateV20(db);

    db.prepare(
      "INSERT INTO projects (id, name, path, discord_routing, telegram_routing) VALUES ('p1', 'test', '/tmp/test', 'custom', 'disabled')",
    ).run();
    const row = db
      .prepare('SELECT discord_routing, telegram_routing FROM projects WHERE id = ?')
      .get('p1') as { discord_routing: string; telegram_routing: string };

    expect(row.discord_routing).toBe('custom');
    expect(row.telegram_routing).toBe('disabled');
  });

  it('is idempotent', () => {
    migrateV20(db);
    expect(() => migrateV20(db)).not.toThrow();
  });
});

describe('migrateV21', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrate(db);
    migrateV2(db);
    migrateV3(db);
  });

  afterEach(() => {
    db.close();
  });

  it('reclassifies open completed issues with linked PR evidence back to completed and closed ones to closed', () => {
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'test', '/tmp/test')").run();
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt, status) VALUES ('t1', 'p1', 'title', 'prompt', 'completed')",
    ).run();
    db.prepare(
      "INSERT INTO github_issue_cache (id, project_id, issue_number, title, labels, state, pipeline_status, thread_id, linked_pr_number) VALUES ('open-issue', 'p1', 1, 'Issue', '[]', 'open', 'todo', 't1', 49)",
    ).run();
    db.prepare(
      "INSERT INTO github_issue_cache (id, project_id, issue_number, title, labels, state, pipeline_status) VALUES ('closed-issue', 'p1', 2, 'Issue 2', '[]', 'closed', 'completed')",
    ).run();

    migrateV21(db);

    const openRow = db
      .prepare('SELECT pipeline_status FROM github_issue_cache WHERE id = ?')
      .get('open-issue') as { pipeline_status: string };
    const closedRow = db
      .prepare('SELECT pipeline_status FROM github_issue_cache WHERE id = ?')
      .get('closed-issue') as { pipeline_status: string };

    expect(openRow.pipeline_status).toBe('completed');
    expect(closedRow.pipeline_status).toBe('closed');
  });
});

describe('migrateV22', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrate(db);
    migrateV2(db);
    migrateV3(db);
    migrateV20(db);
    migrateV21(db);
  });

  afterEach(() => {
    db.close();
  });

  it('reclassifies orphaned queued issues back to todo', () => {
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'test', '/tmp/test')").run();
    db.prepare(
      "INSERT INTO github_issue_cache (id, project_id, issue_number, title, labels, state, pipeline_status) VALUES ('queued-issue', 'p1', 1, 'Issue', '[]', 'open', 'queued')",
    ).run();
    db.prepare(
      "INSERT INTO github_issue_cache (id, project_id, issue_number, title, labels, state, pipeline_status, claimed_at, claimed_by) VALUES ('claimed-issue', 'p1', 2, 'Claimed', '[]', 'open', 'queued', datetime('now'), 'worker-1')",
    ).run();

    migrateV22(db);

    const queuedRow = db
      .prepare('SELECT pipeline_status, last_phase_update FROM github_issue_cache WHERE id = ?')
      .get('queued-issue') as { pipeline_status: string; last_phase_update: string | null };
    const claimedRow = db
      .prepare('SELECT pipeline_status FROM github_issue_cache WHERE id = ?')
      .get('claimed-issue') as { pipeline_status: string };

    expect(queuedRow.pipeline_status).toBe('todo');
    expect(queuedRow.last_phase_update).toBeNull();
    expect(claimedRow.pipeline_status).toBe('queued');
  });
});

describe('migrateV27', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrate(db);
    migrateV2(db);
    migrateV3(db);
  });

  afterEach(() => {
    db.close();
  });

  it('normalizes structured artifacts and truncates oversized raw output', () => {
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'test', '/tmp/test')").run();
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt) VALUES ('t1', 'p1', 'Issue', 'Prompt')",
    ).run();

    db.prepare(
      `INSERT INTO plans (id, thread_id, version, raw_output, structured, status)
       VALUES ('plan-1', 't1', 1, 'junk', '{"id":"p","threadId":"t1","version":1,"objective":"obj","files":[],"steps":[],"acceptanceCriteria":[],"outOfScope":[],"estimatedComplexity":"low","dependencies":[]}', 'draft')`,
    ).run();
    db.prepare(
      `INSERT INTO reviews (id, plan_id, decision, confidence, raw_output, structured)
       VALUES ('review-1', 'plan-1', 'approve', 'high', 'junk', '{"planId":"plan-1","decision":"approve","confidence":"high","summary":"ok","findings":[],"suggestedChanges":[]}')`,
    ).run();
    db.prepare(
      `INSERT INTO verifications (id, thread_id, plan_id, raw_output, structured, result, retry_count)
       VALUES ('verification-1', 't1', 'plan-1', 'junk', '{"threadId":"t1","planId":"plan-1","result":"passed","summary":"ok","criteriaResults":[],"issues":[]}', 'passed', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO plans (id, thread_id, version, raw_output, structured, status)
       VALUES ('plan-2', 't1', 2, ?, NULL, 'draft')`,
    ).run(`prefix\n${'x'.repeat(20_000)}\nsuffix`);

    migrateV27(db);

    const planStructured = db
      .prepare('SELECT raw_output FROM plans WHERE id = ?')
      .get('plan-1') as { raw_output: string };
    const reviewStructured = db
      .prepare('SELECT raw_output FROM reviews WHERE id = ?')
      .get('review-1') as { raw_output: string };
    const verificationStructured = db
      .prepare('SELECT raw_output FROM verifications WHERE id = ?')
      .get('verification-1') as { raw_output: string };
    const truncatedPlan = db.prepare('SELECT raw_output FROM plans WHERE id = ?').get('plan-2') as {
      raw_output: string;
    };

    expect(planStructured.raw_output).toContain('```shipcode-plan');
    expect(reviewStructured.raw_output).toContain('```shipcode-review');
    expect(verificationStructured.raw_output).toContain('```shipcode-verification');
    expect(truncatedPlan.raw_output.length).toBeLessThanOrEqual(16_000);
    expect(truncatedPlan.raw_output).toContain('suffix');
    expect(truncatedPlan.raw_output).toContain('[truncated historical raw_output]');
  });

  it('preserves existing raw output when structured artifacts are fenced', () => {
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'test', '/tmp/test')").run();
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt) VALUES ('t1', 'p1', 'Issue', 'Prompt')",
    ).run();

    db.prepare(
      `INSERT INTO plans (id, thread_id, version, raw_output, structured, status)
       VALUES ('plan-raw', 't1', 1, 'planner transcript before JSON', '{"id":"p","threadId":"t1","version":1,"objective":"obj","files":[],"steps":[],"acceptanceCriteria":[],"outOfScope":[],"estimatedComplexity":"low","dependencies":[]}', 'draft')`,
    ).run();
    db.prepare(
      `INSERT INTO reviews (id, plan_id, decision, confidence, raw_output, structured)
       VALUES ('review-raw', 'plan-raw', 'approve', 'high', 'reviewer transcript before JSON', '{"planId":"plan-raw","decision":"approve","confidence":"high","summary":"ok","findings":[],"suggestedChanges":[]}')`,
    ).run();
    db.prepare(
      `INSERT INTO verifications (id, thread_id, plan_id, raw_output, structured, result, retry_count)
       VALUES ('verification-raw', 't1', 'plan-raw', 'verifier transcript before JSON', '{"threadId":"t1","planId":"plan-raw","result":"passed","summary":"ok","criteriaResults":[],"issues":[]}', 'passed', 0)`,
    ).run();

    migrateV27(db);

    const plan = db.prepare('SELECT raw_output FROM plans WHERE id = ?').get('plan-raw') as {
      raw_output: string;
    };
    const review = db.prepare('SELECT raw_output FROM reviews WHERE id = ?').get('review-raw') as {
      raw_output: string;
    };
    const verification = db
      .prepare('SELECT raw_output FROM verifications WHERE id = ?')
      .get('verification-raw') as { raw_output: string };

    expect(plan.raw_output).toContain('planner transcript before JSON');
    expect(plan.raw_output).toContain('```shipcode-plan');
    expect(review.raw_output).toContain('reviewer transcript before JSON');
    expect(review.raw_output).toContain('```shipcode-review');
    expect(verification.raw_output).toContain('verifier transcript before JSON');
    expect(verification.raw_output).toContain('```shipcode-verification');
  });
});

describe('migrateV30', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrate(db);
    migrateV2(db);
    migrateV3(db);
    migrateV29(db);
  });

  afterEach(() => {
    db.close();
  });

  it('renames legacy revision settings and drops planner turn leftovers', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('maxReviewRounds', '3')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('plannerMaxTurns', '12')").run();

    migrateV30(db);

    const revisionCount = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('revisionCount') as { value: string } | undefined;
    const legacyReviewKey = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('maxReviewRounds');
    const legacyPlannerKey = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('plannerMaxTurns');

    expect(revisionCount?.value).toBe('3');
    expect(legacyReviewKey).toBeUndefined();
    expect(legacyPlannerKey).toBeUndefined();
  });

  it('preserves an explicit revisionCount when cleaning legacy keys', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('revisionCount', '1')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('maxReviewRounds', '4')").run();

    migrateV30(db);

    const revisionCount = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('revisionCount') as { value: string } | undefined;

    expect(revisionCount?.value).toBe('1');
  });
});

describe('migrateV31', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrate(db);
    migrateV2(db);
    migrateV3(db);
    migrateV29(db);
    migrateV30(db);
  });

  afterEach(() => {
    db.close();
  });

  it('adds project and issue approval override columns', () => {
    migrateV31(db);

    db.prepare(
      "INSERT INTO projects (id, name, path, require_approval_override) VALUES ('p1', 'test', '/tmp/test', 1)",
    ).run();
    db.prepare(
      "INSERT INTO github_issue_cache (id, project_id, issue_number, title, labels, state, pipeline_status, require_approval_override) VALUES ('i1', 'p1', 1, 'Issue', '[]', 'open', 'todo', 0)",
    ).run();

    const projectRow = db
      .prepare('SELECT require_approval_override FROM projects WHERE id = ?')
      .get('p1') as { require_approval_override: number };
    const issueRow = db
      .prepare('SELECT require_approval_override FROM github_issue_cache WHERE id = ?')
      .get('i1') as { require_approval_override: number };

    expect(projectRow.require_approval_override).toBe(1);
    expect(issueRow.require_approval_override).toBe(0);
  });

  it('is idempotent', () => {
    migrateV31(db);
    expect(() => migrateV31(db)).not.toThrow();
  });
});

describe('migrateV34', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrate(db);
    migrateV2(db);
    migrateV3(db);
    migrateV29(db);
    migrateV30(db);
    migrateV31(db);
    migrateV33(db);
  });

  afterEach(() => {
    db.close();
  });

  it('upgrades the legacy default maxConcurrentExecutions from 1 to 3', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('maxConcurrentExecutions', '1')").run();

    migrateV34(db);

    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('maxConcurrentExecutions') as { value: string } | undefined;

    expect(row?.value).toBe('3');
  });

  it('preserves explicit maxConcurrentExecutions values other than 1', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('maxConcurrentExecutions', '5')").run();

    migrateV34(db);

    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('maxConcurrentExecutions') as { value: string } | undefined;

    expect(row?.value).toBe('5');
  });

  it('is idempotent', () => {
    migrateV34(db);
    expect(() => migrateV34(db)).not.toThrow();
  });
});

describe('migrateV35', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrate(db);
    migrateV2(db);
    migrateV3(db);
    migrateV29(db);
    migrateV30(db);
    migrateV31(db);
    migrateV33(db);
    migrateV34(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates prompt telemetry storage for upgraded databases', () => {
    db.exec('DROP TABLE IF EXISTS prompt_telemetry');

    migrateV35(db);

    expect(tableExists(db, 'prompt_telemetry')).toBe(true);
  });

  it('is idempotent', () => {
    migrateV35(db);
    expect(() => migrateV35(db)).not.toThrow();
  });
});

describe('migrateV36', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrate(db);
    migrateV2(db);
    migrateV3(db);
    migrateV29(db);
    migrateV30(db);
    migrateV31(db);
    migrateV33(db);
    migrateV34(db);
    migrateV35(db);
  });

  afterEach(() => {
    db.close();
  });

  it('adds priority columns to github_issue_cache', () => {
    migrateV36(db);

    const cols = getColumns(db, 'github_issue_cache');
    const names = cols.map((c) => c.name);
    expect(names).toContain('priority_rank');
    expect(names).toContain('priority_raw');
    expect(names).toContain('priority_fetched_at');

    const types = Object.fromEntries(cols.map((c) => [c.name, c.type.toUpperCase()]));
    expect(types.priority_rank).toBe('TEXT');
    expect(types.priority_raw).toBe('TEXT');
    expect(types.priority_fetched_at).toBe('TEXT');
  });

  it('is idempotent', () => {
    migrateV36(db);
    expect(() => migrateV36(db)).not.toThrow();

    const cols = getColumns(db, 'github_issue_cache');
    const rankCount = cols.filter((c) => c.name === 'priority_rank').length;
    expect(rankCount).toBe(1);
  });

  it('bumps schema_version to 36', () => {
    migrateV36(db);
    const row = db
      .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
      .get() as { version: number };
    expect(row.version).toBeGreaterThanOrEqual(36);
  });
});

describe('migrateV37', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrateThrough(db, migrateV36);
  });

  afterEach(() => {
    db.close();
  });

  it('adds FK indexes that were missing', () => {
    migrateV37(db);

    expect(indexExists(db, 'idx_verifications_plan')).toBe(true);
    expect(indexExists(db, 'idx_github_issues_thread')).toBe(true);
    expect(indexExists(db, 'idx_notifications_project')).toBe(true);
    expect(indexExists(db, 'idx_pipeline_checkpoints_project')).toBe(true);
  });

  it('is idempotent', () => {
    migrateV37(db);
    expect(() => migrateV37(db)).not.toThrow();
  });

  it('bumps schema_version to 37', () => {
    migrateV37(db);
    const row = db
      .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
      .get() as { version: number };
    expect(row.version).toBeGreaterThanOrEqual(37);
  });
});

describe('migrateV40', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrateThrough(db, migrateV39);
  });

  afterEach(() => {
    db.close();
  });

  it('adds is_quick_mode column to github_issue_cache', () => {
    expect(columnExists(db, 'github_issue_cache', 'is_quick_mode')).toBe(false);
    migrateV40(db);
    expect(columnExists(db, 'github_issue_cache', 'is_quick_mode')).toBe(true);
  });

  it('defaults is_quick_mode to 0 for existing rows', () => {
    db.prepare(
      `INSERT INTO projects (id, name, path, created_at, updated_at)
       VALUES ('p1', 'p', '/p', datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO github_issue_cache (id, project_id, issue_number, title)
       VALUES ('i1', 'p1', 7, 't')`,
    ).run();
    migrateV40(db);
    const row = db
      .prepare('SELECT is_quick_mode FROM github_issue_cache WHERE id = ?')
      .get('i1') as { is_quick_mode: number };
    expect(row.is_quick_mode).toBe(0);
  });

  it('is idempotent', () => {
    migrateV40(db);
    expect(() => migrateV40(db)).not.toThrow();
  });

  it('bumps schema_version to 40', () => {
    migrateV40(db);
    const row = db
      .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
      .get() as { version: number };
    expect(row.version).toBeGreaterThanOrEqual(40);
  });
});

describe('migrateV41', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    migrateThrough(db, migrateV40);
  });

  afterEach(() => {
    db.close();
  });

  it('adds github_updated_at column to github_issue_cache', () => {
    expect(columnExists(db, 'github_issue_cache', 'github_updated_at')).toBe(false);
    migrateV41(db);
    expect(columnExists(db, 'github_issue_cache', 'github_updated_at')).toBe(true);
  });

  it('backfills github_updated_at from fetched_at for existing rows', () => {
    db.prepare(
      `INSERT INTO projects (id, name, path, created_at, updated_at)
       VALUES ('p1', 'p', '/p', datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO github_issue_cache (id, project_id, issue_number, title, fetched_at)
       VALUES ('i1', 'p1', 7, 't', '2026-04-01T00:00:00.000Z')`,
    ).run();

    migrateV41(db);
    const row = db
      .prepare('SELECT github_updated_at FROM github_issue_cache WHERE id = ?')
      .get('i1') as { github_updated_at: string };
    expect(row.github_updated_at).toBe('2026-04-01T00:00:00.000Z');
  });

  it('is idempotent', () => {
    migrateV41(db);
    expect(() => migrateV41(db)).not.toThrow();
  });

  it('bumps schema_version to 41', () => {
    migrateV41(db);
    const row = db
      .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
      .get() as { version: number };
    expect(row.version).toBeGreaterThanOrEqual(41);
  });
});

describe('migrateV45', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  it('creates agent_conversations table with correct columns', () => {
    const cols = db.prepare("PRAGMA table_info('agent_conversations')").all() as {
      name: string;
      type: string;
      notnull: number;
    }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('thread_id');
    expect(colNames).toContain('phase');
    expect(colNames).toContain('round');
    expect(colNames).toContain('speaker');
    expect(colNames).toContain('role');
    expect(colNames).toContain('parent_id');
    expect(colNames).toContain('provider');
    expect(colNames).toContain('model');
    expect(colNames).toContain('content');
    expect(colNames).toContain('tokens_in');
    expect(colNames).toContain('tokens_out');
    expect(colNames).toContain('cost_usd');
    expect(colNames).toContain('created_at');
  });

  it('creates indexes on (thread_id, created_at) and (thread_id, phase, round)', () => {
    const indexes = db.prepare("PRAGMA index_list('agent_conversations')").all() as {
      name: string;
    }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_agent_conv_thread_time');
    expect(indexNames).toContain('idx_agent_conv_thread_phase_round');
  });

  it('adds conversation_id column to pipeline_step_log', () => {
    const cols = db.prepare("PRAGMA table_info('pipeline_step_log')").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain('conversation_id');
  });

  it('cascades delete when thread is deleted', () => {
    const projectId = 'proj-1';
    db.prepare(
      "INSERT INTO projects (id, name, path, git_remote, default_branch, created_at, updated_at) VALUES (?, 'test', '/tmp', 'git@x', 'main', datetime('now'), datetime('now'))",
    ).run(projectId);
    db.prepare(
      "INSERT INTO threads (id, project_id, prompt, title, status, created_at, updated_at) VALUES ('t1', ?, 'go', 'Test', 'idle', datetime('now'), datetime('now'))",
    ).run(projectId);
    db.prepare(
      "INSERT INTO agent_conversations (id, thread_id, phase, speaker, role, content) VALUES ('c1', 't1', 'plan', 'planner', 'prompt', 'hello')",
    ).run();

    const before = db
      .prepare("SELECT COUNT(*) as count FROM agent_conversations WHERE thread_id = 't1'")
      .get() as { count: number };
    expect(before.count).toBe(1);

    db.prepare("DELETE FROM threads WHERE id = 't1'").run();

    const after = db
      .prepare("SELECT COUNT(*) as count FROM agent_conversations WHERE thread_id = 't1'")
      .get() as { count: number };
    expect(after.count).toBe(0);
  });

  it('is idempotent', () => {
    expect(() => migrateV45(db)).not.toThrow();
  });
});

describe('migrateV46', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  it('creates feature_qa_results table with correct columns', () => {
    const cols = db.prepare("PRAGMA table_info('feature_qa_results')").all() as {
      name: string;
      type: string;
      notnull: number;
    }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('thread_id');
    expect(colNames).toContain('feature_id');
    expect(colNames).toContain('status');
    expect(colNames).toContain('flow_results');
    expect(colNames).toContain('summary');
    expect(colNames).toContain('evidence_paths');
    expect(colNames).toContain('run_at');
    expect(colNames).toContain('created_at');
  });

  it('creates indexes on (thread_id, created_at) and (feature_id, run_at)', () => {
    const indexes = db.prepare("PRAGMA index_list('feature_qa_results')").all() as {
      name: string;
    }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_feature_qa_thread');
    expect(indexNames).toContain('idx_feature_qa_feature');
  });

  it('cascades delete when thread is deleted', () => {
    const projectId = 'proj-1';
    db.prepare(
      "INSERT INTO projects (id, name, path, git_remote, default_branch, created_at, updated_at) VALUES (?, 'test', '/tmp', 'git@x', 'main', datetime('now'), datetime('now'))",
    ).run(projectId);
    db.prepare(
      "INSERT INTO threads (id, project_id, prompt, title, status, created_at, updated_at) VALUES ('t1', ?, 'go', 'Test', 'idle', datetime('now'), datetime('now'))",
    ).run(projectId);
    db.prepare(
      "INSERT INTO feature_qa_results (id, thread_id, feature_id, status, flow_results, summary) VALUES ('qa1', 't1', 'issue-1', 'passed', '[]', 'ok')",
    ).run();

    const before = db
      .prepare("SELECT COUNT(*) as count FROM feature_qa_results WHERE thread_id = 't1'")
      .get() as { count: number };
    expect(before.count).toBe(1);

    db.prepare("DELETE FROM threads WHERE id = 't1'").run();

    const after = db
      .prepare("SELECT COUNT(*) as count FROM feature_qa_results WHERE thread_id = 't1'")
      .get() as { count: number };
    expect(after.count).toBe(0);
  });

  it('is idempotent', () => {
    expect(() => migrateV46(db)).not.toThrow();
  });
});

describe('migrateV47', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  it('adds github_status_mapping column to projects', () => {
    const columns = db.prepare("SELECT name FROM pragma_table_info('projects')").all() as Array<{
      name: string;
    }>;
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('github_status_mapping');
  });

  it('defaults to NULL for existing rows', () => {
    db.prepare(
      "INSERT INTO projects (id, name, path, default_branch) VALUES ('p1', 'test', '/tmp/test', 'main')",
    ).run();
    const row = db.prepare("SELECT github_status_mapping FROM projects WHERE id = 'p1'").get() as {
      github_status_mapping: string | null;
    };
    expect(row.github_status_mapping).toBeNull();
  });

  it('is idempotent', () => {
    expect(() => migrateV47(db)).not.toThrow();
  });
});

describe('migrateV48', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  it('adds done_at column to threads', () => {
    const columns = db.prepare("SELECT name FROM pragma_table_info('threads')").all() as Array<{
      name: string;
    }>;
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('done_at');
  });

  it('defaults to NULL for existing threads', () => {
    db.prepare(
      "INSERT INTO projects (id, name, path, default_branch) VALUES ('p1', 'test', '/tmp/test', 'main')",
    ).run();
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt) VALUES ('t1', 'p1', 'Test', 'prompt')",
    ).run();
    const row = db.prepare("SELECT done_at FROM threads WHERE id = 't1'").get() as {
      done_at: string | null;
    };
    expect(row.done_at).toBeNull();
  });

  it('is idempotent', () => {
    expect(() => migrateV48(db)).not.toThrow();
  });
});

describe('migrateV49', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('adds speed profile override and analytics tables', () => {
    const projectColumns = db
      .prepare("SELECT name FROM pragma_table_info('projects')")
      .all() as Array<{
      name: string;
    }>;
    const projectColumnNames = projectColumns.map((column) => column.name);

    expect(projectColumnNames).toContain('pipeline_speed_profile_override');
    expect(tableExists(db, 'pipeline_phase_log')).toBe(true);
    expect(tableExists(db, 'skill_resolution_log')).toBe(true);
  });

  it('is idempotent', () => {
    expect(() => migrateV49(db)).not.toThrow();
  });
});

describe('migrateV50', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('adds archived_at column to threads', () => {
    const columns = db.prepare("SELECT name FROM pragma_table_info('threads')").all() as Array<{
      name: string;
    }>;
    const colNames = columns.map((column) => column.name);

    expect(colNames).toContain('archived_at');
  });

  it('is idempotent', () => {
    expect(() => migrateV50(db)).not.toThrow();
  });
});

describe('migrateV52', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('adds paused state columns to threads', () => {
    const columns = db.prepare("SELECT name FROM pragma_table_info('threads')").all() as Array<{
      name: string;
    }>;
    const colNames = columns.map((column) => column.name);

    expect(colNames).toContain('paused_phase');
    expect(colNames).toContain('paused_at');
  });

  it('is idempotent', () => {
    expect(() => migrateV52(db)).not.toThrow();
  });
});

describe('migrateV53', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
    db.exec(`
      INSERT INTO projects (id, name, path) VALUES ('p53', 'Project 53', '/tmp/project-53');
      INSERT INTO threads (id, project_id, title, prompt, status, paused_phase)
        VALUES ('t53', 'p53', 'Thread 53', 'prompt', 'awaiting_approval', 'awaiting_approval');
      INSERT INTO plans (id, thread_id, raw_output, status)
        VALUES ('plan53', 't53', '{}', 'awaiting_approval');
      INSERT INTO github_issue_cache (id, project_id, issue_number, title, labels, state, pipeline_status)
        VALUES
          ('issue-approval', 'p53', 5301, 'Approval issue', '[]', 'open', 'awaiting_approval'),
          ('issue-closed', 'p53', 5302, 'Closed issue', '[]', 'closed', 'done');
      INSERT INTO pipeline_phase_log (id, thread_id, phase, started_at, terminal_status)
        VALUES ('phase53', 't53', 'awaiting_approval', '2026-01-01T00:00:00.000Z', 'awaiting_approval');
      INSERT INTO notifications (id, thread_id, project_id, kind, title, body)
        VALUES ('notification53', 't53', 'p53', 'awaiting_approval', 'Approval', 'Body');
      INSERT OR REPLACE INTO settings (key, value)
        VALUES
          ('notificationEvents', '{"awaitingApproval":true,"failed":true}'),
          ('chatNotificationEvents', '{"awaitingApproval":false,"failed":true}');
      DELETE FROM schema_version;
      INSERT INTO schema_version (version) VALUES (52);
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('renames approval and closed status values', () => {
    migrateV53(db);

    expect(
      db.prepare("SELECT status, paused_phase FROM threads WHERE id = 't53'").get() as {
        status: string;
        paused_phase: string;
      },
    ).toEqual({ status: 'approval', paused_phase: 'approval' });
    expect(
      (db.prepare("SELECT status FROM plans WHERE id = 'plan53'").get() as { status: string })
        .status,
    ).toBe('approval');
    expect(
      (
        db
          .prepare("SELECT pipeline_status FROM github_issue_cache WHERE id = 'issue-approval'")
          .get() as { pipeline_status: string }
      ).pipeline_status,
    ).toBe('approval');
    expect(
      (
        db
          .prepare("SELECT pipeline_status FROM github_issue_cache WHERE id = 'issue-closed'")
          .get() as {
          pipeline_status: string;
        }
      ).pipeline_status,
    ).toBe('closed');
    expect(
      db
        .prepare("SELECT phase, terminal_status FROM pipeline_phase_log WHERE id = 'phase53'")
        .get() as {
        phase: string;
        terminal_status: string;
      },
    ).toEqual({ phase: 'approval', terminal_status: 'approval' });
    expect(
      (
        db.prepare("SELECT kind FROM notifications WHERE id = 'notification53'").get() as {
          kind: string;
        }
      ).kind,
    ).toBe('approval');
    expect(
      (
        db.prepare("SELECT value FROM settings WHERE key = 'notificationEvents'").get() as {
          value: string;
        }
      ).value,
    ).toBe('{"approval":true,"failed":true}');
    expect(
      (
        db.prepare("SELECT value FROM settings WHERE key = 'chatNotificationEvents'").get() as {
          value: string;
        }
      ).value,
    ).toBe('{"approval":false,"failed":true}');
    expect(
      (
        db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as {
          version: number;
        }
      ).version,
    ).toBe(53);
  });

  it('is idempotent', () => {
    migrateV53(db);
    expect(() => migrateV53(db)).not.toThrow();
  });
});

describe('migrateV58', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('repairs a newer schema_version database missing issue_type', () => {
    migrateThrough(db, migrateV54);
    expect(columnExists(db, 'github_issue_cache', 'issue_type')).toBe(false);

    db.exec(`
      DELETE FROM schema_version;
      INSERT INTO schema_version (version) VALUES (57);
    `);

    migrateV58(db);

    expect(columnExists(db, 'github_issue_cache', 'issue_type')).toBe(true);
    expect(
      (
        db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as {
          version: number;
        }
      ).version,
    ).toBe(58);
  });

  it('is idempotent', () => {
    migrateThrough(db, migrateV58);
    expect(() => migrateV58(db)).not.toThrow();

    const issueTypeColumns = getColumns(db, 'github_issue_cache').filter(
      (column) => column.name === 'issue_type',
    );
    expect(issueTypeColumns).toHaveLength(1);
  });
});

describe('migrateV54', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates the triage_rules table, indexes, and issue-cache triage columns', () => {
    migrateThrough(db, migrateV54);

    expect(tableExists(db, 'triage_rules')).toBe(true);
    expect(indexExists(db, 'idx_triage_rules_project_order')).toBe(true);
    expect(indexExists(db, 'idx_triage_rules_project_enabled_order')).toBe(true);
    expect(columnExists(db, 'github_issue_cache', 'rules_applied_at')).toBe(true);
    expect(columnExists(db, 'github_issue_cache', 'triage_failure_reason')).toBe(true);
  });

  it('backfills rules_applied_at for issues that existed before the migration', () => {
    migrateThrough(db, migrateV53);
    expect(columnExists(db, 'github_issue_cache', 'rules_applied_at')).toBe(false);

    // FK enforcement is irrelevant to the migration's backfill logic; skip the
    // projects-row prerequisite so the test stays focused on rules_applied_at.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      INSERT INTO github_issue_cache (id, project_id, issue_number, title)
      VALUES ('issue-pre', 'project-pre', 1, 'Legacy issue');
    `);

    migrateV54(db);

    const row = db
      .prepare(
        'SELECT rules_applied_at, triage_failure_reason FROM github_issue_cache WHERE id = ?',
      )
      .get('issue-pre') as {
      rules_applied_at: string | null;
      triage_failure_reason: string | null;
    };
    expect(row.rules_applied_at).toBeTruthy();
    expect(row.triage_failure_reason).toBeNull();
  });

  it('is idempotent', () => {
    migrateThrough(db, migrateV54);
    expect(() => migrateV54(db)).not.toThrow();

    const columns = getColumns(db, 'github_issue_cache').filter(
      (column) => column.name === 'rules_applied_at',
    );
    expect(columns).toHaveLength(1);
  });
});

describe('migrateV60', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('adds the author column to github_issue_cache', () => {
    migrateThrough(db, migrateV59);
    expect(columnExists(db, 'github_issue_cache', 'author')).toBe(false);

    migrateV60(db);
    expect(columnExists(db, 'github_issue_cache', 'author')).toBe(true);
  });

  it('is idempotent', () => {
    migrateThrough(db, migrateV60);
    expect(() => migrateV60(db)).not.toThrow();

    const columns = getColumns(db, 'github_issue_cache').filter(
      (column) => column.name === 'author',
    );
    expect(columns).toHaveLength(1);
  });
});

describe('migrateV61', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates the review findings ledger', () => {
    migrateThrough(db, migrateV60);
    expect(tableExists(db, 'review_findings')).toBe(false);

    migrateV61(db);

    expect(tableExists(db, 'review_findings')).toBe(true);
    expect(indexExists(db, 'idx_review_findings_thread_status')).toBe(true);
    expect(columnExists(db, 'review_findings', 'fingerprint')).toBe(true);
    expect(columnExists(db, 'review_findings', 'metadata_json')).toBe(true);
  });

  it('is idempotent', () => {
    migrateThrough(db, migrateV61);
    expect(() => migrateV61(db)).not.toThrow();

    const columns = getColumns(db, 'review_findings').filter(
      (column) => column.name === 'fingerprint',
    );
    expect(columns).toHaveLength(1);
  });
});

describe('migrateV62', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('creates issue_chat_sessions table with provider session metadata', () => {
    migrateThrough(db, migrateV61);
    migrateV62(db);

    const cols = db.prepare("PRAGMA table_info('issue_chat_sessions')").all() as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain('thread_id');
    expect(colNames).toContain('provider');
    expect(colNames).toContain('session_id');
    expect(colNames).toContain('cwd');
    expect(colNames).toContain('model');
    expect(colNames).toContain('reasoning_effort');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
    expect(indexExists(db, 'idx_issue_chat_sessions_updated')).toBe(true);
  });

  it('cascades delete when thread is deleted', () => {
    migrateThrough(db, migrateV62);
    db.prepare(
      "INSERT INTO projects (id, name, path, git_remote, default_branch, created_at, updated_at) VALUES ('proj-1', 'test', '/tmp', 'git@x', 'main', datetime('now'), datetime('now'))",
    ).run();
    db.prepare(
      "INSERT INTO threads (id, project_id, prompt, title, status, created_at, updated_at) VALUES ('t1', 'proj-1', 'go', 'Test', 'idle', datetime('now'), datetime('now'))",
    ).run();
    db.prepare(
      "INSERT INTO issue_chat_sessions (thread_id, provider, session_id, cwd) VALUES ('t1', 'claude', 'session-1', '/tmp/worktree')",
    ).run();

    db.prepare("DELETE FROM threads WHERE id = 't1'").run();

    const count = db
      .prepare("SELECT COUNT(*) as count FROM issue_chat_sessions WHERE thread_id = 't1'")
      .get() as { count: number };
    expect(count.count).toBe(0);
  });

  it('is idempotent', () => {
    migrateThrough(db, migrateV62);
    expect(() => migrateV62(db)).not.toThrow();
  });
});
