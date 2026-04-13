import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { createTestDb } from '../test-helpers';
import { ProjectQueries } from './projects';
import { ThreadQueries } from './threads';
import { GitHubIssueQueries } from './github-issues';

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
    };
  }

  it('upsert() creates a new record', () => {
    const record = issues.upsert(makeIssue());
    expect(record.id).toBeTruthy();
    expect(record.issueNumber).toBe(1);
    expect(record.title).toBe('Test Issue');
    expect(record.labels).toEqual(['bug']);
    expect(record.pipelineStatus).toBe('queued');
  });

  it('upsert() updates existing record by projectId+issueNumber', () => {
    issues.upsert(makeIssue());
    const updated = issues.upsert(makeIssue({ title: 'Updated Title' }));
    expect(updated.title).toBe('Updated Title');

    // Should still be one record
    const list = issues.list(projectId);
    expect(list.length).toBe(1);
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

    const updated = issues.getByNumber(projectId, 1)!;
    expect(updated.claimedAt).toBeNull();
    expect(updated.claimedBy).toBeNull();
    expect(updated.pipelineStatus).toBe('queued');
  });

  it('updatePipelineStatus() changes the status', () => {
    const record = issues.upsert(makeIssue());
    issues.updatePipelineStatus(record.id, 'planning');
    expect(issues.getByNumber(projectId, 1)!.pipelineStatus).toBe('planning');
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
    expect(record.ciBlocked).toBe(false);
    expect(record.failingChecks).toEqual([]);
    expect(record.unresolvedReviewComments).toEqual([]);
    expect(record.unresolvedReviewCommentCount).toBe(0);
    expect(record.prLastSyncAt).toBeNull();
  });

  it('updatePhaseModelOverride() persists values and can clear them', () => {
    const record = issues.upsert(makeIssue());

    issues.updatePhaseModelOverride(record.id, 'planner', 'openrouter');
    issues.updatePhaseModelOverride(record.id, 'reviewer', 'claude');
    issues.updatePhaseModelOverride(record.id, 'executor', 'openrouter');
    issues.updatePhaseModelOverride(record.id, 'verifier', 'claude');
    expect(issues.getByNumber(projectId, 1)!.plannerModelOverride).toBe('openrouter');
    expect(issues.getByNumber(projectId, 1)!.reviewerModelOverride).toBe('claude');
    expect(issues.getByNumber(projectId, 1)!.executorModelOverride).toBe('openrouter');
    expect(issues.getByNumber(projectId, 1)!.verifierModelOverride).toBe('claude');

    issues.updatePhaseModelOverride(record.id, 'planner', null);
    issues.updatePhaseModelOverride(record.id, 'reviewer', null);
    issues.updatePhaseModelOverride(record.id, 'executor', null);
    issues.updatePhaseModelOverride(record.id, 'verifier', null);
    expect(issues.getByNumber(projectId, 1)!.plannerModelOverride).toBeNull();
    expect(issues.getByNumber(projectId, 1)!.reviewerModelOverride).toBeNull();
    expect(issues.getByNumber(projectId, 1)!.executorModelOverride).toBeNull();
    expect(issues.getByNumber(projectId, 1)!.verifierModelOverride).toBeNull();
  });

  it('updatePhaseModelIdOverride() persists values and can clear them', () => {
    const record = issues.upsert(makeIssue());

    issues.updatePhaseModelIdOverride(record.id, 'planner', 'claude-opus-4-6');
    issues.updatePhaseModelIdOverride(record.id, 'reviewer', 'gpt-5.4-mini');
    issues.updatePhaseModelIdOverride(record.id, 'executor', 'gpt-5.4');
    issues.updatePhaseModelIdOverride(record.id, 'verifier', 'anthropic/claude-sonnet-4-6');

    expect(issues.getByNumber(projectId, 1)!.plannerModelIdOverride).toBe('claude-opus-4-6');
    expect(issues.getByNumber(projectId, 1)!.reviewerModelIdOverride).toBe('gpt-5.4-mini');
    expect(issues.getByNumber(projectId, 1)!.executorModelIdOverride).toBe('gpt-5.4');
    expect(issues.getByNumber(projectId, 1)!.verifierModelIdOverride).toBe(
      'anthropic/claude-sonnet-4-6',
    );

    issues.updatePhaseModelIdOverride(record.id, 'planner', null);
    issues.updatePhaseModelIdOverride(record.id, 'reviewer', null);
    issues.updatePhaseModelIdOverride(record.id, 'executor', null);
    issues.updatePhaseModelIdOverride(record.id, 'verifier', null);

    expect(issues.getByNumber(projectId, 1)!.plannerModelIdOverride).toBeNull();
    expect(issues.getByNumber(projectId, 1)!.reviewerModelIdOverride).toBeNull();
    expect(issues.getByNumber(projectId, 1)!.executorModelIdOverride).toBeNull();
    expect(issues.getByNumber(projectId, 1)!.verifierModelIdOverride).toBeNull();
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

    const updated = issues.getByNumber(projectId, 1)!;
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
    const record = issues.upsert(makeIssue({ labels: ['agent:claude'] }));

    issues.setCachedLabelPresence(record.id, 'blocked:ci', true);
    expect(issues.getByNumber(projectId, 1)?.labels).toContain('blocked:ci');

    issues.setCachedLabelPresence(record.id, 'blocked:ci', false);
    expect(issues.getByNumber(projectId, 1)?.labels).not.toContain('blocked:ci');
  });

  it('linkThread() sets the thread_id', () => {
    const record = issues.upsert(makeIssue());
    const threads = new ThreadQueries(db);
    const thread = threads.create(projectId, 'prompt', 'title');
    issues.linkThread(record.id, thread.id);
    expect(issues.getByNumber(projectId, 1)!.threadId).toBe(thread.id);
  });

  it('getRequeued() returns unclaimed queued records', () => {
    const r1 = issues.upsert(makeIssue({ issueNumber: 1 }));
    issues.upsert(makeIssue({ issueNumber: 2 }));

    // Claim and release r1 to make it queued+unclaimed
    issues.tryClaim(r1.id, 'inst');
    issues.releaseClaim(r1.id);

    // r2 is also queued+unclaimed by default
    const requeued = issues.getRequeued(projectId);
    expect(requeued.length).toBe(2);
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

  describe('close/reopen sync', () => {
    it('markCompletedOnClose() flips queued → completed (default source status)', () => {
      const record = issues.upsert(makeIssue());
      expect(record.pipelineStatus).toBe('queued');
      const changed = issues.markCompletedOnClose(record.id);
      expect(changed).toBe(true);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('completed');
    });

    it('markCompletedOnClose() flips todo → completed', () => {
      const record = issues.upsert(makeIssue());
      issues.updatePipelineStatus(record.id, 'todo');
      expect(issues.markCompletedOnClose(record.id)).toBe(true);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('completed');
    });

    it('markCompletedOnClose() flips awaiting_approval → completed', () => {
      const record = issues.upsert(makeIssue());
      issues.updatePipelineStatus(record.id, 'awaiting_approval');
      expect(issues.markCompletedOnClose(record.id)).toBe(true);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('completed');
    });

    it('markCompletedOnClose() flips failed → completed', () => {
      const record = issues.upsert(makeIssue());
      issues.updatePipelineStatus(record.id, 'failed');
      expect(issues.markCompletedOnClose(record.id)).toBe(true);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('completed');
    });

    it('markCompletedOnClose() does NOT flip executing (in-flight guard)', () => {
      const record = issues.upsert(makeIssue());
      issues.updatePipelineStatus(record.id, 'executing');
      expect(issues.markCompletedOnClose(record.id)).toBe(false);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('executing');
    });

    it('markCompletedOnClose() does NOT flip planning (in-flight guard)', () => {
      const record = issues.upsert(makeIssue());
      issues.updatePipelineStatus(record.id, 'planning');
      expect(issues.markCompletedOnClose(record.id)).toBe(false);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('planning');
    });

    it('markCompletedOnClose() is idempotent on already-completed rows', () => {
      const record = issues.upsert(makeIssue());
      issues.updatePipelineStatus(record.id, 'completed');
      expect(issues.markCompletedOnClose(record.id)).toBe(false);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('completed');
    });

    it('markReopenedOnOpen() flips completed → todo', () => {
      const record = issues.upsert(makeIssue());
      issues.updatePipelineStatus(record.id, 'completed');
      expect(issues.markReopenedOnOpen(record.id)).toBe(true);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('todo');
    });

    it('markReopenedOnOpen() is a no-op on non-completed source states', () => {
      const record = issues.upsert(makeIssue());
      // Default is 'queued'
      expect(issues.markReopenedOnOpen(record.id)).toBe(false);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('queued');

      issues.updatePipelineStatus(record.id, 'executing');
      expect(issues.markReopenedOnOpen(record.id)).toBe(false);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('executing');

      issues.updatePipelineStatus(record.id, 'failed');
      expect(issues.markReopenedOnOpen(record.id)).toBe(false);
      expect(issues.getByNumber(projectId, 1)?.pipelineStatus).toBe('failed');
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
      expect(found!.id).toBe(r.id);
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

    it('archiveIssues() only archives the exact ID set (race-safe)', () => {
      const r1 = issues.upsert(makeIssue({ issueNumber: 1 }));
      const r2 = issues.upsert(makeIssue({ issueNumber: 2 }));
      const r3 = issues.upsert(makeIssue({ issueNumber: 3 }));
      issues.archiveIssues([r1.id, r3.id]);
      const visible = issues.list(projectId);
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe(r2.id);
    });

    it('listCompleted() excludes archived and non-completed rows', () => {
      const r1 = issues.upsert(makeIssue({ issueNumber: 1 }));
      const r2 = issues.upsert(makeIssue({ issueNumber: 2 }));
      issues.upsert(makeIssue({ issueNumber: 3 }));
      issues.updatePipelineStatus(r1.id, 'completed');
      issues.updatePipelineStatus(r2.id, 'completed');
      // issue #3 stays queued
      issues.archiveIssues([r2.id]); // archive one completed
      const completed = issues.listCompleted(projectId);
      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe(r1.id);
    });

    it('clearArchivedAt() during reopen re-exposes the issue', () => {
      const r = issues.upsert(makeIssue({ issueNumber: 1 }));
      issues.updatePipelineStatus(r.id, 'completed');
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
});
