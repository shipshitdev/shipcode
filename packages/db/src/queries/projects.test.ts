import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { GitHubIssueQueries } from './github-issues';
import { ProjectQueries } from './projects';

describe('ProjectQueries', () => {
  let db: DatabaseSync;
  let projects: ProjectQueries;

  beforeEach(() => {
    db = createTestDb();
    projects = new ProjectQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('add() creates a project with basename as name', () => {
    const p = projects.add('/home/user/my-project');
    expect(p.id).toBeTruthy();
    expect(p.name).toBe('my-project');
    expect(p.path).toBe('/home/user/my-project');
    expect(p.defaultBranch).toBe('main');
    expect(p.createdAt).toBeTruthy();
    expect(p.updatedAt).toBeTruthy();
  });

  it('getById() returns project or null', () => {
    const p = projects.add('/tmp/a');
    expect(projects.getById(p.id)).toMatchObject({ id: p.id });
    expect(projects.getById('nonexistent')).toBeNull();
  });

  it('list() returns projects ordered by updated_at DESC', () => {
    const p1 = projects.add('/tmp/first');
    // Manually backdate p1 so p2 is definitively newer
    db.prepare("UPDATE projects SET updated_at = datetime('now', '-1 hour') WHERE id = ?").run(
      p1.id,
    );
    const p2 = projects.add('/tmp/second');
    const list = projects.list();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(p2.id);
    expect(list[1].id).toBe(p1.id);
  });

  it('remove() deletes the project', () => {
    const p = projects.add('/tmp/a');
    projects.remove(p.id);
    expect(projects.getById(p.id)).toBeNull();
  });

  it('remove() cascades to threads', () => {
    const p = projects.add('/tmp/a');
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt) VALUES ('t1', ?, 'title', 'prompt')",
    ).run(p.id);
    projects.remove(p.id);
    const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get('t1');
    expect(thread).toBeUndefined();
  });

  it('updateGitInfo() updates git_remote and default_branch', () => {
    const p = projects.add('/tmp/a');
    projects.updateGitInfo(p.id, 'git@github.com:foo/bar.git', 'develop');
    const updated = projects.getById(p.id);
    expect(updated).toBeTruthy();
    if (!updated) throw new Error('Expected updated project');
    expect(updated.gitRemote).toBe('git@github.com:foo/bar.git');
    expect(updated.defaultBranch).toBe('develop');
  });

  it('new projects default githubProjectUrl to null', () => {
    const p = projects.add('/tmp/gp-default');
    expect(p.githubProjectUrl).toBeNull();
  });

  it('updateGithubProjectUrl() persists a value', () => {
    const p = projects.add('/tmp/gp-set');
    projects.updateGithubProjectUrl(p.id, 'https://github.com/orgs/acme/projects/3');
    const updated = projects.getById(p.id);
    expect(updated).toBeTruthy();
    if (!updated) throw new Error('Expected updated project URL');
    expect(updated.githubProjectUrl).toBe('https://github.com/orgs/acme/projects/3');
  });

  it('updateGithubProjectUrl() clears to null', () => {
    const p = projects.add('/tmp/gp-clear');
    projects.updateGithubProjectUrl(p.id, 'https://github.com/orgs/acme/projects/3');
    projects.updateGithubProjectUrl(p.id, null);
    expect(projects.getById(p.id)?.githubProjectUrl).toBeNull();
  });

  it('updateGithubProjectUrl() round-trips through list()', () => {
    const p = projects.add('/tmp/gp-list');
    projects.updateGithubProjectUrl(p.id, 'https://github.com/users/alice/projects/7');
    const fromList = projects.list().find((x) => x.id === p.id);
    expect(fromList).toBeTruthy();
    if (!fromList) throw new Error('Expected project from list');
    expect(fromList.githubProjectUrl).toBe('https://github.com/users/alice/projects/7');
  });

  it('new projects default model overrides to null', () => {
    const p = projects.add('/tmp/project-overrides-default');
    expect(p.plannerModelOverride).toBeNull();
    expect(p.reviewerModelOverride).toBeNull();
    expect(p.executorModelOverride).toBeNull();
    expect(p.verifierModelOverride).toBeNull();
    expect(p.plannerModelIdOverride).toBeNull();
    expect(p.reviewerModelIdOverride).toBeNull();
    expect(p.executorModelIdOverride).toBeNull();
    expect(p.verifierModelIdOverride).toBeNull();
    expect(p.plannerReasoningEffortOverride).toBeNull();
    expect(p.reviewerReasoningEffortOverride).toBeNull();
    expect(p.executorReasoningEffortOverride).toBeNull();
    expect(p.verifierReasoningEffortOverride).toBeNull();
    expect(p.revisionCountOverride).toBeNull();
    expect(p.requireApprovalOverride).toBeNull();
    expect(p.discordRouting).toBe('inherit');
    expect(p.discordWebhookUrlOverride).toBeNull();
    expect(p.telegramRouting).toBe('inherit');
    expect(p.telegramChatIdOverride).toBeNull();
  });

  it('updateModelOverrides() persists values and clears back to null', () => {
    const p = projects.add('/tmp/project-overrides-set');
    projects.updateModelOverrides(p.id, {
      plannerModelOverride: 'openrouter',
      reviewerModelOverride: 'claude',
      executorModelOverride: 'codex',
      verifierModelOverride: 'claude',
      plannerModelIdOverride: 'openrouter/auto',
      reviewerModelIdOverride: 'claude-opus-4-6',
      executorModelIdOverride: 'gpt-5.4',
      verifierModelIdOverride: 'claude-sonnet-4-6',
      plannerReasoningEffortOverride: 'low',
      reviewerReasoningEffortOverride: 'medium',
      executorReasoningEffortOverride: 'high',
      verifierReasoningEffortOverride: 'medium',
      revisionCountOverride: 3,
      requireApprovalOverride: true,
      prdQualityGate: true,
    });

    let updated = projects.getById(p.id);
    expect(updated).toBeTruthy();
    if (!updated) throw new Error('Expected updated project overrides');
    expect(updated.plannerModelOverride).toBe('openrouter');
    expect(updated.reviewerModelOverride).toBe('claude');
    expect(updated.executorModelOverride).toBe('codex');
    expect(updated.verifierModelOverride).toBe('claude');
    expect(updated.plannerModelIdOverride).toBe('openrouter/auto');
    expect(updated.reviewerModelIdOverride).toBe('claude-opus-4-6');
    expect(updated.executorModelIdOverride).toBe('gpt-5.4');
    expect(updated.verifierModelIdOverride).toBe('claude-sonnet-4-6');
    expect(updated.plannerReasoningEffortOverride).toBe('low');
    expect(updated.reviewerReasoningEffortOverride).toBe('medium');
    expect(updated.executorReasoningEffortOverride).toBe('high');
    expect(updated.verifierReasoningEffortOverride).toBe('medium');
    expect(updated.revisionCountOverride).toBe(3);
    expect(updated.requireApprovalOverride).toBe(true);
    expect(updated.prdQualityGate).toBe(true);

    projects.updateModelOverrides(p.id, {
      plannerModelOverride: null,
      reviewerModelOverride: null,
      executorModelOverride: null,
      verifierModelOverride: null,
      plannerModelIdOverride: null,
      reviewerModelIdOverride: null,
      executorModelIdOverride: null,
      verifierModelIdOverride: null,
      plannerReasoningEffortOverride: null,
      reviewerReasoningEffortOverride: null,
      executorReasoningEffortOverride: null,
      verifierReasoningEffortOverride: null,
      revisionCountOverride: null,
      requireApprovalOverride: null,
      prdQualityGate: null,
    });

    updated = projects.getById(p.id);
    expect(updated).toBeTruthy();
    if (!updated) throw new Error('Expected cleared project overrides');
    expect(updated.plannerModelOverride).toBeNull();
    expect(updated.reviewerModelOverride).toBeNull();
    expect(updated.executorModelOverride).toBeNull();
    expect(updated.verifierModelOverride).toBeNull();
    expect(updated.plannerModelIdOverride).toBeNull();
    expect(updated.reviewerModelIdOverride).toBeNull();
    expect(updated.executorModelIdOverride).toBeNull();
    expect(updated.verifierModelIdOverride).toBeNull();
    expect(updated.plannerReasoningEffortOverride).toBeNull();
    expect(updated.reviewerReasoningEffortOverride).toBeNull();
    expect(updated.executorReasoningEffortOverride).toBeNull();
    expect(updated.verifierReasoningEffortOverride).toBeNull();
    expect(updated.revisionCountOverride).toBeNull();
    expect(updated.requireApprovalOverride).toBeNull();
    expect(updated.prdQualityGate).toBeNull();
  });

  it('persists GitHub repo identity and starter issue metadata', () => {
    const project = projects.add('/tmp/repo-identity', {
      githubRepoId: 'R_kgDOStarter',
      githubRepoFullName: 'shipshitdev/shipcode',
    });

    expect(project.githubRepoId).toBe('R_kgDOStarter');
    expect(project.githubRepoFullName).toBe('shipshitdev/shipcode');
    expect(projects.getByGithubRepoIdentity('R_kgDOStarter', null)?.id).toBe(project.id);

    projects.markStarterIssueSeeded(project.id, {
      starterIssueNumber: 101,
      starterIssueCreatedAt: '2026-04-21T10:00:00.000Z',
    });

    const updated = projects.getById(project.id);
    expect(updated?.starterIssueNumber).toBe(101);
    expect(updated?.starterIssueCreatedAt).toBe('2026-04-21T10:00:00.000Z');
  });

  it('updateNotificationRouting() persists values and clears back to inherit/null', () => {
    const p = projects.add('/tmp/project-routing-set');
    projects.updateNotificationRouting(p.id, {
      discordRouting: 'custom',
      discordWebhookUrlOverride: 'https://discord.com/api/webhooks/123/abc',
      telegramRouting: 'custom',
      telegramChatIdOverride: '-1001234567890',
    });

    let updated = projects.getById(p.id);
    expect(updated?.discordRouting).toBe('custom');
    expect(updated?.discordWebhookUrlOverride).toBe('https://discord.com/api/webhooks/123/abc');
    expect(updated?.telegramRouting).toBe('custom');
    expect(updated?.telegramChatIdOverride).toBe('-1001234567890');

    projects.updateNotificationRouting(p.id, {
      discordRouting: 'inherit',
      discordWebhookUrlOverride: null,
      telegramRouting: 'disabled',
      telegramChatIdOverride: null,
    });

    updated = projects.getById(p.id);
    expect(updated?.discordRouting).toBe('inherit');
    expect(updated?.discordWebhookUrlOverride).toBeNull();
    expect(updated?.telegramRouting).toBe('disabled');
    expect(updated?.telegramChatIdOverride).toBeNull();
  });

  it('add() is idempotent: re-adding same path returns existing row', () => {
    const first = projects.add('/tmp/same');
    const second = projects.add('/tmp/same');
    expect(second.id).toBe(first.id);
    expect(projects.list().length).toBe(1);
  });

  it('add() restores an archived project when re-adding its path', () => {
    const p = projects.add('/tmp/old');
    expect(projects.archiveIfIdle(p.id)).toBe(true);
    expect(projects.getById(p.id)?.archived).toBe(true);

    const restored = projects.add('/tmp/old');
    expect(restored.id).toBe(p.id);
    expect(restored.archived).toBe(false);
  });

  it('add() resets queued issues to todo when restoring an archived project', () => {
    const issues = new GitHubIssueQueries(db);
    const p = projects.add('/tmp/restore-queue');
    const issue = issues.upsert({
      projectId: p.id,
      issueNumber: 1,
      title: 'Stale issue',
      body: '',
      labels: [],
      assignee: null,
      state: 'open',
    });
    issues.updatePipelineStatus(issue.id, 'queued');
    expect(projects.archiveIfIdle(p.id)).toBe(true);

    projects.add('/tmp/restore-queue');

    const after = issues.getByNumber(p.id, 1);
    expect(after?.pipelineStatus).toBe('todo');
    expect(after?.lastPhaseUpdate).toBeNull();
  });

  it('unarchive() resets queued issues to todo', () => {
    const issues = new GitHubIssueQueries(db);
    const p = projects.add('/tmp/unarchive-queue');
    const issue = issues.upsert({
      projectId: p.id,
      issueNumber: 1,
      title: 'Stale issue',
      body: '',
      labels: [],
      assignee: null,
      state: 'open',
    });
    issues.updatePipelineStatus(issue.id, 'queued');
    expect(projects.archiveIfIdle(p.id)).toBe(true);

    projects.unarchive(p.id);

    const after = issues.getByNumber(p.id, 1);
    expect(after?.pipelineStatus).toBe('todo');
  });

  // === listVisible / listArchived ===

  it('listVisible() excludes archived rows, listArchived() returns only archived', () => {
    const active = projects.add('/tmp/active');
    const archived = projects.add('/tmp/archived');
    projects.archiveIfIdle(archived.id);

    const visible = projects.listVisible();
    expect(visible.map((p) => p.id)).toEqual([active.id]);

    const arch = projects.listArchived();
    expect(arch.map((p) => p.id)).toEqual([archived.id]);

    const all = projects.list();
    expect(all.length).toBe(2);
  });

  // === hasLiveWork / archiveIfIdle / removeIfIdle ===

  it('archiveIfIdle() succeeds on a project with no live work', () => {
    const p = projects.add('/tmp/quiet');
    expect(projects.hasLiveWork(p.id)).toBe(false);
    expect(projects.archiveIfIdle(p.id)).toBe(true);
    expect(projects.getById(p.id)?.archived).toBe(true);
  });

  it('archiveIfIdle() is blocked by a thread in an active status', () => {
    const p = projects.add('/tmp/busy-thread');
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt, status) VALUES ('t1', ?, 'title', 'prompt', 'executing')",
    ).run(p.id);
    expect(projects.hasLiveWork(p.id)).toBe(true);
    expect(projects.archiveIfIdle(p.id)).toBe(false);
    expect(projects.getById(p.id)?.archived).toBe(false);
  });

  it('completed threads do NOT block archive/remove', () => {
    const p = projects.add('/tmp/done-thread');
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt, status) VALUES ('t1', ?, 'title', 'prompt', 'completed')",
    ).run(p.id);
    expect(projects.hasLiveWork(p.id)).toBe(false);
    expect(projects.archiveIfIdle(p.id)).toBe(true);
    projects.unarchive(p.id);
    expect(projects.removeIfIdle(p.id)).toBe(true);
  });

  it('archiveIfIdle() is blocked by an undismissed notification', () => {
    const p = projects.add('/tmp/notif');
    // Notifications have a NOT NULL thread_id FK, and inserting any thread
    // fires the auto-unarchive trigger on archived projects — so we insert
    // a terminal (completed) thread which does NOT count as live work.
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt, status) VALUES ('t-notif', ?, 'title', 'prompt', 'completed')",
    ).run(p.id);
    db.prepare(
      "INSERT INTO notifications (id, thread_id, project_id, kind, title, body) VALUES ('n1', 't-notif', ?, 'test', 'title', 'body')",
    ).run(p.id);
    expect(projects.hasLiveWork(p.id)).toBe(true);
    expect(projects.archiveIfIdle(p.id)).toBe(false);
  });

  it('archiveIfIdle() can ignore stale notifications during missing-repo cleanup', () => {
    const p = projects.add('/tmp/notif-missing');
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt, status) VALUES ('t-notif-missing', ?, 'title', 'prompt', 'completed')",
    ).run(p.id);
    db.prepare(
      "INSERT INTO notifications (id, thread_id, project_id, kind, title, body) VALUES ('n-missing', 't-notif-missing', ?, 'test', 'title', 'body')",
    ).run(p.id);
    expect(projects.hasLiveWork(p.id)).toBe(true);
    expect(projects.hasLiveWork(p.id, { ignoreAttentionOnly: true })).toBe(false);
    expect(projects.archiveIfIdle(p.id, { ignoreAttentionOnly: true })).toBe(true);
  });

  it('archiveIfIdle() is blocked by a claimed github_issue_cache row (orphaned-claim case)', () => {
    const p = projects.add('/tmp/claimed');
    db.prepare(
      `INSERT INTO github_issue_cache (id, project_id, issue_number, title, claimed_at, claimed_by)
			 VALUES ('i1', ?, 1, 'title', datetime('now'), 'bot')`,
    ).run(p.id);
    expect(projects.hasLiveWork(p.id)).toBe(true);
    expect(projects.archiveIfIdle(p.id)).toBe(false);
    expect(projects.removeIfIdle(p.id)).toBe(false);
  });

  it('removeIfIdle() can ignore stale claimed issues during missing-repo cleanup', () => {
    const p = projects.add('/tmp/claimed-missing');
    db.prepare(
      `INSERT INTO github_issue_cache (id, project_id, issue_number, title, claimed_at, claimed_by)
       VALUES ('i-missing', ?, 1, 'title', datetime('now'), 'bot')`,
    ).run(p.id);
    expect(projects.hasLiveWork(p.id)).toBe(true);
    expect(projects.hasLiveWork(p.id, { ignoreAttentionOnly: true })).toBe(false);
    expect(projects.removeIfIdle(p.id, { ignoreAttentionOnly: true })).toBe(true);
    expect(projects.getById(p.id)).toBeNull();
  });

  it('removeIfIdle() returns false when live work appears', () => {
    const p = projects.add('/tmp/race');
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt, status) VALUES ('t1', ?, 'title', 'prompt', 'planning')",
    ).run(p.id);
    expect(projects.removeIfIdle(p.id)).toBe(false);
    expect(projects.getById(p.id)).not.toBeNull();
  });

  it('ignoreAttentionOnly still blocks active thread work', () => {
    const p = projects.add('/tmp/busy-missing');
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt, status) VALUES ('t-busy', ?, 'title', 'prompt', 'executing')",
    ).run(p.id);
    expect(projects.hasLiveWork(p.id, { ignoreAttentionOnly: true })).toBe(true);
    expect(projects.archiveIfIdle(p.id, { ignoreAttentionOnly: true })).toBe(false);
    expect(projects.removeIfIdle(p.id, { ignoreAttentionOnly: true })).toBe(false);
  });

  // === auto-unarchive triggers ===

  it('trigger: inserting a new thread on an archived project unarchives it', () => {
    const p = projects.add('/tmp/trigger-thread');
    projects.archiveIfIdle(p.id);
    expect(projects.getById(p.id)?.archived).toBe(true);
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt) VALUES ('t1', ?, 'title', 'prompt')",
    ).run(p.id);
    expect(projects.getById(p.id)?.archived).toBe(false);
  });

  it('trigger: inserting a new notification on an archived project unarchives it', () => {
    const p = projects.add('/tmp/trigger-notif');
    // Seed a terminal thread first (required by notifications.thread_id FK).
    // The thread INSERT also fires the auto-unarchive trigger, so we archive
    // AFTER the thread is in place.
    db.prepare(
      "INSERT INTO threads (id, project_id, title, prompt, status) VALUES ('t-notif', ?, 'title', 'prompt', 'completed')",
    ).run(p.id);
    projects.archiveIfIdle(p.id);
    expect(projects.getById(p.id)?.archived).toBe(true);
    db.prepare(
      "INSERT INTO notifications (id, thread_id, project_id, kind, title, body) VALUES ('n1', 't-notif', ?, 'test', 'title', 'body')",
    ).run(p.id);
    expect(projects.getById(p.id)?.archived).toBe(false);
  });

  it('trigger: inserting a new github_issue_cache row on an archived project unarchives it', () => {
    const p = projects.add('/tmp/trigger-issue');
    projects.archiveIfIdle(p.id);
    expect(projects.getById(p.id)?.archived).toBe(true);
    db.prepare(
      `INSERT INTO github_issue_cache (id, project_id, issue_number, title) VALUES ('i1', ?, 1, 'title')`,
    ).run(p.id);
    expect(projects.getById(p.id)?.archived).toBe(false);
  });

  it('trigger: updating claimed_at on a cached issue unarchives the project', () => {
    const p = projects.add('/tmp/trigger-claim');
    // Seed an unclaimed cached issue first
    db.prepare(
      `INSERT INTO github_issue_cache (id, project_id, issue_number, title) VALUES ('i1', ?, 1, 'title')`,
    ).run(p.id);
    // Now archive the project (the insert already fired the trigger — re-archive)
    projects.archiveIfIdle(p.id);
    expect(projects.getById(p.id)?.archived).toBe(true);
    // Transition claimed_at NULL → non-NULL
    db.prepare(`UPDATE github_issue_cache SET claimed_at = datetime('now') WHERE id = 'i1'`).run();
    expect(projects.getById(p.id)?.archived).toBe(false);
  });

  it('trigger: metadata updates on a cached issue do NOT unarchive', () => {
    const p = projects.add('/tmp/trigger-metadata');
    db.prepare(
      `INSERT INTO github_issue_cache (id, project_id, issue_number, title) VALUES ('i1', ?, 1, 'title')`,
    ).run(p.id);
    projects.archiveIfIdle(p.id);
    expect(projects.getById(p.id)?.archived).toBe(true);
    // Update only title — claimed_at stays NULL
    db.prepare(`UPDATE github_issue_cache SET title = 'new title' WHERE id = 'i1'`).run();
    expect(projects.getById(p.id)?.archived).toBe(true);
  });

  // === pin ===

  it('pin() toggles the pinned flag', () => {
    const p = projects.add('/tmp/pin');
    expect(p.pinned).toBe(false);
    projects.pin(p.id, true);
    expect(projects.getById(p.id)?.pinned).toBe(true);
    projects.pin(p.id, false);
    expect(projects.getById(p.id)?.pinned).toBe(false);
  });

  it('archiveIfIdle() clears pinned state as a side effect', () => {
    const p = projects.add('/tmp/pin-then-archive');
    projects.pin(p.id, true);
    expect(projects.getById(p.id)?.pinned).toBe(true);
    expect(projects.archiveIfIdle(p.id)).toBe(true);
    const after = projects.getById(p.id);
    expect(after).toBeTruthy();
    if (!after) throw new Error('Expected archived project');
    expect(after.archived).toBe(true);
    expect(after.pinned).toBe(false);
  });
});
