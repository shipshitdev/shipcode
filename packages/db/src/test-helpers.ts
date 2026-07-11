import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './schema';

/**
 * Build an in-memory database migrated fully up to date, for use in tests.
 * Delegates to {@link runMigrations} — the same canonical migration list the
 * production runner (getDatabase) uses — so a test database can never fall
 * behind production by a migration.
 */
export function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  return db;
}
