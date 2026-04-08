import type { DatabaseSync } from 'node:sqlite'
import { nanoid } from 'nanoid'
import type { Project } from '@shipcode/shared'
import path from 'node:path'

export class ProjectQueries {
  constructor(private db: DatabaseSync) {}

  list(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as any[]
    return rows.map(mapProject)
  }

  getById(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any
    return row ? mapProject(row) : null
  }

  add(projectPath: string): Project {
    const id = nanoid()
    const name = path.basename(projectPath)
    const now = new Date().toISOString()

    this.db.prepare(
      'INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, projectPath, now, now)

    return this.getById(id)!
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  }

  updateGitInfo(id: string, gitRemote: string | null, defaultBranch: string): void {
    this.db.prepare(
      `UPDATE projects SET git_remote = ?, default_branch = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(gitRemote, defaultBranch, id)
  }
}

function mapProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    gitRemote: row.git_remote,
    defaultBranch: row.default_branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
