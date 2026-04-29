import type { DatabaseSync } from 'node:sqlite';
import {
  type AnsweredClarification,
  answeredClarificationSchema,
  type ClarificationAnswer,
  type ClarificationRequest,
  clarificationAnswerSchema,
  clarificationRequestSchema,
  ISO_NOW_SQL,
  PIPELINE_PHASE,
  type Thread,
  type ThreadKind,
  type ThreadStatus,
  toIsoUtc,
} from '@shipcode/shared';
import { nanoid } from 'nanoid';
import { asRow, asRows } from '../utils';

const STUCK_THREAD_PHASES: ThreadStatus[] = [
  PIPELINE_PHASE.planning,
  PIPELINE_PHASE.reviewing,
  PIPELINE_PHASE.revising,
  PIPELINE_PHASE.executing,
  PIPELINE_PHASE.testing,
  PIPELINE_PHASE.verifying,
  PIPELINE_PHASE.shipping,
];

interface ThreadRow {
  id: string;
  project_id: string;
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
}

export class ThreadQueries {
  constructor(private db: DatabaseSync) {}

  list(projectId: string): Thread[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM threads WHERE project_id = ? AND kind = 'pipeline' ORDER BY updated_at DESC",
      )
      .all(projectId);
    return asRows<ThreadRow>(rows).map(mapThread);
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

  create(projectId: string, prompt: string, title: string, kind: ThreadKind = 'pipeline'): Thread {
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
    if (lastError !== undefined) {
      this.db
        .prepare(
          `UPDATE threads SET status = ?, last_error = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
        )
        .run(status, lastError, id);
    } else {
      this.db
        .prepare(
          `UPDATE threads SET status = ?, last_error = NULL, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
        )
        .run(status, id);
    }
  }

  recordFailure(id: string, failurePhase: string, lastError?: string): void {
    this.db
      .prepare(
        `UPDATE threads SET status = ?, last_error = ?, failure_phase = ?, failure_count = failure_count + 1, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
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

  setClarificationAnswers(id: string, answers: ClarificationAnswer[]): void {
    this.db
      .prepare(
        `UPDATE threads
            SET clarification_answers = ?,
                updated_at = ${ISO_NOW_SQL}
          WHERE id = ?`,
      )
      .run(JSON.stringify(answers), id);
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

  setVerificationStatus(id: string, status: string): void {
    this.db
      .prepare(
        `UPDATE threads SET verification_status = ?, updated_at = ${ISO_NOW_SQL} WHERE id = ?`,
      )
      .run(status, id);
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
        `SELECT 1 FROM threads WHERE project_id = ? AND status IN (${Array(STUCK_THREAD_PHASES.length).fill('?').join(',')}) LIMIT 1`,
      )
      .get(projectId, ...STUCK_THREAD_PHASES);
    return !!row;
  }

  getOrphaned(): Thread[] {
    return asRows<ThreadRow>(
      this.db
        .prepare(
          `SELECT * FROM threads WHERE status IN (${Array(STUCK_THREAD_PHASES.length).fill('?').join(',')})`,
        )
        .all(...STUCK_THREAD_PHASES),
    ).map(mapThread);
  }

  /** Find awaiting_approval threads whose latest plan is approved (execution-queued), oldest first. */
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
      .all(PIPELINE_PHASE.awaitingApproval);
    return asRows<ThreadRow>(rows).map(mapThread);
  }

  /** Find the oldest thread in awaiting_approval whose latest plan is approved (execution-queued). */
  getAwaitingWithApprovedPlan(): Thread | null {
    return this.listAwaitingWithApprovedPlans()[0] ?? null;
  }

  getStuck(thresholdMs: number): Thread[] {
    const thresholdSec = Math.floor(thresholdMs / 1000);
    const rows = this.db
      .prepare(
        `SELECT * FROM threads
         WHERE status IN (${Array(STUCK_THREAD_PHASES.length).fill('?').join(',')})
           AND updated_at <= datetime('now', '-' || ? || ' seconds')`,
      )
      .all(...STUCK_THREAD_PHASES, thresholdSec);
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
    return Number(result.changes ?? 0);
  }
}

function mapThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind ?? 'pipeline',
    title: row.title,
    prompt: row.prompt,
    status: row.status as ThreadStatus,
    worktreeBranch: row.worktree_branch,
    worktreePath: row.worktree_path,
    plannerModel: row.planner_model ?? 'claude',
    reviewerModel: row.reviewer_model ?? 'claude',
    verifierModel: row.verifier_model ?? 'claude',
    executorModel: row.executor_model ?? 'claude',
    reviewRound: row.review_round ?? 0,
    clarificationRound: row.clarification_round ?? 0,
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
    failureCount: row.failure_count ?? 0,
    createdAt: toIsoUtc(row.created_at) ?? row.created_at,
    updatedAt: toIsoUtc(row.updated_at) ?? row.updated_at,
    plannerResolvedModel: row.planner_resolved_model ?? null,
    reviewerResolvedModel: row.reviewer_resolved_model ?? null,
    revisorResolvedModel: row.revisor_resolved_model ?? null,
    executorResolvedModel: row.executor_resolved_model ?? null,
    verifierResolvedModel: row.verifier_resolved_model ?? null,
    totalTokensPrompt: row.total_tokens_prompt ?? 0,
    totalTokensCompletion: row.total_tokens_completion ?? 0,
    totalCostUsd: row.total_cost_usd ?? 0,
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
