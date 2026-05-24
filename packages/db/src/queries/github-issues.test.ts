import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../test-helpers';
import { GitHubIssueQueries } from './github-issues';
import { PlanQueries } from './plans';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';

describe('GitHubIssueQueries', () => {
  let db: DatabaseSync;
  let issues: GitHubIssueQueries;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    const projects = new ProjectQueries(db);
    issues = new GitHubIssueQueries(db);
    projectId = projects.add('/tmp/test').id;
  });

  afterEach(() => {
    db.close();
  });

  function makeIssue(
    overrides: Partial<{
      projectId: string;
      issueNumber: number;
      title: string;
      body: string | null;
      labels: string[];
      assignee: string | null;
      state: string;
      updatedAt: string | null;
    }> = {},
  ) {
    return {
      projectId: overrides.projectId ?? projectId,
      issueNumber: overrides.issueNumber ?? 1,
      title: overrides.title ?? 'Test Issue',
      body: overrides.body ?? 'body',
      labels: overrides.labels ?? ['bug'],
      assignee: overrides.assignee ?? null,
      state: overrides.state ?? 'open',
      updatedAt: overrides.updatedAt ?? null,
    };
  }

  it('upsert() creates a new record', () => {
    const record = issues.upsert(makeIssue());
    expect(record.id).toBeTruthy();
    expect(record.issueNumber).toBe(1);
    expect(record.title).toBe('Test Issue');
    expect(record.labels).toEqual(['bug']);
    expect(record.pipelineStatus).toBe('todo');
  });

  it('upsert() updates existing record by projectId+issueNumber', () => {
    issues.upsert(makeIssue());
    const updated = issues.upsert(makeIssue({ title: 'Updated Title' }));
    expect(updated.title).toBe('Updated Title');

    // Should still be one record
    const list = issues.list(projectId);
    expect(list.length).toBe(1);
  });

  it('upsert() throws if the updated row cannot be reloaded', () => {
    const existing = issues.upsert(makeIssue());
    const getByNumber = vi
      .spyOn(issues, 'getByNumber')
      .mockReturnValueOnce(existing)
      .mockReturnValueOnce(null);

    expect(() => issues.upsert(makeIssue({ title: 'Updated Title' }))).toThrow(
      `Failed to load GitHub issue after update: ${projectId}#1`,
    );

    getByNumber.mockRestore();
  });

  it('upsert() throws if the inserted row cannot be reloaded', () => {
    const getByNumber = vi
      .spyOn(issues, 'getByNumber')
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);

    expect(() => issues.upsert(makeIssue())).toThrow(
      `Failed to load GitHub issue after insert: ${projectId}#1`,
    );

    getByNumber.mockRestore();
  });

  it('upsert() preserves GitHub updatedAt separately from local fetchedAt', () => {
    const record = issues.upsert(makeIssue({ updatedAt: '2026-04-01T12:00:00.000Z' }));

    expect(record.updatedAt).toBe('2026-04-01T12:00:00.000Z');

    const updated = issues.upsert(makeIssue({ title: 'Updated Title' }));
    expect(updated.updatedAt).toBe('2026-04-01T12:00:00.000Z');
  });

  it('list() returns all issues for a project', () => {
    issues.upsert(makeIssue({ issueNumber: 1 }));
    issues.upsert(makeIssue({ issueNumber: 2, title: 'Second' }));
    expect(issues.list(projectId).length).toBe(2);
  });

  it('getByNumber() returns issue or null', () => {
    issues.upsert(makeIssue({ issueNumber: 42 }));
    expect(issues.getByNumber(projectId, 42)).toBeTruthy();
    expect(issues.getByNumber(projectId, 999)).toBeNull();
  });

  it('getByThreadId() returns linked issue or null', () => {
    const record = issues.upsert(makeIssue());
    const threads = new ThreadQueries(db);
    const thread = threads.create(projectId, 'prompt', 'title');
    issues.linkThread(record.id, thread.id);

    expect(issues.getByThreadId(thread.id)?.id).toBe(record.id);
    expect(issues.getByThreadId('missing')).toBeNull();
  });

  it('getByLinkedPrNumber() returns the issue linked to a pull request', () => {
    const record = issues.upsert(makeIssue({ issueNumber: 42 }));

    issues.updatePullRequestFeedback(record.id, {
      linkedPrNumber: 77,
      linkedPrUrl: 'https://github.com/shipshitdev/shipcode/pull/77',
      linkedPrIsDraft: false,
      ciBlocked: false,
      failingChecks: [],
      unresolvedReviewComments: [],
    });

    expect(issues.getByLinkedPrNumber(projectId, 77)?.id).toBe(record.id);
    expect(issues.getByLinkedPrNumber(projectId, 999)).toBeNull();
  });

  it('tryClaim() returns true if unclaimed, false if already claimed', () => {
    const record = issues.upsert(makeIssue());
    expect(issues.tryClaim(record.id, 'instance-1')).toBe(true);
    expect(issues.tryClaim(record.id, 'instance-2')).toBe(false);
  });

  it('releaseClaim() resets claimed state and pipeline_status to queued', () => {
    const record = issues.upsert(makeIssue());
    issues.tryClaim(record.id, 'instance-1');
    issues.updatePipelineStatus(record.id, 'planning');

    issues.releaseClaim(record.id);

    const updated = issues.getByNumber(projectId, 1);
    expect(updated).toBeTruthy();
    if (!updated) throw new Error('Expected updated issue');
    expect(updated.claimedAt).toBeNull();
    expect(updated.claimedBy).toBeNull();
    expect(updated.pipelineStatus).toBe('queued');
  });

  it('getNextQueued() skips issues whose project is archived', () => {
    const projects = new ProjectQueries(db);
    const archivedProject = projects.add('/tmp/archived-proj');
    const issue = issues.upsert(makeIssue({ projectId: archivedProject.id, issueNumber: 99 }));
    issues.updatePipelineStatus(issue.id, 'queued');

    // Archive the project directly via SQL to bypass idle guard
    db.prepare('UPDATE projects SET archived = 1 WHERE id = ?').run(archivedProject.id);

    expect(issues.getNextQueued()).toBeNull();

    // Unarchive: should now be visible
    db.prepare('UPDATE projects SET archived = 0 WHERE id = ?').run(archivedProject.id);
    expect(issues.getNextQueued()?.issueNumber).toBe(99);
  });

  it('updatePipelineStatus() changes the status', () => {
    const record = issues.upsert(makeIssue());
    issues.updatePipelineStatus(record.id, 'planning');
    expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('planning');
  });

  it('updatePipelineStatus() preserves lastPhaseUpdate when the status is unchanged', () => {
    const record = issues.upsert(makeIssue());
    issues.updatePipelineStatus(record.id, 'planning');
    db.prepare('UPDATE github_issue_cache SET last_phase_update = ? WHERE id = ?').run(
      '2026-05-01T10:00:00.000Z',
      record.id,
    );

    issues.updatePipelineStatus(record.id, 'planning');
    expect(issues.getByNumber(projectId, 1)?.lastPhaseUpdate).toBe('2026-05-01T10:00:00.000Z');

    issues.updatePipelineStatus(record.id, 'executing');
    const updated = issues.getByNumber(projectId, 1);
    expect(updated?.pipelineStatus).toBe('executing');
    expect(updated?.lastPhaseUpdate).not.toBe('2026-05-01T10:00:00.000Z');
  });

  it('runInTransaction() commits grouped issue writes', () => {
    const result = issues.runInTransaction(() => {
      issues.upsert(makeIssue({ issueNumber: 10, title: 'Ten' }));
      issues.upsert(makeIssue({ issueNumber: 11, title: 'Eleven' }));
      return 'committed';
    });

    expect(result).toBe('committed');
    expect(
      issues
        .list(projectId)
        .map((issue) => issue.issueNumber)
        .toSorted(),
    ).toEqual([10, 11]);
  });

  it('updateState() persists the GitHub issue open/closed state independently of pipeline status', () => {
    const record = issues.upsert(makeIssue());
    issues.updatePipelineStatus(record.id, 'executing');

    issues.updateState(record.id, 'closed');

    expect(issues.getByNumber(projectId, 1)).toMatchObject({
      state: 'closed',
      pipelineStatus: 'executing',
    });
  });

  it('defaults phase model overrides to null', () => {
    const record = issues.upsert(makeIssue());
    expect(record.plannerModelOverride).toBeNull();
    expect(record.reviewerModelOverride).toBeNull();
    expect(record.executorModelOverride).toBeNull();
    expect(record.verifierModelOverride).toBeNull();
    expect(record.plannerModelIdOverride).toBeNull();
    expect(record.reviewerModelIdOverride).toBeNull();
    expect(record.executorModelIdOverride).toBeNull();
    expect(record.verifierModelIdOverride).toBeNull();
    expect(record.linkedPrNumber).toBeNull();
    expect(record.linkedPrUrl).toBeNull();
    expect(record.linkedPrIsDraft).toBe(false);
    expect(record.revisionCountOverride).toBeNull();
    expect(record.requireApprovalOverride).toBeNull();
    expect(record.ciBlocked).toBe(false);
    expect(record.failingChecks).toEqual([]);
    expect(record.unresolvedReviewComments).toEqual([]);
    expect(record.unresolvedReviewCommentCount).toBe(0);
    expect(record.prLastSyncAt).toBeNull();
  });

  it('updateRevisionCountOverride() persists values and can clear them', () => {
    const record = issues.upsert(makeIssue());

    issues.updateRevisionCountOverride(record.id, 4);
    expect(issues.getByNumber(projectId, 1)?.revisionCountOverride).toBe(4);

    issues.updateRevisionCountOverride(record.id, null);
    expect(issues.getByNumber(projectId, 1)?.revisionCountOverride).toBeNull();
  });

  it('updateRequireApprovalOverride() persists values and can clear them', () => {
    const record = issues.upsert(makeIssue());

    issues.updateRequireApprovalOverride(record.id, true);
    expect(issues.getByNumber(projectId, 1)?.requireApprovalOverride).toBe(true);

    issues.updateRequireApprovalOverride(record.id, false);
    expect(issues.getByNumber(projectId, 1)?.requireApprovalOverride).toBe(false);

    issues.updateRequireApprovalOverride(record.id, null);
    expect(issues.getByNumber(projectId, 1)?.requireApprovalOverride).toBeNull();
  });

  it('updatePhaseModelOverride() persists values and can clear them', () => {
    const record = issues.upsert(makeIssue());

    issues.updatePhaseModelOverride(record.id, 'planner', 'openrouter');
    issues.updatePhaseModelOverride(record.id, 'reviewer', 'claude');
    issues.updatePhaseModelOverride(record.id, 'executor', 'openrouter');
    issues.updatePhaseModelOverride(record.id, 'verifier', 'claude');
    expect(issues.getByNumber(projectId, 1)?.plannerModelOverride).toBe('openrouter');
    expect(issues.getByNumber(projectId, 1)?.reviewerModelOverride).toBe('claude');
    expect(issues.getByNumber(projectId, 1)?.executorModelOverride).toBe('openrouter');
    expect(issues.getByNumber(projectId, 1)?.verifierModelOverride).toBe('claude');

    issues.updatePhaseModelOverride(record.id, 'planner', null);
    issues.updatePhaseModelOverride(record.id, 'reviewer', null);
    issues.updatePhaseModelOverride(record.id, 'executor', null);
    issues.updatePhaseModelOverride(record.id, 'verifier', null);
    expect(issues.getByNumber(projectId, 1)?.plannerModelOverride).toBeNull();
    expect(issues.getByNumber(projectId, 1)?.reviewerModelOverride).toBeNull();
    expect(issues.getByNumber(projectId, 1)?.executorModelOverride).toBeNull();
    expect(issues.getByNumber(projectId, 1)?.verifierModelOverride).toBeNull();
  });

  it('updatePhaseModelOverride() round-trips codex for every phase', () => {
    const record = issues.upsert(makeIssue());

    issues.updatePhaseModelOverride(record.id, 'planner', 'codex');
    issues.updatePhaseModelOverride(record.id, 'reviewer', 'codex');
    issues.updatePhaseModelOverride(record.id, 'executor', 'codex');
    issues.updatePhaseModelOverride(record.id, 'verifier', 'codex');

    expect(issues.getByNumber(projectId, 1)).toMatchObject({
      plannerModelOverride: 'codex',
      reviewerModelOverride: 'codex',
      executorModelOverride: 'codex',
      verifierModelOverride: 'codex',
    });

    issues.updatePhaseModelOverride(record.id, 'planner', 'claude');
    issues.updatePhaseModelOverride(record.id, 'reviewer', 'openrouter');
    issues.updatePhaseModelOverride(record.id, 'executor', 'claude');
    issues.updatePhaseModelOverride(record.id, 'verifier', 'openrouter');

    expect(issues.getByNumber(projectId, 1)).toMatchObject({
      plannerModelOverride: 'claude',
      reviewerModelOverride: 'openrouter',
      executorModelOverride: 'claude',
      verifierModelOverride: 'openrouter',
    });
  });

  it('updatePhaseModelIdOverride() persists values and can clear them', () => {
    const record = issues.upsert(makeIssue());

    issues.updatePhaseModelIdOverride(record.id, 'planner', 'claude-opus-4-6');
    issues.updatePhaseModelIdOverride(record.id, 'reviewer', 'gpt-5.4-mini');
    issues.updatePhaseModelIdOverride(record.id, 'executor', 'gpt-5.4');
    issues.updatePhaseModelIdOverride(record.id, 'verifier', 'anthropic/claude-sonnet-4-6');

    expect(issues.getByNumber(projectId, 1)?.plannerModelIdOverride).toBe('claude-opus-4-6');
    expect(issues.getByNumber(projectId, 1)?.reviewerModelIdOverride).toBe('gpt-5.4-mini');
    expect(issues.getByNumber(projectId, 1)?.executorModelIdOverride).toBe('gpt-5.4');
    expect(issues.getByNumber(projectId, 1)?.verifierModelIdOverride).toBe(
      'anthropic/claude-sonnet-4-6',
    );

    issues.updatePhaseModelIdOverride(record.id, 'planner', null);
    issues.updatePhaseModelIdOverride(record.id, 'reviewer', null);
    issues.updatePhaseModelIdOverride(record.id, 'executor', null);
    issues.updatePhaseModelIdOverride(record.id, 'verifier', null);

    expect(issues.getByNumber(projectId, 1)?.plannerModelIdOverride).toBeNull();
    expect(issues.getByNumber(projectId, 1)?.reviewerModelIdOverride).toBeNull();
    expect(issues.getByNumber(projectId, 1)?.executorModelIdOverride).toBeNull();
    expect(issues.getByNumber(projectId, 1)?.verifierModelIdOverride).toBeNull();
  });

  it('updatePhaseReasoningEffortOverride() persists values for every phase', () => {
    const record = issues.upsert(makeIssue());

    issues.updatePhaseReasoningEffortOverride(record.id, 'planner', 'low');
    issues.updatePhaseReasoningEffortOverride(record.id, 'reviewer', 'medium');
    issues.updatePhaseReasoningEffortOverride(record.id, 'executor', 'high');
    issues.updatePhaseReasoningEffortOverride(record.id, 'verifier', 'xhigh');

    expect(issues.getByNumber(projectId, 1)).toMatchObject({
      plannerReasoningEffortOverride: 'low',
      reviewerReasoningEffortOverride: 'medium',
      executorReasoningEffortOverride: 'high',
      verifierReasoningEffortOverride: 'xhigh',
    });

    issues.updatePhaseReasoningEffortOverride(record.id, 'planner', null);
    issues.updatePhaseReasoningEffortOverride(record.id, 'reviewer', null);
    issues.updatePhaseReasoningEffortOverride(record.id, 'executor', null);
    issues.updatePhaseReasoningEffortOverride(record.id, 'verifier', null);

    expect(issues.getByNumber(projectId, 1)).toMatchObject({
      plannerReasoningEffortOverride: null,
      reviewerReasoningEffortOverride: null,
      executorReasoningEffortOverride: null,
      verifierReasoningEffortOverride: null,
    });
  });

  it('clearAllPhaseOverridesForProject() clears issue overrides only for the target project', () => {
    const otherProjectId = new ProjectQueries(db).add('/tmp/other-project').id;
    const issue = issues.upsert(makeIssue({ issueNumber: 10 }));
    const untouched = issues.upsert(makeIssue({ projectId: otherProjectId, issueNumber: 11 }));

    issues.updatePhaseModelOverride(issue.id, 'planner', 'claude');
    issues.updatePhaseModelIdOverride(issue.id, 'planner', 'claude-sonnet-4-6');
    issues.updatePhaseReasoningEffortOverride(issue.id, 'planner', 'high');
    issues.updateRevisionCountOverride(issue.id, 2);

    issues.updatePhaseModelOverride(untouched.id, 'planner', 'codex');
    issues.updatePhaseModelIdOverride(untouched.id, 'planner', 'gpt-5.4');
    issues.updatePhaseReasoningEffortOverride(untouched.id, 'planner', 'high');
    issues.updateRevisionCountOverride(untouched.id, 5);
    issues.updateRequireApprovalOverride(issue.id, true);
    issues.updateRequireApprovalOverride(untouched.id, false);
    issues.updatePipelineStatus(issue.id, 'planning');

    expect(issues.clearAllPhaseOverridesForProject(projectId)).toBe(1);

    expect(issues.getByNumber(projectId, 10)).toMatchObject({
      plannerModelOverride: null,
      plannerModelIdOverride: null,
      plannerReasoningEffortOverride: null,
      revisionCountOverride: null,
      requireApprovalOverride: null,
      pipelineStatus: 'planning',
    });
    expect(issues.getByNumber(otherProjectId, 11)).toMatchObject({
      plannerModelOverride: 'codex',
      plannerModelIdOverride: 'gpt-5.4',
      plannerReasoningEffortOverride: 'high',
      revisionCountOverride: 5,
      requireApprovalOverride: false,
    });
  });

  it('updatePullRequestFeedback() persists linked PR metadata and blocker summaries', () => {
    const record = issues.upsert(makeIssue());

    issues.updatePullRequestFeedback(record.id, {
      linkedPrNumber: 77,
      linkedPrUrl: 'https://github.com/shipshitdev/shipcode/pull/77',
      linkedPrIsDraft: true,
      ciBlocked: true,
      failingChecks: [
        {
          name: 'check',
          status: 'failed',
          conclusion: 'failure',
          detailsUrl: 'https://github.com/example/check',
          workflowName: 'CI',
        },
      ],
      unresolvedReviewComments: [
        {
          author: 'chatgpt-codex-connector',
          body: 'Please fix this edge case.',
          url: 'https://github.com/example/comment',
          createdAt: new Date().toISOString(),
          path: 'packages/pipeline/src/pipeline.ts',
          line: 42,
        },
      ],
    });

    const updated = issues.getByNumber(projectId, 1);
    expect(updated).toBeTruthy();
    if (!updated) throw new Error('Expected linked PR metadata');
    expect(updated.linkedPrNumber).toBe(77);
    expect(updated.linkedPrUrl).toBe('https://github.com/shipshitdev/shipcode/pull/77');
    expect(updated.linkedPrIsDraft).toBe(true);
    expect(updated.ciBlocked).toBe(true);
    expect(updated.failingChecks).toHaveLength(1);
    expect(updated.unresolvedReviewComments).toHaveLength(1);
    expect(updated.unresolvedReviewCommentCount).toBe(1);
    expect(updated.prLastSyncAt).toBeTruthy();
  });

  it('setCachedLabelPresence() adds and removes a local GitHub marker label', () => {
    const record = issues.upsert(makeIssue({ labels: ['shipcode:agent:claude'] }));

    issues.setCachedLabelPresence(record.id, 'shipcode:blocked:ci', true);
    expect(issues.getByNumber(projectId, 1)?.labels).toContain('shipcode:blocked:ci');

    issues.setCachedLabelPresence(record.id, 'shipcode:blocked:ci', false);
    expect(issues.getByNumber(projectId, 1)?.labels).not.toContain('shipcode:blocked:ci');
  });

  it('setCachedLabelPresence() is a no-op for missing issue ids', () => {
    issues.upsert(makeIssue({ labels: ['shipcode:agent:claude'] }));

    issues.setCachedLabelPresence('missing-issue-id', 'shipcode:blocked:ci', true);

    expect(issues.getByNumber(projectId, 1)?.labels).toEqual(['shipcode:agent:claude']);
  });

  it('linkThread() sets the thread_id', () => {
    const record = issues.upsert(makeIssue());
    const threads = new ThreadQueries(db);
    const thread = threads.create(projectId, 'prompt', 'title');
    issues.linkThread(record.id, thread.id);
    expect(issues.getByNumber(projectId, 1)?.threadId).toBe(thread.id);
  });

  it('clearThread() clears the thread_id', () => {
    const record = issues.upsert(makeIssue());
    const threads = new ThreadQueries(db);
    const thread = threads.create(projectId, 'prompt', 'title');

    issues.linkThread(record.id, thread.id);
    issues.clearThread(record.id);

    expect(issues.getByNumber(projectId, 1)?.threadId).toBeNull();
  });

  it('getRequeued() returns unclaimed queued records', () => {
    const r1 = issues.upsert(makeIssue({ issueNumber: 1 }));
    issues.upsert(makeIssue({ issueNumber: 2 }));

    // Claim and release r1 to make it queued+unclaimed
    issues.tryClaim(r1.id, 'inst');
    issues.releaseClaim(r1.id);

    const requeued = issues.getRequeued(projectId);
    expect(requeued.length).toBe(1);
    expect(requeued[0]?.id).toBe(r1.id);
  });

  it('getOrphanedClaims() returns claimed records with no thread_id and old claim', () => {
    const record = issues.upsert(makeIssue());
    issues.tryClaim(record.id, 'instance-1');

    // Manually backdate the claimed_at to more than 5 minutes ago
    db.prepare(
      "UPDATE github_issue_cache SET claimed_at = datetime('now', '-10 minutes') WHERE id = ?",
    ).run(record.id);

    const orphaned = issues.getOrphanedClaims();
    expect(orphaned.length).toBe(1);
    expect(orphaned[0].id).toBe(record.id);
  });

  it('getOrphanedClaims() does not return recently claimed records', () => {
    const record = issues.upsert(makeIssue());
    issues.tryClaim(record.id, 'instance-1');

    // claimed_at is 'now', which is less than 5 minutes ago
    const orphaned = issues.getOrphanedClaims();
    expect(orphaned.length).toBe(0);
  });

  it('getOrphanedClaims() does not return claimed records that have a thread', () => {
    const record = issues.upsert(makeIssue());
    issues.tryClaim(record.id, 'instance-1');
    const threads = new ThreadQueries(db);
    const thread = threads.create(projectId, 'prompt', 'title');
    issues.linkThread(record.id, thread.id);

    // Backdate claim
    db.prepare(
      "UPDATE github_issue_cache SET claimed_at = datetime('now', '-10 minutes') WHERE id = ?",
    ).run(record.id);

    const orphaned = issues.getOrphanedClaims();
    expect(orphaned.length).toBe(0);
  });

  it('getEligibleTodoIssues() and countEligibleTodo() filter by state, archive, quick mode, project archive, and priority', () => {
    const p0 = issues.upsert(makeIssue({ issueNumber: 10, title: 'P0' }));
    issues.setPriority({
      id: p0.id,
      rank: 'p0',
      raw: 'P0',
      fetchedAt: '2026-05-01T00:00:00.000Z',
    });
    const p2 = issues.upsert(makeIssue({ issueNumber: 11, title: 'P2' }));
    issues.setPriority({
      id: p2.id,
      rank: 'p2',
      raw: 'P2',
      fetchedAt: '2026-05-01T00:00:00.000Z',
    });
    issues.upsert(makeIssue({ issueNumber: 12, title: 'Unranked' }));
    issues.upsert(makeIssue({ issueNumber: 13, title: 'Closed state', state: 'closed' }));
    const executing = issues.upsert(makeIssue({ issueNumber: 14, title: 'Executing' }));
    issues.updatePipelineStatus(executing.id, 'executing');
    const archived = issues.upsert(makeIssue({ issueNumber: 15, title: 'Archived' }));
    issues.archiveIssues([archived.id]);

    const threads = new ThreadQueries(db);
    const quickThread = threads.create(projectId, 'quick', 'quick');
    issues.insertQuickTask({
      projectId,
      title: 'Quick',
      body: 'Quick',
      threadId: quickThread.id,
    });

    const projects = new ProjectQueries(db);
    const archivedProjectId = projects.add('/tmp/archived-project').id;
    const hiddenProjectIssue = issues.upsert(
      makeIssue({ projectId: archivedProjectId, issueNumber: 16, title: 'Hidden project' }),
    );
    issues.setPriority({
      id: hiddenProjectIssue.id,
      rank: 'p0',
      raw: 'P0',
      fetchedAt: '2026-05-01T00:00:00.000Z',
    });
    db.prepare('UPDATE projects SET archived = 1 WHERE id = ?').run(archivedProjectId);

    expect(issues.getEligibleTodoIssues(projectId, []).map((issue) => issue.issueNumber)).toEqual([
      10, 11, 12,
    ]);
    expect(issues.countEligibleTodo(projectId, [])).toBe(3);
    expect(
      issues.getEligibleTodoIssues(projectId, ['p2']).map((issue) => issue.issueNumber),
    ).toEqual([11]);
    expect(issues.countEligibleTodo(projectId, ['p0', 'p2'])).toBe(2);
    expect(issues.countEligibleTodo(archivedProjectId, ['p0'])).toBe(0);
  });

  describe('close/reopen sync', () => {
    it('markClosedOnClose() flips todo → closed (default source status)', () => {
      const record = issues.upsert(makeIssue());
      expect(record.pipelineStatus).toBe('todo');
      const changed = issues.markClosedOnClose(record.id);
      expect(changed).toBe(true);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('closed');
    });

    it('markClosedOnClose() flips completed → closed', () => {
      const record = issues.upsert(makeIssue());
      issues.updatePipelineStatus(record.id, 'completed');
      expect(issues.markClosedOnClose(record.id)).toBe(true);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('closed');
    });

    it('markClosedOnClose() does NOT flip executing (in-flight guard)', () => {
      const record = issues.upsert(makeIssue());
      issues.updatePipelineStatus(record.id, 'executing');
      expect(issues.markClosedOnClose(record.id)).toBe(false);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('executing');
    });

    it('reconcileCompletedFromEvidence() repairs todo → completed when a linked PR exists', () => {
      const record = issues.upsert(makeIssue());
      issues.updatePipelineStatus(record.id, 'todo');
      issues.updatePullRequestFeedback(record.id, {
        linkedPrNumber: 49,
        linkedPrUrl: 'https://github.com/shipshitdev/shipcode/pull/49',
        linkedPrIsDraft: true,
        ciBlocked: false,
        failingChecks: [],
        unresolvedReviewComments: [],
      });

      expect(issues.reconcileCompletedFromEvidence(record.id)).toBe(true);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('completed');
    });

    it('reconcileCompletedFromEvidence() repairs todo → completed when a linked thread already completed', () => {
      const record = issues.upsert(makeIssue());
      const threads = new ThreadQueries(db);
      const thread = threads.create(projectId, 'prompt', 'title');
      threads.updateStatus(thread.id, 'completed');
      issues.linkThread(record.id, thread.id);
      issues.updatePipelineStatus(record.id, 'todo');

      expect(issues.reconcileCompletedFromEvidence(record.id)).toBe(true);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('completed');
    });

    it('markReopenedOnOpen() flips closed → todo when there is no completion evidence', () => {
      const record = issues.upsert(makeIssue());
      issues.updatePipelineStatus(record.id, 'closed');

      expect(issues.markReopenedOnOpen(record.id)).toBe(true);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('todo');
    });

    it('markReopenedOnOpen() flips closed → completed when a linked PR still exists', () => {
      const record = issues.upsert(makeIssue());
      issues.updatePipelineStatus(record.id, 'closed');
      issues.updatePullRequestFeedback(record.id, {
        linkedPrNumber: 49,
        linkedPrUrl: 'https://github.com/shipshitdev/shipcode/pull/49',
        linkedPrIsDraft: true,
        ciBlocked: false,
        failingChecks: [],
        unresolvedReviewComments: [],
      });

      expect(issues.markReopenedOnOpen(record.id)).toBe(true);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('completed');
    });

    it('resetToTodo() refuses to clear a row that still has completion evidence', () => {
      const record = issues.upsert(makeIssue());
      issues.updatePipelineStatus(record.id, 'completed');
      issues.updatePullRequestFeedback(record.id, {
        linkedPrNumber: 49,
        linkedPrUrl: 'https://github.com/shipshitdev/shipcode/pull/49',
        linkedPrIsDraft: true,
        ciBlocked: false,
        failingChecks: [],
        unresolvedReviewComments: [],
      });

      expect(issues.resetToTodo(record.id)).toBe(false);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('completed');
    });

    it('resetStaleApproval() clears approval rows without a generated plan', () => {
      const noThread = issues.upsert(makeIssue({ issueNumber: 10 }));
      issues.updatePipelineStatus(noThread.id, 'approval');

      const threads = new ThreadQueries(db);
      const threadWithoutPlan = threads.create(projectId, 'prompt', 'title');
      const withoutPlan = issues.upsert(makeIssue({ issueNumber: 11 }));
      issues.linkThread(withoutPlan.id, threadWithoutPlan.id);
      issues.updatePipelineStatus(withoutPlan.id, 'approval');

      const threadWithPlan = threads.create(projectId, 'prompt', 'title');
      const plans = new PlanQueries(db);
      plans.create(threadWithPlan.id, 'raw', null, 1);
      const withPlan = issues.upsert(makeIssue({ issueNumber: 12 }));
      issues.linkThread(withPlan.id, threadWithPlan.id);
      issues.updatePipelineStatus(withPlan.id, 'approval');

      expect(issues.resetStaleApproval(projectId)).toBe(2);
      expect(issues.getByNumber(projectId, 10)?.pipelineStatus).toBe('todo');
      expect(issues.getByNumber(projectId, 11)?.pipelineStatus).toBe('todo');
      expect(issues.getByNumber(projectId, 12)?.pipelineStatus).toBe('approval');
    });
  });

  describe('archive', () => {
    it('list() excludes archived rows', () => {
      const r1 = issues.upsert(makeIssue({ issueNumber: 1 }));
      const r2 = issues.upsert(makeIssue({ issueNumber: 2 }));
      expect(issues.list(projectId)).toHaveLength(2);
      issues.archiveIssues([r1.id]);
      const visible = issues.list(projectId);
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe(r2.id);
    });

    it('getByNumber() still returns archived rows', () => {
      const r = issues.upsert(makeIssue({ issueNumber: 1 }));
      issues.archiveIssues([r.id]);
      expect(issues.list(projectId)).toHaveLength(0);
      const found = issues.getByNumber(projectId, 1);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(r.id);
    });

    it('archiveIssues() is a no-op for empty array', () => {
      issues.upsert(makeIssue({ issueNumber: 1 }));
      expect(() => issues.archiveIssues([])).not.toThrow();
      expect(issues.list(projectId)).toHaveLength(1);
    });

    it('upsert() does NOT clear archived_at on update', () => {
      const r = issues.upsert(makeIssue({ issueNumber: 1 }));
      issues.archiveIssues([r.id]);
      expect(issues.list(projectId)).toHaveLength(0);
      // Re-upsert same issue (simulates refresh)
      issues.upsert(makeIssue({ issueNumber: 1, title: 'Updated title' }));
      // Should still be hidden
      expect(issues.list(projectId)).toHaveLength(0);
      // But direct lookup works
      const found = issues.getByNumber(projectId, 1);
      expect(found?.title).toBe('Updated title');
    });

    it('clearArchivedAt() makes row visible again', () => {
      const r = issues.upsert(makeIssue({ issueNumber: 1 }));
      issues.archiveIssues([r.id]);
      expect(issues.list(projectId)).toHaveLength(0);
      issues.clearArchivedAt(r.id);
      expect(issues.list(projectId)).toHaveLength(1);
    });

    it('listArchived() returns archived rows across projects newest first', () => {
      const otherProjectId = new ProjectQueries(db).add('/tmp/other-archived').id;
      const first = issues.upsert(makeIssue({ issueNumber: 1, title: 'First archived' }));
      const second = issues.upsert(
        makeIssue({
          projectId: otherProjectId,
          issueNumber: 2,
          title: 'Second archived',
        }),
      );
      const visible = issues.upsert(makeIssue({ issueNumber: 3, title: 'Visible' }));

      issues.archiveIssues([first.id]);
      db.prepare(
        "UPDATE github_issue_cache SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 second') WHERE id = ?",
      ).run(second.id);

      expect(issues.listArchived().map((issue) => issue.id)).toEqual([second.id, first.id]);
      expect(issues.listArchived().map((issue) => issue.id)).not.toContain(visible.id);
    });

    it('archiveIssues() only archives the exact ID set (race-safe)', () => {
      const r1 = issues.upsert(makeIssue({ issueNumber: 1 }));
      const r2 = issues.upsert(makeIssue({ issueNumber: 2 }));
      const r3 = issues.upsert(makeIssue({ issueNumber: 3 }));
      issues.archiveIssues([r1.id, r3.id]);
      const visible = issues.list(projectId);
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe(r2.id);
    });

    it('listClosed() returns closed rows while excluding completed and archived ones', () => {
      const r1 = issues.upsert(makeIssue({ issueNumber: 1 }));
      const r2 = issues.upsert(makeIssue({ issueNumber: 2 }));
      const r3 = issues.upsert(makeIssue({ issueNumber: 3 }));
      issues.updatePipelineStatus(r1.id, 'completed');
      issues.updatePipelineStatus(r2.id, 'closed');
      issues.updatePipelineStatus(r3.id, 'closed');
      issues.archiveIssues([r3.id]);
      const closed = issues.listClosed(projectId);
      expect(closed).toHaveLength(1);
      expect(closed[0].id).toBe(r2.id);
    });

    it('clearArchivedAt() during reopen re-exposes the issue', () => {
      const r = issues.upsert(makeIssue({ issueNumber: 1 }));
      issues.updatePipelineStatus(r.id, 'closed');
      issues.archiveIssues([r.id]);
      expect(issues.list(projectId)).toHaveLength(0);
      // Simulate refresh: reopen + clear archive
      issues.markReopenedOnOpen(r.id);
      issues.clearArchivedAt(r.id);
      const visible = issues.list(projectId);
      expect(visible).toHaveLength(1);
      expect(visible[0].pipelineStatus).toBe('todo');
    });
  });

  describe('priority', () => {
    it('setPriority() round-trips rank, raw, and fetchedAt', () => {
      const r = issues.upsert(makeIssue({ issueNumber: 50 }));
      const fetchedAt = '2026-04-27T09:00:00.000Z';
      issues.setPriority({ id: r.id, rank: 'p0', raw: 'P0', fetchedAt });

      const fresh = issues.getByNumber(projectId, 50);
      expect(fresh).not.toBeNull();
      expect(fresh?.priorityRank).toBe('p0');
      expect(fresh?.priorityRaw).toBe('P0');
      expect(fresh?.priorityFetchedAt).toBe(fetchedAt);
    });

    it('setPriority() with rank=null preserves raw (unknown option)', () => {
      const r = issues.upsert(makeIssue({ issueNumber: 51 }));
      issues.setPriority({
        id: r.id,
        rank: null,
        raw: 'Icebox',
        fetchedAt: '2026-04-27T09:00:00.000Z',
      });

      const fresh = issues.getByNumber(projectId, 51);
      expect(fresh?.priorityRank).toBeNull();
      expect(fresh?.priorityRaw).toBe('Icebox');
    });

    it('upsert() after setPriority() does NOT clear priority columns', () => {
      const r = issues.upsert(makeIssue({ issueNumber: 52 }));
      issues.setPriority({
        id: r.id,
        rank: 'p1',
        raw: 'High',
        fetchedAt: '2026-04-27T09:00:00.000Z',
      });

      // Simulate a subsequent issue refresh that re-upserts the row.
      issues.upsert(makeIssue({ issueNumber: 52, title: 'Updated title' }));

      const fresh = issues.getByNumber(projectId, 52);
      expect(fresh?.title).toBe('Updated title');
      expect(fresh?.priorityRank).toBe('p1');
      expect(fresh?.priorityRaw).toBe('High');
    });

    it('toRecord() defaults priority columns to null when never set', () => {
      issues.upsert(makeIssue({ issueNumber: 53 }));
      const fresh = issues.getByNumber(projectId, 53);
      expect(fresh?.priorityRank).toBeNull();
      expect(fresh?.priorityRaw).toBeNull();
      expect(fresh?.priorityFetchedAt).toBeNull();
    });
  });

  describe('insertQuickTask', () => {
    it('creates a synthetic row with negative sentinel issue_number', () => {
      const threads = new ThreadQueries(db);
      const thread = threads.create(projectId, 'fix off-by-one', 'fix off-by-one');
      const issue = issues.insertQuickTask({
        projectId,
        title: 'fix off-by-one',
        body: 'fix off-by-one',
        threadId: thread.id,
      });
      expect(issue.issueNumber).toBe(-1);
      expect(issue.isQuickMode).toBe(true);
      expect(issue.threadId).toBe(thread.id);
      expect(issue.pipelineStatus).toBe('queued');
      expect(issue.title).toBe('fix off-by-one');
    });

    it('allocates sequential negative sentinels per project', () => {
      const threads = new ThreadQueries(db);
      const t1 = threads.create(projectId, 'a', 'a');
      const t2 = threads.create(projectId, 'b', 'b');
      const t3 = threads.create(projectId, 'c', 'c');
      const a = issues.insertQuickTask({ projectId, title: 'a', body: 'a', threadId: t1.id });
      const b = issues.insertQuickTask({ projectId, title: 'b', body: 'b', threadId: t2.id });
      const c = issues.insertQuickTask({ projectId, title: 'c', body: 'c', threadId: t3.id });
      expect([a.issueNumber, b.issueNumber, c.issueNumber]).toEqual([-1, -2, -3]);
    });

    it('does not collide with existing positive issue numbers', () => {
      issues.upsert(makeIssue({ issueNumber: 5 }));
      const threads = new ThreadQueries(db);
      const thread = threads.create(projectId, 'x', 'x');
      const quick = issues.insertQuickTask({
        projectId,
        title: 'x',
        body: 'x',
        threadId: thread.id,
      });
      expect(quick.issueNumber).toBe(-1);
    });

    it('continues from existing minimum when called sequentially', () => {
      const threads = new ThreadQueries(db);
      const t1 = threads.create(projectId, 'a', 'a');
      issues.insertQuickTask({ projectId, title: 'a', body: 'a', threadId: t1.id });
      issues.insertQuickTask({
        projectId,
        title: 'b',
        body: 'b',
        threadId: threads.create(projectId, 'b', 'b').id,
      });
      const t3 = threads.create(projectId, 'c', 'c');
      const c = issues.insertQuickTask({ projectId, title: 'c', body: 'c', threadId: t3.id });
      expect(c.issueNumber).toBe(-3);
    });

    it('throws if the inserted quick row cannot be reloaded', () => {
      const threads = new ThreadQueries(db);
      const thread = threads.create(projectId, 'vanished', 'vanished');
      const getByNumber = vi.spyOn(issues, 'getByNumber').mockReturnValueOnce(null);

      expect(() =>
        issues.insertQuickTask({
          projectId,
          title: 'vanished',
          body: 'vanished',
          threadId: thread.id,
        }),
      ).toThrow(`Quick task row vanished after insert: ${projectId}#-1`);

      getByNumber.mockRestore();
    });

    it('fails after five unique sentinel allocation collisions', () => {
      const threads = new ThreadQueries(db);
      const thread = threads.create(projectId, 'collision', 'collision');
      const originalPrepare = db.prepare.bind(db);
      const prepare = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
        if (String(sql).includes('INSERT INTO github_issue_cache')) {
          return {
            run: () => {
              throw new Error(
                'UNIQUE constraint failed: github_issue_cache.project_id, github_issue_cache.issue_number',
              );
            },
          } as unknown as ReturnType<DatabaseSync['prepare']>;
        }
        return originalPrepare(sql);
      });

      expect(() =>
        issues.insertQuickTask({
          projectId,
          title: 'collision',
          body: 'collision',
          threadId: thread.id,
        }),
      ).toThrow(
        'insertQuickTask: failed to allocate sentinel after 5 attempts (last: UNIQUE constraint failed:',
      );

      prepare.mockRestore();
    });
  });
});
