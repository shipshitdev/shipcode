import Database from 'better-sqlite3'
import path from 'node:path'
import { migrate, migrateV2 } from './schema'

export { ProjectQueries } from './queries/projects'
export { ThreadQueries } from './queries/threads'
export { PlanQueries } from './queries/plans'
export { ReviewQueries } from './queries/reviews'
export { DiffQueries } from './queries/diffs'
export { SettingsQueries } from './queries/settings'
export { VerificationQueries } from './queries/verifications'
export { GitHubIssueQueries } from './queries/github-issues'

let db: Database.Database | null = null

export function getDatabase(dataDir: string): Database.Database {
  if (db) return db

  const dbPath = path.join(dataDir, 'crosscode.db')
  db = new Database(dbPath)

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  migrate(db)
  migrateV2(db)
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
