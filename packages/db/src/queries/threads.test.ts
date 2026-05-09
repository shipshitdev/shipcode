import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { AutomationQueries } from './automations';
import { PlanQueries } from './plans';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';

describe('ThreadQueries', () => {
  let db: DatabaseSync;
  let projects: ProjectQueries;
  let plans: PlanQueries;
  let automations: AutomationQueries;
  let threads: ThreadQueries;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    projects = new ProjectQueries(db);
    plans = new PlanQueries(db);
    automations = new AutomationQueries(db);
    threads = new ThreadQueries(db);
    projectId = projects.add('/tmp/test-project').id;
  });

  afterEach(() => {
    db.close();
  });

  it('create() returns a thread with idle status', () => {
    const t = threads.create(projectId, 'fix the bug', 'Bug fix');
    expect(t.id).toBeTruthy();
    expect(t.projectId).toBe(projectId);
    expect(t.prompt).toBe('fix the bug');
    expect(t.title).toBe('Bug fix');
    expect(t.status).toBe('idle');
  });

  it('list() returns threads for a project', () => {
    threads.create(projectId, 'a', 'Thread A');
    threads.create(projectId, 'b', 'Thread B');

    const other = projects.add('/tmp/other').id;
    threads.create(other, 'c', 'Thread C');

    const list = threads.list(projectId);
    expect(list.length).toBe(2);
  });

  it('archiveClosedAutomationRuns() hides closed automation threads from list()', () => {
    const done = threads.create(projectId, 'done prompt', 'Done automation');
    const completed = threads.create(projectId, 'completed prompt', 'Completed automation');
    const active = threads.create(projectId, 'active prompt', 'Active automation');
    const manual = threads.create(projectId, 'manual prompt', 'Manual thread');
    const automation = automations.create({
      projectId,
      name: 'Nightly cleanup',
      prompt: 'clean',
      cronExpr: '0 0 * * *',
    });

    threads.setAutomationId(done.id, automation.id);
    threads.setAutomationId(completed.id, automation.id);
    threads.setAutomationId(active.id, automation.id);
    threads.markDone(done.id);
    threads.updateStatus(completed.id, 'completed');
    threads.updateStatus(active.id, 'executing');
    threads.updateStatus(manual.id, 'completed');

    expect(threads.archiveClosedAutomationRuns(projectId)).toBe(1);

    expect(threads.list(projectId).map((thread) => thread.id)).toEqual(
      expect.arrayContaining([completed.id, active.id, manual.id]),
    );
    expect(threads.list(projectId).map((thread) => thread.id)).not.toEqual(
      expect.arrayContaining([done.id]),
    );
    expect(threads.getById(done.id)?.archivedAt).toBeTruthy();
    expect(threads.getById(completed.id)?.archivedAt).toBeNull();
    expect(threads.getById(active.id)?.archivedAt).toBeNull();
    expect(threads.getById(manual.id)?.archivedAt).toBeNull();
  });

  it('getById() returns thread or null', () => {
    const t = threads.create(projectId, 'a', 'A');
    expect(threads.getById(t.id)).toMatchObject({ id: t.id });
    expect(threads.getById('nonexistent')).toBeNull();
  });

  it('getByProjectAndGithubIssue() returns the latest thread for the same issue', () => {
    const older = threads.create(projectId, 'older prompt', 'Older title');
    threads.setGithubIssue(older.id, 42, 'owner/repo');

    const newer = threads.create(projectId, 'newer prompt', 'Newer title');
    threads.setGithubIssue(newer.id, 42, 'owner/repo');

    db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(
      '2026-04-17T08:00:00.000Z',
      older.id,
    );
    db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(
      '2026-04-17T09:00:00.000Z',
      newer.id,
    );

    expect(threads.getByProjectAndGithubIssue(projectId, 42)?.id).toBe(newer.id);
    expect(threads.getByProjectAndGithubIssue(projectId, 404)).toBeNull();
  });

  it('updateStatus() changes the status', () => {
    const t = threads.create(projectId, 'a', 'A');
    threads.updateStatus(t.id, 'planning');
    expect(threads.getById(t.id)?.status).toBe('planning');
  });

  it('updateStatus() persists and clears paused phase metadata', () => {
    const t = threads.create(projectId, 'a', 'A');
    threads.updateStatus(t.id, 'executing');
    threads.updateStatus(t.id, 'paused');

    const paused = threads.getById(t.id);
    expect(paused?.status).toBe('paused');
    expect(paused?.pausedPhase).toBe('executing');
    expect(paused?.pausedAt).toBeTruthy();

    threads.updateStatus(t.id, 'executing');
    const resumed = threads.getById(t.id);
    expect(resumed?.status).toBe('executing');
    expect(resumed?.pausedPhase).toBeNull();
    expect(resumed?.pausedAt).toBeNull();
  });

  it('recordFailure() clears paused phase metadata', () => {
    const t = threads.create(projectId, 'a', 'A');
    threads.updateStatus(t.id, 'executing');
    threads.updateStatus(t.id, 'paused');

    threads.recordFailure(t.id, 'executing', 'Boom');

    const failed = threads.getById(t.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.pausedPhase).toBeNull();
    expect(failed?.pausedAt).toBeNull();
  });

  it('setWorktree() and clearWorktree()', () => {
    const t = threads.create(projectId, 'a', 'A');
    threads.setWorktree(t.id, 'feat/branch', '/tmp/wt');
    let updated = threads.getById(t.id);
    expect(updated).toBeTruthy();
    if (!updated) throw new Error('Expected worktree thread');
    expect(updated.worktreeBranch).toBe('feat/branch');
    expect(updated.worktreePath).toBe('/tmp/wt');

    threads.clearWorktree(t.id);
    updated = threads.getById(t.id);
    expect(updated).toBeTruthy();
    if (!updated) throw new Error('Expected cleared worktree thread');
    expect(updated.worktreeBranch).toBeNull();
    expect(updated.worktreePath).toBeNull();
  });

  it('updateAutonomousFields() sets all autonomous fields', () => {
    const t = threads.create(projectId, 'a', 'A');
    threads.updateAutonomousFields(t.id, {
      autonomous: true,
      reviewRound: 2,
      executorModel: 'gpt-4',
      baseBranch: 'main',
      forkPointSha: 'abc123',
    });
    const updated = threads.getById(t.id);
    expect(updated).toBeTruthy();
    if (!updated) throw new Error('Expected autonomous thread');
    expect(updated.autonomous).toBe(true);
    expect(updated.reviewRound).toBe(2);
    expect(updated.executorModel).toBe('gpt-4');
    expect(updated.baseBranch).toBe('main');
    expect(updated.forkPointSha).toBe('abc123');
  });

  it('incrementReviewRound() increments by 1', () => {
    const t = threads.create(projectId, 'a', 'A');
    expect(threads.getById(t.id)?.reviewRound).toBe(0);
    threads.incrementReviewRound(t.id);
    expect(threads.getById(t.id)?.reviewRound).toBe(1);
    threads.incrementReviewRound(t.id);
    expect(threads.getById(t.id)?.reviewRound).toBe(2);
  });

  it('listAwaitingWithApprovedPlans() returns execution waiters oldest first', () => {
    const older = threads.create(projectId, 'older', 'Older waiter');
    const newer = threads.create(projectId, 'newer', 'Newer waiter');
    const rejected = threads.create(projectId, 'rejected', 'Rejected waiter');
    const executing = threads.create(projectId, 'executing', 'Executing');

    for (const thread of [older, newer, rejected]) {
      threads.updateStatus(thread.id, 'approval');
    }
    threads.updateStatus(executing.id, 'executing');

    const structuredPlan = { steps: [] } as never;
    const olderPlan = plans.create(older.id, 'older plan', structuredPlan, 1);
    plans.updateStatus(olderPlan.id, 'approved');
    const newerPlan = plans.create(newer.id, 'newer plan', structuredPlan, 1);
    plans.updateStatus(newerPlan.id, 'approved');
    const rejectedPlan = plans.create(rejected.id, 'rejected plan', structuredPlan, 1);
    plans.updateStatus(rejectedPlan.id, 'rejected');
    const executingPlan = plans.create(executing.id, 'executing plan', structuredPlan, 1);
    plans.updateStatus(executingPlan.id, 'approved');

    db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(
      '2026-04-17T08:00:00.000Z',
      newer.id,
    );
    db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(
      '2026-04-17T07:00:00.000Z',
      older.id,
    );

    expect(threads.listAwaitingWithApprovedPlans().map((thread) => thread.id)).toEqual([
      older.id,
      newer.id,
    ]);
    expect(threads.getAwaitingWithApprovedPlan()?.id).toBe(older.id);
  });

  it('setGithubIssue() and setGithubPr()', () => {
    const t = threads.create(projectId, 'a', 'A');
    threads.setGithubIssue(t.id, 42, 'owner/repo');
    let updated = threads.getById(t.id);
    expect(updated).toBeTruthy();
    if (!updated) throw new Error('Expected GitHub issue thread');
    expect(updated.githubIssueNumber).toBe(42);
    expect(updated.githubRepo).toBe('owner/repo');

    threads.setGithubPr(t.id, 99);
    updated = threads.getById(t.id);
    expect(updated).toBeTruthy();
    if (!updated) throw new Error('Expected GitHub PR thread');
    expect(updated.githubPrNumber).toBe(99);
  });

  it('updateIssueContent() refreshes the stored prompt and title for a reused issue thread', () => {
    const t = threads.create(projectId, 'old prompt', 'Old title');

    threads.updateIssueContent(t.id, 'new prompt', 'New title');

    expect(threads.getById(t.id)).toMatchObject({
      prompt: 'new prompt',
      title: 'New title',
    });
  });

  it('hasActivePipeline() returns true when active statuses exist', () => {
    expect(threads.hasActivePipeline(projectId)).toBe(false);

    const t = threads.create(projectId, 'a', 'A');
    threads.updateStatus(t.id, 'planning');
    expect(threads.hasActivePipeline(projectId)).toBe(true);
  });

  it('hasActivePipeline() returns false for idle/closed statuses', () => {
    const t = threads.create(projectId, 'a', 'A');
    threads.updateStatus(t.id, 'idle');
    expect(threads.hasActivePipeline(projectId)).toBe(false);
  });

  // ─── Tier 3: telemetry columns ────────────────────────────────

  describe('Tier 3 telemetry', () => {
    it('create() seeds telemetry columns with zero / null defaults', () => {
      const t = threads.create(projectId, 'a', 'A');
      expect(t.plannerResolvedModel).toBeNull();
      expect(t.reviewerResolvedModel).toBeNull();
      expect(t.revisorResolvedModel).toBeNull();
      expect(t.executorResolvedModel).toBeNull();
      expect(t.verifierResolvedModel).toBeNull();
      expect(t.totalTokensPrompt).toBe(0);
      expect(t.totalTokensCompletion).toBe(0);
      expect(t.totalCostUsd).toBe(0);
    });

    it('setResolvedModel() writes the correct column per phase', () => {
      const t = threads.create(projectId, 'a', 'A');

      threads.setResolvedModel(t.id, 'plan', 'anthropic/claude-sonnet-4-6');
      threads.setResolvedModel(t.id, 'review', 'openai/gpt-5-codex');
      threads.setResolvedModel(t.id, 'revision', 'anthropic/claude-opus-4-6');
      threads.setResolvedModel(t.id, 'execute', 'qwen/qwen3-coder:free');
      threads.setResolvedModel(t.id, 'verify', 'anthropic/claude-sonnet-4-6');

      const updated = threads.getById(t.id);
      expect(updated).toBeTruthy();
      if (!updated) throw new Error('Expected resolved model thread');
      expect(updated.plannerResolvedModel).toBe('anthropic/claude-sonnet-4-6');
      expect(updated.reviewerResolvedModel).toBe('openai/gpt-5-codex');
      expect(updated.revisorResolvedModel).toBe('anthropic/claude-opus-4-6');
      expect(updated.executorResolvedModel).toBe('qwen/qwen3-coder:free');
      expect(updated.verifierResolvedModel).toBe('anthropic/claude-sonnet-4-6');
    });

    it('setResolvedModel() only touches the target column', () => {
      const t = threads.create(projectId, 'a', 'A');

      threads.setResolvedModel(t.id, 'plan', 'model-A');
      threads.setResolvedModel(t.id, 'verify', 'model-B');

      const updated = threads.getById(t.id);
      expect(updated).toBeTruthy();
      if (!updated) throw new Error('Expected selectively updated thread');
      expect(updated.plannerResolvedModel).toBe('model-A');
      expect(updated.verifierResolvedModel).toBe('model-B');
      // Untouched columns stay null
      expect(updated.reviewerResolvedModel).toBeNull();
      expect(updated.revisorResolvedModel).toBeNull();
      expect(updated.executorResolvedModel).toBeNull();
    });

    it('addTokenUsage() accumulates prompt + completion tokens and cost', () => {
      const t = threads.create(projectId, 'a', 'A');

      threads.addTokenUsage(t.id, 100, 50, 0.0012);
      let updated = threads.getById(t.id);
      expect(updated).toBeTruthy();
      if (!updated) throw new Error('Expected token usage thread');
      expect(updated.totalTokensPrompt).toBe(100);
      expect(updated.totalTokensCompletion).toBe(50);
      expect(updated.totalCostUsd).toBeCloseTo(0.0012, 6);

      // Second call accumulates on top
      threads.addTokenUsage(t.id, 200, 75, 0.0034);
      updated = threads.getById(t.id);
      expect(updated).toBeTruthy();
      if (!updated) throw new Error('Expected accumulated token usage thread');
      expect(updated.totalTokensPrompt).toBe(300);
      expect(updated.totalTokensCompletion).toBe(125);
      expect(updated.totalCostUsd).toBeCloseTo(0.0046, 6);
    });

    it('addTokenUsage() accepts zero cost without error', () => {
      const t = threads.create(projectId, 'a', 'A');
      threads.addTokenUsage(t.id, 10, 5, 0);
      const updated = threads.getById(t.id);
      expect(updated).toBeTruthy();
      if (!updated) throw new Error('Expected zero-cost token usage thread');
      expect(updated.totalCostUsd).toBe(0);
    });
  });

  describe('setGithubIssueNumber', () => {
    it('updates github_issue_number without touching repo', () => {
      const t = threads.create(projectId, 'p', 'T');
      threads.setGithubIssue(t.id, 5, 'owner/repo');
      threads.setGithubIssueNumber(t.id, -3);
      const updated = threads.getById(t.id);
      expect(updated?.githubIssueNumber).toBe(-3);
      expect(updated?.githubRepo).toBe('owner/repo');
    });

    it('accepts negative sentinels for quick tasks', () => {
      const t = threads.create(projectId, 'p', 'T');
      threads.setGithubIssueNumber(t.id, -1);
      expect(threads.getById(t.id)?.githubIssueNumber).toBe(-1);
    });
  });
});
