import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, migrateV2, migrateV3, migrateV18, migrateV20 } from './schema';
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
});
