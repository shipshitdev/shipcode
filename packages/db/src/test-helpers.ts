import { DatabaseSync } from 'node:sqlite'
import { migrate, migrateV2, migrateV3, migrateV4, migrateV5, migrateV6 } from './schema'

export function createTestDb(): DatabaseSync {
	const db = new DatabaseSync(':memory:')
	migrate(db)
	migrateV2(db)
	migrateV3(db)
	migrateV4(db)
	migrateV5(db)
	migrateV6(db)
	return db
}
