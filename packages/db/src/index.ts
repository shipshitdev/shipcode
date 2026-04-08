import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { migrate, migrateV2, migrateV3 } from './schema'

export { transaction } from './utils'
export { ProjectQueries } from './queries/projects'
export { ThreadQueries } from './queries/threads'
export { PlanQueries } from './queries/plans'
export { ReviewQueries } from './queries/reviews'
export { DiffQueries } from './queries/diffs'
export { SettingsQueries } from './queries/settings'
export { VerificationQueries } from './queries/verifications'
export { GitHubIssueQueries } from './queries/github-issues'

let db: DatabaseSync | null = null

export function getDatabase(dataDir: string): DatabaseSync {
  if (db) return db

  const dbPath = path.join(dataDir, 'shipcode.db')
  db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true })

  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')

  migrate(db)
  migrateV2(db)
  migrateV3(db)
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
