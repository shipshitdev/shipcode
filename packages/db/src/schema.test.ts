import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, migrateV2, migrateV3 } from './schema';
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
