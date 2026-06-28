import type { DatabaseSync } from 'node:sqlite';
import {
  AGENT_RUNNING_PHASES,
  type AnsweredClarification,
  answeredClarificationSchema,
  type ClarificationAnswer,
  type ClarificationRequest,
  clarificationAnswerSchema,
  clarificationRequestSchema,
  ISO_NOW_SQL,
  PIPELINE_PHASE,
  THREAD_KIND,
  type Thread,
  type ThreadKind,
  type ThreadStatus,
  toIsoUtc,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

interface ThreadRow {
  id: string;
  project_id: string;
  current_run_id: string | null;
  kind: ThreadKind;
  title: string;
  prompt: string;
  status: ThreadStatus;
  worktree_branch: string | null;
  worktree_path: string | null;
  planner_model: string | null;
  reviewer_model: string | null;
  verifier_model: string | null;
  executor_model: string | null;
  review_round: number | null;
  clarification_round: number | null;
  clarification_request: string | null;
  clarification_answers: string | null;
  answered_clarification: string | null;
  verification_status: string | null;
  verification_retries: number | null;
  autonomous: number | null;
  base_branch: string | null;
  fork_point_sha: string | null;
  github_issue_number: number | null;
  github_pr_number: number | null;
  github_repo: string | null;
  automation_id: string | null;
  last_error: string | null;
  failure_phase: string | null;
  failure_count: number;
  paused_phase: ThreadStatus | null;
  paused_at: string | null;
  created_at: string;
  updated_at: string;
  planner_resolved_model: string | null;
  reviewer_resolved_model: string | null;
  revisor_resolved_model: string | null;
  executor_resolved_model: string | null;
  verifier_resolved_model: string | null;
  total_tokens_prompt: number | null;
  total_tokens_completion: number | null;
  total_cost_usd: number | null;
  done_at: string | null;
  archived_at: string | null;
}

export class ThreadQueries {
  constructor(private db: DatabaseSync) {}

  list(projectId: string): Thread[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM threads WHERE project_id = ? AND kind = 'pipeline' AND archived_at IS NULL ORDER BY updated_at DESC",
      )
      .all(projectId);
    return asRows<ThreadRow>(rows).map(mapThread);
  }

  listByAutomationId(automationId: string): Thread[] {
    const rows = this.db
      .prepare('SELECT * FROM threads WHERE automation_id = ? ORDER BY created_at DESC')
      .all(automationId);
    return asRows<ThreadRow>(rows).map(mapThread);
  }

  hasActiveForAutomation(automationId: string, projectId?: string): boolean {
    // When projectId is given, the guard is scoped to one target repo so a
    // multi-repo automation can run a different target concurrently.
    if (projectId !== undefined) {
      const row = this.db
        .prepare(
          "SELECT 1 FROM threads WHERE automation_id = ? AND project_id = ? AND status NOT IN ('idle', 'completed', 'failed') LIMIT 1",
        )
        .get(automationId, projectId);
      return !!row;
    }
    const row = this.db
      .prepare(
        "SELECT 1 FROM threads WHERE automation_id = ? AND status NOT IN ('idle', 'completed', 'failed') LIMIT 1",
      )
      .get(automationId);
    return !!row;
  }

  getById(id: string): Thread | null {
    const row = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id);
    return row ? mapThread(asRow<ThreadRow>(row)) : null;
  }

  getByProjectAndGithubIssue(projectId: string, issueNumber: number): Thread | null {
    const row = this.db
      .prepare(
        `SELECT *
           FROM threads
          WHERE project_id = ?
            AND github_issue_number = ?
          ORDER BY updated_at DESC, created_at DESC, id DESC
          LIMIT 1`,
      )
      .get(projectId, issueNumber);
    return row ? mapThread(asRow<ThreadRow>(row)) : null;
  }

  create(
    projectId: string,
    prompt: string,
    title: string,
    kind: ThreadKind = THREAD_KIND.pipeline,
  ): Thread {
    const id = nanoid();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO threads (id, project_id, kind, title, prompt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, projectId, kind, title, prompt, now, now);

    const thread = this.getById(id);
    if (!thread) {
      throw new Error(`Failed to load thread after insert: ${id}`);
    }
    return thread;
  }

  updateStatus(id: string, status: ThreadStatus, lastError?: string): void {
    if (status === PIPELINE_PHASE.paused) {
      const current = this.getById(id);
      const pausedPhase =
        current?.status && current.status !== PIPELINE_PHASE.paused
          ? current.status
          : current?.pausedPhase;
      this.db
        .prepare(
          `UPDATE threads
              SET status = ?,
                  paused_phase = ?,
                  paused_at = ${ISO_NOW_SQL},
                  last_error = ?,
                  updated_at = ${ISO_NOW_SQL}
            WHERE id = ?`,
        )
        .run(status, pausedPhase ?? null, lastError ?? null, id);
      return;
    }

    if (lastError !== undefined) {
      this.db
        .prepare(
          `UPDATE threads
              SET status = ?,
                  last_error = ?,
                  paused_phase = NULL,
                  paused_at = NULL,
                  updated_at = ${ISO_NOW_SQL}
            WHERE id = ?`,
        )
        .run(status, lastError, id);
    } else {
      this.db
        .prepare(
          `UPDATE threads
              SET status = ?,
                  last_error = NULL,
                  paused_phase = NULL,
                  paused_at = NULL,
                  updated_at = ${ISO_NOW_SQL}
            WHERE id = ?`,
        )
        .run(status, id);
    }
  }

  markDone(id: string): void {
    this.db
      .prepare(
        `UPDATE threads SET done_at = ${ISO_NOW_SQL}, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(id);
  }

  clearDoneAt(id: string): void {
    this.db
      .prepare(`UPDATE threads SET done_at = NULL, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
      .run(id);
  }

  archiveClosedAutomationRuns(projectId: string): number {
    const result = this.db
      .prepare(
        `UPDATE threads
            SET archived_at = ${ISO_NOW_SQL}, updated_at = ${ISO_NOW_SQL}
          WHERE project_id = ?
            AND kind = ?
            AND automation_id IS NOT NULL
            AND archived_at IS NULL
            AND done_at IS NOT NULL`,
      )
      .run(projectId, THREAD_KIND.pipeline);
    return Number(result.changes);
  }

  recordFailure(id: string, failurePhase: string, lastError?: string): void {
    this.db
      .prepare(
        `UPDATE threads
            SET status = ?,
                last_error = ?,
                failure_phase = ?,
                failure_count = failure_count + 1,
                paused_phase = NULL,
                paused_at = NULL,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(PIPELINE_PHASE.failed, lastError ?? null, failurePhase, id);
  }

  resetFailureTracking(id: string): void {
    this.db
      .prepare(
        `UPDATE threads SET failure_phase = NULL, failure_count = 0, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(id);
  }

  setWorktree(id: string, branch: string, worktreePath: string): void {
    this.db
      .prepare(
        `UPDATE threads SET worktree_branch = ?, worktree_path = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(branch, worktreePath, id);
  }

  clearWorktree(id: string): void {
    this.db
      .prepare(
        `UPDATE threads SET worktree_branch = NULL, worktree_path = NULL, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(id);
  }

  updateAutonomousFields(
    id: string,
    fields: {
      autonomous: boolean;
      reviewRound: number;
      executorModel: string;
      baseBranch: string;
      forkPointSha: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE threads SET autonomous = ?, review_round = ?, executor_model = ?, base_branch = ?, fork_point_sha = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(
        fields.autonomous ? 1 : 0,
        fields.reviewRound,
        fields.executorModel,
        fields.baseBranch,
        fields.forkPointSha,
        id,
      );
  }

  incrementReviewRound(id: string): void {
    this.db
      .prepare(
        `UPDATE threads SET review_round = review_round + 1, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(id);
  }

  setClarificationRequest(id: string, request: ClarificationRequest, round: number): void {
    this.db
      .prepare(
        `UPDATE threads
            SET clarification_request = ?,
                clarification_answers = '[]',
                answered_clarification = NULL,
                clarification_round = ?,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(JSON.stringify(request), round, id);
  }

  resolveClarification(
    id: string,
    request: ClarificationRequest,
    answers: ClarificationAnswer[],
  ): void {
    const snapshot: AnsweredClarification = { request, answers };
    this.db
      .prepare(
        `UPDATE threads
            SET clarification_request = NULL,
                clarification_answers = '[]',
                answered_clarification = ?,
                clarification_round = 0,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(JSON.stringify(snapshot), id);
  }

  clearPendingClarification(id: string): void {
    this.db
      .prepare(
        `UPDATE threads
            SET clarification_request = NULL,
                clarification_answers = '[]',
                clarification_round = 0,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(id);
  }

  clearClarification(id: string): void {
    this.db
      .prepare(
        `UPDATE threads
            SET clarification_request = NULL,
                clarification_answers = '[]',
                answered_clarification = NULL,
                clarification_round = 0,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(id);
  }

  setGithubIssue(id: string, issueNumber: number, repo: string | null): void {
    this.db
      .prepare(
        `UPDATE threads SET github_issue_number = ?, github_repo = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(issueNumber, repo, id);
  }

  /**
   * Stamp `github_issue_number` without touching `github_repo`. Used by quick
   * mode to link a thread to its synthetic negative-sentinel cache row, where
   * there is no GitHub repo association.
   */
  setGithubIssueNumber(id: string, issueNumber: number): void {
    this.db
      .prepare(
        `UPDATE threads SET github_issue_number = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(issueNumber, id);
  }

  updateIssueContent(id: string, prompt: string, title: string): void {
    this.db
      .prepare(
        `UPDATE threads
            SET prompt = ?,
                title = ?,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(prompt, title, id);
  }

  setGithubPr(id: string, prNumber: number): void {
    this.db
      .prepare(`UPDATE threads SET github_pr_number = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
      .run(prNumber, id);
  }

  setAutomationId(id: string, automationId: string | null): void {
    this.db
      .prepare(`UPDATE threads SET automation_id = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
      .run(automationId, id);
  }

  setPhaseModels(
    id: string,
    fields: {
      plannerModel: string;
      reviewerModel: string;
      verifierModel: string;
      executorModel: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE threads
           SET planner_model = ?,
               reviewer_model = ?,
               verifier_model = ?,
               executor_model = ?,
               updated_at = ${ISO_NOW_SQL}
         WHERE id = ?`,
      )
      .run(
        fields.plannerModel,
        fields.reviewerModel,
        fields.verifierModel,
        fields.executorModel,
        id,
      );
  }

  /**
   * Persist what model actually served a given phase. For
   * openrouter/auto runs this captures whatever the meta-router
   * ultimately picked (e.g. 'anthropic/claude-sonnet-4-6'); for
   * claude/codex it just holds the CLI name.
   */
  setResolvedModel(
    id: string,
    phase: 'plan' | 'review' | 'revision' | 'execute' | 'verify',
    model: string,
  ): void {
    const column = (() => {
      switch (phase) {
        case 'plan':
          return 'planner_resolved_model';
        case 'review':
          return 'reviewer_resolved_model';
        case 'revision':
          return 'revisor_resolved_model';
        case 'execute':
          return 'executor_resolved_model';
        case 'verify':
          return 'verifier_resolved_model';
      }
    })();
    this.db
      .prepare(`UPDATE threads SET ${column} = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`)
      .run(model, id);
  }

  /**
   * Accumulate token + cost usage for a thread. Called after each
   * provider call that reports usage. Uses SQL-side arithmetic so
   * concurrent writers can't lose counts.
   */
  addTokenUsage(id: string, promptTokens: number, completionTokens: number, costUsd: number): void {
    this.db
      .prepare(
        `UPDATE threads SET
         total_tokens_prompt = total_tokens_prompt + ?,
         total_tokens_completion = total_tokens_completion + ?,
         total_cost_usd = total_cost_usd + ?,
         updated_at = ${ISO_NOW_SQL}
       WHERE id = ?`,
      )
      .run(promptTokens, completionTokens, costUsd, id);
  }

  hasActivePipeline(projectId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM threads WHERE project_id = ? AND status IN (${Array(AGENT_RUNNING_PHASES.length).fill('?').join(',')}) LIMIT 1`,
      )
      .get(projectId, ...AGENT_RUNNING_PHASES);
    return !!row;
  }

  getOrphaned(): Thread[] {
    return asRows<ThreadRow>(
      this.db
        .prepare(
          `SELECT * FROM threads WHERE status IN (${Array(AGENT_RUNNING_PHASES.length).fill('?').join(',')})`,
        )
        .all(...AGENT_RUNNING_PHASES),
    ).map(mapThread);
  }

  /** Find approval threads whose latest plan is approved (execution-queued), oldest first. */
  listAwaitingWithApprovedPlans(): Thread[] {
    const rows = this.db
      .prepare(
        `SELECT t.* FROM threads t
         INNER JOIN plans p ON p.thread_id = t.id
           AND p.status = 'approved'
           AND p.version = (SELECT MAX(p2.version) FROM plans p2 WHERE p2.thread_id = t.id)
         WHERE t.status = ?
         ORDER BY t.updated_at ASC
        `,
      )
      .all(PIPELINE_PHASE.approval);
    return asRows<ThreadRow>(rows).map(mapThread);
  }

  /** Find the oldest thread in approval whose latest plan is approved (execution-queued). */
  getAwaitingWithApprovedPlan(): Thread | null {
    return this.listAwaitingWithApprovedPlans()[0] ?? null;
  }

  getStuck(thresholdMs: number): Thread[] {
    const thresholdSec = Math.floor(thresholdMs / 1000);
    const rows = this.db
      .prepare(
        `SELECT * FROM threads
         WHERE status IN (${Array(AGENT_RUNNING_PHASES.length).fill('?').join(',')})
           AND updated_at <= datetime('now', '-' || ? || ' seconds')`,
      )
      .all(...AGENT_RUNNING_PHASES, thresholdSec);
    return asRows<ThreadRow>(rows).map(mapThread);
  }

  listInstant(): Thread[] {
    const rows = this.db
      .prepare("SELECT * FROM threads WHERE kind = 'instant' ORDER BY updated_at DESC")
      .all();
    return asRows<ThreadRow>(rows).map(mapThread);
  }

  /**
   * Delete threads of a given kind older than `days` days.
   * Returns the number of rows deleted. `terminal_events` cascade automatically.
   */
  deleteOlderThan(kind: ThreadKind, days: number): number {
    const result = this.db
      .prepare(
        `DELETE FROM threads
         WHERE kind = ?
           AND julianday('now') - julianday(updated_at) > ?`,
      )
      .run(kind, days);
    return Number(result.changes);
  }
}

function mapThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    projectId: row.project_id,
    currentRunId: row.current_run_id ?? null,
    kind: row.kind,
    title: row.title,
    prompt: row.prompt,
    status: row.status as ThreadStatus,
    worktreeBranch: row.worktree_branch,
    worktreePath: row.worktree_path,
    plannerModel: row.planner_model as string,
    reviewerModel: row.reviewer_model as string,
    verifierModel: row.verifier_model as string,
    executorModel: row.executor_model as string,
    reviewRound: row.review_round ?? 0,
    clarificationRound: row.clarification_round as number,
    clarificationRequest: parseClarificationRequest(row.clarification_request),
    clarificationAnswers: parseClarificationAnswers(row.clarification_answers),
    answeredClarification: parseAnsweredClarification(row.answered_clarification),
    verificationStatus: row.verification_status ?? null,
    verificationRetries: row.verification_retries ?? 0,
    autonomous: !!row.autonomous,
    baseBranch: row.base_branch ?? null,
    forkPointSha: row.fork_point_sha ?? null,
    githubIssueNumber: row.github_issue_number ?? null,
    githubPrNumber: row.github_pr_number ?? null,
    githubRepo: row.github_repo ?? null,
    automationId: row.automation_id ?? null,
    lastError: row.last_error ?? null,
    failurePhase: row.failure_phase ?? null,
    failureCount: row.failure_count,
    pausedPhase: row.paused_phase ?? null,
    pausedAt: row.paused_at ? toIsoUtc(row.paused_at) : null,
    createdAt: toIsoUtc(row.created_at) as string,
    updatedAt: toIsoUtc(row.updated_at) as string,
    plannerResolvedModel: row.planner_resolved_model ?? null,
    reviewerResolvedModel: row.reviewer_resolved_model ?? null,
    revisorResolvedModel: row.revisor_resolved_model ?? null,
    executorResolvedModel: row.executor_resolved_model ?? null,
    verifierResolvedModel: row.verifier_resolved_model ?? null,
    totalTokensPrompt: row.total_tokens_prompt as number,
    totalTokensCompletion: row.total_tokens_completion as number,
    totalCostUsd: row.total_cost_usd as number,
    doneAt: row.done_at ?? null,
    archivedAt: row.archived_at ?? null,
  };
}

function parseClarificationRequest(value: string | null): ClarificationRequest | null {
  if (!value) return null;
  try {
    return clarificationRequestSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

function parseClarificationAnswers(value: string | null): ClarificationAnswer[] {
  if (!value) return [];
  try {
    return JSON.parse(value)
      .map((entry: unknown) => clarificationAnswerSchema.parse(entry))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseAnsweredClarification(value: string | null): AnsweredClarification | null {
  if (!value) return null;
  try {
    return answeredClarificationSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}
