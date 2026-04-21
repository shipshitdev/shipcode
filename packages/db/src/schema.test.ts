import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  migrate,
  migrateV2,
  migrateV3,
  migrateV18,
  migrateV20,
  migrateV21,
  migrateV22,
  migrateV27,
  migrateV29,
  migrateV30,
} from './schema';
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

  it('rewrites rejected plans to awaiting_approval when the owning thread is awaiting approval', () => {
    db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'test', '/tmp/test')").run();
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt, status) VALUES ('t1', 'p1', 'title', 'prompt', 'awaiting_approval')",
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

    expect(rewritten.status).toBe('awaiting_approval');
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

  it('reclassifies open completed issues with linked PR evidence back to completed and closed ones to done', () => {
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
    expect(closedRow.pipeline_status).toBe('done');
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
