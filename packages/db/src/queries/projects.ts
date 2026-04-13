import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import { ISO_NOW_SQL, toIsoUtc, type Project } from '@shipcode/shared';
import path from 'node:path';

export class ProjectQueries {
  constructor(private db: DatabaseSync) {}

  /**
   * Full registry: returns every project including archived ones. This is the
   * canonical lookup used by CLI flows (apps/cli/src/commands/{run,onboard,status}.ts)
   * and any renderer surface that needs to resolve an arbitrary projectId
   * (Titlebar, IssueDetail, ThreadPanel). Do NOT change this to filter archived.
   * The sidebar uses `listVisible()` instead.
   */
  list(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as any[];
    return rows.map(mapProject);
  }

  /**
   * Non-archived projects, for the sidebar's visible project list.
   */
  listVisible(): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE archived = 0 ORDER BY updated_at DESC')
      .all() as any[];
    return rows.map(mapProject);
  }

  /**
   * Archived projects only, for the Settings → Archived panel.
   */
  listArchived(): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE archived = 1 ORDER BY name ASC')
      .all() as any[];
    return rows.map(mapProject);
  }

  getById(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    return row ? mapProject(row) : null;
  }

  getByPath(projectPath: string): Project | null {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE path = ? LIMIT 1')
      .get(projectPath) as any;
    return row ? mapProject(row) : null;
  }

  /**
   * Idempotent add: if a row already exists for this path, restore it (unarchive
   * + bump updated_at) and return it. Prevents UNIQUE(path) violations when
   * re-adding an archived project from the CLI or Add Repository dialog.
   */
  add(projectPath: string): Project {
    const existing = this.getByPath(projectPath);
    if (existing) {
      this.db
        .prepare(`UPDATE projects SET archived = 0, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
        .run(existing.id);
      return this.getById(existing.id)!;
    }

    const id = nanoid();
    const name = path.basename(projectPath);
    const now = new Date().toISOString();

    this.db
      .prepare(
        'INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, name, projectPath, now, now);

    return this.getById(id)!;
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  /**
   * Atomic final-guard DELETE. The idle predicate is enforced by the DELETE
   * statement itself (WHERE NOT EXISTS) so there is no read/write race between
   * a separate hasLiveWork() check and an unconditional DELETE. Returns true
   * iff the project row was actually removed.
   */
  removeIfIdle(id: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM projects
      WHERE id = ?
        AND NOT EXISTS (
          SELECT 1 FROM threads
          WHERE project_id = ? AND status NOT IN ('completed','failed','idle')
        )
        AND NOT EXISTS (
          SELECT 1 FROM notifications
          WHERE project_id = ? AND dismissed_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM github_issue_cache
          WHERE project_id = ? AND claimed_at IS NOT NULL
        )
    `);
    const result = stmt.run(id, id, id, id);
    return (result.changes ?? 0) > 0;
  }

  pin(id: string, pinned: boolean): void {
    this.db.prepare(`UPDATE projects SET pinned = ? WHERE id = ?`).run(pinned ? 1 : 0, id);
  }

  /**
   * Atomic archive: set archived=1 only if the project has no live work. The
   * idle predicate is enforced by the UPDATE statement itself via NOT EXISTS
   * subqueries, so there is no TOCTOU between the guard read and the mutation.
   * Returns true iff the project was archived.
   */
  archiveIfIdle(id: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE projects
      SET archived = 1, pinned = 0
      WHERE id = ?
        AND NOT EXISTS (
          SELECT 1 FROM threads
          WHERE project_id = ? AND status NOT IN ('completed','failed','idle')
        )
        AND NOT EXISTS (
          SELECT 1 FROM notifications
          WHERE project_id = ? AND dismissed_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM github_issue_cache
          WHERE project_id = ? AND claimed_at IS NOT NULL
        )
    `);
    const result = stmt.run(id, id, id, id);
    return (result.changes ?? 0) > 0;
  }

  unarchive(id: string): void {
    this.db.prepare(`UPDATE projects SET archived = 0 WHERE id = ?`).run(id);
  }

  /**
   * Fast pre-check used by project:remove to bail early (before slow async
   * worktree cleanup) if the project is clearly active. The final safety
   * guarantee comes from removeIfIdle's atomic DELETE.
   */
  hasLiveWork(id: string): boolean {
    const liveThread = this.db
      .prepare(
        `SELECT 1 FROM threads WHERE project_id = ? AND status NOT IN ('completed','failed','idle') LIMIT 1`,
      )
      .get(id);
    if (liveThread) return true;
    const liveNotif = this.db
      .prepare(`SELECT 1 FROM notifications WHERE project_id = ? AND dismissed_at IS NULL LIMIT 1`)
      .get(id);
    if (liveNotif) return true;
    const liveIssue = this.db
      .prepare(
        `SELECT 1 FROM github_issue_cache WHERE project_id = ? AND claimed_at IS NOT NULL LIMIT 1`,
      )
      .get(id);
    return !!liveIssue;
  }

  updateGitInfo(id: string, gitRemote: string | null, defaultBranch: string): void {
    this.db
      .prepare(
        `UPDATE projects SET git_remote = ?, default_branch = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(gitRemote, defaultBranch, id);
  }

  updateDefaultBranch(id: string, branch: string): void {
    this.db
      .prepare(`UPDATE projects SET default_branch = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
      .run(branch, id);
  }

  /**
   * Set the per-project GitHub Projects v2 URL override. Pass `null` to clear
   * (falls back to the repo Projects tab). Callers must validate the URL
   * with `validateGithubProjectUrl` before reaching this query — the DB layer
   * trusts what it gets.
   */
  updateGithubProjectUrl(id: string, url: string | null): void {
    this.db
      .prepare(
        `UPDATE projects SET github_project_url = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(url, id);
  }

  updateModelOverrides(
    id: string,
    overrides: {
      plannerModelOverride: string | null;
      reviewerModelOverride: string | null;
      executorModelOverride: string | null;
      verifierModelOverride: string | null;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE projects
           SET planner_model_override = ?,
               reviewer_model_override = ?,
               executor_model_override = ?,
               verifier_model_override = ?,
               updated_at = ${ISO_NOW_SQL}
         WHERE id = ?`,
      )
      .run(
        overrides.plannerModelOverride,
        overrides.reviewerModelOverride,
        overrides.executorModelOverride,
        overrides.verifierModelOverride,
        id,
      );
  }
}

function mapProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    gitRemote: row.git_remote,
    githubProjectUrl: row.github_project_url ?? null,
    plannerModelOverride: row.planner_model_override ?? null,
    reviewerModelOverride: row.reviewer_model_override ?? null,
    executorModelOverride: row.executor_model_override ?? null,
    verifierModelOverride: row.verifier_model_override ?? null,
    defaultBranch: row.default_branch,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
    updatedAt: toIsoUtc(row.updated_at) ?? row.updated_at,
  };
}
