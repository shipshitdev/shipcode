import type { DatabaseSync } from 'node:sqlite';

export function execAlterTableIfMissing(db: DatabaseSync, ddl: string): void {
  try {
    db.exec(ddl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Only suppress the idempotent duplicate-column case. Any other ALTER
    // failure must abort the migration so startup retries instead of silently
    // leaving the schema half-updated.
    if (!/duplicate column name/i.test(message)) throw err;
  }
}

export function execAlterTablesIfMissing(db: DatabaseSync, ddls: readonly string[]): void {
  for (const ddl of ddls) {
    execAlterTableIfMissing(db, ddl);
  }
}
