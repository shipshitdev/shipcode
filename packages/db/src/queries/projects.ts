import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  type AgentType,
  type GhStatusMapping,
  type GhStatusOption,
  ISO_NOW_SQL,
  ISSUE_PIPELINE_STATUS,
  type Project,
  toIsoUtc,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface ProjectIdleGuardOptions {
  /**
   * Missing-repo cleanup escape hatch: still block genuinely running work
   * (non-terminal threads), but ignore stale attention records that only exist
   * to drive inbox badges / claimed-issue ownership.
   */
  ignoreAttentionOnly?: boolean;
}

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  git_remote: string | null;
  github_repo_id: string | null;
  github_repo_full_name: string | null;
  starter_issue_number: number | null;
  starter_issue_created_at: string | null;
  github_project_url: string | null;
  github_status_mapping: string | null;
  planner_model_override: AgentType | null;
  reviewer_model_override: AgentType | null;
  executor_model_override: AgentType | null;
  verifier_model_override: AgentType | null;
  planner_model_id_override: string | null;
  reviewer_model_id_override: string | null;
  executor_model_id_override: string | null;
  verifier_model_id_override: string | null;
  planner_reasoning_effort_override: Project['plannerReasoningEffortOverride'];
  reviewer_reasoning_effort_override: Project['reviewerReasoningEffortOverride'];
  executor_reasoning_effort_override: Project['executorReasoningEffortOverride'];
  verifier_reasoning_effort_override: Project['verifierReasoningEffortOverride'];
  revision_count_override: Project['revisionCountOverride'];
  require_approval_override: number | null;
  pipeline_speed_profile_override: Project['pipelineSpeedProfileOverride'];
  prd_quality_gate: number | null;
  discord_routing: Project['discordRouting'];
  discord_webhook_url_override: string | null;
  telegram_routing: Project['telegramRouting'];
  telegram_chat_id_override: string | null;
  default_branch: string;
  pinned: number;
  archived: number;
  hidden: number;
  notify_github_user: string | null;
  created_at: string;
  updated_at: string;
}

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
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
    return asRows<ProjectRow>(rows).map(mapProject);
  }

  /**
   * Non-archived projects, for the sidebar's visible project list.
   */
  listVisible(): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE archived = 0 AND hidden = 0 ORDER BY updated_at DESC')
      .all();
    return asRows<ProjectRow>(rows).map(mapProject);
  }

  /**
   * Archived projects only, for the Settings → Archived panel.
   */
  listArchived(): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE archived = 1 ORDER BY name ASC')
      .all();
    return asRows<ProjectRow>(rows).map(mapProject);
  }

  getById(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row ? mapProject(asRow<ProjectRow>(row)) : null;
  }

  getByPath(projectPath: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE path = ? LIMIT 1').get(projectPath);
    return row ? mapProject(asRow<ProjectRow>(row)) : null;
  }

  /**
   * Idempotent add: if a row already exists for this path, restore it (unarchive
   * + bump updated_at) and return it. Prevents UNIQUE(path) violations when
   * re-adding an archived project from the CLI or Add Repository dialog.
   */
  add(
    projectPath: string,
    options?: {
      githubRepoId?: string | null;
      githubRepoFullName?: string | null;
    },
  ): Project {
    const existing = this.getByPath(projectPath);
    if (existing) {
      this.db
        .prepare(`UPDATE projects SET archived = 0, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
        .run(existing.id);
      if (options?.githubRepoId || options?.githubRepoFullName) {
        this.updateGithubRepoIdentity(existing.id, {
          githubRepoId: options?.githubRepoId ?? null,
          githubRepoFullName: options?.githubRepoFullName ?? null,
        });
      }
      // Reset stale queued issues so they don't auto-start pipelines on restore.
      this.db
        .prepare(
          `UPDATE github_issue_cache
             SET pipeline_status = ?, last_phase_update = NULL
           WHERE project_id = ?
             AND pipeline_status = ?
             AND claimed_at IS NULL`,
        )
        .run(ISSUE_PIPELINE_STATUS.todo, existing.id, ISSUE_PIPELINE_STATUS.queued);
      const restored = this.getById(existing.id);
      if (!restored) {
        throw new Error(`Failed to load restored project: ${existing.id}`);
      }
      return restored;
    }

    const id = nanoid();
    const name = path.basename(projectPath);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO projects (
          id,
          name,
          path,
          github_repo_id,
          github_repo_full_name,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        name,
        projectPath,
        options?.githubRepoId ?? null,
        options?.githubRepoFullName ?? null,
        now,
        now,
      );

    const created = this.getById(id);
    if (!created) {
      throw new Error(`Failed to load project after insert: ${id}`);
    }
    return created;
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
  removeIfIdle(id: string, options: ProjectIdleGuardOptions = {}): boolean {
    const attentionOnlyGuards = options.ignoreAttentionOnly
      ? ''
      : `
        AND NOT EXISTS (
          SELECT 1 FROM notifications
          WHERE project_id = ? AND dismissed_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM github_issue_cache
          WHERE project_id = ? AND claimed_at IS NOT NULL
        )
      `;
    const stmt = this.db.prepare(`
      DELETE FROM projects
      WHERE id = ?
        AND NOT EXISTS (
          SELECT 1 FROM threads
          WHERE project_id = ? AND status NOT IN ('completed','failed','idle')
        )
        ${attentionOnlyGuards}
    `);
    const result = options.ignoreAttentionOnly ? stmt.run(id, id) : stmt.run(id, id, id, id);
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
  archiveIfIdle(id: string, options: ProjectIdleGuardOptions = {}): boolean {
    const attentionOnlyGuards = options.ignoreAttentionOnly
      ? ''
      : `
        AND NOT EXISTS (
          SELECT 1 FROM notifications
          WHERE project_id = ? AND dismissed_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM github_issue_cache
          WHERE project_id = ? AND claimed_at IS NOT NULL
        )
      `;
    const stmt = this.db.prepare(`
      UPDATE projects
      SET archived = 1, pinned = 0
      WHERE id = ?
        AND NOT EXISTS (
          SELECT 1 FROM threads
          WHERE project_id = ? AND status NOT IN ('completed','failed','idle')
        )
        ${attentionOnlyGuards}
    `);
    const result = options.ignoreAttentionOnly ? stmt.run(id, id) : stmt.run(id, id, id, id);
    return (result.changes ?? 0) > 0;
  }

  unarchive(id: string): void {
    this.db.prepare(`UPDATE projects SET archived = 0 WHERE id = ?`).run(id);
    // Reset stale queued issues so they don't auto-start pipelines on unarchive.
    this.db
      .prepare(
        `UPDATE github_issue_cache
           SET pipeline_status = ?, last_phase_update = NULL
         WHERE project_id = ?
           AND pipeline_status = ?
           AND claimed_at IS NULL`,
      )
      .run(ISSUE_PIPELINE_STATUS.todo, id, ISSUE_PIPELINE_STATUS.queued);
  }

  /** Stable path for instant fix threads. The project is hidden from the sidebar. */
  static readonly INSTANT_PROJECT_NAME = '__instant__';

  getOrCreateInstantProject(homedir: string): Project {
    const existing = this.db
      .prepare(`SELECT * FROM projects WHERE name = ? LIMIT 1`)
      .get(ProjectQueries.INSTANT_PROJECT_NAME);
    if (existing) return mapProject(asRow<ProjectRow>(existing));

    const id = nanoid();
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO projects (id, name, path, hidden, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      )
      .run(id, ProjectQueries.INSTANT_PROJECT_NAME, homedir, now, now);

    const created = this.getById(id);
    if (!created) throw new Error('Failed to create instant project');
    return created;
  }

  /**
   * Fast pre-check used by project:remove to bail early (before slow async
   * worktree cleanup) if the project is clearly active. The final safety
   * guarantee comes from removeIfIdle's atomic DELETE.
   */
  hasLiveWork(id: string, options: ProjectIdleGuardOptions = {}): boolean {
    const liveThread = this.db
      .prepare(
        `SELECT 1 FROM threads WHERE project_id = ? AND status NOT IN ('completed','failed','idle') LIMIT 1`,
      )
      .get(id);
    if (liveThread) return true;
    if (options.ignoreAttentionOnly) return false;
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

  getByGithubRepoIdentity(
    githubRepoId: string | null,
    githubRepoFullName: string | null,
  ): Project | null {
    if (githubRepoId) {
      const row = this.db
        .prepare('SELECT * FROM projects WHERE github_repo_id = ? ORDER BY updated_at DESC LIMIT 1')
        .get(githubRepoId);
      if (row) return mapProject(asRow<ProjectRow>(row));
    }
    if (githubRepoFullName) {
      const row = this.db
        .prepare(
          'SELECT * FROM projects WHERE github_repo_full_name = ? ORDER BY updated_at DESC LIMIT 1',
        )
        .get(githubRepoFullName);
      if (row) return mapProject(asRow<ProjectRow>(row));
    }
    return null;
  }

  updateGithubRepoIdentity(
    id: string,
    fields: { githubRepoId: string | null; githubRepoFullName: string | null },
  ): void {
    this.db
      .prepare(
        `UPDATE projects
            SET github_repo_id = ?,
                github_repo_full_name = ?,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(fields.githubRepoId, fields.githubRepoFullName, id);
  }

  markStarterIssueSeeded(
    id: string,
    fields: { starterIssueNumber: number | null; starterIssueCreatedAt?: string | null },
  ): void {
    this.db
      .prepare(
        `UPDATE projects
            SET starter_issue_number = ?,
                starter_issue_created_at = COALESCE(?, ${ISO_NOW_SQL}),
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(fields.starterIssueNumber, fields.starterIssueCreatedAt ?? null, id);
  }

  updateDefaultBranch(id: string, branch: string): void {
    this.db
      .prepare(`UPDATE projects SET default_branch = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
      .run(branch, id);
  }

  updateGitRemote(id: string, remote: string | null): void {
    this.db
      .prepare(`UPDATE projects SET git_remote = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
      .run(remote, id);
  }

  updateName(id: string, name: string): void {
    this.db
      .prepare(`UPDATE projects SET name = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
      .run(name, id);
  }

  updatePath(id: string, projectPath: string): void {
    this.db
      .prepare(`UPDATE projects SET path = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
      .run(projectPath, id);
  }

  /**
   * Set the per-project GitHub Projects v2 URL override. Pass `null` to clear
   * (which hides the Kanban `board` quick-link). Callers must validate the URL
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

  /**
   * Store the auto-detected mapping from ShipCode macro columns to GH Projects
   * v2 Status field option names for this project.
   */
  setGithubStatusMapping(id: string, mapping: GhStatusMapping): void {
    this.db
      .prepare(
        `UPDATE projects SET github_status_mapping = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(JSON.stringify(mapping), id);
  }

  clearGithubStatusMapping(id: string): void {
    this.db
      .prepare(
        `UPDATE projects SET github_status_mapping = NULL, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(id);
  }

  updateNotifyGithubUser(id: string, handle: string | null): void {
    this.db
      .prepare(
        `UPDATE projects SET notify_github_user = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(handle || null, id);
  }

  updateModelOverrides(
    id: string,
    overrides: {
      plannerModelOverride: string | null;
      reviewerModelOverride: string | null;
      executorModelOverride: string | null;
      verifierModelOverride: string | null;
      plannerModelIdOverride: string | null;
      reviewerModelIdOverride: string | null;
      executorModelIdOverride: string | null;
      verifierModelIdOverride: string | null;
      plannerReasoningEffortOverride: Project['plannerReasoningEffortOverride'];
      reviewerReasoningEffortOverride: Project['reviewerReasoningEffortOverride'];
      executorReasoningEffortOverride: Project['executorReasoningEffortOverride'];
      verifierReasoningEffortOverride: Project['verifierReasoningEffortOverride'];
      revisionCountOverride: Project['revisionCountOverride'];
      requireApprovalOverride: Project['requireApprovalOverride'];
      pipelineSpeedProfileOverride: Project['pipelineSpeedProfileOverride'];
      prdQualityGate: Project['prdQualityGate'];
    },
  ): void {
    if (
      overrides.pipelineSpeedProfileOverride != null &&
      overrides.pipelineSpeedProfileOverride !== 'smart_fast' &&
      overrides.pipelineSpeedProfileOverride !== 'thorough'
    ) {
      throw new Error('pipelineSpeedProfileOverride must be smart_fast|thorough|null');
    }
    this.db
      .prepare(
        `UPDATE projects
           SET planner_model_override = ?,
               reviewer_model_override = ?,
               executor_model_override = ?,
               verifier_model_override = ?,
               planner_model_id_override = ?,
               reviewer_model_id_override = ?,
               executor_model_id_override = ?,
               verifier_model_id_override = ?,
               planner_reasoning_effort_override = ?,
               reviewer_reasoning_effort_override = ?,
               executor_reasoning_effort_override = ?,
               verifier_reasoning_effort_override = ?,
               revision_count_override = ?,
               require_approval_override = ?,
               pipeline_speed_profile_override = ?,
               prd_quality_gate = ?,
               updated_at = ${ISO_NOW_SQL}
         WHERE id = ?`,
      )
      .run(
        overrides.plannerModelOverride,
        overrides.reviewerModelOverride,
        overrides.executorModelOverride,
        overrides.verifierModelOverride,
        overrides.plannerModelIdOverride,
        overrides.reviewerModelIdOverride,
        overrides.executorModelIdOverride,
        overrides.verifierModelIdOverride,
        overrides.plannerReasoningEffortOverride,
        overrides.reviewerReasoningEffortOverride,
        overrides.executorReasoningEffortOverride,
        overrides.verifierReasoningEffortOverride,
        overrides.revisionCountOverride,
        overrides.requireApprovalOverride == null
          ? null
          : Number(overrides.requireApprovalOverride),
        overrides.pipelineSpeedProfileOverride ?? null,
        overrides.prdQualityGate == null ? null : Number(overrides.prdQualityGate),
        id,
      );
  }

  updateNotificationRouting(
    id: string,
    routing: import('@shipcode/shared').ProjectNotificationRouting,
  ) {
    this.db
      .prepare(
        `UPDATE projects
           SET discord_routing = ?,
               discord_webhook_url_override = ?,
               telegram_routing = ?,
               telegram_chat_id_override = ?,
               updated_at = ${ISO_NOW_SQL}
         WHERE id = ?`,
      )
      .run(
        routing.discordRouting,
        routing.discordWebhookUrlOverride,
        routing.telegramRouting,
        routing.telegramChatIdOverride,
        id,
      );
  }
}

/**
 * Migrate old flat-string `GhStatusMapping` values (pre-color) to the new
 * `GhStatusOption` shape. Old rows stored `"Todo"` directly; new rows store
 * `{ name: "Todo", color: "GREEN" }`.
 */
function migrateStatusMapping(raw: unknown): GhStatusMapping {
  if (raw === null || typeof raw !== 'object') {
    return { todo: null, inProgress: null, humanReview: null, done: null };
  }
  const obj = raw as Record<string, unknown>;
  function toOption(v: unknown): GhStatusOption | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return { name: v, color: null };
    if (typeof v === 'object' && v !== null && 'name' in v) {
      const obj = v as Record<string, unknown>;
      if (typeof obj.name !== 'string') return null;
      const color = typeof obj.color === 'string' ? obj.color : null;
      return { name: obj.name, color };
    }
    return null;
  }
  return {
    todo: toOption(obj.todo),
    inProgress: toOption(obj.inProgress),
    humanReview: toOption(obj.humanReview),
    done: toOption(obj.done),
  };
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    gitRemote: row.git_remote,
    githubRepoId: row.github_repo_id ?? null,
    githubRepoFullName: row.github_repo_full_name ?? null,
    starterIssueNumber: row.starter_issue_number ?? null,
    starterIssueCreatedAt: toIsoUtc(row.starter_issue_created_at) ?? row.starter_issue_created_at,
    githubProjectUrl: row.github_project_url ?? null,
    githubStatusMapping: row.github_status_mapping
      ? migrateStatusMapping(JSON.parse(row.github_status_mapping))
      : null,
    plannerModelOverride: row.planner_model_override ?? null,
    reviewerModelOverride: row.reviewer_model_override ?? null,
    executorModelOverride: row.executor_model_override ?? null,
    verifierModelOverride: row.verifier_model_override ?? null,
    plannerModelIdOverride: row.planner_model_id_override ?? null,
    reviewerModelIdOverride: row.reviewer_model_id_override ?? null,
    executorModelIdOverride: row.executor_model_id_override ?? null,
    verifierModelIdOverride: row.verifier_model_id_override ?? null,
    plannerReasoningEffortOverride: row.planner_reasoning_effort_override ?? null,
    reviewerReasoningEffortOverride: row.reviewer_reasoning_effort_override ?? null,
    executorReasoningEffortOverride: row.executor_reasoning_effort_override ?? null,
    verifierReasoningEffortOverride: row.verifier_reasoning_effort_override ?? null,
    revisionCountOverride: row.revision_count_override ?? null,
    requireApprovalOverride:
      row.require_approval_override == null ? null : row.require_approval_override === 1,
    pipelineSpeedProfileOverride: row.pipeline_speed_profile_override ?? null,
    prdQualityGate: row.prd_quality_gate == null ? null : row.prd_quality_gate === 1,
    discordRouting: row.discord_routing ?? 'inherit',
    discordWebhookUrlOverride: row.discord_webhook_url_override ?? null,
    telegramRouting: row.telegram_routing ?? 'inherit',
    telegramChatIdOverride: row.telegram_chat_id_override ?? null,
    defaultBranch: row.default_branch,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    hidden: row.hidden === 1,
    notifyGithubUser: row.notify_github_user ?? null,
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
    updatedAt: toIsoUtc(row.updated_at) ?? row.updated_at,
  };
}
