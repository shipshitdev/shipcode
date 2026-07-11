import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase } from './index';
import { createTestDb } from './test-helpers';

function latestVersion(db: DatabaseSync): number {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as {
    version: number | null;
  };
  return row.version ?? 0;
}

function schemaObjects(db: DatabaseSync): Array<{ type: string; name: string; sql: string }> {
  // Only user-defined objects carry a non-null `sql`; auto-indexes and internal
  // bookkeeping tables are excluded so the comparison reflects migration DDL.
  return db
    .prepare('SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name')
    .all() as Array<{ type: string; name: string; sql: string }>;
}

describe('createTestDb', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    closeDatabase();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Direct guard for the specific landmine: createTestDb must run the migration
  // that adds pipeline_checkpoints.ref_name (migrateV64). CheckpointQueries.create()
  // inserts into ref_name unconditionally, so any query test built on createTestDb
  // that touches it would otherwise fail with "no such column: ref_name".
  it('applies migrateV64 so pipeline_checkpoints has the ref_name column', () => {
    const db = createTestDb();
    const columns = db.prepare("PRAGMA table_info('pipeline_checkpoints')").all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toContain('ref_name');
    db.close();
  });

  // General drift guard: createTestDb and the production runner (getDatabase) must
  // invoke the identical migration sequence. Any migration added to one but not the
  // other diverges the final schema and trips this test loudly here, instead of
  // surfacing as a mysterious runtime error in some downstream query test.
  it('matches the production runner schema (migration-sequence drift guard)', () => {
    const testDb = createTestDb();
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'shipcode-db-testhelpers-'));
    tempDirs.push(dataDir);
    const prodDb = getDatabase(dataDir);

    expect(latestVersion(testDb)).toBe(latestVersion(prodDb));
    expect(schemaObjects(testDb)).toEqual(schemaObjects(prodDb));

    testDb.close();
  });
});
