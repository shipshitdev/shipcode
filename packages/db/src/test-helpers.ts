import { DatabaseSync } from 'node:sqlite'
import { migrate, migrateV2, migrateV3 } from './schema'

export function createTestDb(): DatabaseSync {
	const db = new DatabaseSync(':memory:')
	migrate(db)
	migrateV2(db)
	migrateV3(db)
	return db
}
