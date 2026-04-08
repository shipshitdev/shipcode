import type { DatabaseSync } from 'node:sqlite'

/**
 * Transaction wrapper for node:sqlite's DatabaseSync.
 * node:sqlite has no db.transaction() helper — this wraps BEGIN/COMMIT/ROLLBACK.
 *
 * If already inside a transaction (db.isTransaction), runs fn directly without
 * nesting. This is a deliberate semantic downgrade from better-sqlite3's
 * SAVEPOINT-based nesting. Current codebase has zero nested transactions.
 */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
	if (db.isTransaction) {
		return fn()
	}
	db.exec('BEGIN')
	try {
		const result = fn()
		db.exec('COMMIT')
		return result
	} catch (err) {
		db.exec('ROLLBACK')
		throw err
	}
}
