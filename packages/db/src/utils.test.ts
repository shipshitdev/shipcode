import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from './test-helpers';
import { transaction } from './utils';

interface SettingsRow {
  value: string;
}

describe('transaction', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('commits on success', () => {
    transaction(db, () => {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('foo', 'bar');
    });

    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('foo') as SettingsRow;
    expect(row.value).toBe('bar');
  });

  it('rolls back on error and rethrows', () => {
    expect(() => {
      transaction(db, () => {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('foo', 'bar');
        throw new Error('boom');
      });
    }).toThrow('boom');

    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('foo');
    expect(row).toBeUndefined();
  });

  it('runs fn directly without BEGIN/COMMIT if already in transaction', () => {
    transaction(db, () => {
      expect(db.isTransaction).toBe(true);

      // Nested transaction should just run fn directly
      const result = transaction(db, () => {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('nested', 'val');
        return 42;
      });

      expect(result).toBe(42);
    });

    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('nested') as SettingsRow;
    expect(row.value).toBe('val');
  });
});
